// Song goal (count, bar, one chime on crossing) and auto-add to the playlist, in jsdom.
import { makeSim } from '../sim/spotify-sim.mjs';
import { boot, track, rowBy } from './harness.mjs';
import { suite, tick, waitUntil } from '../check.mjs';

const { check, done } = suite();
const sim = makeSim();
sim.addTrack('a', 'Song A', 'Artist A');
sim.addTrack('b', 'Song B', 'Artist B');
sim.addTrack('c', 'Song C', 'Artist C');
sim.addTrack('d', 'Song D', 'Artist D');
sim.addTrack('e', 'Song E', 'Artist E');
sim.addTrack('f', 'Song F', 'Artist F');
sim.searchOverride = (q) => (q.includes('Mystery') ? [] : undefined);
sim.playlists.PL1 = { name: 'Mine', uris: [] };

const { storage, $, external } = await boot(sim, {
  tracks: { k1: track('k1', 'Song A', 'Artist A', 1000) },
  playlist: { id: 'PL1', url: 'u', name: 'Mine', keys: [], uris: [] },
});
const data = storage.data;
let chimes = 0;
window.AudioContext = class {
  constructor() { chimes++; this.currentTime = 0; this.destination = {}; }
  createOscillator() { return { frequency: {}, connect: (g) => g, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d) => d }; }
  close() { return Promise.resolve(); }
};
const pick = (sel, value) => { $(sel).value = value; $(sel).dispatchEvent(new window.Event('change')); };
const toggle = (sel, on) => { $(sel).checked = on; $(sel).dispatchEvent(new window.Event('change')); };
await tick(100);

// ---- goal
check('no goal: plain count, no bar', $('#n-song').textContent === '1 song' && $('#goal-bar').hidden);
pick('#goal', '10');
await tick(60);
check('goal picked from the menu is saved', data.prefs && data.prefs.goal === 10, JSON.stringify(data.prefs));
check('progress shows "1 of 10 songs" with a 10% bar', $('#n-song').textContent === '1 of 10 songs' &&
  !$('#goal-bar').hidden && $('#goal-fill').style.width === '10%', `${$('#n-song').textContent} ${$('#goal-fill').style.width}`);
await external({ prefs: { ...data.prefs, goal: 2 } }); // a small goal so two songs reach it
await tick(60);
check('progress shows "1 of 2 songs" with a half bar', $('#n-song').textContent === '1 of 2 songs' &&
  $('#goal-fill').style.width === '50%', `${$('#n-song').textContent} ${$('#goal-fill').style.width}`);
check('no chime before the goal', chimes === 0);
await external({ tracks: { ...data.tracks, k2: track('k2', 'Song B', 'Artist B', 2000) } });
await tick(60);
check('reaching the goal: "2 of 2 songs · goal reached", full bar', $('#n-song').textContent === '2 of 2 songs · goal reached' &&
  $('#goal-bar').classList.contains('done') && $('#goal-fill').style.width === '100%', $('#n-song').textContent);
check('one chime when the goal is reached', chimes === 1, String(chimes));
await external({ excluded: {} });
await tick(60);
check('no second chime on later renders', chimes === 1, String(chimes));

// ---- auto-add: off by default
await waitUntil(() => data.matches.k1 && data.matches.k2, 15000);
await tick(1800);
check('auto-add is off by default: nothing added', sim.playlists.PL1.uris.length === 0 && !$('#auto-sync').checked);

// ---- turned on: matched songs go into the playlist
toggle('#auto-sync', true);
await waitUntil(() => sim.playlists.PL1.uris.length === 2, 8000);
check('turning it on adds the matched songs', JSON.stringify([...sim.playlists.PL1.uris].sort()) === '["spotify:track:a","spotify:track:b"]', JSON.stringify(sim.playlists.PL1.uris));
check('...and records them as in the playlist', data.playlist.keys.includes('k1') && data.playlist.keys.includes('k2'));
check('...and says so', /Added 2 new songs to "Mine"/.test($('#msg').textContent), $('#msg').textContent);
check('the setting is saved', data.prefs.autoSync === true);

