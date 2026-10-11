// The first-run walkthrough: shown over the panel the first time, four steps that play through
// by themselves (the last is connecting Spotify, with the real setup steps in it), closed for
// good by Skip or the last step's button, and back from Settings.
import { makeSim } from '../sim/spotify-sim.mjs';
import { boot, track } from './harness.mjs';
import { suite, tick, waitUntil } from '../check.mjs';

const { check, done } = suite();
const sim = makeSim({ rotateRefresh: true });
const { storage, $, external } = await boot(sim, { welcomed: undefined, spotify: {}, tracks: { k1: track('k1', 'Song A', 'Artist A', 1000) } });
const data = storage.data;
const all = () => [...document.querySelectorAll('#welcome .w-step')];
const shown = () => all().findIndex((s) => !s.hidden);
const bars = () => [...$('#w-bars').children].map((b) => b.className || '-').join(' ');
const CID = 'c0ffee00c0ffee00c0ffee00c0ffee00';

await waitUntil(() => !$('#welcome').hidden, 3000).catch(() => {});
check('first time: the walkthrough is over the panel, on step 1, and the songs behind it are out of reach', !$('#welcome').hidden && shown() === 0 && $('#main').inert === true && bars() === 'run - - -', `${shown()} ${bars()}`);
check('in every step the words come before the drawing', all().every((s) => { const art = s.querySelector('.w-art'); const h = s.querySelector('h2'); return h && art && (h.compareDocumentPosition(art) & 4) && (s.querySelector('p').compareDocumentPosition(art) & 4); }));
check('Back and Next come right after the steps, in one block with them', $('.w-nav').parentNode === $('.w-body') && all().every((s) => s.parentNode === $('.w-body')) && $('.w-nav').previousElementSibling === all()[3]);
check('step 1 offers Next and Skip, no Back', !$('#w-next').hidden && $('#w-back').hidden && $('#w-go').hidden && $('#w-skip').textContent === 'Skip');
$('#w-next').click();
check('Next goes to step 2, with Back', shown() === 1 && !$('#w-back').hidden && bars() === 'done run - -', bars());
$('#w-back').click();
check('Back returns, and stops it playing by itself', shown() === 0 && bars() === 'done - - -', bars());
check('until the last step the Spotify steps stay in Settings', $('#setup-steps').parentNode === $('#setup'));

// The last step is connecting Spotify, with the real steps in it.
$('#w-bars').children[3].click();
check('a bar jumps to its step; the last one is Connect Spotify', shown() === 3 && /Connect Spotify/.test(all()[3].querySelector('h2').textContent) && bars() === 'done done done done', bars());
check('not connected: the real setup steps are in the walkthrough, not a drawing of them', $('#setup-steps').parentNode === $('#w-setup-slot') && !$('#w-setup-slot').hidden && !$('#setup-steps').hidden && $('#w-art-connect').hidden && $('#w-connected').hidden && !!$('#w-setup-slot').querySelector('#open-create'));
check('not connected: the steps are the only thing to do there, Open Instagram Explore is not offered yet', $('#w-go').hidden && $('#w-next').hidden && !$('#w-back').hidden && $('#w-skip').textContent === 'Close');
check('nothing is remembered until it is closed', data.welcomed === undefined);

// Setting up from inside the walkthrough: the app arrives from Spotify's page, then the login.
await external({ spotify: { clientId: CID, access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null } });
await tick(80);
check('the steps there follow along: app done, Connect open', $('#step-app').classList.contains('done') && !$('#step-connect-body').hidden && $('#setup-steps').parentNode === $('#w-setup-slot'));
chrome.identity.launchWebAuthFlow = async ({ url }) => `https://abc.chromiumapp.org/?code=c1&state=${new URL(url).searchParams.get('state')}`;
$('#connect').click();
await waitUntil(() => !$('#w-connected').hidden, 5000).catch(() => {});
check('connected from inside the walkthrough: it says so in place of the steps', !$('#w-connected').hidden && $('#w-setup-slot').hidden && !$('#w-art-connect').hidden && !!data.spotify.refresh_token);
check('...right under the title, above the drawing', $('#w-connected').previousElementSibling.tagName === 'H2' && !!($('#w-connected').compareDocumentPosition($('#w-art-connect')) & 4));
check('...and now Open Instagram Explore is offered', !$('#w-go').hidden && /instagram\.com\/explore/.test($('#w-go').href), $('#w-go').href);
$('#w-go').click();
await tick(30);
check('Open Instagram Explore closes it for good', $('#welcome').hidden && data.welcomed === true && $('#main').inert === false);
check('...and the Spotify steps are back in Settings', $('#setup-steps').parentNode === $('#setup') && $('#setup-steps').nextElementSibling === $('#setup-mobile'));

// From Settings: the whole walkthrough, or just how connecting works.
check('Settings has "How it works" as its own section under Spotify, built like the Spotify one', $('#howto').classList.contains('setup') && $('#howto').previousElementSibling.tagName === 'H2' && $('#howto').previousElementSibling.previousElementSibling === $('#setup') && !!$('#howto .setup-title') && !!$('#setup > .setup-title') && !$('.version #show-welcome'));
check('both Settings cards are always open: nothing to fold', $('#setup').tagName !== 'DETAILS' && $('#howto').tagName !== 'DETAILS');
$('#show-welcome').click();
check('Watch the walkthrough shows it again from step 1', !$('#welcome').hidden && shown() === 0);
$('#welcome').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
check('the arrow keys step through it', shown() === 1);
$('#w-skip').click();
check('Skip closes it', $('#welcome').hidden);
check('the connected block in Settings has a button that explains connecting', !!$('#setup-done #show-connect-help') && /How connecting works/.test($('#show-connect-help').textContent));
$('#show-connect-help').click();
check('...which opens the walkthrough on the Connect step, as an explanation (a drawing, since Spotify is connected)', !$('#welcome').hidden && shown() === 3 && !$('#w-art-connect').hidden && $('#w-setup-slot').hidden && bars() === 'done done done done', `${shown()} ${bars()}`);
$('#w-skip').click();

// It plays through by itself, a step every few seconds, and stops on the last one.
{
  const real = globalThis.setTimeout;
  const waits = [];
  globalThis.setTimeout = (f, ms, ...a) => { if (ms >= 5000 && ms <= 9000) { waits.push(f); return 0; } return real(f, ms, ...a); };
  $('#show-welcome').click();
  const at = [shown()];
  while (waits.length) { waits.shift()(); at.push(shown()); }
  globalThis.setTimeout = real;
  check('left alone it plays 1, 2, 3, 4 and stays on 4', at.join() === '0,1,2,3' && bars() === 'done done done done', `${at.join()} ${bars()}`);
  $('#w-skip').click();
}
done();
