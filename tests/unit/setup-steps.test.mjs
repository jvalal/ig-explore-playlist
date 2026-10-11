// The Spotify setup in Settings: two steps, one open at a time, that follow what the person does
// on Spotify's dashboard (the helper there writes `setupSeen` and the Client ID), and login
// errors in plain words where the person is looking.
import { makeSim } from '../sim/spotify-sim.mjs';
import { boot } from './harness.mjs';
import { suite, tick, waitUntil } from '../check.mjs';

const { check, done } = suite();
const sim = makeSim({ rotateRefresh: true }); // a login hands out a refresh token
const { storage, $, external } = await boot(sim, { spotify: {} });
const data = storage.data;
const CID = 'c0ffee00c0ffee00c0ffee00c0ffee00';
await tick(100);

check('not set up: step 1 is the open one, step 2 waits', $('#step-app').classList.contains('now') && !$('#step-app-body').hidden && $('#step-connect-body').hidden && !$('#step-connect').classList.contains('now') && $('#step-app-done').hidden);
check('it says why, how long, and that Premium is needed', /only five people/.test($('#setup-steps').textContent) && /three minutes/.test($('#setup-steps').textContent) && /Premium/.test($('#setup-steps').textContent));
check('step 1 opens Spotify\'s Create app page in a tab', $('#open-create').href === 'https://developer.spotify.com/dashboard/create' && $('#open-create').target === '_blank');
check('nothing live to report yet', $('#step-live').hidden);

// The helper on Spotify's page reports in.
await external({ setupSeen: { page: 'create', filled: true, terms: false, at: Date.now() } });
await tick(60);
check('form filled on Spotify\'s page: the panel says what to do there', !$('#step-live').hidden && /tick the terms box and click Save/.test($('#step-live').textContent), $('#step-live').textContent);
await external({ setupSeen: { page: 'create', filled: true, terms: true, at: Date.now() } });
await tick(60);
check('that line is above the button that opens Spotify\'s page', !!($('#step-live').compareDocumentPosition($('#open-create')) & 4) && $('#step-live').parentNode === $('#step-app-body'));
check('terms ticked: now Save', /Now click Save/.test($('#step-live').textContent), $('#step-live').textContent);
await external({ setupSeen: { page: 'create', filled: false, at: Date.now() } });
await tick(60);
check('form could not be filled: points to By hand', /By hand/.test($('#step-live').textContent), $('#step-live').textContent);
await external({ setupSeen: { page: 'create', filled: true, terms: false, at: Date.now() - 3600e3 } });
await tick(60);
check('an old report is not shown', $('#step-live').hidden);

// The helper saves the new app's Client ID.
await external({ spotify: { clientId: CID, access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null } });
await tick(80);
check('app saved from Spotify\'s page: step 1 ticks itself and step 2 opens', $('#step-app').classList.contains('done') && $('#step-app-body').hidden && !$('#step-app-done').hidden && $('#app-id').textContent === 'c0ffee…' &&
  $('#step-connect').classList.contains('now') && !$('#step-connect-body').hidden, $('#step-app').className);
check('...and a line says so, in Settings too', /Now connect your account/.test($('#setup-msg').textContent) && $('#setup-msg').textContent === $('#msg').textContent, $('#setup-msg').textContent);

