# Explore Finds privacy policy

Last updated: November 1, 2026

Explore Finds is a Chrome extension that lists the songs used in posts on your Instagram Explore
feed and helps you put them in a Spotify playlist. It has no server of its own: nothing is sent
to the developer, and there are no analytics, ads or trackers.

## What it reads
- **On instagram.com:** the post data Instagram's own page has already loaded while you scroll.
  From it the extension keeps the song title and artist, and the post's short code (to link back
  to the post). It makes no requests of its own to Instagram and never sees your password.
  For troubleshooting it also keeps, in your browser only, a short log of the Instagram
  requests it looked at and a few raw copies of responses that mentioned music (these can
  include other post details, such as captions and account names). They stay in your browser
  unless you press **Debug data** and send the file to someone yourself.
- **On developer.spotify.com/dashboard:** only while you set up your Spotify app, to fill in the
  form for you and to read your app's Client ID from the page address.

## What it stores
Everything is kept in your browser, in the extension's own storage (`chrome.storage.local`):
the songs found, their Spotify matches, your settings, the playlist it made, the
troubleshooting log above, and your Spotify Client ID and login tokens. Removing the extension deletes all of it. **Clear captures** in the
panel removes the song list.

## What it sends, and where
Only to Spotify, and only for your own account:
- **Spotify login** (accounts.spotify.com), when you connect.
- **Spotify Web API** (api.spotify.com): song searches (title and artist), creating your
  playlist and adding songs to it, and saving a song to your Liked Songs when you ask.
- **Spotify's player and cover images** (open.spotify.com), to play songs in the panel.

Spotify's own privacy policy applies to that: https://www.spotify.com/legal/privacy-policy/

The **Search YouTube** link opens YouTube's search in a new tab only when you click it.
**Download CSV** and **Debug data** save a file to your computer only when you press them.

## Selling and sharing
None of your data is sold, shared, or used for anything other than the features above.

## Contact
Questions: open an issue at https://github.com/jvalal/ig-explore-playlist/issues
