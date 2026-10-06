// Runs the real side panel in real Chrome. chrome.* and the Spotify API are stubbed in the
// page; HTML, CSS, layout and modules are real. Uses the installed Chrome (CHROME_PATH):
// Puppeteer's bundled Chrome fails macOS code-signature checks on this Mac.
// Headless Chrome does not enforce the autoplay policy: never judge playback here without HEADFUL=1.
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { EXT_DIR } from '../ext-dir.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' });
      r.end(fs.readFileSync(f));
    }).listen(0, () => res(srv));
  });
}

// songs: number of captured songs ("Song 0".."Song n-1", all on Spotify).
// misses: extra captured songs Spotify search can't find.
// embed: settings for fake-embed.html (mode, durationMs, readyDelayMs, block, tickMs), or omitted
// for a blank stand-in. The fake is built from logs of the real embed; see that file.
// store: extra chrome.storage.local keys (e.g. a saved playlist).
export async function open({ songs = 30, misses = [], viewport = { width: 380, height: 760 }, embed = null, store = {} } = {}) {
  const srv = await serve(EXT_DIR);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: !process.env.HEADFUL, args: ['--mute-audio'] });
  const page = await browser.newPage();
  // Never let the page reach the real Spotify embed from these layout tests.
  await page.setRequestInterception(true);
  const fake = embed && fs.readFileSync(new URL('./fake-embed.html', import.meta.url), 'utf8')
    .replace('/*CONFIG*/{}', JSON.stringify(embed));
  page.on('request', (req) => (req.url().startsWith('https://open.spotify.com/')
    ? req.respond({ status: 200, contentType: 'text/html', body: fake || '<!doctype html><body>embed</body>' })
    : req.continue()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    if (where.endsWith('/favicon.ico')) return; // the test server has none; extensions don't ask
    errors.push(`console.error: ${m.text()} ${where}`);
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));

  await page.evaluateOnNewDocument((songs, misses, manifest, extraStore) => {
    const tracks = {};
    const catalog = [];
    for (let i = 0; i < songs; i++) {
      tracks[`k${i}`] = { key: `k${i}`, kind: 'song', title: `Song ${i}`, artist: `Artist ${i}`, first_seen: 1000 + i, last_seen: 1000 + i, posts: [{ code: `c${i}`, type: 'clips' }], areas: { explore: 1 } };
      catalog.push({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }], album: { images: [] }, external_urls: { spotify: 'u' } });
    }
    misses.forEach((title, j) => {
      tracks[`m${j}`] = { key: `m${j}`, kind: 'song', title, artist: 'Nobody Known', first_seen: 5000 + j, last_seen: 5000 + j, posts: [{ code: `m${j}`, type: 'clips' }], areas: { explore: 1 } };
    });
    catalog.push({ id: 'other', uri: 'spotify:track:other', name: 'Some Other Song', artists: [{ name: 'Somebody' }], album: { images: [] }, external_urls: { spotify: 'u' } });

    const data = {
      spotify: { clientId: 'a'.repeat(32), access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3.6e6, user: 'jkidd' },
      tracks, matches: {},
      ...extraStore,
    };
    window.__store = data;
    window.__fake = []; // what the fake embed received and did, in order
    window.addEventListener('message', (e) => { if (e.data && e.data.type === '__fake') window.__fake.push({ at: Date.now(), ...e.data }); });
    const listeners = [];
    const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
    const fire = (changes) => setTimeout(() => listeners.forEach((l) => l(changes, 'local')), 5);
    window.chrome = {
      storage: {
        local: {
          get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, clone(data[k])])),
          set: async (o) => { const c = {}; for (const [k, v] of Object.entries(clone(o))) { c[k] = { newValue: v }; data[k] = v; } fire(c); },
          remove: async (ks) => { const c = {}; for (const k of [].concat(ks)) { c[k] = {}; delete data[k]; } fire(c); },
        },
        onChanged: { addListener: (f) => listeners.push(f) },
      },
      identity: { getRedirectURL: () => 'https://adnfnkniiefhlojabhejngpkefohmnhg.chromiumapp.org/' },
      runtime: { getManifest: () => manifest, id: 'test' },
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, o) => {
      const u = new URL(String(url));
      if (u.host !== 'api.spotify.com') return realFetch(url, o);
      if (u.pathname === '/v1/search') {
        const q = u.searchParams.get('q');
        const items = catalog.filter((t) => q.includes(t.name)).sort((a, b) => b.name.length - a.name.length).slice(0, 10);
        return json(200, { tracks: { items: q.includes('Mystery') ? [catalog[catalog.length - 1]] : items } });
      }
      return json(404, {});
    };
  }, songs, misses, manifest, store);

  await page.setViewport(viewport);
  await page.goto(`http://localhost:${srv.address().port}/sidepanel.html`);
  await new Promise((r) => setTimeout(r, 500));
  return { browser, page, errors, close: async () => { await browser.close(); srv.close(); } };
}

// Is the element visible to a person: rendered and inside the viewport?
export function onScreen(page, sel) {
  return page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });
}
