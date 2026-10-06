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
  $('#sp-user').textContent = (st.spotify && st.spotify.user) || 'your account';
  if (!$('#setup').dataset.touched) $('#setup').open = !ok;
  const cid = $('#client-id');
  if (document.activeElement !== cid && st.spotify && st.spotify.clientId) cid.value = st.spotify.clientId;
}

export function openSetup() {
  $('#setup').open = true;
  $('#setup').dataset.touched = '1';
}

export function wireSetup({ store, onError, onDisconnect }) {
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
