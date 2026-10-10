# Explore Finds — project brief for Claude Code

Chrome extension (Manifest V3) that captures the songs used in posts on the user's Instagram
Explore feed, shows them in a side panel, matches them on Spotify, plays them in the panel,
and builds a Spotify playlist. Personal tool for now; public release is undecided (see the end).

Owner: Jkidd (Jason). Direct, wants things verified, not guessed. Has Spotify Premium. On a Mac.

## Current status (v0.10.9)

**Side panel layout** (v0.10.0, the user's design): top to bottom it is now the title and status, the song count with Goal and **Clear
captures**, the "Nothing captured yet" text while there are no songs, then the block with the
**player and the playlist** (`#build`, pinned to the top while the list scrolls; it used to be
pinned to the bottom), the list, and **Download CSV**. sidepanel.js sets `scroll-padding-top` to the pinned block's height
so rows scrolled into view stop below it. The iPhone (Safari) build shares this page and gets
the same order; not looked at there.

**Settings screen** (v0.10.1): a gear in the header slides `#settings` in from the
right while the songs screen (`#main`) slides out to the left; a back arrow in its upper left
(or Esc) returns. It holds the Spotify connection (the same `#setup` block and code) and the
version with Debug data. `body.settings-open` drives it in CSS; the hidden screen is `inert`
and `visibility: hidden` (not the `hidden` attribute, which would kill the slide). Not
connected, the songs screen shows a one-line note with a Connect Spotify link, and pressing
Play or Create playlist opens Settings. A background "connect again" error only says so in
the message line; it doesn't slide Settings in by itself.

Reloading the extension closes its pages, and what they still try on the way out fails with
"Extension context invalidated", which showed up on the extension's Errors page (seen at
mini.js `pagehide`). The panel and the mini player now swallow exactly that error
(`quietWhenOrphaned` in dom.js). A page opened before the fix still logs it once, and old
entries stay on the Errors page until "Clear all" is pressed there. The settings icon is three
sliders (the gear didn't read well).

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
- **Play playlist is gone from the panel** (v0.10.2, the user's call: it played, but nobody
  could tell where). Before a playlist exists the box says "Add to a new Spotify playlist
  named" and the button "Create it on Spotify with N songs". With a playlist: the button "Add N
  new songs", under it "to playlist: <name>" (a link; on its own line since v0.10.7 so the
  whole name shows), then the auto-add checkbox. With auto-add ticked the button only reports and can't be
  pressed: "Adding N new songs…", then "Songs added" (misses aren't counted). Auto-add is
  always off for a new playlist (v0.10.4): creating one, or Start a new playlist, turns it off.
- **Row buttons say what they do** (v0.10.9): Play, or Pause while that song plays (they used
  to read Playing / Paused). The row of the song in the player, playing or paused, has a thick
  accent outline (`.row.current`, from `rowState().current`). **Select all / none**
  (`#check-all`, at the bottom of the pinned block, in line with the rows' checkboxes) ticks
  or unticks every song that has a checkbox; it shows a dash and "3 of 5 selected" when mixed.
- **Rows say which songs are in the playlist** (v0.10.5, list.js). With a playlist, a song in
  it shows a green outlined circle with a check where its checkbox was (`.in-pl-mark`), and a
  song the Add button would add shows a dot and "New" in plain text (`.new`; as a pill it
  looked like a button): checked, not in the playlist, and not a miss.
  So "Add 2 new songs" matches two rows marked New, including after the panel is reopened.
  "In the playlist" means this panel added it (`playlist.keys`); Spotify isn't asked.
- **A playlist deleted on Spotify** (v0.10.4): adding to it answers 404 "Resource not found",
  which the panel used to show as is (the user's stored playlist, "Explore finds, Oct 6-902";
  that it was deleted is likely, not confirmed). `api()` marks 404 as `NOT_FOUND`;
  `playlistGone()` in sidepanel.js then forgets the playlist, turns auto-add off and says so,
  and the box goes back to creating a new one. The songs stay in the list.
  **Doubt (2026-10-10):** the user then got this for "Explore finds, Oct 10", a playlist made
  the same day. If they didn't delete it, 404 means something else (a bad URI in the batch?)
  and forgetting the playlist is the wrong reaction. Needs `recent_spotify_calls` from a
  Debug data export taken right after it happens.
- **The x on the new-playlist box** (v0.10.8): shown when there was a playlist before (after
  Start a new playlist, or after the case above). It puts that playlist back, nothing created
  or added. The previous playlist is kept in storage key `playlistUndo` until a new playlist is
  created. The code that plays a playlist embed is still there and
  unreachable from the panel (`playback.clickPlaylist`, playlist mode in player.js, the mini
  player's `playlist` command, `popIn.playlist`).

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
- **Keep on top** (rebuilt in v0.8.6): Document Picture-in-Picture from player.html. **The music
  stays in the mini window's embed; only our controls move** to the floating window (cover from
  the match's `image`, title, artist, time, Prev / Play-Pause / Next, Back to panel). The mini
  window can't close (the floating window closes with it), so it goes behind the browser window
  and comes forward again only for "Bring the controls back here". Nothing reloads either way.
  Why: up to v0.8.5 the embed itself moved, which reloads it, and Chrome won't start sound in a
  new window without a click there. Logged out it stayed paused (we showed a Play button);
  in the user's Chrome, logged in, the trace showed the embed report `isPaused:false` for ~350 ms
  without the position moving, then pause itself, so it looked like a successful start.
- **Closing the floating window closes the player** (v0.9.6, the user's request). Its X used to
  bring the mini window (Spotify's player) forward, so there was no way to close everything
  from there. Now the X closes the mini window too, and the music stops. Only the mini
  window's "Bring the controls back here" keeps it. The user also saw Back to panel in the
  floating window fall back to the mini window in their Chrome (v0.9.5); it worked in Chrome
  for Testing, cause unknown. The mini window is now closed with `chrome.windows.remove`, not
  `window.close()`.
- **Never minimize the mini window** (v0.8.7). Chrome doesn't start a newly loaded song in a
  minimized window. v0.8.6 minimized it for Keep on top, and Next from the floating window then
  showed the time running with no sound in the user's Chrome (our time display runs on from the
  last report). Reproduced in Chrome for Testing, logged out: minimized, the embed sends only
  the placeholder update and ends `blocked`; not minimized it starts, also behind another
  window. mini.js `shown()` brings a minimized window back (without focus) before starting
  anything, so it also covers someone minimizing it by hand.
- **Back to panel in the floating window** (v0.8.7): a click there counts as the gesture
  `sidePanel.open` needs (verified in Chrome for Testing).
- **"+" in the floating window** (v0.9.0): saves the song playing to the Spotify library (Liked
  Songs), like the "+" in Spotify's own player, which the floating window doesn't have (it shows
  our controls, not the embed). A check mark means saved; pressing again removes it. It needs
  the scopes `user-library-modify` and `user-library-read`, which `connect()` now requests with
  the playlist ones. A connection made before v0.9.0 lacks them (`S.canSave(st.spotify)` reads
  the stored `scope`): the first press runs `S.connect()` from the mini page, Spotify asks for
  approval once, then the song is saved. The grant survives token refreshes; playlists work
  without it. Hidden while a playlist plays. Verified with Spotify stubbed (unit test with the
  sim, real-browser test with the login and API stubbed in the page); **not yet against real
  Spotify**.
- **Window sizes vs zoom** (v0.8.3): window sizes are in screen points, page sizes in page
  pixels, so with Chrome's zoom above 100% (the user's Chrome) the bottom row was cut off. In the
  floating window this hid our Play button, and Chrome refuses to start sound there, so the
  song sat paused. Chrome allows `resizeBy` in a Document PiP window only right after a click in
  it ("requires user activation"), so the floating window opens already tall enough for the Play
  row, scaled by `chrome.tabs.getZoom()`. The mini window follows the player's height (ResizeObserver
  → `chrome.windows.update`, no click needed). `DEFZOOM=1.25` runs the real test at 125% zoom.
- **Floating window cut off** (v0.8.8; the user's Chrome, v0.8.7). Two causes. Its height was
  measured before the title and artist were filled in (empty lines have no height). And the
  floating window has its own zoom: 125% (Chrome's default) while the mini window was at 100%,
  so `chrome.tabs.getZoom()` was the wrong number. Now the controls are rendered before
  measuring, and the zoom is the one measured at the last opening (`localStorage.floatZoom`,
  from the two windows' `devicePixelRatio`), else the larger of the mini window's and the
  default. A click in a floating window that is still too short grows it (trace: `floating-grow`).
  The user found v0.8.8 still slightly short in their Chrome; v0.8.9 adds 6 px. Cause not known:
  check `floating-open` in the trace (`zoom`, `guess`, `mine`, `inner`, `controls`). The real test's
  "nothing cut off" check had been passing wrongly: puppeteer's default 800x600 viewport resized
  the floating window's page (now `defaultViewport: null`). `DEFZOOM=1.25 MINIZOOM=1` runs the
  user's case.
- **Floating window too small again** (v0.9.0 and v0.9.1 in the user's Chrome: cut off at the
  right and the bottom). Read from their screenshot: about 420 points wide with 125% content,
  so it was sized for 100%. The size comes from a zoom guess, and the guess was the zoom
  "measured" at the previous opening (`localStorage.floatZoom`), which came from
  `chrome.tabs.getZoom()` and a `devicePixelRatio` read right after opening. Those evidently
  gave 100% there; in Chrome for Testing they gave the right number, so this was not
  reproduced. Since v0.9.2 a window's zoom is measured on the window itself
  (`outerWidth / innerWidth`, 400 ms after opening and on resize) and kept under a new key,
  `floatZoom2`. v0.9.2 still opened cut off the first time in the user's Chrome (right from
  then on): the first guess, the larger of the mini window's zoom and Chrome's default, was
  too low there. Since v0.9.3 a first-ever guess is at least 125%, so a 100% Chrome gets one
  window 25% too big, then exact ones.
  A second `requestWindow` to correct a wrong first size is refused ("requires user
  activation"), so a wrong guess can only be fixed by a click in the window (`growFloat`) or at
  the next opening.
  Layout since v0.9.5 (the user's design): cover on the left; beside it the title and artist
  with a round, filled, icon-only Play/Pause right after them (like Spotify's; centered on the
  two lines; its state is in `aria-label`/`title`; long text is cut with an ellipsis so the
  button stays beside it), then a row with Prev, Next and "+"; under everything the time (below
  the cover) with Back to panel 8 px to its right. The width is what the wider of the button
  row (plus cover) and the bottom line needs, at least 360. `SHOT=<file.png>` makes the real
  test save a picture of the floating window.
  Trace: `floating-open` and `floating-zoom` (`zoom`, `guess`, `inner`, `outer`, `want`).
- **Keep on top started at 0:00** in the user's Chrome (v0.8.3, logged in), though Pop out and
  Back to panel continued. Not reproduced: logged out (Chrome for Testing) the floating window
  continues at `t`, and in the user's Chrome a top-level embed with `t=60` started at 1:00 from
  Spotify's own play button. Cause unknown. Since v0.8.4 player.js seeks once (`seek
  {timestamp: startAt}`) when a song loaded with `startAt` first reports playing more than 3 s
  before it. That didn't fix it in the user's Chrome.
- **Diagnostic trace** (v0.8.5): the mini player records moves between windows, each embed load,
  every embed message (with position, and whether it came from our iframe), commands sent, status
  changes and iframe `load` events, in storage `playerTrace` (fresh per mini window, last 800
  entries). The panel's Debug data includes it as `player_trace`.
- **Real-browser test, open problem (2026-10-10 afternoon):** the two checks after "Back to
  panel" fail because the real side panel's page doesn't answer (`asPage()`: "Network.enable
  timed out", and no Spotify embed target appears). The committed v0.9.6 with its own test,
  50/50 that morning, fails the same way now, so it is the machine or session, not the code;
  the same hand-back works in a tab. Cause not found (the Chrome for Testing window not on
  screen?). Re-run before trusting or blaming those two checks.
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
Every response is still logged with its area. The area comes from the page path, with two
exceptions decided by the request itself: a home-feed response is always `home`, and the Explore
grid (`/api/v1/discover/web/explore_grid/`) is always `explore` (v0.8.9). Instagram requests the
grid's first screen while the page is still Home (the click on Explore), so until v0.8.8 those
songs were dropped as `home` and the first screen only showed up after scrolling on (debug export
2026-10-08: 4 songs, 20 posts lost that way). The Explore page also fetches the first page of the home
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
  Saving to the library is `PUT /me/library?uris=…` (remove: `DELETE`, check:
  `GET /me/library/contains?uris=…` → array of booleans; max 40 URIs). `PUT /me/tracks` and
  `/me/tracks/contains` are gone (read from Spotify's reference pages, 2026-10-10).
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