// ---- new captures: matched ones are added, unchecked ones and misses are not
await external({
  excluded: { k3: true },
  tracks: { ...data.tracks,
    k3: track('k3', 'Song C', 'Artist C', 3000),
    k4: track('k4', 'Song D', 'Artist D', 4000),
    k5: track('k5', 'Mystery Tune', 'Nobody', 5000) },
});
await waitUntil(() => sim.playlists.PL1.uris.includes('spotify:track:d'), 15000);
await tick(1800);
check('a newly captured, matched song is added by itself', sim.playlists.PL1.uris.includes('spotify:track:d'));
check('an unchecked song is not added', !sim.playlists.PL1.uris.includes('spotify:track:c'));
check('nothing is added twice', new Set(sim.playlists.PL1.uris).size === sim.playlists.PL1.uris.length, JSON.stringify(sim.playlists.PL1.uris));
check('a song Spotify could not find is skipped', data.matches.k5 && data.matches.k5.status === 'none' && sim.playlists.PL1.uris.length === 3);

// ---- Build while auto-add is on: still no duplicates
rowBy('Song C').querySelector('input[type=checkbox]').click(); // include it again
await waitUntil(() => sim.playlists.PL1.uris.includes('spotify:track:c'), 8000);
$('#build-btn').click();
await tick(1500);
check('re-checking a song adds it; Build alongside adds nothing twice',
  sim.playlists.PL1.uris.length === 4 && new Set(sim.playlists.PL1.uris).size === 4, JSON.stringify(sim.playlists.PL1.uris));

// ---- turned off: nothing more is added
toggle('#auto-sync', false);
await tick(60);
await external({ tracks: { ...data.tracks, k6: track('k6', 'Song A', 'Artist A', 6000) } });
await tick(2500);
check('turned off: new songs wait for Build', sim.playlists.PL1.uris.length === 4 && data.prefs.autoSync === false);

// ---- errors pause auto-add instead of retrying in a loop
toggle('#auto-sync', true);
sim.failAddItems = 5;
await external({ tracks: { ...data.tracks, k7: track('k7', 'Song E', 'Artist E', 7000) } });
await tick(4000);
// Captures keep arriving while scrolling; each one must not trigger another failing add.
for (let i = 0; i < 3; i++) {
  await external({ tracks: { ...data.tracks, [`k8${i}`]: track(`k8${i}`, 'Song E', 'Artist E', 8000 + i) } });
  await tick(2200);
}
const addCalls = sim.calls.filter((c) => /POST \/playlists\/PL1\/items -> 5/.test(c)).length;
check('a failed add is reported and not retried right away', addCalls <= 1 && $('#msg').classList.contains('error'), `${addCalls} failed calls; ${$('#msg').textContent}`);

