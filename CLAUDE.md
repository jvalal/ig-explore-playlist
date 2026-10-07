# Explore Finds — project brief for Claude Code

Chrome extension (Manifest V3) that captures the songs used in posts on the user's Instagram
Explore feed, shows them in a side panel, matches them on Spotify, plays them in the panel,
and builds a Spotify playlist. Personal tool for now; public release is undecided (see the end).

Owner: Jkidd (Jason). Direct, wants things verified, not guessed. Has Spotify Premium. On a Mac.

## Current status (v0.8.0)

v0.6.0 is a rebuild (see REVIEW.md for why). The v0.5.0 code is in `legacy/` for reference only;
it is never loaded and its tests aren't maintained.

Carried over from v0.5.0: capture from Explore, list with roll-in animation, Spotify connect
(PKCE), background matching, manual "Choose" picker for misses, playlist create / add-new-songs,
CSV/debug export, Clear, auto re-attach to open Instagram tabs after an extension update.

New in v0.6.0:
- The player is rebuilt from the observed embed protocol (below).
- The matcher prefers originals over remix/live versions, rejects karaoke/cover, and no longer
  matches a one-word title inside a longer one ("Love" ≠ "Love Me Do"). `MATCHER_VERSION` is 3, so
  older misses are retried.
- Token refresh is single-flight.
- The playlist is saved before songs are added, so a failed add can't orphan it.
- Bridge writes are batched for responses without music. Since v0.6.10 captures with songs are
  written at once. Measured: storage write → row on screen in the panel is 10–20 ms. No
  keep-alive is needed: the service worker isn't in the capture path (content script →
  storage → open panel).
- The panel shows songs only: the Original audio tab is gone. Original audio is still captured,
  stored and included in the CSV.
- "Debug data" is a small muted link next to the version, no longer a button.
- Every Instagram link people tap ends in `#weblink` (dom.js `webLink`), so on iPhone it opens in
  Safari, not the Instagram app; see MOBILE.md. The CSV keeps plain post URLs.
- Explore only: songs from the home feed, Reels and other pages are no longer kept or listed.
- The status line reads "N Explore posts checked, M songs found". M is the list's own count. N is
  distinct Explore post shortcodes: inject.js collects every post code it walks (`posts` on the
  message), the bridge keeps them in storage key `seen` (Explore only, ≤ 20 000, cleared by Clear),
  and the panel adds the posts behind listed songs, so N ≥ M. Responses without music keywords
  aren't parsed, so their posts aren't counted. Log entries carry `songs`, `hits` and `posts`
  counts for the debug export.
- **Play playlist** is back as an understated pill button with a play/pause icon (`.pill`), a little
  to the right of the playlist name. It plays the playlist built by this panel in Spotify. Its
  label is Play / Pause / Resume / Starting…. It loads the playlist embed in the dock, and the
  embed moves through the playlist by itself (Prev/Next are off). Pressing a song's Play takes
  over.

New in v0.7.0 (2026-10-05, built overnight, **not yet tried in the user's Chrome**):
- **Song goal** (goal.js): a Goal menu (Off/10/20/30/50/100) beside the count. It shows "18 of 30
  songs", a thin progress bar, and plays one soft chime when the count *crosses* the goal (not on
  load, not again on later renders). Nothing scrolls Instagram; that was ruled out (Meta's terms on
  automated collection, and account risk).
- **Auto-add** (`syncMatched` in build.js): a checkbox under the playlist line. When on, songs
  that are already matched are added to the existing playlist ~1.5 s after they change. It skips
  unchecked songs and misses, never creates a playlist and never searches Spotify itself (prematch
  does). After an error it pauses 60 s instead of retrying on every capture. Build waits for an
  auto-add in flight, so nothing is added twice.
- Both settings live in storage key `prefs` ({goal, autoSync}), which Clear keeps.

New in v0.7.1: **Spotify setup helper** (spotify-dashboard.js, content script on
developer.spotify.com/dashboard*). It's the main step in bring-your-own-Client-ID setup, the way
around Spotify's 5-users-per-Client-ID cap.
- On *Create app* it fills empty fields: name, description, Redirect URI (via Spotify's own Add
  button) and the Web API box. It **never ticks Spotify's terms and never clicks Save**: accepting
  the terms is the person's own act.
