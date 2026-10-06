# Explore Finds — project brief for Claude Code

Chrome extension (Manifest V3) that captures the songs used in posts on the user's Instagram
Explore feed, shows them in a side panel, matches them on Spotify, plays them in the panel,
and builds a Spotify playlist. Personal tool for now; public release is undecided (see the end).

Owner: Jkidd (Jason). Direct, wants things verified, not guessed. Has Spotify Premium. On a Mac.

## Current status (v0.5.0)

Working: capture from Explore, list with roll-in animation, Spotify connect (PKCE), background
matching, manual "Choose" picker for misses, playlist create / add-new-songs, CSV/debug export,
Clear, auto re-attach to open Instagram tabs after an extension update.

**Open problem: the in-panel Play button is temperamental.** Sometimes pressing Play starts the
song, sometimes the docked player loads but doesn't play. This is the top priority. See
"Playback" below before touching it.

## Layout

```
extension/          the unpacked extension (load this folder in chrome://extensions)
  manifest.json     MV3. Has a "key" field that pins the extension ID — never remove it.
  inject.js         MAIN-world content script. Wraps fetch/XHR on instagram.com, parses
                    responses for music, posts results with window.postMessage.
                    MUST stay wrapped in an IIFE: it can be injected twice into one page.
  bridge.js         ISOLATED-world content script. Receives postMessages, merges into
                    chrome.storage.local. Detaches itself when the extension context dies.
  background.js     Side panel opens on toolbar click. On install/update, re-injects
                    inject.js + bridge.js into open Instagram tabs.
  sidepanel.html/css/js   The UI. ES modules.
  spotify.js        Spotify Web API: PKCE auth via chrome.identity, search + matching,
                    playlists. Also contains unused Spotify Connect helpers.
  embed.js          EmbedPlayer: drives the Spotify embed iframe docked at the bottom.
tests/
  sim/spotify-sim.mjs     Simulated Spotify Web API (search, playlists, Connect quirks).
  unit/*.test.mjs         jsdom + vm tests (parser, re-injection, bridge, CSS, panel flows).
  browser/*.test.js       Real Chrome via puppeteer with a fake Spotify embed (fake-embed.html)
                          served by request interception.
```

Storage keys (chrome.storage.local): `tracks`, `log`, `samples`, `matches`, `excluded`,
`spotify` (clientId + tokens), `playlist`, `playbackDevice` (legacy).

Pinned extension ID: `adnfnkniiefhlojabhejngpkefohmnhg`
Spotify Redirect URI: `https://adnfnkniiefhlojabhejngpkefohmnhg.chromiumapp.org/`
The Spotify Client ID lives in the user's extension storage, not in code.

## How capture works

Instagram's web app already fetches post data while the user scrolls. inject.js reads those
responses (no requests of its own, no credentials). Signals: any object with `title` +
`display_artist` = licensed song; any non-null `original_sound_info` = creator audio. The nearest
ancestor with `code` + `media_type`/`product_type` is the post. First real session: ~25% of
Explore audio was licensed songs.

## Spotify constraints (verified Oct 2026, re-check if something breaks)

- Development mode: max 5 allowlisted users per app; the app owner must have Premium.
  Extended quota: organizations only, 250k MAU minimum (since May 15, 2025).
- February 2026 API changes: create playlist is `POST /me/playlists`; add tracks is
  `POST /playlists/{id}/items` (body `{uris}`), search `limit` max 10, `popularity` removed.
- `error=server_error` at /authorize usually means the account isn't in the app's
  User Management list.

## Playback — history and current hypotheses

1. v0.2: Spotify embed iframe. Worked, but the user had to press play inside the embed.
2. v0.3–v0.4.6: Spotify Connect (play on the desktop app via Web API). Failed repeatedly on the
   user's Mac: idle device accepted play but didn't start; /me/player reported no active device
   after a transfer; added wake/escalation/confirmation logic. Still unreliable. Abandoned.
3. v0.5.0 (current): back to the embed, docked at the bottom. `embed.js` loads
   `https://open.spotify.com/embed/track/{id}` and sends `postMessage({command:'toggle'})`.
   `toggle` (and `pause`) are confirmed by Spotify's embed team in their forum. The message
   shapes we LISTEN for (`{type:'ready'}`, `{type:'playback_update', payload:{isPaused, position,
   duration}}`) are guesses based on the iFrame API docs and have NOT been verified against the
   real embed.

Ranked hypotheses for "temperamental":
1. **State desync with a non-idempotent toggle.** If the real embed's messages don't match what
   embed.js expects, `state.playing` stays false; the next click sends `toggle` again and pauses
   a song that was actually playing.
2. **Toggle sent too early.** With no recognized `ready`, embed.js waits iframe `load` + 800ms;
   the embed may not be ready, so the command is dropped.
3. **Autoplay policy.** Chrome's transient user activation (~5s) can expire while the iframe
   reloads for each song. Each song creates a new iframe document.
4. Commands like `resume`/`play` may exist and be idempotent; unverified.

**Do this first: observe, don't guess.** In the real side panel (right-click inside the panel →
Inspect), log every message whose origin is `https://open.spotify.com` while (a) pressing play
inside the embed by hand and (b) pressing our Play button. Write the exact message shapes into
this file. Then update `tests/browser/fake-embed.html` to match reality before changing code.

Candidate fixes once the protocol is known:
- Use idempotent commands if they exist; never send `toggle` blind.
- Keep one persistent embed iframe and switch songs without reloading it (the official iFrame
  API has `loadUri`; its script is remote, which MV3 extension pages can't load — check whether a
  sandboxed extension page with a custom sandbox CSP may load it, and whether that is allowed).
- Heavier but fully controllable: Spotify Web Playback SDK in a sandboxed page (needs the
  `streaming` scope + Premium; the panel becomes its own Connect device).

## Testing rules (learned the hard way)

- Run `cd tests && npm install && npm test`. Browser tests use full puppeteer by default.
- **Headless Chrome does not enforce the autoplay policy** (verified: audio plays without any
  click under every flag). Autoplay can only be judged with `HEADFUL=1` or in the real extension.
- jsdom does no layout: anything about visibility/scroll must be checked in the browser tests.
- Real Spotify is never reached by tests. A fix is not "done" until it's verified in the real
  extension on the user's Mac. Say plainly what was and wasn't verified.

## Things that broke before (don't regress)

- `[hidden]` was overridden by `display:grid` → keep `html [hidden] { display:none !important }`
  at the end of sidepanel.css.
- `body { height:100% }` broke sticky header/footer after scrolling → keep `min-height`.
- Top-level `const` in inject.js crashed on re-injection → keep the IIFE.
- Loading the extension from a new folder used to change its ID and wipe storage → the manifest
  `key` fixes this. Removing the extension in Chrome still deletes its storage.
- Matcher accepted "Song 1" for "Song 10" and "Future Islands" for "Future" → whole-word
  matching only.

## Conventions

- Bump `version` in manifest.json for every change the user will load; the panel shows it.
- After changes: user clicks reload on the extension in chrome://extensions, then reloads the
  Instagram tab only if the content scripts changed.
- Keep UI copy plain and short (sentence case, no jargon).

## Public release (undecided)

Risks: Meta's terms prohibit automated collection without permission (Meta sued BrandTotal over
browser extensions and had one removed from the Chrome Web Store); local-only data helps but
isn't an exemption. Spotify dev mode caps at 5 users unless each user brings their own Client ID.
Options discussed: open source on GitHub (lowest risk), free Web Store listing, or paid (lawyer
first).
