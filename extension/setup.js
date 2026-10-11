// The "Connect Spotify" section.
import * as S from './spotify.js';
import { runConnect as platformConnect, PLATFORM } from './platform.js';
import { $, setMsg } from './dom.js';
import { connected } from './store.js';

// What the helper on Spotify's dashboard last reported (storage key `setupSeen`:
// { page: 'create' | 'list' | 'app', filled, at }), so the steps here follow along.
let seen = null;
let shownId = null; // the Client ID last written into the box
let changing = false; // "Change" was pressed: step 1 is open again although an app is set
const LIVE = {
  create: (s) => (s.filled === false
    ? 'Couldn\'t fill in Spotify\'s form. Use "By hand" below.'
    : s.terms ? 'Terms ticked. Now click Save on Spotify\'s page.'
      : 'The form is filled in. On Spotify\'s page, tick the terms box and click Save.'),
  list: () => 'On Spotify\'s page, click Create app. If you already have an app, open it.',
  app: () => 'On Spotify\'s page, press "Use this app".',
};

export function renderSetup(st) {
  $('#redirect-uri').textContent = S.redirectUri();
  const ok = connected(st);
  // The two steps: an app (a Client ID), then the login. One is open at a time.
  const clientId = (st.spotify && st.spotify.clientId) || '';
  const appDone = !!clientId && !changing;
  $('#step-app').classList.toggle('done', appDone);
  $('#step-app').classList.toggle('now', !appDone);
  $('#step-connect').classList.toggle('now', appDone);
  $('#step-app-body').hidden = appDone;
  $('#step-app-done').hidden = !appDone;
  $('#step-connect-body').hidden = !appDone;
  $('#step-app-state').textContent = appDone ? 'Done' : '';
  $('#app-id').textContent = clientId ? `${clientId.slice(0, 6)}…` : '';
  const fresh = seen && Date.now() - seen.at < 10 * 60_000 && LIVE[seen.page];
  $('#step-live').hidden = !fresh;
  $('#step-live').textContent = fresh ? LIVE[seen.page](seen) : '';
  // On iPhone the setup steps live on their own page (onboarding.html); the popup links to it.
  const mobile = PLATFORM === 'safari';
  $('#setup-steps').hidden = ok || mobile;
  $('#setup-mobile').hidden = ok || !mobile;
  $('#setup-done').hidden = !ok;
  $('#setup-summary').textContent = ok ? 'Spotify connected' : 'Connect Spotify';
  $('#connect-note').hidden = ok; // on the songs screen; the steps themselves are in Settings
  $('#sp-user').textContent = (st.spotify && st.spotify.user) || 'your account';
  const cid = $('#client-id');
  // The box follows the stored Client ID when that changes (also to none, after Start over).
  if (document.activeElement !== cid && clientId !== shownId) { cid.value = clientId; shownId = clientId; }
}

// The Settings screen (Spotify connection, version, debug data). It slides in over the songs.
export function showSettings(on = true) {
  if (document.body.classList.contains('settings-open') === on) return;
  document.body.classList.toggle('settings-open', on);
  $('#main').inert = on;
  $('#settings').inert = !on;
  (on ? $('#settings-back') : $('#open-settings')).focus({ preventScroll: true });
}
// For someone who pressed something that needs Spotify: straight to the steps.
export function openSettingsForSetup() {
  showSettings(true);
}

export function wireSetup({ store, onError, onDisconnect }) {
  $('#settings').inert = true;
  chrome.storage.local.get('setupSeen').then((s) => { seen = s.setupSeen || null; renderSetup(store.st); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.setupSeen) seen = changes.setupSeen.newValue || null;
    // A Client ID arriving (from the helper's "Use this app", or Save here) closes step 1.
    if (changes.spotify && ((changes.spotify.newValue || {}).clientId) !== ((changes.spotify.oldValue || {}).clientId)) {
      changing = false;
      if ((changes.spotify.newValue || {}).clientId) setMsg('Your Spotify app is set. Now connect your account.');
    }
    if (changes.setupSeen || changes.spotify) renderSetup(store.st);
  });
  $('#change-app').addEventListener('click', () => { changing = true; $('#by-hand').open = true; renderSetup(store.st); });
  $('#open-settings').addEventListener('click', () => showSettings(true));
  $('#settings-back').addEventListener('click', () => showSettings(false));
  $('#connect-note-btn').addEventListener('click', openSettingsForSetup);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') showSettings(false); });
  // Appearance: light, dark or follow system (theme.js applies it and remembers it).
  const theme = window.efTheme || { get: () => 'system', set() {} };
  for (const radio of document.querySelectorAll('.theme-pick input')) {
    radio.checked = radio.value === theme.get();
    radio.addEventListener('change', () => { if (radio.checked) theme.set(radio.value); });
  }

  $('#open-onboarding').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    window.close();
  });

  $('#copy-redirect').addEventListener('click', async () => {
    await navigator.clipboard.writeText(S.redirectUri());
    $('#copy-redirect').textContent = 'Copied';
    setTimeout(() => { $('#copy-redirect').textContent = 'Copy'; }, 1500);
  });

  $('#save-client').addEventListener('click', async () => {
    const v = $('#client-id').value.trim();
    if (!/^[a-z0-9]{32}$/i.test(v)) {
      setMsg('That doesn\'t look like a Client ID. It should be 32 letters and numbers.', true);
      return;
    }
    await S.saveClientId(v);
    changing = false;
    renderSetup(store.st);
    setMsg('Client ID saved. Now click Connect Spotify.');
  });

  $('#connect').addEventListener('click', async () => {
    const v = $('#client-id').value.trim();
    if (v && store.st.spotify.clientId !== v) await S.saveClientId(v);
    try {
      setMsg('Opening Spotify login…');
      await platformConnect(S.connect);
      setMsg('Spotify connected.');
    } catch (err) {
      // Spotify turned the app down: back to step 1, where a new one can be made.
      if (err && err.refused) { changing = true; $('#by-hand').open = true; renderSetup(store.st); }
      onError(err);
    }
  });

  // Start over: forget the app and the login, back to step 1 as on a first run. Nothing is
  // touched on Spotify. Two presses, since it disconnects.
  let sure = null;
  $('#start-over').addEventListener('click', async () => {
    if (!sure) {
      $('#start-over').textContent = 'Press again to start over';
      sure = setTimeout(() => { sure = null; $('#start-over').textContent = 'Start over'; }, 4000);
      return;
    }
    clearTimeout(sure);
    sure = null;
    $('#start-over').textContent = 'Start over';
    await onDisconnect();
    await S.saveClientId('');
    await chrome.storage.local.remove('setupSeen').catch(() => {});
    seen = null;
    changing = false;
    $('#by-hand').open = false;
    renderSetup(store.st);
    setMsg('Starting over. Create your Spotify app, or paste a Client ID.');
  });

  $('#disconnect').addEventListener('click', async () => {
    await onDisconnect();
    await S.disconnect();
    setMsg('Spotify disconnected.');
  });
}
