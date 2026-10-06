import { JSDOM } from 'jsdom';
import fs from 'fs';
export async function boot(dir, sim, extraStore = {}) {
  const html = fs.readFileSync(dir + 'sidepanel.html', 'utf8').replace(/<script.*<\/script>/, '');
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'chrome-extension://abc/sidepanel.html' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, requestAnimationFrame: (f) => setTimeout(f, 0) });
  const store = {
    spotify: { clientId: 'a'.repeat(32), access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3.6e6, scope: 'playlist-modify-private user-modify-playback-state user-read-playback-state', user: 'jkidd' },
    tracks: {}, matches: {}, ...extraStore,
  };
  const listeners = [];
  const fire = () => listeners.forEach((l) => l({}, 'local'));
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  globalThis.chrome = {
    storage: { local: {
      get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, clone(store[k])])),
      set: async (o) => { Object.assign(store, clone(o)); fire(); },
      remove: async (ks) => { ks.forEach((k) => delete store[k]); fire(); },
    }, onChanged: { addListener: (f) => listeners.push(f) } },
    identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/' },
    runtime: { getManifest: () => JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8')) },
  };
  globalThis.fetch = sim.fetch;
  await import(dir + 'sidepanel.js?' + Math.random());
  return { store, fire, $: (s) => document.querySelector(s) };
}
export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
export const track = (key, title, artist, t) => ({ key, kind: 'song', title, artist, first_seen: t, last_seen: t, posts: [{ code: key, type: 'clips' }], areas: { explore: 1 } });
export const rowBy = (text) => [...document.querySelectorAll('#list > li.row')].find((li) => li.querySelector('.title').textContent === text);
