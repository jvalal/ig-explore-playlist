// The floating window's controls (mini.js) in jsdom, while Spotify is rate-limiting the app.
// The user's case, 2026-10-10: Keep on top "isn't working". The "+" asks Spotify whether the
// song is saved; rate-limited, that fails at once, and each failure asked again straight away,
// without end, which froze the mini window.
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { makeSim, makeChromeStorage } from '../sim/spotify-sim.mjs';
import { suite, tick } from '../check.mjs';
import { track } from './harness.mjs';

const { check, done } = suite();
const html = fs.readFileSync(EXT_DIR + 'player.html', 'utf8').replace(/<script.*<\/script>/g, '');
const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'chrome-extension://abc/player.html?key=k1&from=7' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, location: dom.window.location,
  addEventListener: dom.window.addEventListener.bind(dom.window),
  requestAnimationFrame: (f) => setTimeout(f, 0),
  ResizeObserver: class { observe() {} disconnect() {} },
});
const sim = makeSim();
const storage = makeChromeStorage({
  spotify: { clientId: 'a'.repeat(32), access_token: 't0', refresh_token: 'r0', expires_at: Date.now() + 3.6e6, user: 'jkidd',
    scope: 'user-library-read user-library-modify playlist-modify-private playlist-modify-public' },
  tracks: { k1: track('k1', 'Nicole Kidman', 'ADÉLA', 1000) },
  matches: { k1: { status: 'matched', id: 'AAA', uri: 'spotify:track:AAA', name: 'Nicole Kidman' } },
  spotifyLimit: Date.now() + 16 * 3600 * 1000,
});
const noop = async () => ({});
globalThis.chrome = {
  storage: { local: storage.local, session: { get: noop, set: noop, remove: noop }, onChanged: storage.onChanged },
  identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/' },
  runtime: { onMessage: { addListener() {} }, sendMessage: noop, getManifest: () => ({ version: '0' }) },
  windows: { getCurrent: async () => ({ id: 1, state: 'normal' }), update: noop, remove: noop },
  tabs: { getZoom: async () => 1 },
  sidePanel: { open: noop },
};
let asked = 0;
const covers = [];
// Spotify's public oEmbed lookup (no login, not the rate-limited Web API) knows a song's cover.
globalThis.fetch = (...a) => {
  const u = new URL(String(a[0]));
  if (u.host === 'open.spotify.com' && u.pathname === '/oembed') {
    covers.push(u.searchParams.get('url'));
    return Promise.resolve({ ok: true, json: async () => ({ thumbnail_url: 'https://image-cdn.example/cover-AAA' }) });
  }
  asked++;
  return sim.fetch(...a);
};

await import(`${EXT_DIR}mini.js?${Math.random()}`);
await tick(50);
const $ = (s) => document.querySelector(s);
check('the song is in the mini player', /Nicole Kidman/.test($('#mini-now').textContent), $('#mini-now').textContent);

// Keep on top shows these controls and renders them. Count how often the "+" is redrawn:
// an endless retry redraws it without ever letting go, so stop the test when it runs away.
let redraws = 0;
new dom.window.MutationObserver((list) => {
  redraws += list.length;
  if (redraws > 500) {
    console.log('FAIL  rate-limited, the "+" keeps asking Spotify without end (the mini window freezes)');
    process.exit(1);
  }
}).observe($('#mini-float-save'), { attributes: true });
$('#mini-float').hidden = false;
await storage.local.set({ prefs: { goal: 0 } }); // any change re-renders
await tick(300);
check('rate-limited: the floating controls show the song and stay responsive', $('#mini-float-title').textContent === 'Nicole Kidman' && redraws <= 500, `${redraws} redraws`);
check('...the "+" is offered, not shown as saved', !$('#mini-float-save').hidden && !$('#mini-float-save').classList.contains('saved'));
check('...and Spotify was not asked over the network', asked === 0, String(asked));

// A match without a picture (a song known only from the playlist, v0.11.7): the user saw the
// floating window without album art. The cover comes from the public lookup, asked once.
await storage.local.set({ prefs: { goal: 10 } });
await tick(100);
check('a match without a picture still gets its cover in the floating controls', !$('#mini-float-art').hidden && $('#mini-float-art').src === 'https://image-cdn.example/cover-AAA',
  `${$('#mini-float-art').hidden} ${$('#mini-float-art').src}`);
check('...looked up once for the song', covers.length === 1 && covers[0] === 'spotify:track:AAA', JSON.stringify(covers));
done();
