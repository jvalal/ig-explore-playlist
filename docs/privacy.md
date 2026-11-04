# Instagram Explore Playlist Generator privacy policy

Last updated: November 4, 2026

Instagram Explore Playlist Generator (in Safari: Instagram Explore Playlist Gen) is a browser extension for Chrome and Safari that lists the songs used in posts on your Instagram Explore
feed and helps you put them in a Spotify playlist. It has no server of its own: everything
stays in your browser on your computer, nothing is sent to the developer, and there are no analytics,
ads or trackers. Spotify is reached through a Spotify developer app that you create and own, with
your own Spotify account; the developer of this extension has no access to it.

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
Everything is kept in your browser, in the extension's own storage:
the songs found, their Spotify matches, your settings, the playlist it made, the
troubleshooting log above, and your Spotify Client ID and login tokens. Removing the extension deletes all of it. **Clear captures** in the
panel removes the song list.

**Backups.** **Back up** in Settings (Chrome only), and an automatic backup once a week, save a copy of that
storage as a file in your Downloads folder, without your Spotify login tokens (the Client ID is
included). The files stay on your computer: delete them like any other file. **Restore** reads a
file you pick and merges it back into the extension's storage.

## What it sends, and where
Only to Spotify, and only for your own account:
- **Spotify login** (accounts.spotify.com), when you connect.
- **Spotify Web API** (api.spotify.com): song searches (title and artist), creating your
  playlist and adding songs to it, and saving a song to your Liked Songs when you ask.
- **Spotify's player and cover images** (open.spotify.com), to play songs in the panel.

Spotify's own privacy policy applies to that: https://www.spotify.com/legal/privacy-policy/

The **Search YouTube** link opens YouTube's search in a new tab only when you click it.
**Download CSV** and **Debug data** save a file to your computer only when you press them; backups
are described above.

## Selling and sharing
None of your data is sold, shared, or used for anything other than the features above.

## Contact
Questions: open an issue at https://github.com/jvalal/ig-explore-playlist/issues
