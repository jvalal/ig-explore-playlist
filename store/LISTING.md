# Chrome Web Store listing

Text to paste into the Developer Dashboard (chrome.google.com/webstore/devconsole).
Upload `dist/explore-finds-<version>.zip` from `node tools/build-webstore.mjs`.

## Store listing tab

**Name** (from the manifest): Instagram Explore Playlist Generator

**Summary** (from the manifest, 132 characters max):
Captures song info from the posts Instagram loads in your browser while you browse Explore, and turns it into a Spotify playlist.

**Category:** Entertainment

**Language:** English

**Description:**

Hear a great song on an Instagram Explore post, scroll on, and it's gone. Instagram Explore Playlist Generator keeps it for you.

As you scroll Explore, the side panel lists the songs used in the posts you pass, newest first. Play any of them right in the panel, untick the ones you don't want, and send the rest to a Spotify playlist with one click. Turn on auto-add and new finds go straight into that playlist as you scroll.

• Lists the songs from Explore posts as they load, with a link back to each post
• Plays them in the panel with Spotify's own player, or in a small window that stays on top
• Finds each song on Spotify, preferring the original over remixes, live versions and covers
• Creates a Spotify playlist and adds new finds, by hand or automatically
• Search YouTube for a song Spotify doesn't have
• Light and dark looks, a song goal, and a CSV download of everything found

Setup takes about three minutes: Spotify only lets each developer app have five users, so you make your own free Spotify app and the extension walks you through it, filling in Spotify's form for you. Needs Spotify Premium.

Private by design: no data collection, no account with us, no server, no analytics. Your list stays in your browser; the extension only talks to Spotify, through your own account. No auto-scrolling or automation: you scroll yourself, and it never scrolls, clicks, likes, follows or posts for you. It reads the posts Instagram has already loaded for you and makes no requests of its own to Instagram.

Not affiliated with Instagram, Meta or Spotify.

**Screenshots:** 1280×800 or 640×400, 1 to 5. See "Screenshots" below.
**Small promo tile** (optional): 440×280.
**Store icon:** 128×128 PNG (the same icon as the extension).

**Homepage / support URL:** https://github.com/jvalal/ig-explore-playlist

## Privacy tab

**Single purpose:**
List the songs used in the posts of the user's Instagram Explore feed, and let the user play them and save them to a Spotify playlist.

**Permission justifications:**
- `storage`: keeps the list of songs found, their Spotify matches, the user's settings and Spotify login in the browser.
- `sidePanel`: the extension's interface is a side panel next to Instagram.
- `identity`: signs the user in to their own Spotify account (`chrome.identity.launchWebAuthFlow`, OAuth with PKCE).
- `scripting`: after an install or update, re-attaches the song reader to Instagram tabs that are already open, so the user doesn't have to reload them.
- Host `https://www.instagram.com/*`: reads the post data Instagram's page has already loaded, to find the song title and artist of each post. Also used to reload open Instagram tabs when the user asks.
- Host `https://accounts.spotify.com/*` and `https://api.spotify.com/*`: Spotify login, song search, creating the playlist and adding songs, saving to Liked Songs.
- Content script on `https://developer.spotify.com/dashboard*`: fills in the user's Spotify app form during setup and reads the app's Client ID from the page address. It never accepts Spotify's terms or saves the form for the user.

**Remote code:** No, I am not using remote code. (Spotify's player is an iframe from open.spotify.com, not code run by the extension.)

**Data usage** (tick these):
- Website content: song titles, artists and post links read from Instagram pages.
- Authentication information: the user's Spotify login tokens and Client ID, stored locally.

Certify all three: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://github.com/jvalal/ig-explore-playlist/blob/main/PRIVACY.md

## Distribution tab

**Visibility:** Unlisted (only people with the link can find it) to start; Public later if wanted.

## Screenshots

Take them in your own Chrome with the store version installed, window at 1280×800:
1. Instagram Explore with the side panel open and a dozen songs listed.
2. A song playing in the panel (the moving bars on its row).
3. The playlist block after "Create it on Spotify", with the playlist link.
4. Settings › Spotify, connected.
5. The first-run walkthrough, step 1.

## After it's approved

The store copy has its own extension ID, so its Spotify Redirect URI differs from the unpacked
copy's. Add the new one to your Spotify app (Settings › Spotify shows it under "By hand", and the
dashboard helper says when it's missing), then connect. The store copy has its own storage, so
it starts with an empty list.
