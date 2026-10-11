// What the panel knows about a song on Spotify (store.js), including after `matches` was lost.
import { EXT_DIR } from '../ext-dir.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();
globalThis.chrome = {};
const { matchOf, matchFor } = await import(EXT_DIR + 'store.js');
const { MatchQueue } = await import(EXT_DIR + 'match-queue.js');

const t1 = { key: 'song|nicole kidman|adéla', title: 'Nicole Kidman', artist: 'ADÉLA' };
const t2 = { key: 'k2', title: 'Other', artist: 'Someone' };
const t3 = { key: 'k3', title: 'Not added', artist: 'Nobody' };
const tracks = { [t1.key]: t1, k2: t2, k3: t3 };
const playlist = { id: 'PL1', name: 'Mine', keys: [t1.key, 'k2'], uris: ['spotify:track:AAA', 'spotify:track:BBB'] };

// The user's storage on 2026-10-10: a Clear before v0.11.5 had removed `matches`, the playlist
// still listed the songs, and Spotify was refusing searches for 16 hours.
const st = { tracks, matches: {}, playlist };
const m = matchOf(st, t1);
check('a song in the playlist is known on Spotify without a stored match', !!m && m.status === 'matched' && m.id === 'AAA' && m.uri === 'spotify:track:AAA', JSON.stringify(m));
check('...with the right link for each song', matchOf(st, t2).id === 'BBB' && matchOf(st, t2).url === 'https://open.spotify.com/track/BBB');
check('...and the song\'s own title, so the row shows no "Spotify match" note', m.name === 'Nicole Kidman');
check('a song that is not in the playlist is still unknown', matchOf(st, t3) === undefined);
check('a stored match wins over the playlist', matchOf({ ...st, matches: { [t1.key]: { status: 'matched', id: 'ZZZ' } } }, t1).id === 'ZZZ');
check('a stored "not found" is kept as it is', matchOf({ ...st, matches: { k2: { status: 'none' } } }, t2).status === 'none');
check('keys and links that don\'t line up are not trusted', matchOf({ ...st, playlist: { ...playlist, uris: ['spotify:track:AAA'] } }, t2) === undefined);
check('no playlist: unknown', matchOf({ ...st, playlist: null }, t1) === undefined);

// Play asks the queue; it must answer from the playlist and not search.
let searched = 0;
const queue = new MatchQueue({ getMatch: (key) => matchFor(st, key), setMatch: async () => {}, match: async () => { searched++; throw new Error('rate limited'); } });
const got = await queue.request(t1, { urgent: true }).catch((e) => e);
check('Play on such a song does not search Spotify', searched === 0 && got && got.id === 'AAA', `${searched} ${JSON.stringify(got)}`);

done();
