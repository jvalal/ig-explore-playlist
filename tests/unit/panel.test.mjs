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
// k0 was saved before v0.6.4 from the home feed: kept in storage, never listed.
await external({ tracks: { ...data.tracks, k0: { ...track('k0', "You've Got a Friend in Me", 'Randy Newman', 2500), areas: { home: 1 } },
  k2: track('k2', 'Song B', 'Artist B', 2000), k3: track('k3', 'Mystery Tune', 'Unknown', 3000) } });
await tick(100);
const titles = rows().map((li) => li.querySelector('.title').textContent + (li.classList.contains('enter') ? '*' : ''));
check('song rows link to their post, kept in the browser on iPhone (#weblink)',
  rows().every((li) => /^https:\/\/www\.instagram\.com\/(reel|p)\/[^/]+\/#weblink$/.test(li.querySelector('a.main').href)),
  rows().map((li) => li.querySelector('a.main').href).join(' '));
check('a song captured only outside Explore is not listed', !rowBy("You've Got a Friend in Me") && $('#n-song').textContent === '3 songs', $('#n-song').textContent);
check('new songs roll in at the top, existing row not re-animated', JSON.stringify(titles) === '["Mystery Tune*","Song B*","Song A"]', JSON.stringify(titles));
// Status counts only what the list can show (real case: "3 had music", 1 song listed).
await external({ log: [
  { at: Date.now(), page: '/explore/', area: 'home', name: 'PolarisFeedTimelineRootV2Query', relevant: true, hits: 2, songs: 1 },
  { at: Date.now(), page: '/explore/', area: 'explore', relevant: true, hits: 1, songs: 0 },
  { at: Date.now(), page: '/p/X/', via: '/explore/', area: 'explore', relevant: true, hits: 1, songs: 1 },
  { at: Date.now(), page: '/explore/', area: 'explore', relevant: false, hits: 0 },
] });
await tick(50);
check('status: posts behind the listed songs count as checked; songs match the list',
  $('#status').textContent.startsWith(`${rows().length} Explore posts checked, ${rows().length} songs found.`) && $('#n-song').textContent === `${rows().length} songs`,
  `${$('#status').textContent} / ${$('#n-song').textContent}`);
// Real case: "12 Explore responses checked, 22 songs found". Posts without music count too.
await external({ seen: ['k1', 'k2', 'x1', 'x2', 'x3', 'x4', 'x5'] });
await tick(50);
const shown = $('#status').textContent.match(/^(\d+) Explore posts checked, (\d+) songs found/);
check('posts checked counts posts without music too, and is never below songs found',
  shown && Number(shown[1]) === rows().length + 5 && Number(shown[1]) >= Number(shown[2]), $('#status').textContent);
const manifestVersion = JSON.parse(fs.readFileSync(EXT_DIR + 'manifest.json', 'utf8')).version;
check('version label shows the manifest version', $('#version').textContent === `Version ${manifestVersion}`, $('#version').textContent);

await waitUntil(() => data.matches.k1 && data.matches.k2 && data.matches.k3, 15000);
check('background matching found the two real songs', data.matches.k1.status === 'matched' && data.matches.k2.status === 'matched');
check('miss recorded as not found', data.matches.k3.status === 'none');
const searches = sim.calls.filter((c) => c.startsWith('GET /search')).length;
await tick(800);
check('background matching does not repeat searches', sim.calls.filter((c) => c.startsWith('GET /search')).length === searches);
// Today's Spotify use, beside the settings icon (temporary: to learn where Spotify's limit is).
{
  const api = sim.calls.filter((c) => !c.startsWith('token')).length;
  const c = Object.values(data.spotifyCounts || {})[0] || {};
  check('the header counter shows how many songs were looked up and how many requests that took today',
    c.songs === 3 && c.searches === searches && c.requests === api && !$('#api-count').hidden &&
    [...$('#flip-songs').children].map((f) => f.dataset.d).join('') === '003' &&
    [...$('#flip-requests').children].map((f) => f.dataset.d).join('') === String(api).padStart(4, '0') &&
    $('#api-count').getAttribute('aria-label') === `3 songs looked up today, ${api} Spotify requests`,
    `${JSON.stringify(c)} / ${$('#api-count').getAttribute('aria-label')} / ${$('#api-count').textContent} / api ${api}`);
}

await waitUntil(() => rowBy('Mystery Tune').querySelector('.play').textContent === 'Choose');
check('miss gets the Choose button', rowBy('Mystery Tune').querySelector('.play').textContent === 'Choose');
rowBy('Mystery Tune').querySelector('.play').click();
await waitUntil(() => document.querySelector('#list > li.picker button'));
{
  const links = [...document.querySelectorAll('#list > li.picker .row-actions a')];
  check('the picker ends with two ways to look yourself: Spotify, then YouTube (title and artist in the search)', links.length === 2 && /Search Spotify/.test(links[0].textContent) && links[1].textContent === 'Search YouTube' && /^https:\/\/www\.youtube\.com\/results\?search_query=.+/.test(links[1].href) && links[1].target === '_blank', links.map((l) => `${l.textContent} ${l.href}`).join(' | '));
}
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
  check('next build adds to that playlist instead of creating another', Object.keys(sim.playlists).length === 2 && sim.playlists[data.playlist.id].uris.join() === 'spotify:track:d', // the three from the earlier playlist start unticked
    `${Object.keys(sim.playlists).length} playlists, ${sim.playlists[data.playlist.id].uris}`);
})();

