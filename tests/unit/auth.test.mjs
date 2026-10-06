// Spotify API client: token refresh, 401 and 429 handling, playlists.
import { EXT_DIR } from '../ext-dir.mjs';
import { makeSim, makeChromeStorage } from '../sim/spotify-sim.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();

const sim = makeSim({ rotateRefresh: true });
const storage = makeChromeStorage({
  spotify: { clientId: 'a'.repeat(32), access_token: 'expired', refresh_token: 'r0', expires_at: Date.now() - 1000, user: 'jkidd' },
});
globalThis.chrome = { storage: { local: storage.local, onChanged: storage.onChanged } };
globalThis.fetch = sim.fetch;
const S = await import(EXT_DIR + 'spotify.js');

// Three callers at once with an expired token: exactly one refresh, everyone gets through.
const results = await Promise.all([S.api('/me'), S.api('/me'), S.api('/me')]);
check('three concurrent calls with an expired token: one refresh', sim.tokenRequests === 1, `token requests: ${sim.tokenRequests}`);
check('all three calls succeed', results.every((r) => r && r.id === 'jkidd'));
check('the rotated refresh token is stored', storage.data.spotify.refresh_token === sim.refreshToken, storage.data.spotify.refresh_token);

// The server stops accepting the current token: refresh once, retry, succeed.
sim.validTokens.clear();
const me = await S.api('/me');
check('401: refreshes and retries once', me && me.id === 'jkidd' && sim.tokenRequests === 2, `token requests: ${sim.tokenRequests}`);

// Concurrent 401s also share one refresh.
sim.validTokens.clear();
await Promise.all([S.api('/me'), S.api('/me')]);
check('concurrent 401s share one refresh', sim.tokenRequests === 3, `token requests: ${sim.tokenRequests}`);

// 429 with Retry-After: waits and retries.
sim.rateLimitNext = 2;
const before = sim.calls.length;
const r429 = await S.api('/me');
check('429: retries after Retry-After and succeeds', r429 && r429.id === 'jkidd' && sim.calls.slice(before).filter((c) => c.endsWith('429')).length === 2);

// Too many 429s: gives up with an error rather than looping forever.
sim.rateLimitNext = 10;
let err429 = null;
try { await S.api('/me'); } catch (e) { err429 = e; }
check('429: gives up after 4 retries', !!err429 && sim.rateLimitNext === 5, err429 && err429.message);
sim.rateLimitNext = 0;

// A revoked refresh token is reported as AUTH (the panel asks to reconnect).
sim.validTokens.clear();
sim.refreshToken = 'something-else';
let authErr = null;
try { await S.api('/me'); } catch (e) { authErr = e; }
check('revoked refresh token: AUTH error', authErr && authErr.code === 'AUTH', authErr && authErr.message);

// Not connected at all.
storage.data.spotify = { clientId: 'a'.repeat(32) };
let noConn = null;
try { await S.api('/me'); } catch (e) { noConn = e; }
check('not connected: AUTH error, no network call', noConn && noConn.code === 'AUTH');

// Playlists: create, then add in batches of 100.
storage.data.spotify = { clientId: 'a'.repeat(32), access_token: 'tok', refresh_token: sim.refreshToken, expires_at: Date.now() + 3.6e6 };
sim.validTokens.add('tok');
const pl = await S.createPlaylist('Test', 'd');
await S.addItems(pl.id, Array.from({ length: 205 }, (_, i) => `spotify:track:${i}`));
const adds = sim.calls.filter((c) => c.startsWith('POST /playlists/'));
check('addItems sends 205 songs in 3 batches', sim.playlists[pl.id].uris.length === 205 && adds.length === 3, adds.join(' | '));

check('no Spotify Connect helpers remain', !('getDevices' in S) && !('playUris' in S) && !('transferPlayback' in S));
done();
