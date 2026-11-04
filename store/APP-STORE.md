# Mac App Store listing

Text to paste into App Store Connect (appstoreconnect.apple.com › Apps › Instagram Explore
Playlist Gen › macOS App). Build and upload: `TEAM=7B3GB44F7V tools/mac-safari.sh --upload`.
Adapted from the Chrome listing (LISTING.md). The Safari build has no pop-out player and no
Back up, so neither is mentioned here.

## App Information

**Name** (30 max): Instagram Explore Playlist Gen
**Subtitle** (30 max): Save the songs you scroll past
**Category:** Music. Secondary: Entertainment.
**Content rights:** "Yes, it contains, shows or accesses third-party content", then "I have the
necessary rights": it shows song titles from Instagram posts and plays songs only through
Spotify's official embed, with the user's own accounts; nothing is bundled.
**Age rating:** None for every question. No unrestricted web access (it only opens Instagram and
Spotify pages).
**Privacy Policy URL:** https://github.com/jvalal/ig-explore-playlist/blob/main/docs/privacy.md

## Version page (0.11.34)

**Promotional text** (170 max):
Hear a great song on Instagram Explore, scroll on, and it's gone. This Safari extension keeps it,
plays it, and sends it to your Spotify playlist.

**Description:**

Hear a great song on an Instagram Explore post, scroll on, and it's gone. Instagram Explore Playlist Gen keeps it for you.

As you scroll Explore in Safari, a panel beside the Safari window lists the songs used in the posts you pass, newest first. Play any of them right in the panel, untick the ones you don't want, and send the rest to a Spotify playlist with one click. Turn on auto-add and new finds go straight into that playlist as you scroll.

• Lists the songs from Explore posts as they load, with a link back to each post
• Plays them in the panel with Spotify's own player
• Finds each song on Spotify, preferring the original over remixes, live versions and covers
• Creates a Spotify playlist and adds new finds, by hand or automatically
• Search YouTube for a song Spotify doesn't have
• Light and dark looks, a song goal, and a CSV download of everything found

Setup takes about three minutes: Spotify only lets each developer app have five users, so you make your own free Spotify app and the extension walks you through it, filling in Spotify's form for you. Needs Spotify Premium. After installing, turn the extension on in Safari › Settings › Extensions.

Private by design: no data collection, no account with us, no server, no analytics. Your list stays in Safari on your Mac; the extension only talks to Spotify, through your own account. No auto-scrolling or automation: you scroll yourself, and it never scrolls, clicks, likes, follows or posts for you. It reads the posts Instagram has already loaded for you and makes no requests of its own to Instagram.

Not affiliated with Instagram, Meta or Spotify.

**Keywords** (100 max, no spaces after commas; words in the name are already indexed, and other
companies' names are not allowed):
music,songs,song finder,reels,discover,soundtrack,audio,tracks,trending,saver,mixtape,find songs

**Support URL:** https://github.com/jvalal/ig-explore-playlist/issues
**Marketing URL** (optional): https://github.com/jvalal/ig-explore-playlist
**Copyright:** 2026 Jason Valalik

**Screenshots** (2880×1800): `store/screenshots-mac/1-songs.png`, `2-settings.png`, `3-dark.png`,
made by `node tools/build-safari.mjs --mac && cd tests && node ../tools/store-shots.mjs --mac`: the
Safari Mac build's panel in a Mac window frame, made-up songs, Spotify stubbed.

## App Privacy

**Data collection:** "No, we do not collect data from this app." Apple counts data as collected
when it leaves the device to the developer or a partner. Here nothing reaches the developer;
song searches and playlist changes go from the user's Mac to Spotify, under the user's own
Spotify account and own Spotify app.

## App Review Information

**Sign-in required:** No account with us. The reviewer needs an Instagram account and a Spotify
Premium account of their own; we have no demo accounts to give. Attach a screen recording
(App Review › Attachment) showing setup, capture and playlist creation.

**Notes:**

This app is a container for a Safari Web Extension. To try it:

1. Open the app, then turn on "Instagram Explore Playlist Gen" in Safari › Settings › Extensions, and allow it on instagram.com.
2. Open instagram.com/explore in Safari (any Instagram account) and click the extension's toolbar button. A panel opens beside the Safari window.
3. Scroll Explore. Songs used in the posts appear in the panel.
4. To play songs and make a playlist, the extension connects to Spotify. Spotify limits each developer app to five users, so each person creates their own free Spotify developer app; Settings › Spotify walks through it and fills in Spotify's form. Spotify requires Premium for this. The attached video shows the whole flow.

The extension only reads the post data Instagram's own page has already loaded. It makes no requests to Instagram, never automates anything (no scrolling, clicking or posting), has no server, and sends nothing to the developer. Spotify is reached only with the user's own account.

## Steps only you can do

1. Push `docs/privacy.md` so the policy URL shows the Safari wording.
2. Fill the fields above. In the version page, pick the uploaded build (0.11.34).
3. Screenshots and the review video.
4. Pricing and Availability: Free, all countries (or pick).
5. Add for Review, then Submit.
