# Mobile web extension — research notes (2026-10-05)

Question: could Explore Finds work on a phone the way it works in desktop Chrome, and could that
be a path to making money? No code has been written for this. "Verified" below means confirmed
from a source listed at the end; everything else is marked as unverified.

## How it would have to work

The desktop extension reads what instagram.com already loads in the browser: a script in the
page's own JavaScript world (`world: "MAIN"`) sees Instagram's responses. A phone version must do
the same thing in a **mobile browser that runs extensions**, with Explore open at
instagram.com/explore in that browser, **not in the Instagram app**. A native app can't read what
the Instagram app loads, and Instagram's API doesn't offer the Explore feed.

## Where extensions run on phones

| Platform | Extensions? | Can it run our capture script (MAIN world)? | Side panel? |
|---|---|---|---|
| iPhone: Safari | Yes (Safari Web Extensions, shipped inside an App Store app) | Partly verified: Apple says Safari 16.4+ supports `world: "MAIN"` via `scripting.registerContentScripts`; a developer in the same thread disputed it, and **iOS was not tested** there | No: popup or extension page only |
| Android: Firefox | Yes, MV3 fully supported since Firefox 128 | Verified: Firefox 128 supports `world: "MAIN"` in manifest `content_scripts` and `executeScript` | No sidebar on Android |
| Android: Chrome | **No** (verified, as of Aug 2026); only experimental "desktop Chrome on Android PCs" builds | — | — |

The core idea ports to both. The UI doesn't: there's no side panel on phones, so the list and
player would live in a popup or a full extension page you switch to. On a phone, switching
between Explore and the list is clumsier than the desktop side-by-side layout. That's a real
product question, not just a technical one.

Unverified, and needed before any build:
1. iOS Safari actually running a MAIN-world script on instagram.com (registered at runtime, since
   the manifest form isn't confirmed).
2. instagram.com/explore in mobile Safari and Firefox loading the same kind of responses as
   desktop. Mobile web may get a different layout, or prompts to "open the app".
3. The Spotify embed playing inside a Safari extension page or popup on iOS (autoplay and audio
   rules differ on iOS).

## What blocks profitability (any platform)

1. **Spotify API limits (verified).**
   - Development-mode apps allow 5 users, and the app owner needs Premium (since Feb 2026).
   - Extended quota is only for registered organizations with at least 250k monthly active users
     (since May 2025).
   - A paid product on our Spotify Client ID can't serve more than 5 people.
   - Workaround: each user brings their own Client ID, as this extension already supports. That's
     heavy friction for a consumer product, and each user then needs Premium.
2. **Meta's terms.** Automated collection without permission is prohibited, and Meta has sued
   over browser extensions before (see CLAUDE.md). A free, open-source personal tool is the lowest
   risk. Charging money raises both the visibility and the stakes. Talk to a lawyer before any
   paid version.
3. **App Store for iOS.** A Safari extension ships inside an App Store app (Apple Developer
   Program, $99/yr) and goes through App Review. Unverified: how review treats an extension that
   reads Instagram data.

## An option worth a look: Apple Music on iPhone (unverified)

An iPhone build could match songs to **Apple Music** instead of Spotify, through Apple's MusicKit
for the web. As far as I know, it has no 5-user development cap like Spotify's. It would need
the Apple Developer Program you'd already have for the Safari app. Verify its quota, catalog
search and playlist-creation access before relying on it.

## Recommended next step

A small, time-boxed spike (about half a day) before any product decision:
1. Firefox for Android (easiest; the capture side is verified to work there): load a copy of the
   capture scripts, browse instagram.com/explore, and confirm songs are captured.
2. iOS Safari: minimal Xcode Safari Web Extension that registers a MAIN-world script on
   instagram.com and logs captures. This answers unverified points 1 and 2.
3. Decide on the music service: Spotify with bring-your-own-Client-ID (fine for a hobby or
   open-source tool) versus Apple Music (better for a paid iPhone product, if it checks out).

## Sources
- Apple Developer Forums, world "MAIN" in Safari: https://developer.apple.com/forums/thread/728849
- Mozilla, Manifest V3 updates in Firefox 128: https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/
- Chrome extensions on Android, status 2026: https://web-highlights.com/blog/how-to-install-chrome-extensions-on-android/
- TechCrunch, Spotify developer mode limits (Feb 2026): https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/
- Spotify, extended access criteria (Apr 2025): https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access
