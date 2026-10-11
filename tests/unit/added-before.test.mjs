// A song that was put in an earlier playlist says so on its row ("Added Oct 10"). The record
// is storage key `added`, kept by Clear. Such a song starts unticked; the person can tick it back
// (the earlier playlist may not exist any more).
import { makeSim } from '../sim/spotify-sim.mjs';
import { boot, track, rowBy } from './harness.mjs';
import { suite, tick, waitUntil } from '../check.mjs';

const { check, done } = suite();
const sim = makeSim();
for (const x of ['a', 'b', 'c', 'd']) sim.addTrack(x, `Song ${x.toUpperCase()}`, `Artist ${x.toUpperCase()}`);
sim.playlists.OLD = { name: 'Explore finds, Oct 10', uris: ['spotify:track:a'] };

// Yesterday's playlist holds Song A (from before the record existed).
const { storage, $, external } = await boot(sim, {
  tracks: { k1: track('k1', 'Song A', 'Artist A', 1000), k2: track('k2', 'Song B', 'Artist B', 2000), k3: track('k3', 'Song C', 'Artist C', 3000) },
  matches: {},
  playlist: { id: 'OLD', url: 'u', name: 'Explore finds, Oct 10', keys: ['k1'], uris: ['spotify:track:a'] },
});
const data = storage.data;
const box = (title) => rowBy(title).querySelector('input[type=checkbox]');
const note = (title) => { const n = rowBy(title).querySelector('.note.before'); return n ? n.textContent : null; };

await waitUntil(() => data.added && data.matches.k2 && data.matches.k3);
check('the record starts with the playlist known today', !!data.added.keys.k1 && !!data.added.uris['spotify:track:a'] && data.added.keys.k1.at === null && data.added.keys.k1.pl === 'Explore finds, Oct 10', JSON.stringify(data.added));
check('a song in the current playlist is just "in the playlist"', !!rowBy('Song A').querySelector('.in-pl-mark') && note('Song A') === null);
check('a song never added has no mark', note('Song B') === null && box('Song B').checked);

$('#build-btn').click();
await waitUntil(() => data.playlist.keys.length === 3, 8000).catch(() => {});
check('adding songs writes them in the record, with the date and the playlist', data.playlist.keys.length === 3 && !!data.added.keys.k2 && data.added.keys.k2.at > Date.now() - 60000 && data.added.keys.k2.pl === 'Explore finds, Oct 10' && !!data.added.uris['spotify:track:c'], JSON.stringify(data.added.keys.k2));

// Clear, then the same songs come round again, one of them under another Instagram audio.
$('#clear').click();
$('#clear').click();
await waitUntil(() => !data.tracks && !data.playlist);
check('Clear keeps the record', Object.keys(data.added.keys).length === 3);
await external({ tracks: {
  k1: track('k1', 'Song A', 'Artist A', 5000),
  k2: track('k2', 'Song B', 'Artist B', 5001),
  k9: track('k9', 'Song C', 'Artist C', 5002), // Song C again, as a different audio
  k4: track('k4', 'Song D', 'Artist D', 5003),
} });
await waitUntil(() => data.matches.k9 && data.matches.k4 && note('Song C'), 8000).catch(() => {});
const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
check('a song added before says when, and its tooltip names the playlist', note('Song B') === `Added ${today}` && /Added to "Explore finds, Oct 10"/.test(rowBy('Song B').querySelector('.note.before').title), `${note('Song B')}`);
check('...also when it comes back as a different Instagram audio (same song on Spotify)', note('Song C') === `Added ${today}`, `${note('Song C')}`);
check('one seeded from an old playlist, with no date, reads "Added before"', note('Song A') === 'Added before', `${note('Song A')}`);
check('a new find has no mark', note('Song D') === null);
// They start unticked (the person can tick them back: the earlier playlist may be gone).
const state = () => `${$('#build-btn').textContent} / ${$('#check-all-text').textContent} / ${JSON.stringify(data.excluded)}`;
check('songs added before start unticked; the new find is ticked, and the button counts only it', ['Song A', 'Song B', 'Song C'].every((t) => !box(t).checked && rowBy(t).classList.contains('skipped')) && box('Song D').checked && /with 1 song$/.test($('#build-btn').textContent) && $('#check-all-text').textContent === '1 of 4 selected' && !data.excluded, state());

// Ticking one back is one click, and it stays ticked.
box('Song A').click();
await waitUntil(() => /with 2 songs$/.test($('#build-btn').textContent), 3000).catch(() => {});
check('ticking one back puts it in, and that choice is kept', /with 2 songs$/.test($('#build-btn').textContent) && data.excluded.k1 === false && box('Song A').checked && note('Song A') === 'Added before', state());
$('#check-all').click();
await waitUntil(() => /with 4 songs$/.test($('#build-btn').textContent), 3000).catch(() => {});
check('Select all ticks them too', /with 4 songs$/.test($('#build-btn').textContent) && $('#check-all-text').textContent === 'All selected' && ['Song A', 'Song B', 'Song C', 'Song D'].every((t) => box(t).checked), state());
box('Song B').click();
box('Song C').click();
await waitUntil(() => /with 2 songs$/.test($('#build-btn').textContent), 3000).catch(() => {});
check('unticking leaves a song out again', /with 2 songs$/.test($('#build-btn').textContent) && note('Song B') === `Added ${today}`, state());
$('#build-btn').click();
await waitUntil(() => data.playlist && data.playlist.keys.length === 2, 8000).catch(() => {});
await tick(100); // the rows are redrawn on the next frame
check('the new playlist holds what was ticked', !!data.playlist && [...sim.playlists[data.playlist.id].uris].sort().join() === 'spotify:track:a,spotify:track:d', JSON.stringify(data.playlist && sim.playlists[data.playlist.id]));
check('...the first date a song was added is the one kept', data.added.keys.k1.at === null && data.added.keys.k4.at > Date.now() - 60000);
check('...and the songs left out still read "Added", with no "New"', note('Song B') === `Added ${today}` && !rowBy('Song B').querySelector('.new') && !!rowBy('Song D').querySelector('.in-pl-mark'));

done();
