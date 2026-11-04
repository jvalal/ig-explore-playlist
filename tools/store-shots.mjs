// Chrome Web Store screenshots, 1280x800: the real side panel (sidepanel.html, its CSS and
// modules) in Chrome, with chrome.* and Spotify stubbed by the test harness and made-up songs
// (no Instagram content, no real accounts), set on a plain background with one line of text.
//   cd tests && npm install && node ../tools/store-shots.mjs   → store/screenshots/*.png
// --mac: Mac App Store, 2880x1800, the Safari Mac build's panel (dist/safari-mac, from
// node tools/build-safari.mjs --mac) in a Mac window frame   → store/screenshots-mac/*.png
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MAC = process.argv.includes('--mac');
if (MAC) process.env.EXT_DIR ||= 'dist/safari-mac'; // read by the harness when it loads
const { open } = await import('../tests/browser/harness.mjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'store', MAC ? 'screenshots-mac' : 'screenshots');
const PANEL = MAC ? { width: 400, height: 700 } : { width: 420, height: 720 }; // Mac: the 400 px panel window
const PAGE = MAC ? { width: 1440, height: 900, deviceScaleFactor: 2 } : { width: 1280, height: 800 };
const TITLE_BAR = 28;

const SONGS = [
  ['Golden Hour Drive', 'The Low Tides'], ['Paper Moons', 'Ines Carvalho'], ['Neon Harbor', 'Kito & Rey'],
  ['Slow Motion Summer', 'Maple Avenue'], ['Velvet Static', 'Nora Quinn'], ['Late Train Home', 'The Wandering Hours'],
  ['Cassette Heart', 'Juno Park'], ['Blue Lagoon Days', 'Sol Ramos'], ['After the Rain', 'Echo Valley'],
  ['Midnight Bakery', 'Felix & the Ovens'], ['Satellite Love', 'Mira Lane'], ['Wild Honey', 'Arlo Finch'],
];
const T0 = Date.UTC(2026, 10, 2, 18);
const tracks = {};
const matches = {};
SONGS.forEach(([title, artist], i) => {
  const key = `s${i}`;
  tracks[key] = { key, kind: 'song', title, artist, first_seen: T0 - i * 60000, last_seen: T0 - i * 60000, posts: [{ code: `c${i}`, type: 'clips' }], areas: { explore: 1 } };
  matches[key] = { status: 'matched', id: `t${i}`, uri: `spotify:track:t${i}`, name: title, artists: artist, image: null, url: 'https://open.spotify.com/', at: T0, v: 3 };
});
const inPl = ['s5', 's6', 's7', 's8', 's9', 's10', 's11'];
const store = {
  tracks, matches,
  excluded: { s3: true },
  playlist: { id: 'PL', url: 'https://open.spotify.com/', name: 'Explore Playlist Gen, Nov 2, 9:30 PM', keys: inPl, uris: inPl.map((k) => matches[k].uri) },
  prefs: { goal: 20 },
  spotify: { clientId: 'a'.repeat(32), access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3.6e6, user: 'You', scope: 'playlist-modify-private' },
};

const shots = [
  { name: '1-songs', line: 'The songs from your Explore feed, listed as you scroll.', sub: 'Untick the ones you don’t want, then send the rest to Spotify.' },
  { name: '2-settings', line: MAC ? 'Your list stays in Safari on your Mac.' : 'Your list stays in your browser.',
    sub: MAC ? 'No account with us, no server. Your Spotify app, your account.' : 'Back it up to a file any time. Your Spotify app, your account.', go: async (page) => { await page.click('#open-settings'); } },
  // Safari builds have no walkthrough (welcome.js), so the Mac set shows the dark look instead.
  MAC ? { name: '3-dark', line: 'Light or dark, or follow your Mac.', sub: 'Play any song right in the panel with Spotify’s own player.', scheme: 'dark' }
    : { name: '3-walkthrough', line: 'A short walkthrough on first run.', sub: 'Then it guides you through connecting your own Spotify app.', store: { welcomed: false } },
];

async function panelShot(shot) {
  const h = await open({ songs: 0, viewport: { ...PANEL, deviceScaleFactor: PAGE.deviceScaleFactor || 1 }, store: { ...store, ...(shot.store || {}) } });
  try {
    await h.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: shot.scheme || 'light' }]);
    await new Promise((r) => setTimeout(r, 600));
    if (shot.go) await shot.go(h.page);
    await new Promise((r) => setTimeout(r, 1200)); // slides and roll-ins settle
    if (h.errors.length) throw new Error(`${shot.name}: ${h.errors.join('; ')}`);
    return await h.page.screenshot({ encoding: 'base64' });
  } finally {
    await h.close();
  }
}

const frame = (png, { line, sub }) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Manrope; src: url(data:font/woff2;base64,${fs.readFileSync(path.join(root, 'extension', 'manrope-latin.woff2')).toString('base64')}); font-weight: 200 800; }
  html, body { margin: 0; width: ${PAGE.width}px; height: ${PAGE.height}px; overflow: hidden; }
  body { font-family: Manrope, system-ui, sans-serif; display: flex; align-items: center; gap: 72px; padding: 0 96px; box-sizing: border-box;
    background: linear-gradient(135deg, #f4f6fb 0%, #e6ebf7 100%); color: #10162b; }
  .text { flex: 1; }
  h1 { font-size: 44px; line-height: 1.15; margin: 0 0 18px; font-weight: 800; letter-spacing: -0.02em; }
  p { font-size: 21px; line-height: 1.45; margin: 0; color: #4a5372; }
  img { display: block; width: ${PANEL.width}px; height: ${PANEL.height}px; }
  .shot { border-radius: ${MAC ? 12 : 16}px; overflow: hidden; background: #fff; box-shadow: 0 24px 60px rgba(16,22,43,.18), 0 0 0 1px rgba(16,22,43,.08); }
  .bar { height: ${TITLE_BAR}px; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: #ececec; border-bottom: 1px solid #d6d6d6;
    font: 600 13px -apple-system, system-ui, sans-serif; color: #4d4d4d; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; }
  .bar span { flex: 1; text-align: center; margin-right: 52px; }
</style></head><body><div class="text"><h1>${line}</h1><p>${sub}</p></div><div class="shot">${MAC
  ? '<div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>Explore Playlist Gen</span></div>' : ''}<img src="data:image/png;base64,${png}"></div></body></html>`;

fs.mkdirSync(outDir, { recursive: true });
for (const shot of shots) {
  const png = await panelShot(shot);
  const h = await open({ songs: 0, viewport: PAGE });
  try {
    await h.page.setContent(frame(png, shot), { waitUntil: 'load' });
    await h.page.evaluate(() => document.fonts.ready);
    const file = path.join(outDir, `${shot.name}.png`);
    await h.page.screenshot({ path: file, clip: { x: 0, y: 0, width: PAGE.width, height: PAGE.height } });
    console.log('wrote', path.relative(root, file));
  } finally {
    await h.close();
  }
}
