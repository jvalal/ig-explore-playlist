// iPhone build: the setup page (onboarding.html), the popup's link to it, and the button count.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { makeSim, makeChromeStorage } from '../sim/spotify-sim.mjs';
import { suite, tick, waitUntil } from '../check.mjs';

const { check, done } = suite();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(root, 'dist', 'safari') + '/';
const b = spawnSync(process.execPath, [path.join(root, 'tools', 'build-safari.mjs')], { encoding: 'utf8' });
check('the Safari build assembles', b.status === 0, b.stderr);

const CID = 'c'.repeat(32);
async function openPage(file, initial) {
  const html = fs.readFileSync(DIST + file, 'utf8').replace(/<script type="module".*<\/script>/, '');
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: `safari-web-extension://x/${file}` });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, requestAnimationFrame: (f) => setTimeout(f, 0) });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); // Node has its own
  dom.window.scrollTo = () => {};
  const storage = makeChromeStorage(initial);
  const created = [];
  let connects = 0;
  globalThis.chrome = {
    storage: { local: storage.local, onChanged: storage.onChanged },
    runtime: {
      getManifest: () => JSON.parse(fs.readFileSync(DIST + 'manifest.json', 'utf8')),
      getURL: (p) => `safari-web-extension://x/${p}`,
      // The background answers the login; here it succeeds the way background.js stores it.
      sendMessage: async (msg) => {
        if (msg.type !== 'ef-connect') return undefined;
        connects++;
        const { spotify } = await storage.local.get('spotify');
        await storage.local.set({ spotify: { ...spotify, refresh_token: 'r', access_token: 't', expires_at: Date.now() + 3.6e6, user: 'Jkidd' } });
        return { ok: true };
      },
    },
    tabs: { create: async (o) => created.push(o.url) },
  };
  globalThis.fetch = makeSim().fetch;
  await import(`${DIST}${file.replace('.html', '.js')}?${Math.random()}`);
  await tick(30);
  const $ = (s) => document.querySelector(s);
  const visible = () => [...document.querySelectorAll('section[data-step]')].filter((s) => !s.hidden).map((s) => s.dataset.step);
  const click = (s) => $(s).click();
  const next = () => [...document.querySelectorAll('section[data-step]')].find((s) => !s.hidden).querySelector('[data-next]').click();
  return { $, storage, visible, click, next, created, connects: () => connects, window: dom.window };
}

// ---- first run, step by step
{
  const p = await openPage('onboarding.html', {});
  check('starts at Welcome, step 1 of 5', p.visible().join() === 'welcome' && p.$('#ob-progress').textContent === 'Step 1 of 5');
  p.next(); await tick(20);
  check('Next: the Spotify app step', p.visible().join() === 'spotify');
  check('shows the iPhone Redirect URI to add', p.$('#ob-redirect').textContent === 'http://127.0.0.1:43821/explore-finds');
  check('Next is off until a Client ID is saved', p.$('#ob-spotify-next').disabled);
  p.$('#ob-client').value = 'not-an-id'; p.click('#ob-save'); await tick(20);
  check('a wrong Client ID is explained, not saved', /32 letters and numbers/.test(p.$('#ob-client-msg').textContent) && !(p.storage.data.spotify || {}).clientId);
  p.$('#ob-client').value = CID; p.click('#ob-save');
  await waitUntil(() => !p.$('#ob-spotify-next').disabled, 2000);
  check('a valid Client ID is saved and Next turns on', p.storage.data.spotify.clientId === CID && !p.$('#ob-spotify-next').disabled);
  p.next(); await tick(20);
  check('Next: Connect', p.visible().join() === 'connect' && !p.$('#ob-connect').hidden && p.$('#ob-connect-next').hidden);
  p.click('#ob-connect');
  await waitUntil(() => !p.$('#ob-connect-next').hidden, 2000);
  check('Connect runs the login in the background and shows the account', p.connects() === 1 && /Connected as Jkidd/.test(p.$('#ob-connect-msg').textContent));
  p.next(); await tick(20);
  check('Next: Allow Instagram', p.visible().join() === 'instagram');
  p.next(); await tick(20);
  check('Next: Done, with a link to Instagram Explore', p.visible().join() === 'done' && p.$('#ob-explore').href === 'https://www.instagram.com/explore/#weblink');
  check('Explore opens in a new tab, so the setup page stays', p.$('#ob-explore').target === '_blank');
  const igLinks = [...document.querySelectorAll('a[href*="instagram.com"]')].map((a) => a.href);
  check('every Instagram link on the setup page stays in Safari (#weblink, not the app)',
    igLinks.length >= 2 && igLinks.every((h) => h.endsWith('#weblink')), igLinks.join(' '));
  check('progress is remembered', p.storage.data.onboarding && p.storage.data.onboarding.step === 'done');
  p.window.close();
}

