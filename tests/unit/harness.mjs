// Boots the real sidepanel.html + sidepanel.js in jsdom with a stubbed chrome.* and the Spotify sim.
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { makeChromeStorage } from '../sim/spotify-sim.mjs';

export const connectedSpotify = () => ({
  clientId: 'a'.repeat(32), access_token: 't0', refresh_token: 'r0', expires_at: Date.now() + 3.6e6,
  scope: 'playlist-modify-private playlist-modify-public', user: 'jkidd',
});

export async function boot(sim, initial = {}) {
  const html = fs.readFileSync(EXT_DIR + 'sidepanel.html', 'utf8').replace(/<script.*<\/script>/g, '');
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'chrome-extension://abc/sidepanel.html' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    requestAnimationFrame: (f) => setTimeout(f, 0),
  });
  const storage = makeChromeStorage({ spotify: connectedSpotify(), tracks: {}, matches: {}, ...initial });
  globalThis.chrome = {
    storage: { local: storage.local, onChanged: storage.onChanged },
    identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/' },
    runtime: { getManifest: () => JSON.parse(fs.readFileSync(EXT_DIR + 'manifest.json', 'utf8')) },
  };
  globalThis.fetch = sim.fetch;
  await import(`${EXT_DIR}sidepanel.js?${Math.random()}`);
  return {
    storage,
    $: (s) => document.querySelector(s),
    // A write from somewhere else (the bridge capturing songs).
    external: (patch) => storage.local.set(patch),
  };
}

export const track = (key, title, artist, t) => ({
  key, kind: 'song', title, artist, first_seen: t, last_seen: t,
  posts: [{ code: key, type: 'clips' }], areas: { explore: 1 },
});
export const rows = () => [...document.querySelectorAll('#list > li.row')];
export const rowBy = (text) => rows().find((li) => li.querySelector('.title').textContent === text);
