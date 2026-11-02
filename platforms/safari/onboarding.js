// iPhone setup page: Welcome → Spotify app → Connect → Allow Instagram → Done.
// Opens on install (background.js) or from the popup's "Set up Explore Playlist Gen".
// Progress is kept in storage key `onboarding` ({ step, at }), so leaving for Spotify's login or
// Safari's settings and coming back picks up where you were. A visit older than RESUME_MS starts over.
import * as S from './spotify.js';
import { runConnect, redirectUri, askForSites, DASHBOARD_SITES } from './platform.js';

const $ = (s) => document.querySelector(s);
const STEPS = ['welcome', 'spotify', 'connect', 'instagram', 'done'];
const CLIENT_ID = /^[a-z0-9]{32}$/i;
const RESUME_MS = 30 * 60_000;
let step = 0;
let spotify = {};

const isConnected = () => !!(spotify && spotify.refresh_token);

function show(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  document.querySelectorAll('section[data-step]').forEach((s) => { s.hidden = s.dataset.step !== STEPS[step]; });
  $('#ob-progress').textContent = `Step ${step + 1} of ${STEPS.length}`;
  chrome.storage.local.set({ onboarding: { step: STEPS[step], at: Date.now() } });
  renderSpotify();
  renderConnect();
  window.scrollTo(0, 0);
}

function note(sel, text, error = false) {
  $(sel).textContent = text || '';
  $(sel).classList.toggle('error', !!error);
}

function renderSpotify() {
  const has = !!(spotify && spotify.clientId && CLIENT_ID.test(spotify.clientId));
  if (has && document.activeElement !== $('#ob-client') && !$('#ob-client').value) $('#ob-client').value = spotify.clientId;
  $('#ob-spotify-next').disabled = !has;
}

function renderConnect() {
  const ok = isConnected();
  $('#ob-connect').hidden = ok;
  $('#ob-connect-next').hidden = !ok;
  if (ok) note('#ob-connect-msg', `Connected as ${spotify.user || 'your Spotify account'}.`);
}

document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => show(step + 1)));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => show(step - 1)));

$('#ob-redirect').textContent = redirectUri();
$('#ob-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(redirectUri());
    $('#ob-copy').textContent = 'Copied';
  } catch (_) {
    $('#ob-copy').textContent = 'Press and hold to copy';
  }
  setTimeout(() => { $('#ob-copy').textContent = 'Copy'; }, 1800);
});

$('#ob-save').addEventListener('click', async () => {
  const v = $('#ob-client').value.trim();
  if (!CLIENT_ID.test(v)) {
    note('#ob-client-msg', "That doesn't look like a Client ID. It's 32 letters and numbers.", true);
    return;
  }
  if (!(spotify && spotify.clientId === v)) await S.saveClientId(v);
  note('#ob-client-msg', 'Saved. Make sure the Redirect URI below is added to that app, then tap Next.');
});

$('#ob-connect').addEventListener('click', async () => {
  note('#ob-connect-msg', 'Opening Spotify login…');
  try {
    await runConnect(S.connect);
  } catch (err) {
    note('#ob-connect-msg', (err && err.message) || 'Something went wrong. Try again.', true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.spotify) return;
  spotify = changes.spotify.newValue || {};
  renderSpotify();
  renderConnect();
});

// Safari runs the form helper on developer.spotify.com only once the site is allowed, and doesn't ask.
$('#ob-create').addEventListener('click', async (e) => {
  e.preventDefault();
  const url = e.currentTarget.href;
  const ok = await askForSites(DASHBOARD_SITES);
  note('#ob-client-msg', ok ? '' : "Without Safari's OK for developer.spotify.com, the form can't be filled in for you. Fill it in by hand (steps below), or press the button again and choose Allow.");
  if (!ok) $('.ob-how').open = true;
  await chrome.tabs.create({ url });
});

$('#ob-explore').addEventListener('click', () => chrome.storage.local.set({ onboarding: { step: 'done', finished: true } }));

const saved = await chrome.storage.local.get(['spotify', 'onboarding']);
spotify = saved.spotify || {};
const last = saved.onboarding || {};
const at = last.at && Date.now() - last.at < RESUME_MS ? STEPS.indexOf(last.step) : -1;
// Already connected (e.g. set up before): no need to repeat the Spotify steps.
show(isConnected() ? Math.max(at, STEPS.indexOf('instagram')) : Math.max(at, 0));