// Login problems, in plain words, on the Settings screen.
chrome.identity.launchWebAuthFlow = async () => { throw new Error('The user did not approve access.'); };
$('#connect').click();
await waitUntil(() => $('#setup-msg').classList.contains('error'), 3000).catch(() => {});
check('login window closed: says so and how to go on', /window was closed/.test($('#setup-msg').textContent) && /Press Connect Spotify/.test($('#setup-msg').textContent), $('#setup-msg').textContent);
chrome.identity.launchWebAuthFlow = async () => { throw new Error('Authorization page could not be loaded.'); };
$('#connect').click();
await waitUntil(() => /Redirect URI/.test($('#setup-msg').textContent), 3000).catch(() => {});
check('Spotify turns the app down (deleted, or no Redirect URI): says so and what to do', /doesn't recognise this app/.test($('#setup-msg').textContent) && /deleted/.test($('#setup-msg').textContent) && /Redirect URI/.test($('#setup-msg').textContent), $('#setup-msg').textContent);
check('...and step 1 is open again, with the way to a new app and the by-hand fields', !$('#step-app-body').hidden && $('#step-app').classList.contains('now') && $('#step-connect-body').hidden && $('#by-hand').open && !!$('#step-app-body #open-create'), $('#step-app').className);
await external({ spotify: { clientId: 'e'.repeat(32), access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null } });
await tick(80);
check('a new app from Spotify\'s page closes it again', $('#step-app').classList.contains('done') && !$('#step-connect-body').hidden);
await external({ spotify: { clientId: CID, access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null } });
await tick(80);
chrome.identity.launchWebAuthFlow = async ({ url }) => `https://abc.chromiumapp.org/?error=server_error&state=${new URL(url).searchParams.get('state')}`;
$('#connect').click();
await waitUntil(() => /Premium/.test($('#setup-msg').textContent), 3000).catch(() => {});
check('account not allowed (server_error): Premium for an owner, User Management for a friend\'s key', /needs Spotify Premium/.test($('#setup-msg').textContent) && /User Management/.test($('#setup-msg').textContent), $('#setup-msg').textContent);

// Change: back to step 1, with the by-hand fields open.
$('#change-app').click();
check('Change reopens step 1 with the by-hand fields', !$('#step-app-body').hidden && $('#by-hand').open && $('#client-id').value === CID && $('#step-connect-body').hidden);
$('#client-id').value = 'not a client id';
$('#save-client').click();
await tick(40);
check('a wrong Client ID is refused in words', /doesn't look like a Client ID/.test($('#setup-msg').textContent) && data.spotify.clientId === CID);
$('#client-id').value = 'd'.repeat(32);
$('#save-client').click();
await waitUntil(() => data.spotify.clientId === 'd'.repeat(32), 3000).catch(() => {});
await tick(60);
check('a pasted Client ID (one\'s own, or a friend\'s) moves on to step 2', $('#step-app').classList.contains('done') && !$('#step-connect-body').hidden && $('#app-id').textContent === 'dddddd…');

// And the login that works.
chrome.identity.launchWebAuthFlow = async ({ url }) => `https://abc.chromiumapp.org/?code=c1&state=${new URL(url).searchParams.get('state')}`;
$('#connect').click();
await waitUntil(() => !$('#setup-done').hidden, 5000).catch(() => {});
check('connected: the steps give way to "Connected as …"', !$('#setup-done').hidden && $('#setup-steps').hidden && /Spotify connected/.test($('#setup-msg').textContent), $('#setup-msg').textContent);

// Start over: the app and the login are forgotten, after a second press.
$('#disconnect').click();
await waitUntil(() => !$('#step-app-done').hidden && !$('#setup-steps').hidden, 3000).catch(() => {});
check('Disconnect keeps the app; Start over is offered next to Change', data.spotify.clientId === 'd'.repeat(32) && !!$('#step-app-done #start-over') && $('#start-over').textContent === 'Start over');
$('#start-over').click();
await tick(40);
check('one press only asks', data.spotify.clientId === 'd'.repeat(32) && /Press again/.test($('#start-over').textContent));
$('#start-over').click();
await waitUntil(() => !data.spotify.clientId, 3000).catch(() => {});
await tick(80);
check('the second forgets the app and the login: step 1 as on a first run', !data.spotify.clientId && !data.spotify.refresh_token && data.setupSeen === undefined && $('#step-app').classList.contains('now') && !$('#step-app-body').hidden && $('#step-app-done').hidden && $('#step-connect-body').hidden && $('#client-id').value === '' && !$('#by-hand').open && /Starting over/.test($('#setup-msg').textContent), `${JSON.stringify(data.spotify)} ${$('#step-app').className} ${$('#setup-msg').textContent}`);
done();