// ---- the playlist was deleted on Spotify (the user saw a bare "Resource not found", v0.10.3)
toggle('#auto-sync', false);
await tick(60);
sim.failAddItems = 0;
delete sim.playlists.PL1;
await external({ tracks: { ...data.tracks, k9: track('k9', 'Song B', 'Artist B', 9000) } });
await waitUntil(() => /^Add \d+ new song/.test($('#build-btn').textContent) && !$('#build-btn').disabled);
$('#build-btn').click();
await waitUntil(() => !data.playlist, 4000).catch(() => {});
check('a playlist that is gone from Spotify is forgotten, and the message says what happened',
  !data.playlist && /"Mine" isn't on Spotify any more/.test($('#msg').textContent), `${JSON.stringify(data.playlist && data.playlist.id)}; ${$('#msg').textContent}`);
check('...and there is an x to go back to it, in case it is there after all', !$('#pl-undo').hidden);
check('...the box goes back to making a new playlist, with nothing lost from the list',
  !$('#build-new').hidden && $('#build-existing').hidden && /^Create it on Spotify with \d+ songs$/.test($('#build-btn').textContent) && !$('#build-btn').disabled, $('#build-btn').textContent);

// ---- a new playlist always starts with auto-add off
toggle('#auto-sync', true); // (left on from somewhere: the box is hidden now, the setting is not)
await tick(60);
$('#build-btn').click();
await waitUntil(() => data.playlist && data.playlist.uris.length > 0, 6000).catch(() => {});
check('creating a playlist commits it to Spotify with the songs', !!data.playlist && sim.playlists[data.playlist.id].uris.length === data.playlist.uris.length && data.playlist.uris.length > 0, JSON.stringify(data.playlist));
check('...and auto-add is off for it until it is ticked', data.prefs.autoSync === false && !$('#auto-sync').checked && !$('#build-existing').hidden);
toggle('#auto-sync', true);
await waitUntil(() => $('#build-btn').textContent === 'Songs added', 4000).catch(() => {});
check('ticked: the button greys out and only reports', $('#build-btn').textContent === 'Songs added' && $('#build-btn').disabled, $('#build-btn').textContent);
toggle('#auto-sync', false);
await tick(60);
check('unticked: it is a button again', !/Songs added|Adding/.test($('#build-btn').textContent), $('#build-btn').textContent);

// ---- which songs are already in the playlist, and which are new
const marks = () => ({ inPl: document.querySelectorAll('#list .in-pl-mark').length, fresh: document.querySelectorAll('#list .new').length,
  boxes: document.querySelectorAll('#list input[type=checkbox]').length, rows: document.querySelectorAll('#list > li.row').length });
const m0 = marks();
check('songs in the playlist show a mark in place of the checkbox, and none is "New"', m0.inPl === data.playlist.keys.length && m0.inPl > 0 && m0.fresh === 0 && m0.boxes === m0.rows - m0.inPl, JSON.stringify(m0));
await external({ tracks: { ...data.tracks, kn: track('kn', 'Song F', 'Artist F', 99000) } });
await waitUntil(() => $('#build-btn').textContent === 'Add 1 new song', 5000).catch(() => {});
const m1 = marks();
check('a song captured afterwards is marked New, with a checkbox, and is the one the button counts',
  $('#build-btn').textContent === 'Add 1 new song' && m1.fresh === 1 && !!rowBy('Song F') && m1.inPl === m0.inPl, `${$('#build-btn').textContent} ${JSON.stringify(m1)}`);
toggle('#auto-sync', true);
await tick(60);
$('#pl-new').click();
await waitUntil(() => !data.playlist, 3000).catch(() => {});
check('Start a new playlist turns auto-add off too', !data.playlist && data.prefs.autoSync === false);

// ---- the x: back out of "new playlist" without doing anything
const wasId = Object.keys(sim.playlists).pop();
await waitUntil(() => !$('#pl-undo').hidden, 2000).catch(() => {});
check('the new-playlist box has an x to go back', !$('#pl-undo').hidden && !$('#build-new').hidden);
$('#pl-undo').click();
await waitUntil(() => !!data.playlist && $('#pl-undo').hidden, 3000).catch(() => {});
check('the x brings the previous playlist back, nothing created, nothing added', !!data.playlist && data.playlist.id === wasId && Object.keys(sim.playlists).length === 1 && $('#pl-undo').hidden && !$('#build-existing').hidden,
  JSON.stringify(data.playlist && data.playlist.id));
toggle('#auto-sync', true); // for the check below
await tick(60);

// ---- Clear keeps the goal; auto-add goes off with the playlist it was for
$('#clear').click();
$('#clear').click();
await waitUntil(() => !data.tracks);
await waitUntil(() => !data.playlist);
check('Clear keeps the goal, and turns auto-add off for the new playlist', data.prefs.goal === 2 && data.prefs.autoSync === false && !data.playlist, JSON.stringify(data.prefs));

done();
