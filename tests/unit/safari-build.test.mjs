// The Safari (iPhone) build: assembled by tools/build-safari.mjs, then its background script
// runs the whole Spotify login through a tab + loopback redirect against the Spotify simulator.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeSim, makeChromeStorage } from '../sim/spotify-sim.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(root, 'dist', 'safari') + '/';

// ---- build
const b = spawnSync(process.execPath, [path.join(root, 'tools', 'build-safari.mjs')], { encoding: 'utf8' });
check('the Safari build assembles', b.status === 0, b.stderr || b.stdout);
const manifest = JSON.parse(fs.readFileSync(DIST + 'manifest.json', 'utf8'));
const desktop = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
check('same version as the desktop build', manifest.version === desktop.version, manifest.version);
check('no side panel, popup is the panel page', !manifest.side_panel && manifest.action.default_popup === 'sidepanel.html' && !manifest.permissions.includes('sidePanel'));
check('desktop-only helper left out', !fs.existsSync(DIST + 'spotify-dashboard.js'));
const shipped = fs.readdirSync(DIST).filter((f) => f.endsWith('.js') && f !== 'platform.js')
  .filter((f) => /chrome\.(identity|sidePanel)/.test(fs.readFileSync(DIST + f, 'utf8')));
check('no Chrome-only API outside platform.js', shipped.length === 0, shipped.join(','));
check('the popup loads the popup width rule', fs.readFileSync(DIST + 'sidepanel.html', 'utf8').includes('popup.css'));

// ---- chrome.* stub for the background script
const sim = makeSim({ rotateRefresh: true });
const storage = makeChromeStorage({ spotify: { clientId: 'c'.repeat(32) } });
const tokenBodies = [];
globalThis.fetch = (url, o) => {
  if (String(url).includes('/api/token')) tokenBodies.push(Object.fromEntries(new URLSearchParams(o.body)));
  return sim.fetch(url, o);
};
const ev = () => { const ls = []; return { addListener: (f) => ls.push(f), removeListener: (f) => { const i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); }, fire: (...a) => ls.slice().forEach((f) => f(...a)), count: () => ls.length }; };
const tabs = { created: [], removed: [], onUpdated: ev(), onRemoved: ev(), query: async () => [] };
tabs.create = async ({ url }) => { const tab = { id: 100 + tabs.created.length, url }; tabs.created.push(tab); return tab; };
tabs.remove = async (id) => { tabs.removed.push(id); tabs.onRemoved.fire(id); };
const registered = [];
const runtime = { onMessage: ev(), onInstalled: ev(), onStartup: ev(), getURL: (p) => `safari-web-extension://x/${p}` };
globalThis.chrome = {
  storage: { local: storage.local, onChanged: storage.onChanged },
  tabs,
  webNavigation: { onBeforeNavigate: ev() },
  runtime,
  scripting: { registerContentScripts: async (s) => registered.push(...s), unregisterContentScripts: async () => {}, executeScript: async () => {} },
  action: { setBadgeText: async () => {} },
};
await import(DIST + 'background.js');
const { REDIRECT } = await import(DIST + 'platform.js');

// Starts a login; resolves with the background's answer. `tab()` waits for that login's own tab.
const connect = () => {
  const before = tabs.created.length;
  const answer = new Promise((resolve) => runtime.onMessage.fire({ type: 'ef-connect' }, {}, resolve));
  answer.tab = async () => { for (let i = 0; i < 200 && tabs.created.length === before; i++) await tick(10); return tabs.created[before]; };
  return answer;
};

// ---- capture script registered for the MAIN world
runtime.onInstalled.fire({ reason: 'install' });
await tick(20);
check('registers the capture script for the page\'s own world (Safari fallback)',
  registered.some((s) => s.world === 'MAIN' && s.js.includes('inject.js') && s.runAt === 'document_start'), JSON.stringify(registered));

// ---- happy path
{
  const answer = connect();
  const tab = await answer.tab();
  const auth = new URL(tab.url);
  check('opens Spotify\'s login in a tab', auth.origin === 'https://accounts.spotify.com' && auth.pathname === '/authorize');
  check('...with the loopback Redirect URI and PKCE', auth.searchParams.get('redirect_uri') === REDIRECT &&
    auth.searchParams.get('code_challenge_method') === 'S256' && auth.searchParams.get('client_id') === 'c'.repeat(32));
  tabs.onUpdated.fire(tab.id, { status: 'loading' }, { url: tab.url }); // still on Spotify: ignored
  tabs.onUpdated.fire(999, { url: `${REDIRECT}?code=other&state=x` }); // another tab: ignored
  tabs.onUpdated.fire(tab.id, { url: `${REDIRECT}?code=abc123&state=${auth.searchParams.get('state')}` });
  const r = await answer;
  check('login completes', r && r.ok === true, JSON.stringify(r));
  check('exchanges the code with the same Redirect URI and a verifier', tokenBodies.length === 1 && tokenBodies[0].code === 'abc123' &&
    tokenBodies[0].redirect_uri === REDIRECT && tokenBodies[0].code_verifier && tokenBodies[0].grant_type === 'authorization_code', JSON.stringify(tokenBodies));
  check('stores the tokens and the account name', !!storage.data.spotify.refresh_token && storage.data.spotify.user === 'Jkidd', JSON.stringify(storage.data.spotify));
  check('closes the login tab', tabs.removed.includes(tab.id));
  check('stops listening afterwards', tabs.onUpdated.count() === 0 && chrome.webNavigation.onBeforeNavigate.count() === 0);
}

// ---- the redirect seen through webNavigation instead of tabs.onUpdated
{
  const answer = connect();
  const tab = await answer.tab();
  const state = new URL(tab.url).searchParams.get('state');
  chrome.webNavigation.onBeforeNavigate.fire({ tabId: tab.id, url: `${REDIRECT}?code=nav&state=${state}` });
  const r = await answer;
  check('also catches the redirect via webNavigation', r && r.ok === true && tokenBodies[tokenBodies.length - 1].code === 'nav');
}

// ---- the person closes the login tab
{
  const answer = connect();
  const tab = await answer.tab();
  tabs.onRemoved.fire(tab.id);
  const r = await answer;
  check('closing the login tab gives a clear error', r && /login was closed/.test(r.error) && r.code === 'INPUT', JSON.stringify(r));
}

// ---- a redirect with the wrong state is rejected
{
  const answer = connect();
  const tab = await answer.tab();
  tabs.onUpdated.fire(tab.id, { url: `${REDIRECT}?code=evil&state=wrong` });
  const r = await answer;
  check('a login response with the wrong state is rejected', r && /did not match/.test(r.error), JSON.stringify(r));
}

// ---- Spotify says no (e.g. not on the app's user list)
{
  const answer = connect();
  const tab = await answer.tab();
  tabs.onUpdated.fire(tab.id, { url: `${REDIRECT}?error=access_denied&state=x` });
  const r = await answer;
  check('Spotify refusing the login is explained', r && /cancelled or denied/.test(r.error), JSON.stringify(r));
}

// ---- popup side: errors from the background come back as errors
{
  chrome.runtime.sendMessage = async () => ({ error: 'Spotify login was closed. Try Connect again.', code: 'INPUT' });
  const { runConnect } = await import(DIST + 'platform.js');
  let err = null;
  try { await runConnect(); } catch (e) { err = e; }
  check('popup: a failed login is thrown with its code', err && err.code === 'INPUT' && /closed/.test(err.message));
}

done();
