// Back up and Restore (backup.js): a backup restored into a fresh copy of the extension (empty
// storage, as the store copy or a reinstall has) brings the whole list back; on a conflict the
// newer entry wins; the Spotify login never goes into the file; the weekly backup runs once.
import { makeSim } from '../sim/spotify-sim.mjs';
import { boot, track, rows, connectedSpotify } from './harness.mjs';
import { suite, waitUntil } from '../check.mjs';
import { EXT_DIR } from '../ext-dir.mjs';

const { check, done } = suite();
const { makeBackup, readBackup, mergeBackup, WEEK, LAST_KEY } = await import(`${EXT_DIR}backup.js`);

// ---- the old copy's storage
const tracks = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, track(`k${i}`, `Song ${i}`, `Artist ${i}`, 1000 + i)]));
const old = {
  tracks,
  matches: { k0: { status: 'matched', uri: 'spotify:track:a', id: 'a', name: 'Song 0', artists: 'Artist 0', at: 5 } },
  excluded: { k3: true },
  playlist: { id: 'PL', url: 'u', name: 'Explore finds, Oct 10', keys: ['k0'], uris: ['spotify:track:a'] },
  added: { keys: { k0: { at: 5, pl: 'Explore finds, Oct 10' } }, uris: { 'spotify:track:a': { at: 5, pl: 'Explore finds, Oct 10' } } },
  seen: ['p1', 'p2'],
  prefs: { goal: 30 },
  spotify: connectedSpotify(),
  nowPlaying: { host: 'mini', key: 'k0', status: 'playing' },
};
const file = JSON.stringify(makeBackup(old, '0.11.30'));
check('the file has no Spotify tokens, only the Client ID', !/t0|r0|access_token|refresh_token/.test(file) && file.includes('a'.repeat(32)));
check('what is playing right now is left out', !file.includes('nowPlaying'));

// ---- reading a file from disk
const throws = (text) => { try { readBackup(text); return null; } catch (e) { return e.message; } };
check('a file that is not JSON is refused', /isn't a backup/.test(throws('hello')));
check('JSON that is not our backup is refused', /isn't an Explore Playlist Gen backup/.test(throws('{"tracks":{}}')));
const bad = JSON.parse(file);
bad.data.tracks.broken = { key: 'broken', title: 7 };
bad.data.spotify = { clientId: 'not-an-id', access_token: 'x' };
const read = readBackup(JSON.stringify(bad));
check('a broken song in the file is dropped, the rest kept', !read.tracks.broken && Object.keys(read.tracks).length === 12);
check('a bad Client ID and any token in the file are ignored', read.spotify === undefined);

// ---- merging into what is there
const here = {
  tracks: { k1: { ...tracks.k1, last_seen: 9999, posts: [{ code: 'new' }] }, k2: { ...tracks.k2, last_seen: 1 }, x: track('x', 'Here only', 'A', 50) },
  matches: { k0: { status: 'none', at: 1 } },
  playlist: { id: 'NEW', url: 'u', name: 'Now', keys: [], uris: [] },
  seen: ['p2', 'p3'],
  spotify: { clientId: 'b'.repeat(32), access_token: 'mine' },
};
const m = mergeBackup(here, readBackup(file));
check('songs only in the backup come back, songs only here stay', Object.keys(m.tracks).length === 13 && !!m.tracks.x);
check('on a conflict the newer song wins', m.tracks.k1.last_seen === 9999 && m.tracks.k2.last_seen === tracks.k2.last_seen);
check('on a conflict the newer match wins', m.matches.k0.status === 'matched');
check('the playlist here stays', m.playlist === undefined);
check('lists are merged without duplicates', JSON.stringify(m.seen) === '["p2","p3","p1"]');
check('a Client ID here (maybe connected) is not replaced', m.spotify === undefined);
// Plant the bug: with the older entry winning, the first conflict check would fail.
check('merge is not just "backup wins"', m.tracks.k1.posts[0].code === 'new');

// ---- a fresh copy: empty storage, the real panel, Restore through the file picker
const sim = makeSim();
const { storage, $ } = await boot(sim, { spotify: {}, tracks: {}, matches: {} });
check('the fresh copy starts empty', rows().length === 0);
const input = $('#backup-file');
Object.defineProperty(input, 'files', { configurable: true, value: [new File([file], 'backup.json', { type: 'application/json' })] });
input.dispatchEvent(new window.Event('change'));
await waitUntil(() => rows().length === 12);
check('Restore brings the full list back', rows().length === 12, `${rows().length} rows; msg: ${$('#backup-msg').textContent}`);
check('the choices, playlist and record come back too', storage.data.excluded.k3 === true && storage.data.playlist.id === 'PL' && !!storage.data.added.keys.k0 && storage.data.prefs.goal === 30);
check('the Client ID comes back, the login does not', storage.data.spotify.clientId === 'a'.repeat(32) && !storage.data.spotify.access_token);
await waitUntil(() => /Restored/.test($('#backup-msg').textContent));
check('the panel says what came back', $('#backup-msg').textContent === 'Restored. 12 songs added back, 12 in the list.', $('#backup-msg').textContent);

Object.defineProperty(input, 'files', { configurable: true, value: [new File(['nope'], 'x.json')] });
input.dispatchEvent(new window.Event('change'));
await waitUntil(() => /isn't a backup/.test($('#backup-msg').textContent));
check('a wrong file says so and changes nothing', /isn't a backup/.test($('#backup-msg').textContent) && Object.keys(storage.data.tracks).length === 12);

// ---- the weekly backup: on open when a week has passed, then not again
const saved = [];
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};
const downloads = { download: async (o) => { saved.push(o); return saved.length; } };
await boot(makeSim(), { tracks, [LAST_KEY]: Date.now() - WEEK - 1000 }, { downloads });
await waitUntil(() => saved.length > 0);
check('a week after the last backup, opening the panel saves one to Downloads without asking',
  saved.length === 1 && saved[0].saveAs === false && /^explore-playlist-gen-backup-\d{4}-\d\d-\d\d\.json$/.test(saved[0].filename), JSON.stringify(saved));
const fresh = await boot(makeSim(), { tracks, [LAST_KEY]: Date.now() - 1000 }, { downloads });
await fresh.external({ tracks: { ...tracks, z: track('z', 'New one', 'A', 9e9) } });
await waitUntil(() => rows().length === 13);
check('within the week, nothing more is saved', saved.length === 1, `${saved.length} saved`);

done();
