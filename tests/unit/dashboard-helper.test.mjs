// The setup helper on Spotify's developer dashboard, against a page built from the live form's
// fields (2026-10-06): fills what's empty, never ticks the terms or clicks Save, and offers the
// Client ID from an app page's URL.
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const SRC = fs.readFileSync(EXT_DIR + 'spotify-dashboard.js', 'utf8');
const ID = 'adnfnkniiefhlojabhejngpkefohmnhg';
const REDIRECT = `https://${ID}.chromiumapp.org/`;
const CREATE_FORM = `<main><form>
  <label for="name">App name*(required)</label><input id="name" name="name" type="text">
  <label for="description">App description*(required)</label><textarea id="description" name="description"></textarea>
  <label for="website">Website</label><input id="website" name="website" type="text">
  <label for="newRedirectUri">Redirect URIs*(required)</label><input id="newRedirectUri" name="newRedirectUri" type="text" placeholder="https://example.org/callback">
  <button type="button" aria-label="Add redirect URI">Add</button><ul id="uris"></ul>
  <input type="checkbox" id="apis-used-1"><label for="apis-used-1">Web API</label>
  <input type="checkbox" id="apis-used-3"><label for="apis-used-3">Web Playback SDK</label>
  <input type="checkbox" id="termsAccepted" name="termsAccepted"><label for="termsAccepted">I understand and agree with Spotify's Developer Terms of Service</label>
  <button type="submit" id="save">Save</button>
</form></main>`;

function page(path, body, stored = {}) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url: `https://developer.spotify.com${path}`, runScripts: 'outside-only' });
  const w = dom.window;
  const store = JSON.parse(JSON.stringify(stored));
  w.chrome = { runtime: { id: ID }, storage: { local: {
    get: async (k) => ({ [k]: store[k] && JSON.parse(JSON.stringify(store[k])) }),
    set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
  } } };
  const events = { saved: 0, adds: 0 };
  const add = w.document.querySelector('button[aria-label="Add redirect URI"]');
  if (add) add.addEventListener('click', () => {
    events.adds++;
    const input = w.document.querySelector('#newRedirectUri');
    const li = w.document.createElement('li'); li.textContent = input.value;
    w.document.querySelector('#uris').append(li); input.value = '';
  });
  const form = w.document.querySelector('form');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); events.saved++; });
  w.eval(SRC);
  const shadow = () => { const h = w.document.querySelector('#explore-finds-helper'); return h && h.shadowRoot; };
  return { w, $: (s) => w.document.querySelector(s), store, events, shadow };
}

// ---- Create app
{
  const p = page('/dashboard/create', CREATE_FORM);
  await tick(50);
  check('fills the app name and description', p.$('#name').value === 'Explore Finds' && p.$('#description').value.length > 10);
  check('adds the Redirect URI through the Add button', p.events.adds === 1 && p.$('#uris').textContent === REDIRECT, p.$('#uris').textContent);
  check('ticks Web API (and nothing else)', p.$('#apis-used-1').checked && !p.$('#apis-used-3').checked);
  check('leaves Spotify\'s terms box for the person', !p.$('#termsAccepted').checked);
  check('never clicks Save', p.events.saved === 0);
  check('tells the person what is left to do', /Tick Spotify's terms box and click/.test(p.shadow().textContent), p.shadow() && p.shadow().textContent);
  await tick(1100); // the helper re-checks every 500 ms
  check('does not add the Redirect URI twice', p.events.adds === 1);
  p.w.close();
}
{
  const p = page('/dashboard/create', CREATE_FORM);
  p.$('#name').value = 'My own name'; // typed before the helper ran? keep it
  await tick(600);
  check('keeps a name the person already typed', p.$('#name').value === 'My own name');
  p.w.close();
}
{
  const p = page('/dashboard/create', CREATE_FORM.replace('<li', '<li').replace('<ul id="uris"></ul>', `<ul id="uris"><li>${REDIRECT}</li></ul>`));
  await tick(50);
  check('Redirect URI already listed: not added again', p.events.adds === 0);
  p.w.close();
}

// ---- App page: offer the Client ID from the URL
const CID = 'c0ffee00c0ffee00c0ffee00c0ffee00';
{
  const p = page(`/dashboard/${CID}`, '<main>App</main>', { spotify: { clientId: 'a'.repeat(32), access_token: 'old', refresh_token: 'old', user: 'x' } });
  await tick(50);
  const btn = [...p.shadow().querySelectorAll('button')].find((b) => b.textContent === 'Use this app');
  check('on an app page: offers "Use this app"', !!btn, p.shadow() && p.shadow().querySelector('.b').textContent);
  btn.click();
  await tick(50);
  check('saves that Client ID and clears the old login', p.store.spotify.clientId === CID && p.store.spotify.access_token === null &&
    p.store.spotify.refresh_token === null, JSON.stringify(p.store.spotify));
  check('then says to click Connect Spotify', /Connect Spotify/.test(p.shadow().textContent));
  p.w.close();
}
{
  const p = page(`/dashboard/${CID}/settings`, '<main>Settings</main>', { spotify: { clientId: CID, refresh_token: 'keep' } });
  await tick(50);
  check('already using this app: says so, offers no button, keeps the login',
    /already set to use this app/.test(p.shadow().textContent) && ![...p.shadow().querySelectorAll('button')].some((b) => b.textContent === 'Use this app') &&
    p.store.spotify.refresh_token === 'keep');
  p.w.close();
}

// ---- In-page navigation: after Save the dashboard moves to the new app's page
{
  const p = page('/dashboard/create', CREATE_FORM, { spotify: {} });
  await tick(50);
  p.w.history.pushState({}, '', `/dashboard/${CID}`);
  await tick(700);
  check('after Save (in-page navigation) it offers the new app', [...p.shadow().querySelectorAll('button')].some((b) => b.textContent === 'Use this app'));
  p.w.close();
}

// ---- Other pages: nothing
{
  const p = page('/dashboard', '<main>Apps</main>');
  await tick(50);
  check('the app list page gets no banner', !p.shadow());
  p.w.close();
}
done();
