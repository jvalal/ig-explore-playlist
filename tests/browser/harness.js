// Runs the real side panel in real Chromium. chrome.* APIs and the Spotify API are stubbed
// (Spotify via the Connect simulator), everything else (HTML, CSS, layout, modules) is real.
// Default: full puppeteer (bundled Chrome). Set USE_SPARTICUZ=1 to use @sparticuz/chromium + puppeteer-core.
const useSparticuz = !!process.env.USE_SPARTICUZ;
const chromium = useSparticuz ? require('@sparticuz/chromium') : null;
const puppeteer = useSparticuz ? require('puppeteer-core') : require('puppeteer');
const http = require('http'); const fs = require('fs'); const path = require('path');

function serve(dir) {
  return new Promise((res) => {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const srv = http.createServer((q, r) => {
      const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]));
      if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f));
    }).listen(0, () => res(srv));
  });
}

const simSource = fs.readFileSync(path.join(__dirname, '../sim/spotify-sim.mjs'), 'utf8').replace('export function makeSim', 'function makeSim');

async function open(dir, { songs = 30, devices, store = {}, viewport = { width: 380, height: 760 }, simOpts = {}, fakeEmbed = false, stripAutoplay = false, forceBlock = false } = {}) {
  const srv = await serve(dir);
  // Real desktop Chrome rule: sound only after a user click. Audio output muted (no speakers here).
  // NOTE: headless Chrome does NOT enforce the autoplay policy (verified). Use HEADFUL=1 to test autoplay for real.
  const base = useSparticuz ? chromium.args.filter((a) => !/autoplay-policy|mute-audio/.test(a)) : [];
  const args = base.concat('--autoplay-policy=document-user-activation-required');
  const browser = await puppeteer.launch(useSparticuz
    ? { executablePath: await chromium.executablePath(), args, headless: true }
    : { args, headless: !process.env.HEADFUL });
  const page = await browser.newPage();
  if (fakeEmbed) {
    const fake = fs.readFileSync(path.join(__dirname, 'fake-embed.html'), 'utf8');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('https://open.spotify.com/embed/')) req.respond({ status: 200, contentType: 'text/html', body: forceBlock ? fake.replace('<script>', '<script>window.__FORCE_BLOCK = true;') : fake });
      else if (stripAutoplay && req.url().endsWith('/sidepanel.html')) {
        req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(dir, 'sidepanel.html'), 'utf8').replace(/allow="autoplay; /, 'allow="') });
      } else req.continue();
    });
  }
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const url = (m.location() && m.location().url) || '';
    if (/\/img-/.test(url)) return; // simulator's fake album-art URLs
    errors.push(`console.${m.type()}: ${m.text()} ${url}`);
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  await page.evaluateOnNewDocument((simSource, songs, devices, store, manifest, simOpts) => {
    eval(simSource + '; window.__makeSim = makeSim;');
    const sim = window.__makeSim(Object.assign({}, simOpts, devices ? { devices } : {}));
    window.__sim = sim;
    const tracks = {};
    for (let i = 0; i < songs; i++) {
      sim.addTrack('t' + i, 'Song ' + i, 'Artist ' + i);
      tracks['k' + i] = { key: 'k' + i, kind: 'song', title: 'Song ' + i, artist: 'Artist ' + i, first_seen: 1000 + i, last_seen: 1000 + i, posts: [{ code: 'c' + i, type: 'clips' }], areas: { explore: 1 } };
    }
    const data = Object.assign({
      spotify: { clientId: 'a'.repeat(32), access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3.6e6, scope: 'playlist-modify-private user-modify-playback-state user-read-playback-state', user: 'jkidd' },
      tracks, matches: {},
    }, store);
    window.__store = data;
    window.__embedEvents = [];
    window.addEventListener('message', (e) => { if (e.data && e.data.type === '__test') window.__embedEvents.push(e.data); });
    const listeners = [];
    const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
    const fire = () => listeners.forEach((l) => l({}, 'local'));
    window.chrome = {
      storage: { local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, clone(data[k])])),
        set: async (o) => { Object.assign(data, clone(o)); fire(); },
        remove: async (ks) => { ks.forEach((k) => delete data[k]); fire(); },
      }, onChanged: { addListener: (f) => listeners.push(f) } },
      identity: { getRedirectURL: () => 'https://adnfnkniiefhlojabhejngpkefohmnhg.chromiumapp.org/' },
      runtime: { getManifest: () => manifest, id: 'test' },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, o) => (String(url).includes('spotify.com') ? sim.fetch(url, o) : realFetch(url, o));
  }, simSource, songs, devices || null, store, manifest, simOpts);
  await page.goto(`http://localhost:${srv.address().port}/sidepanel.html`);
  await new Promise((r) => setTimeout(r, 800));
  return { browser, page, errors, close: async () => { await browser.close(); srv.close(); } };
}

// Is the element actually visible to a person: rendered and inside the viewport?
async function onScreen(page, sel) {
  return page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });
}
module.exports = { open, onScreen };
