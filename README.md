# Explore Finds

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

See `CLAUDE.md` for architecture, constraints, and the current open issue.
