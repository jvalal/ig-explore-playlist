// Panel flows in jsdom: roll-in, background matching, Choose picker, playlist build/add,
// a failed add that must not orphan the playlist, Play wiring, and Clear.
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { makeSim } from '../sim/spotify-sim.mjs';
import { boot, track, rows, rowBy } from './harness.mjs';
import { suite, tick, waitUntil } from '../check.mjs';

const { check, done } = suite();
const sim = makeSim();
sim.addTrack('a', 'Song A', 'Artist A');
sim.addTrack('b', 'Song B', 'Artist B');
sim.addTrack('x', 'Some Other Song', 'Somebody');
sim.addTrack('d', 'Song D', 'Artist D');
sim.searchOverride = (q) => (q.includes('Mystery') ? [sim.tracks.x] : undefined);

const { storage, $, external } = await boot(sim, { tracks: { k1: track('k1', 'Song A', 'Artist A', 1000) } });
const data = storage.data;
await tick(100);
await external({ tracks: { ...data.tracks, k2: track('k2', 'Song B', 'Artist B', 2000), k3: track('k3', 'Mystery Tune', 'Unknown', 3000) } });
await tick(100);
const titles = rows().map((li) => li.querySelector('.title').textContent + (li.classList.contains('enter') ? '*' : ''));
check('new songs roll in at the top, existing row not re-animated', JSON.stringify(titles) === '["Mystery Tune*","Song B*","Song A"]', JSON.stringify(titles));
const manifestVersion = JSON.parse(fs.readFileSync(EXT_DIR + 'manifest.json', 'utf8')).version;
check('version label shows the manifest version', $('#version').textContent === `Version ${manifestVersion}`, $('#version').textContent);

await waitUntil(() => data.matches.k1 && data.matches.k2 && data.matches.k3, 15000);
check('background matching found the two real songs', data.matches.k1.status === 'matched' && data.matches.k2.status === 'matched');
check('miss recorded as not found', data.matches.k3.status === 'none');
const searches = sim.calls.filter((c) => c.startsWith('GET /search')).length;
await tick(800);
check('background matching does not repeat searches', sim.calls.filter((c) => c.startsWith('GET /search')).length === searches);

await waitUntil(() => rowBy('Mystery Tune').querySelector('.play').textContent === 'Choose');
check('miss gets the Choose button', rowBy('Mystery Tune').querySelector('.play').textContent === 'Choose');
rowBy('Mystery Tune').querySelector('.play').click();
await waitUntil(() => document.querySelector('#list > li.picker button'));
check('picker opens under the row', rows().indexOf(rowBy('Mystery Tune')) === 0 && document.querySelector('#list > li:nth-child(2)').classList.contains('picker'));
document.querySelector('#list > li.picker button').click();
await tick(150);
check('picking a candidate matches it', data.matches.k3.status === 'matched' && data.matches.k3.manual === true);
check('picker closes after picking', !document.querySelector('#list > li.picker'));

$('#build-btn').click();
await waitUntil(() => data.playlist && data.playlist.keys.length === 3);
const pl1 = Object.keys(sim.playlists);
check('playlist created with all three songs', pl1.length === 1 && sim.playlists[pl1[0]].uris.length === 3, JSON.stringify(sim.playlists));
await tick(50);
check('button switches to Add mode', $('#build-btn').textContent === 'No new songs yet', $('#build-btn').textContent);

// A failed add must not leave a playlist that the panel forgot about.
await (async () => {
  $('#pl-new').click();
  await waitUntil(() => data.playlist === null);
  await external({ tracks: { ...data.tracks, k4: track('k4', 'Song D', 'Artist D', 4000) } });
  await waitUntil(() => data.matches.k4, 10000);
  sim.failAddItems = 1;
  await waitUntil(() => !$('#build-btn').disabled);
  $('#build-btn').click();
  await waitUntil(() => $('#msg').classList.contains('error'), 8000);
  check('failed add shows an error', /problem adding/.test($('#msg').textContent), $('#msg').textContent);
  check('the new playlist is remembered even though adding failed', !!(data.playlist && data.playlist.id) && data.playlist.keys.length === 0, JSON.stringify(data.playlist));
  await tick(50);
  $('#build-btn').click();
  await waitUntil(() => data.playlist && data.playlist.keys.length > 0, 8000);
  check('next build adds to that playlist instead of creating another', Object.keys(sim.playlists).length === 2 && sim.playlists[data.playlist.id].uris.length === 4,
    `${Object.keys(sim.playlists).length} playlists`);
})();

// Play wiring (the player itself is a stub until the embed protocol is documented).
rowBy('Song A').querySelector('.play').click();
await waitUntil(() => !$('#dock').hidden);
check('Play shows the docked player', !$('#dock').hidden);
check('Play loads the matched track in the embed', $('#dock-frame').src.includes('/embed/track/a'), $('#dock-frame').src);
check('dock shows the position in the list', $('#dock-pos').textContent === '4 of 4', $('#dock-pos').textContent);
await tick(50);
check('row does not claim Playing until the player says so', rowBy('Song A').querySelector('.play').textContent !== 'Playing');
$('#dock-close').click();
await tick(50);
check('Close player hides it and unloads the embed', $('#dock').hidden && $('#dock-frame').src === 'about:blank');

// Clear, two clicks.
rowBy('Song B').querySelector('.play').click();
await waitUntil(() => !$('#dock').hidden);
$('#clear').click();
await tick(50);
check('first click on Clear only arms it', $('#clear').textContent === 'Confirm clear' && Object.keys(data.tracks).length === 4);
$('#clear').click();
await waitUntil(() => !data.tracks);
await tick(100);
check('Clear removes captures and resets the list and player', rows().length === 0 && $('#dock').hidden && !data.matches);
check('Clear keeps the Spotify connection and playlist', !!data.spotify.refresh_token && !!data.playlist);
await external({ tracks: { k9: track('k9', 'Song A', 'Artist A', 9000) } });
await tick(100);
check('songs captured after Clear roll in', rows().length === 1 && rows()[0].classList.contains('enter'));

done();
