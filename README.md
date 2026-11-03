# Instagram Explore Playlist Generator

<a href="https://ko-fi.com/jkidd"><img src=".github/kofi-badge.svg" alt="Support this project on Ko-fi" height="45"></a>

Chrome extension: songs from your Instagram Explore feed → side panel → Spotify playlist.

## Why I built it
Some of the best new music I hear is in the background of posts on Instagram's Explore feed. By the time I'd scrolled on, the song was gone, and finding it again meant digging back for the post and searching Spotify by hand. This extension keeps a list of the songs as you scroll, lets you play them right in the side panel, and turns the ones you like into a Spotify playlist. Nothing to tap or copy. Your list stays in your browser; the only place it talks to is Spotify, through your own account.

> [!IMPORTANT]
> **No data collection. No auto-scrolling.**
> - **Nothing is collected.** No account, no server, no analytics. Your list stays in your browser; the only service it talks to is Spotify, through your own account. See [docs/privacy.md](docs/privacy.md).
> - **No automation.** You scroll Explore yourself. The extension never scrolls, clicks, likes, follows, posts or sends messages for you.
> - **No requests to Instagram.** It only reads the posts Instagram has already loaded in your browser while you scroll.
> - **No Instagram login.** It never asks for or reads your Instagram password or login cookies.
>
> Not affiliated with Instagram, Meta or Spotify.

## Install

One codebase, a package for each browser. You also need **Spotify Premium**; the first-run steps
walk you through connecting your own free Spotify developer app (about three minutes).

### Chrome
Chrome Web Store listing: in review. Until then, load it yourself:
1. Download this repo (Code → Download ZIP) and unzip it.
2. `chrome://extensions` → **Developer mode** on → **Load unpacked** → select the `extension/` folder.
3. Click the extension's toolbar icon: the side panel opens and walks you through setup.

### Safari on Mac
Mac App Store: planned. Until then, build it yourself (needs Xcode, free; an Apple ID added in
Xcode › Settings › Accounts is enough):
1. Run `tools/mac-safari.sh`. It builds the app into `~/Applications` and opens it.
2. Safari › Settings › **Developer** → tick **Allow unsigned extensions** (Safari turns this off
   each time it quits).
3. Safari › Settings › **Extensions** → tick **Explore Playlist Gen**.
4. Open Instagram Explore and click the extension's toolbar button: the panel opens as a window
   beside Safari. When Safari asks to let it use a site (instagram.com, Spotify), choose **Allow**.

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
