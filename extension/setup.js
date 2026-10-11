// The "Connect Spotify" section.
import * as S from './spotify.js';
import { runConnect as platformConnect, PLATFORM } from './platform.js';
import { $, setMsg } from './dom.js';
import { connected } from './store.js';

export function renderSetup(st) {
  $('#redirect-uri').textContent = S.redirectUri();
  const ok = connected(st);
  // On iPhone the setup steps live on their own page (onboarding.html); the popup links to it.
  const mobile = PLATFORM === 'safari';
  $('#setup-steps').hidden = ok || mobile;
  $('#setup-mobile').hidden = ok || !mobile;
  $('#setup-done').hidden = !ok;
  $('#setup-summary').textContent = ok ? 'Spotify connected' : 'Connect Spotify';
  $('#connect-note').hidden = ok; // on the songs screen; the steps themselves are in Settings
  $('#sp-user').textContent = (st.spotify && st.spotify.user) || 'your account';
  if (!$('#setup').dataset.touched) $('#setup').open = !ok;
  const cid = $('#client-id');
  if (document.activeElement !== cid && st.spotify && st.spotify.clientId) cid.value = st.spotify.clientId;
}

export function openSetup() {
  $('#setup').open = true;
  $('#setup').dataset.touched = '1';
}

// The Settings screen (Spotify connection, version, debug data). It slides in over the songs.
export function showSettings(on = true) {
  if (document.body.classList.contains('settings-open') === on) return;
  document.body.classList.toggle('settings-open', on);
  if (on) $('#setup').open = true; // on this screen there's no reason to keep it folded
  $('#main').inert = on;
  $('#settings').inert = !on;
  (on ? $('#settings-back') : $('#open-settings')).focus({ preventScroll: true });
}
// For someone who pressed something that needs Spotify: straight to the steps.
export function openSettingsForSetup() {
  openSetup();
  showSettings(true);
}

export function wireSetup({ store, onError, onDisconnect }) {
  $('#settings').inert = true;
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
  $('#setup').addEventListener('toggle', () => { $('#setup').dataset.touched = '1'; });

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
    setMsg('Client ID saved. Now click Connect Spotify.');
  });

  $('#connect').addEventListener('click', async () => {
    const v = $('#client-id').value.trim();
    if (v && store.st.spotify.clientId !== v) await S.saveClientId(v);
    try {
      setMsg('Opening Spotify login…');
      await platformConnect(S.connect);
      $('#setup').dataset.touched = '';
      setMsg('Spotify connected.');
    } catch (err) {
      onError(err);
    }
  });

  $('#disconnect').addEventListener('click', async () => {
    await onDisconnect();
    await S.disconnect();
    setMsg('Spotify disconnected.');
  });
}