// Play wiring (the player itself is a stub until the embed protocol is documented).
rowBy('Song A').querySelector('.play').click();
await waitUntil(() => !$('#dock').hidden);
check('Play shows the docked player', !$('#dock').hidden);
check('Play loads the matched track in the embed', $('#dock-frame').src.includes('/embed/track/a'), $('#dock-frame').src);
check('dock shows the position in the list', $('#dock-pos').textContent === '4 of 4', $('#dock-pos').textContent);
await tick(50);
check('row does not claim Playing until the player says so', rowBy('Song A').querySelector('.play').textContent !== 'Pause');
check('the player has no Close button; Pop out carries an icon', !$('#dock-close') && !!$('#dock-popout svg') && $('#dock-popout').textContent.trim() === 'Pop out');

// Clear, two clicks.
rowBy('Song B').querySelector('.play').click();
await waitUntil(() => !$('#dock').hidden);
$('#clear').click();
await tick(50);
// ---- select all / none
{
  const boxes = () => [...document.querySelectorAll('#list input[type=checkbox]')];
  const n = boxes().length;
  if (n) {
    $('#check-all').checked = false; $('#check-all').dispatchEvent(new window.Event('change'));
    await waitUntil(() => boxes().every((b) => !b.checked));
    check('Select all/none, unticked: every song in the list is unticked', boxes().length === n && boxes().every((b) => !b.checked) && $('#check-all-text').textContent === 'None selected', $('#check-all-text').textContent);
    boxes()[0].click();
    await waitUntil(() => $('#check-all').indeterminate);
    check('...one ticked by hand: it shows a dash and the count', $('#check-all').indeterminate && $('#check-all-text').textContent === `1 of ${n} selected`, $('#check-all-text').textContent);
    $('#check-all').checked = true; $('#check-all').dispatchEvent(new window.Event('change'));
    await waitUntil(() => boxes().every((b) => b.checked));
    check('...ticked: every song is ticked again', boxes().every((b) => b.checked) && $('#check-all').checked && !$('#check-all').indeterminate && $('#check-all-text').textContent === 'All selected');
  } else check('Select all/none is hidden when no song has a checkbox', $('#check-all-row').hidden);
}

// ---- "reload that tab" in the empty text
{
  const reloaded = [];
  const link = $('#reload-ig');
  check('the empty text has a real link to reload Instagram', link.tagName === 'A' && link.textContent === 'reload that tab' && !!link.closest('#empty'));
  chrome.tabs = { query: async (q) => (q.url === 'https://www.instagram.com/*' ? [{ id: 7 }, { id: 9 }] : []), reload: async (id) => { reloaded.push(id); } };
  link.click();
  await waitUntil(() => reloaded.length === 2);
  check('pressing it reloads the open Instagram tabs and says so', reloaded.join() === '7,9' && /Reloaded 2 Instagram tabs/.test($('#msg').textContent), `${reloaded} ${$('#msg').textContent}`);
  chrome.tabs.query = async () => [];
  link.click();
  await waitUntil(() => /No Instagram tab/.test($('#msg').textContent));
  check('with no Instagram tab open it says so', /No Instagram tab is open/.test($('#msg').textContent));
}

check('first click on Clear only arms it', $('#clear').textContent === 'Confirm clear' && Object.keys(data.tracks).length === 5);
$('#clear').click();
await waitUntil(() => !data.tracks);
await tick(100);
check('Clear removes captures and resets the list and player', rows().length === 0 && $('#dock').hidden && !data.tracks);
check('...but keeps what was found on Spotify, so the same songs are not searched for again', !!data.matches && data.matches.k1.status === 'matched');
check('Clear keeps the Spotify connection', !!data.spotify.refresh_token);
// A new round of captures gets a new playlist, named with today's date and the time.
check('Clear starts a new playlist: the old one is put aside (the x brings it back), nothing deleted on Spotify',
  !data.playlist && !!data.playlistUndo && !!sim.playlists[data.playlistUndo.id] && !$('#build-new').hidden && !$('#pl-undo').hidden,
  JSON.stringify({ pl: data.playlist, undo: data.playlistUndo && data.playlistUndo.id }));
check('...and its name has the date and the time', /^Explore Playlist Gen, \w+ \d+, \d+:\d\d/.test($('#pl-name').value), $('#pl-name').value);
await external({ tracks: { k9: track('k9', 'Song A', 'Artist A', 9000) } });
await tick(100);
check('songs captured after Clear roll in', rows().length === 1 && rows()[0].classList.contains('enter'));

done();