// ---- coming back: picks up where you left off
{
  const p = await openPage('onboarding.html', { spotify: { clientId: CID }, onboarding: { step: 'connect' } });
  check('reopening resumes at the saved step', p.visible().join() === 'connect');
  p.window.close();
}
{
  const p = await openPage('onboarding.html', { spotify: { clientId: CID, refresh_token: 'r', user: 'Jkidd' } });
  check('already connected: skips ahead to Allow Instagram', p.visible().join() === 'instagram');
  p.window.close();
}

// ---- the popup: one button to the setup page instead of the desktop steps
{
  const p = await openPage('sidepanel.html', { tracks: {}, matches: {} });
  window.close = () => { p.closed = true; };
  await tick(50);
  const popupIg = [...document.querySelectorAll('a[href*="instagram.com"]')].map((a) => a.href);
  check('popup: the empty list links to Explore, kept in Safari', popupIg.includes('https://www.instagram.com/explore/#weblink'), popupIg.join(' '));
  check('popup, not connected: shows "Set up Explore Playlist Gen", hides the desktop steps',
    !p.$('#setup-mobile').hidden && p.$('#setup-steps').hidden, `${p.$('#setup-mobile').hidden} ${p.$('#setup-steps').hidden}`);
  p.click('#open-onboarding'); await tick(20);
  check('...which opens the setup page and closes the popup', p.created[0] === 'safari-web-extension://x/onboarding.html' && p.closed);
  p.window.close();
}

// ---- background: opens the setup page on install, counts songs on the button
{
  const storage = makeChromeStorage({});
  const ev = () => { const ls = []; return { addListener: (f) => ls.push(f), removeListener() {}, fire: (...a) => ls.forEach((f) => f(...a)) }; };
  const created = [];
  const badges = [];
  const runtime = { onMessage: ev(), onInstalled: ev(), onStartup: ev(), getURL: (p) => `safari-web-extension://x/${p}` };
  globalThis.chrome = {
    storage: { local: storage.local, onChanged: storage.onChanged },
    runtime,
    tabs: { create: async (o) => created.push(o.url), query: async () => [], onUpdated: ev(), onRemoved: ev() },
    scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => {} },
    action: { setBadgeText: async (o) => badges.push(o.text) },
  };
  await import(`${DIST}background.js?${Math.random()}`);
  runtime.onInstalled.fire({ reason: 'install' });
  await tick(30);
  check('first install opens the setup page', created.includes('safari-web-extension://x/onboarding.html'));
  runtime.onInstalled.fire({ reason: 'update' });
  await tick(30);
  check('an update does not open it again', created.filter((u) => u.endsWith('onboarding.html')).length === 1);
  const t = (key, areas) => ({ key, kind: 'song', title: key, artist: 'A', first_seen: 1, last_seen: 1, posts: [], areas });
  await storage.local.set({ tracks: { a: t('a', { explore: 1 }), b: t('b', { explore: 2 }), c: t('c', { home: 1 }), d: { ...t('d', { explore: 1 }), kind: 'original' } } });
  await tick(50);
  check('the button shows the Explore song count (not home-feed songs or original audio)', badges[badges.length - 1] === '2', JSON.stringify(badges));
  await storage.local.set({ tracks: {} });
  await tick(50);
  check('after Clear the count disappears', badges[badges.length - 1] === '', JSON.stringify(badges));
}

done();