- On an app page, `/dashboard/{32-hex Client ID}` (read from the URL, not the page), it offers
  "Use this app", which saves the Client ID like the panel's Save.
- Field ids come from the live page on 2026-10-06 (`#name`, `#description`, `#newRedirectUri`,
  `button[aria-label="Add redirect URI"]`, checkbox labelled "Web API", `#termsAccepted`).
  Verified once on the real page via Claude in Chrome: React accepted the values and the URI
  was listed. The form was not saved. If Spotify changes the page, the helper says it couldn't
  fill the form, and the manual steps in the panel still apply.

New in v0.8.0: **pop-out mini player**, so music keeps playing after the side panel closes
(Chrome unloads the panel's page, and the embed with it).
- **The window:** `player.html` is a popup window (360x200). background.js opens it on
  `{type:'ef-open-mini', key | playlist, from}` and keeps its id in `storage.session.miniWindowId`.
  It checks the window still exists, and focuses it instead of opening a second one.
- **Shared code:** it uses the same `Player` (embed control) and `Playback` (queue, Next/Prev,
  auto-advance) as the panel. The queue is the song list in storage, so Next and auto-advance work
  with the panel closed.
- **Who plays:** while the mini player is open it is the only player. The panel sends Play
  presses as `{type:'ef-player', cmd: play|toggle|playlist|next|prev|close, key}`, and its rows
  mirror storage `nowPlaying` ({host:'mini', key, playlist, status}), which the mini player writes.
- **Pop out:** the "Pop out" button by the docked player stops it and opens the mini player on the
  same song, continuing where it was (`startAt` from `Player.currentSeconds()` → embed `t`;
  v0.8.2). Back to panel and Keep on top continue the same way. A playlist starts again from its
  first song.
- **Back to panel** (v0.8.1) is the reverse of Pop out. It opens the side panel in the window the
  mini player came from, leaves `popIn` ({key | playlist, windowId, at}) in storage, and closes
  the mini window. The panel picks the song up in its docked player.
- **When Chrome refuses to start sound** (`blocked`) in the mini or floating window, it shows its
  own **Play** button. One click in that window starts it, and Next works without another click
  (verified in Chrome for Testing). The user saw the mini window not auto-start in their own
  Chrome when popping out from the side panel. In Chrome for Testing it started by itself, even
  from the real side panel, so the cause in their Chrome is unknown.
- **Keep on top:** Document Picture-in-Picture works from player.html (Chrome for Testing 155). It
  moves the player into an always-on-top window and back. The floating window closes with the
  window that opened it, so the mini window minimizes itself meanwhile, with a "playing in the
  floating window" note, and comes back when the floating window closes (v0.8.1). Moving an iframe reloads it; the
  song is reloaded at its position. In a fresh profile, Chrome's autoplay rules held the start in the new
  window for ~10 s (the "press play" hint shows meanwhile). It started at once with autoplay
  allowed.
- **Real-browser test:** `tests/real/mini-player.real.mjs`, with real Spotify embeds and not
  in `npm test`. It uses Chrome for Testing (~/.cache/cft, unpacked with `ditto` so the app
  launches), because branded Chrome no longer loads unpacked extensions from the command line.
- Safari build: excluded (no windows API on iPhone); the Pop out button is hidden there.

Verified so far:
- **Embed protocol:** verified in the user's real Chrome (side panel, logged in) and in headless
  Chrome.
- **The v0.6.0 extension:** verified only by the automated tests. Not yet loaded in the user's
  Chrome as of 2026-10-05.

## Layout

```
extension/          the unpacked extension (load this folder in chrome://extensions)
  manifest.json     MV3. Has a "key" field that pins the extension ID — never remove it.
  inject.js         MAIN-world content script. Wraps fetch/XHR on instagram.com, parses
                    responses for music, posts results with window.postMessage.
                    MUST stay wrapped in an IIFE: it can be injected twice into one page.
  bridge.js         ISOLATED-world content script. Receives postMessages, merges into
                    chrome.storage.local. Captures with songs are written at once; responses
                    without music are batched (≤ 1 write / 500 ms). Detaches itself when
                    the extension context dies.
  background.js     Side panel opens on toolbar click. On install/update, re-injects
                    inject.js + bridge.js into open Instagram tabs.
  sidepanel.html/css   The panel. sidepanel.js is the controller; it wires these ES modules:
    store.js        in-memory copy of storage, kept current from onChanged deltas
    list.js         keyed list render (rows rebuilt only when their content changes)
    match-queue.js  one matching queue for background prematch, Play and Build
    build.js        playlist create / add, and auto-add (syncMatched)
    goal.js         song goal: count, progress bar, chime
    setup.js, exports.js, dom.js
    playback.js     what is playing / was pressed; list order for Next/Prev/auto-advance
    player.js       drives the embed iframe (protocol below); shared with the mini player
  player.html, mini.js, mini.css   pop-out mini player window (desktop only)
  spotify.js        Spotify Web API: PKCE auth via chrome.identity, search + matching, playlists.
  spotify-dashboard.js  Content script on developer.spotify.com/dashboard*: setup helper.
tests/              npm test = unit + browser. run.mjs fails on any FAIL line or non-zero exit.
  unit/*.test.mjs   jsdom/vm/node: parser, re-injection, bridge, CSS, matcher, auth, panel
                    flows, player (replays message sequences from the real-Chrome log).
  browser/          Real Chrome via puppeteer: layout, and playback against fake-embed.html,
                    which reproduces the observed protocol. Uses the installed Chrome.
  sim/              Spotify Web API sim (token, /me, search, playlists) + chrome.storage stub.
tools/embed-probe/  Temporary unpacked extension that logs embed messages; logs/ has the runs.
legacy/             v0.5.0 extension + tests, reference only.
platforms/safari/   Safari (iPhone) build parts: manifest, background (login, button count,
                    opens setup on install), platform.js (tab + loopback login), popup.css,
                    onboarding.html/js/css (setup page). Shared code stays in extension/.
                    setup.js shows the desktop steps or, when PLATFORM is 'safari', a link
                    to onboarding.html.
tools/build-safari.mjs  assembles dist/safari (gitignored). tools/ios-sim.sh: Xcode → Simulator.
extension/platform.js   desktop platform (chrome.identity); the Safari build swaps this file.
```

Storage keys (chrome.storage.local): `tracks`, `log`, `samples`, `seen`, `prefs`, `matches`, `excluded`,
`spotify` (clientId + tokens), `playlist`. (`playbackDevice` from v0.4 may linger; unused.)

Pinned extension ID: `adnfnkniiefhlojabhejngpkefohmnhg`
Spotify Redirect URI: `https://adnfnkniiefhlojabhejngpkefohmnhg.chromiumapp.org/`
The Spotify Client ID lives in the user's extension storage, not in code.

## How capture works

Instagram's web app already fetches post data while the user scrolls. inject.js reads those
responses (no requests of its own, no credentials). Signals: any object with `title` +
`display_artist` = licensed song; any non-null `original_sound_info` = creator audio. The nearest
ancestor with `code` + `media_type`/`product_type` is the post.

**Explore only (since v0.6.4).** Capture runs on every instagram.com page, but the bridge keeps
songs only when the area is `explore`, and the panel lists only tracks with `areas.explore`.
Every response is still logged with its area. The area comes from the page path, except that a
home-feed response is always `home`. The Explore page also fetches the first page of the home
feed (`PolarisFeedTimelineRootV2Query`, `xdt_api__v1__feed__timeline__connection`), including
suggested reels (`explore_story`). Before v0.6.3 those were counted as Explore on every refresh.
There is no "Only from Explore" checkbox any more.

The grid responses fetched while scrolling Explore carry the music, so nothing has to be opened
(the user's experience with earlier builds, 2026-10-05). The first screen of the grid arrives in
the page HTML (`#embedded`), with the post data as **JSON inside a string** (escaped quotes). Up to
v0.6.7 the parser didn't look inside such strings, so first-screen songs only registered once a
post was opened (it fetches `/api/v1/media/{id}/info/`). The export of 2026-10-05 had 8 songs in it.
Since v0.6.8 `extract()` also parses string values that start with `{`/`[` and mention a music
field. Opening a post from the grid changes the URL to `/p/…` or `/reel/…`. Since v0.6.6 inject.js
sends `via`, the last non-post page, so a post opened from Explore counts as `explore`. One
opened from Home or a profile, or loaded directly (`via` null), is `post` and isn't kept. `page` and
`via` are recorded when the request is made, not when the response is parsed. Before v0.6.6 a
slow response could be labelled with the page the person had moved on to.

The debug export includes the extension `version`. When a response mentions music fields but
yields no songs, its sample holds short excerpts around those fields (`[no songs extracted]`)
instead of raw text. First real session: ~25% of
Explore audio was licensed songs.

## Spotify constraints (verified Oct 2026, re-check if something breaks)

- Development mode: max 5 allowlisted users per app; the app owner must have Premium.
  Extended quota: organizations only, 250k MAU minimum (since May 15, 2025).
- February 2026 API changes: create playlist is `POST /me/playlists`; add tracks is
  `POST /playlists/{id}/items` (body `{uris}`), search `limit` max 10, `popularity` removed.
- `error=server_error` at /authorize usually means the account isn't in the app's
  User Management list.

## Playback

History:
1. **v0.2:** Spotify embed. It worked, but the user had to press play inside it.
2. **v0.3–v0.4.6:** Spotify Connect. Never reliable on the user's Mac; abandoned.
3. **v0.5.0:** the embed again, with a blind `toggle` and guessed message shapes. It was
   "temperamental". REVIEW.md lists the causes found.
4. **v0.6.0:** the embed, driven by the protocol below, which was observed rather than guessed.

### Spotify embed protocol (observed 2026-10-05, Chrome 154)

Sources:
- `tools/embed-probe/logs/2026-10-05-real-chrome-sidepanel.json`: the user's Chrome, inside an
  extension side panel, logged in to Spotify.
- `…-headless-logged-out.txt`: headless Chrome, logged out.

Re-run the probe if anything here stops matching.

Embed URL: `https://open.spotify.com/embed/track/{id}?utm_source=generator`, with iframe
`allow="autoplay; encrypted-media; …"`. All messages have origin `https://open.spotify.com`.

**From the embed:**

| Message | When |
|---|---|
| `{type:'ready'}` | Once per document, ~150–1300 ms after setting `src`. It can arrive before or after the iframe's `load` event. |
| `{type:'playback_update', payload:{isPaused, isBuffering, duration, position, playingURI}}` | Times are in ms. Sent every ~250 ms in real Chrome (~1 s headless) while playing, and on every change. `duration` wobbles by tens of ms between updates. |
| `{type:'playback_started', payload:{playingURI}}` | When playback starts from 0:00 (first start, or a restart after the end). Not sent on resume after a pause. |

- **No state messages are sent until something starts playback.** After `ready` the song is
  loaded and paused at 0:00.
- **Placeholder update:** the first update after a command can be
  `{isPaused:false, isBuffering:true, duration:0, position:0, playingURI:''}`. Ignore it.
- **Stale update:** after `src` changes, the *outgoing* document can still deliver one more
  `playback_update`, ~250 ms later and before the new `ready`. In real Chrome it passed the
  `e.source === iframe.contentWindow` check, and when the same song is reloaded it has the same
  `playingURI`.
- **Pause:** one trailing update with `isPaused:false`, then about three with `isPaused:true`.
- **End of a full track (logged in):** a last update with `position == duration` and
  `isPaused:false`, then about five updates with `isPaused:true, position:0`.
- **End of a preview (logged out, ~30 s):** a last update at `position == duration`, then nothing.
- **Pressing play/pause inside the embed** produces the same messages, so our state stays in
  sync.

**Start position:** the embed URL takes `t=<seconds>` (from Spotify's iFrame API source,
`appendCommonParams`). `?t=12` started at 12.0 s. player.js `play(id, type, { startAt })` uses it
to carry a song to another window. After `ready`, Spotify's library also sends
`{command:'load_complete_ack'}`; nothing we use seems to need it.

**Playlist embed** (`/embed/playlist/{id}`, observed headless, logged out):
- The same messages, but `playingURI` is the *track* playing, not the playlist.
- At a track's end it starts the next track itself: a new `playback_started` and new
  `playingURI`, with no pause in between.
- `resume` and `pause` behave as for a track.

**Commands (`iframe.contentWindow.postMessage({command}, 'https://open.spotify.com')`):**

| Command | Behaviour |
|---|---|
| `resume` | Starts or continues. A no-op while playing (nothing is sent back). After the end it restarts from 0:00. |
| `pause` | Pauses. A no-op while paused, and nothing is sent back. |
| `play` | **Restarts at 0:00.** Don't use it to continue. |
| `toggle` | Flips. Don't use it: it isn't idempotent. |
| `seek {timestamp: <seconds>}` | **Works** (re-checked 2026-10-06: `timestamp: 8` jumped to 8.7 s). The first probe sent `timestamp: 0` and wrongly concluded seek was ignored. |
| `loadUri` | Not an embed command: Spotify's own iFrame API "loadUri" just sets a new iframe `src`. Changing songs means reloading the iframe, as player.js does. |
| Anything sent as a JSON string | Ignored. |
| Anything sent before the new document's `ready` | Lost. |

**Autoplay (user's Chrome, side panel, logged in):** `resume` started audio with sound in every
case tried:
- right after a click
- 8 s after the last click, with no user activation (`navigator.userActivation.isActive` was false)
- in a freshly loaded iframe 8 s after load, with no click

So auto-advance and Next don't need a fresh click there. This has not been verified on a fresh
profile or a logged-out Spotify session. The player still reports `blocked` if starting fails.

### How player.js uses it
- One iframe, reloaded for each song.
- Ignore everything before this document's `ready`, then only updates whose `playingURI` is the
  loaded song.
- Send only `resume` and `pause`, and only when the reported state says it's needed. Play =
  load if needed → wait for `ready` → `resume` → wait up to 5 s for `isPaused:false`, else
  `blocked` (the panel says "Press play in the player once").
- Playlist mode (`play(id, 'playlist')`): any `spotify:track:` URI counts as ours, and "ended"
  is never detected (the embed advances by itself). `state.nowPlaying` holds the reported track.
- End = paused at 0 right after being within 2 s of the end, or no updates for 2.5 s after
  `position == duration`. Then the next song in list order starts.
- The panel re-renders only on a status or song change, never on position updates (see
  "Things that broke before").

### Fallback: Web Playback SDK (not built)
If the embed ever stops working, the alternative is the Web Playback SDK. It runs in a sandboxed
extension page, needs the `streaming` scope (re-consent) and Premium, and makes the panel its
own Spotify Connect device. That gives full control and real state events, but it's a much
larger build, adds an extra OAuth scope, and depends on Spotify allowing the SDK inside an
extension sandbox. That last point is unverified.

## Testing rules (learned the hard way)

- Run `cd tests && npm install && npm test`.
- **Browser tests use the installed Google Chrome** (`CHROME_PATH`, default
  `/Applications/Google Chrome.app/...`). Puppeteer's bundled Chrome fails macOS code-signature
  checks on this Mac (it's killed on launch), probably because npm 12 doesn't run install scripts.
- **Headless Chrome does not enforce the autoplay policy** (verified: audio plays without any
  click under every flag). Autoplay can only be judged with `HEADFUL=1` or in the real extension.
- jsdom does no layout: anything about visibility, scroll or overlap must be checked in the
  browser tests. The docked player covers the rows behind it, so scroll a row into view before
  clicking it in a test.
- **The fake embed must match the real one.** It's built from the probe logs. If the real
  protocol changes, re-run `tools/embed-probe`, update the protocol section above, then the fake.
  Some real behaviour can't be reproduced in puppeteer (a stale message passing the
  `e.source` check). `tests/unit/player.test.mjs` replays those sequences instead.
- `EXT_DIR=dist/safari` runs the browser tests against the Safari build's popup page.
  `unit/safari-build.test.mjs` builds it and runs the loopback login against the simulator.
- Plant the bug: a new test should fail when the behaviour it guards is broken on purpose
  (done for toggle, stale messages, the URI filter, end detection and the swallowed clicks).
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
  matching only. It also accepted "Love Me Do" for "Love" → a contained title needs ≥ 2 words and at
  least half the longer title.
- Clicks on Play were lost while a song played. The whole list re-rendered on every position
  report (~4/s), replacing the buttons between mousedown and mouseup → render only on a
  status/song change, and update row buttons in place (list.js).
- Blind `toggle` with guessed state paused songs that were playing → resume/pause only,
  driven by reported state.
- Stale embed messages were taken as current (same `contentWindow` across navigations) → ready
  gate + `playingURI` filter.
- Auto-advance waited for `isPaused:true` at the end, which a preview never sends → see the
  end rule in "How player.js uses it".

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
