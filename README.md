# Explore Finds

<a href="https://ko-fi.com/jkidd"><img src=".github/kofi-badge.svg" alt="Support this project on Ko-fi" height="45"></a>

Chrome extension: songs from your Instagram Explore feed → side panel → Spotify playlist.

## Why I built it
Some of the best new music I hear is in the background of posts on Instagram's Explore feed. By the time I'd scrolled on, the song was gone, and finding it again meant digging back for the post and searching Spotify by hand. Explore Finds keeps a list of the songs as you scroll, lets you play them right in the side panel, and turns the ones you like into a Spotify playlist. Nothing to tap or copy. Your list stays in your browser; the only place it talks to is Spotify, through your own account.

## Load it
1. `chrome://extensions` → Developer mode on → **Load unpacked** → select the `extension/` folder.
2. Open the side panel from the toolbar icon and connect Spotify (the panel shows the Redirect URI).

## Test it
```
cd tests
npm install
npm test            # unit + browser (puppeteer)
HEADFUL=1 npm run test:browser   # needed to judge autoplay behavior
```
Browser tests drive your installed Google Chrome (override with `CHROME_PATH`).

See `CLAUDE.md` for architecture, constraints, and the current open issue.

## Support
Tips are appreciated: [buy me a coffee on Ko-fi](https://ko-fi.com/jkidd).
