# Explore Finds

<a href="https://ko-fi.com/jkidd"><img src="https://img.shields.io/badge/Ko--fi-Support%20this%20project-29abe0?style=flat-square&logo=ko-fi&logoColor=white" alt="Support this project on Ko-fi" height="30"></a>

Chrome extension: songs from your Instagram Explore feed → side panel → Spotify playlist.

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
