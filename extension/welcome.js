// The first-run walkthrough: four steps laid over the panel the first time it opens (storage
// key `welcomed`), and again from Settings › How it works. Three are short animations (scroll,
// pick, send); the fourth is connecting Spotify, and holds the real setup steps (the block from
// Settings is moved in while it shows) until Spotify is connected. It plays through by itself
// like a short film, one step every few seconds, and stops on the last step.
import { $, EXPLORE_URL } from './dom.js';
import { PLATFORM } from './platform.js';

const STEP_MS = 6500;
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let step = 0;
let timer = null;
let hooks = { connected: () => true };

const steps = () => [...document.querySelectorAll('#welcome .w-step')];

function show(n, { auto = true } = {}) {
  const all = steps();
  step = Math.max(0, Math.min(all.length - 1, n));
  const last = step === all.length - 1;
  all.forEach((el, i) => {
    el.hidden = i !== step;
    el.classList.remove('on');
  });
  void all[step].offsetWidth; // the step's drawing starts from the beginning each time
  all[step].classList.add('on');
  [...$('#w-bars').children].forEach((b, i) => {
    b.className = i < step ? 'done' : i === step ? (auto && !last && !still() ? 'run' : 'done') : '';
  });
  $('#w-back').hidden = step === 0;
  $('#w-next').hidden = last;
  placeSetup(last);
  renderWelcome();
  $('#w-skip').textContent = last ? 'Close' : 'Skip';
  clearTimeout(timer);
  if (auto && !last && !still()) timer = setTimeout(() => show(step + 1), STEP_MS);
}

// The Spotify steps live in Settings; the last step borrows them, so there is one set.
function placeSetup(inWelcome) {
  const steps = $('#setup-steps');
  if (inWelcome) $('#w-setup-slot').append(steps);
  else if (steps.parentNode !== $('#setup')) $('#setup').insertBefore(steps, $('#setup-mobile'));
}
// Connected or not changes what the last step shows; called on every render of the panel.
export function renderWelcome() {
  if ($('#welcome').hidden) return;
  const ok = hooks.connected();
  $('#w-setup-slot').hidden = ok;
  $('#w-art-connect').hidden = !ok;
  $('#w-connected').hidden = !ok;
  // One thing to do at a time: Explore is offered once Spotify is connected.
  $('#w-go').hidden = !(ok && step === steps().length - 1);
}

// at: the step to open on (3 = connecting Spotify, from Settings).
export function showWelcome(at = 0) {
  $('#welcome').hidden = false;
  $('#main').inert = true;
  show(at, { auto: at === 0 });
  $('#welcome').focus({ preventScroll: true }); // arrow keys and Esc work at once
}

function close() {
  clearTimeout(timer);
  placeSetup(false);
  $('#welcome').hidden = true;
  $('#main').inert = document.body.classList.contains('settings-open');
  chrome.storage.local.set({ welcomed: true }).catch(() => {});
}

// hooks: { connected() -> bool }
export async function initWelcome(h) {
  hooks = h;
  $('#w-bars').style.setProperty('--step', `${STEP_MS}ms`);
  $('#w-next').addEventListener('click', () => show(step + 1));
  $('#w-back').addEventListener('click', () => show(step - 1, { auto: false }));
  $('#w-skip').addEventListener('click', close);
  [...$('#w-bars').children].forEach((b, i) => b.addEventListener('click', () => show(i, { auto: false })));
  $('#w-go').href = EXPLORE_URL;
  $('#w-go').addEventListener('click', close); // the link opens Explore in a tab
  $('#welcome').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(step + 1, { auto: false });
    else if (e.key === 'ArrowLeft') show(step - 1, { auto: false });
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  $('#show-welcome').addEventListener('click', () => showWelcome(0));
  $('#show-connect-help').addEventListener('click', () => showWelcome(3));
  // iPhone has its own setup page (onboarding.html).
  if (PLATFORM === 'safari') { $('#howto').hidden = true; $('#howto').previousElementSibling.hidden = true; $('#show-connect-help').hidden = true; return; }
  const { welcomed } = await chrome.storage.local.get('welcomed').catch(() => ({ welcomed: true }));
  if (!welcomed) showWelcome();
}
