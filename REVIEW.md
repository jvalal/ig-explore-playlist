# Explore Finds v0.5.0 — code review

Reviewed 2026-10-05 against CLAUDE.md. Every file in `extension/` and `tests/` was read in full
(the fake embed's base64 audio was skipped). No code was changed.

How the claims below were checked:

- **Ran:** `npm run test:unit` passes 25/25. `npm run test:browser` crashed before running any
  test because Puppeteer's bundled Chrome isn't installed (`npx puppeteer browsers install
  chrome` is needed). It exits 1 on that crash, as it should.
- **Probed:** I ran the matcher on its own with the edge cases listed under spotify.js (scratch
  script, not committed).
- **Not run:** anything in real Chrome or against real Spotify. Statements about the real embed
  are hypotheses unless marked otherwise.

---

## extension/

### manifest.json — **keep as is** (only the version changes)
MV3. The `key` pins the extension ID, and the permissions are minimal for what the extension
does. Two small notes:
- The `world: "MAIN"` content script needs Chrome 111+, and `minimum_chrome_version` is 116, so
  that's fine.
- The name is "(test build)". That's fine for now.

### background.js — **keep as is**
It's 25 lines and correct:
- It opens the side panel on toolbar click.
- On install or update, but not on a Chrome update, it re-injects both content scripts into open
  Instagram tabs.
- `chrome.tabs.query({url})` works without the `tabs` permission, because the extension has host
  permission for instagram.com.

Untested assumption: a re-injected `inject.js` in a tab that already ran the old copy is skipped
because of `window.__igmpInstalled`. The old fetch wrapper stays in place and keeps posting
messages, which is correct because the new bridge receives them. The catch is that a *changed*
parser never reaches already-open tabs until they reload. That's acceptable, but it isn't
documented.

### inject.js — **keep, with light cleanup**
This is the best code in the project. The schema-agnostic walk is the right design for a
response format that changes often:
- An object with `title` + `display_artist` is a song.
- A non-null `original_sound_info` is creator audio.
- The nearest ancestor with `code` + `media_type`/`product_type` is the post.

It uses an iterative stack with a depth cap and per-response dedupe. Everything is wrapped in an
IIFE, guarded against double patching, and stays clean in the page's global scope.

Issues:
- **Fragile:** `node.id` is the last fallback for a song's `audio_id`. On a music object that's
  probably fine, but if the walker meets an unrelated object with `title` and `display_artist`,
  its id gets used. Nothing currently uses `audio_id` for songs, so it's harmless today.
- **Fragile:** the XHR hook only reads `''`/`text`/`json` response types. A `blob` or
  `arraybuffer` response is silently skipped. That's acceptable, but it has never been measured.
- **Cost:** every relevant response sends up to 300 KB of `sample` text through `postMessage`.
  `bridge.js` keeps only 5, but the page still copies all of them. Easy fix: send a sample only
  while the bridge still wants one.
- **Leftover:** the `friendlyName` and `sample` plumbing exist for debugging which query feeds
  Explore. They're still useful for the debug export, so keep them, but make them optional.
- **Untested:** the XHR path, the `scanEmbedded` path, and `responseType === 'json'`. The unit
  tests only exercise fetch and the pure parser.

### bridge.js — **keep, with a small rewrite**
It merges hits into `tracks`/`log`/`samples`, serializes writes on a promise chain, and detaches
when the extension context dies. The logic is sound. Issues:
- Each message does a read-modify-write of the whole `tracks` object. With hundreds of tracks
  that means hundreds of KB per Instagram response, and every write fires
  `storage.onChanged` → the panel reloads everything (see sidepanel.js). Batching writes (for
  example, at most one flush every 500 ms) would cut this a lot.
- `trackKey` for songs uses `norm(title)|norm(artist)`. Case and whitespace differences merge,
  but "feat." variants don't. That's fine for a capture key.
- The idempotence guard (`window.__efBridgeFor === chrome.runtime.id`) is correct. The ID is
  pinned, so this only blocks a duplicate within one extension lifetime, which is the intent.

### spotify.js — **keep auth + matching but rewrite; drop Connect helpers**
**Auth (PKCE via `chrome.identity`)** is correct: it checks `state`, explains the
`server_error` case, and keeps the refresh token. Problems:
- **Race:** `accessToken()` has no single-flight lock. Prematch, picker search, and build can
  refresh in parallel. If Spotify rotates the refresh token, the losing request can store a
  token that is already dead and end up with `invalid_grant` (a forced reconnect).
- **Fragile:** the 401 retry uses a flag stored on the function object (`api._lastWas401`)
  that's shared across concurrent calls. A 401 that follows a 429 retry is never retried.
- **Dead code:**
  - `hasPlaybackScope`
  - the `(to device)` suffix in `callLog`
  - the `NO_DEVICE` / `PLAYER_FORBIDDEN` branches
  - `getDevices`, `getPlaybackState`, `transferPlayback`, `playUris`, `playContext`, `resume`,
    `pause`, `next`, `previous`

  Everything in that list belongs to the abandoned Spotify Connect path.

**Matching** (normalize → core title → whole-word artist check → weighted score, several search
passes) is reasonable and fixes the "Song 1"/"Future Islands" regressions. Here's how it held up
under probing:

| Case | Result | Verdict |
|---|---|---|
| "Song 1" vs "Song 10" | reject | correct |
| artist "Future" vs "Future Islands" | reject | correct |
| IG title "Love" vs Spotify "Love Me Do", same artist | **accept (0.88)** | false positive |
| "Nights" vs "Nights - Remix" | **1.00**, same as the original | remix can win a tie, and the ≥0.95 early exit can stop before the original is seen |
| IG song with no artist, exact title | always reject | the `aScore = 0.6` branch on line 229 is dead: 0.6 < 0.67 always fails the gate |

Other issues:
- The early exit at 0.95 combined with "remix scores 1.0" means version suffixes
  (`- Remix`, `- Live`, `(Sped Up)`) are invisible to the score except for a +0.05 bonus on an
  exact match. Fix: use version words as a penalty unless the IG title has them too.
- **No unit tests for the matcher at all.** The regressions CLAUDE.md lists are protected only
  by reasoning.

**Playlists:** `createPlaylist`/`addItems` follow the Feb 2026 endpoints, batched by 100. Fine.

### embed.js — **drop and rebuild after observing the real embed**
The playback bug is almost certainly here. Every incoming message shape is a guess (CLAUDE.md
says so), and the fake embed implements exactly the same guess, so tests can't catch a mismatch.
Concrete defects found by reading:

1. **Stale messages are accepted as current.** The filter is
   `e.source === this.frame.contentWindow`, but an iframe's `contentWindow` is the *same*
   WindowProxy across navigations. A late `playback_update` from the previous song's document
   passes the check and can set `playing` for the new song. After that, the next "resume" sends
   `toggle` into a player that is really paused, or the other way round.
2. **Overlapping `play()` calls both send `toggle`.** If you press song A and then song B before
   A starts, both `play()` calls are in flight. `sidepanel.js` checks `playToken` only *after*
   `embed.play()` returns, so A's `play()` still sends `toggle` into B's iframe. B also sends
   one. The two toggles cancel out: **"loaded but didn't play."**
3. **Blind toggle.** `pause()`/`resume()` send `toggle` based on `state.playing`, which is only
   as accurate as message parsing that has never been verified. If the real embed doesn't send
   `playback_update` with `isPaused`, `playing` is always false, and every click on the current
   row sends another toggle.
4. **Fallback timing.** With no recognized `ready`, the code waits 4 s and then 800 ms before
   sending `toggle`. That's 5 s with a spinner, and the command may still arrive before the
   embed's listener is attached.
5. **Autoplay (hypothesis):** the click happens in the panel document, not in the cross-origin
   iframe, so the iframe can only start audio through the `allow="autoplay"` delegation. Whether
   Chrome honours that in a side panel, after an async match lookup plus a full iframe reload,
   is unverified. Auto-advance (`onEnded → step(1)`) and Next/Prev reload the iframe with no
   fresh click at all.
6. `onEnded` assumes `position`/`duration` are in milliseconds. That's unverified.
7. Small: `_readyWaiters` keeps stale resolvers, and the window listener is never removed. Both
   are harmless with one instance.

The ideas worth keeping are the dock UI, "resolve when the embed confirms playing", and the
"tap play in the player" hint when it doesn't.

### sidepanel.html — **keep the structure, rewrite the details**
The layout is fine. Dead pieces: `#scope-note` and `#reconnect` (Connect leftovers). The iframe
`allow` list is correct to keep `autoplay; encrypted-media`.

### sidepanel.css — **keep, with light cleanup**
It's solid:
- Both regressions are guarded: `html [hidden]{display:none!important}` is last in the file, and
  `body` uses `min-height`.
- Dark mode, focus rings, and reduced motion are handled.

Nits: there are two `prefers-reduced-motion` blocks, and one empty double blank line. Carry it
over almost verbatim.

### sidepanel.js — **rewrite**
It's 676 lines that mix storage sync, rendering, matching orchestration, playback state, setup,
and exports in one module-scope blob. The behaviours work (capture list, roll-in, picker, build,
CSV/debug export, two-step Clear), but the structure is what made playback fixes risky.

Problems:
- **Every** `chrome.storage` change, including the panel's own `setMatch` writes and every
  Instagram response the bridge stores, triggers a full `load()` of all keys plus `prematch()`.
  Fine at 30 songs, wasteful at 500.
- Playback state is spread across `nowKey`, `startingKey`, `playlistMode`, `playToken`, and
  `embed.state`, with no single owner. That's how defect 2 above slipped through.
- **Build bug:** if `createPlaylist` succeeds and `addItems` then fails, the new playlist is
  never saved, so the next Build creates a *second* playlist.
- `build()` matches songs one by one with no delay between them, while prematch uses a 600 ms
  delay. They can also run at the same time against the same songs.
- `onEnded → step(1)` auto-plays with no user gesture (see embed.js, item 5).
- **Dead code:**
  - `canControl`
  - `playbackDevice` (the `KEYS` entry and state field)
  - the `DEVICE_ASLEEP` / `NOT_STARTED` / `NO_DEVICE` / `PLAYER_FORBIDDEN` entries in `EXPECTED`
  - `needsScope` (hardcoded `false`), plus `#scope-note` / `#reconnect`
  - the `MATCHER_VERSION` re-match path, which only matters for data from the v1 matcher
- Good parts worth porting:
  - the keyed list diff (rows never re-animate)
  - the `first_seen` sort (rows never reshuffle)
  - the armed two-click Clear
  - the debug export that never includes tokens
  - the error-code-to-message mapping

---

## tests/

### unit/harness.mjs — **keep the idea, rewrite**
Booting the real `sidepanel.html` + `sidepanel.js` in jsdom with a stubbed `chrome` is a good
pattern. Its default stored `scope` still includes Connect scopes, which is a leftover.

### unit/extract.test.mjs — **keep and extend**
It checks REST and streamed GraphQL with the `for (;;);` prefix, plus the irrelevant-response
skip. Missing coverage:
- XHR
- `responseType: 'json'`
- embedded `<script type="application/json">`
- deep nesting
- dedupe within a single response

### unit/inject-realm.test.mjs — **keep**
It covers the IIFE, re-injection, single fetch patch, and no global leak. **It never calls
`process.exit(1)` on failure**, so a failure here doesn't fail `npm run test:unit`.

### unit/bridge.test.mjs — **keep**
It covers live capture, detach after reload, re-attach on update but not on a Chrome update, and
the double-patch guard. **It has the same missing exit code.**

### unit/css.test.mjs — **keep, but fix it**
It checks that `[hidden]` wins over component display rules. It prints `FAIL` but **always
exits 0**. jsdom computes `display` from the cascade well enough for this check. It does no
layout, as CLAUDE.md notes.

### unit/regress.test.mjs — **keep and extend**
It covers roll-in, the Choose picker for misses, picking a candidate, playlist creation, and Add
mode. It uses the Connect simulator only for search, and `searchCandidates` sorts by score,
which the test doesn't verify.

### sim/spotify-sim.mjs — **rewrite as a much smaller search/playlist/token sim**
About 80% of it simulates Connect quirks (devices, transfer, 202 no-op, rate limiting on
`/me/player`) for code that's being removed. It has no token endpoint (`accounts.spotify.com`),
so refresh, rotation, and `invalid_grant` are untested.

### browser/harness.js — **keep the idea, rewrite**
Serving the real panel in real Chromium with stubbed `chrome.*` and request interception is the
right approach. Its default launch is headless, which per CLAUDE.md can't judge autoplay, so the
headline test "one click on Play: the player starts with sound" proves less than its name says.

### browser/embed-player.test.js — **rewrite**
Its flows (play, pause/resume, Next/Prev, auto-advance, Close, Clear, blocked hint) are the right
checklist. But it runs against `fake-embed.html`, which is built on the same guessed protocol,
so it validates embed.js against itself. It also doesn't cover the two-quick-clicks race
(defect 2).

### browser/fake-embed.html — **drop and rebuild from the real log**
The 129 KB is almost all a base64 WAV. It implements only `toggle`, announces `ready`
immediately, and posts `playback_update` with millisecond positions: all unverified. It must be
rebuilt from observed messages, including their timing (for example, how long after load
`ready` arrives) and stale messages from a previous document.

### package.json files — **keep, fix**
`test:browser` correctly exits 1 on a crash. `test:unit` is a hand-chained `&&` list, so a new
test file has to be added by hand, and three of its five files never exit non-zero (see above). Better: one small runner that finds `*.test.mjs` and fails on any `FAIL`.

---

## Recommendation: rebuild, porting the parser and matcher

**Rebuild a clean `extension/`**, move the old code to `legacy/`, and port the parts that hold
up:

| Carry over | How |
|---|---|
| `inject.js` parser + hooks | Nearly verbatim; trim the sample cost; add tests for XHR/embedded |
| `bridge.js` | Same logic, with batched writes |
| `background.js` | Verbatim |
| `manifest.json` `key` | Verbatim |
| `sidepanel.css` | Nearly verbatim (both regression guards kept) |
| Auth (PKCE) | Same flow; add a single-flight token refresh and a clean 401/429 retry |
| Matcher | Same structure; fix version-suffix scoring, the "Love"/"Love Me Do" false positive, and the dead no-artist branch; **add a matcher test suite first** |
| Playlist create/add | Same calls; save the playlist before adding songs so a failed add can't orphan it |

| Rewrite from scratch | Why |
|---|---|
| Player (embed.js) | Built on guesses; three concrete race and state defects; must be rebuilt from the real log |
| Panel controller (sidepanel.js) | Playback state has no single owner; full reload on every storage change; dead Connect code |
| Fake embed, sim, browser tests | They validate the guesses against themselves |

**Why rebuild rather than refactor in place:** the parts worth keeping are small, self-contained
modules that port in minutes. Everything that is actually broken (player, controller, test
doubles) needs replacing anyway, and keeping it in place means picking around Connect
leftovers. With `legacy/` beside the new code, every old behaviour stays available as a spec.
Refactoring in place would cost about the same and leave more dead paths behind.

### Rough estimate
| Step | Work | Your time |
|---|---|---|
| 1. Embed observation probe (temporary panel logging, before any playback code) | ~1 hr | ~10 min in Chrome, paste the log |
| 2. Scaffold + port capture, bridge, background, CSS, auth, matcher with new tests | ~half a day | load once, check capture + connect still work |
| 3. New panel controller (list, picker, build, exports, Clear) + tests | ~half a day | one check-in |
| 4. Document the real protocol, rebuild the fake embed, build the player | ~half a day | 1–2 check-ins with HEADFUL and the real extension |
| 5. If the embed can't be made reliable: Web Playback SDK proposal first | write-up ~1 hr; build ~1 day if approved | approval + re-connect (new `streaming` scope) |

In total that's about 1.5–2 days of focused work plus 3–4 real-Chrome check-ins. **The step 1
log is the critical path for playback.** I'd build the probe first, so you can run it while I
port the rest.

### What the probe needs to answer
1. The exact messages the real embed posts: their shape, timing after load, units, and whether
   anything arrives before we send a command.
2. Whether it accepts commands other than `toggle` (`pause`, `resume`, `play`, `seek`,
   `loadUri`), and which ones are idempotent.
3. Whether a command sent immediately after load is dropped.
4. Whether one click in the side panel starts audio (autoplay delegation), and whether it still
   does after an async delay or an iframe reload.
5. Whether a stale message from the previous song's document arrives after switching.
