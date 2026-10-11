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
// Every request to the API is counted for the day (to learn where Spotify's limit is).
const apiCalls = () => sim.calls.filter((c) => !c.startsWith('token')).length;
{
  const c = await S.countsToday();
  check('requests are counted per day, none lost when they overlap', c.requests === apiCalls() && c.requests >= 3 && c.searches === 0, JSON.stringify(c));
}
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

// A long Retry-After (Spotify throttling the app): stop at once, say how long, and don't ask
// again until then. Waiting 30 s four times per call left every pressed song on "Finding on
// Spotify…" for minutes, and kept knocking, which keeps the limit in place.
sim.rateLimitNext = 10;
sim.retryAfter = '1800';
const t429 = Date.now();
let limited = null;
try { await S.api('/me'); } catch (e) { limited = e; }
check('long Retry-After: one call, no waiting, and the error says how long', !!limited && limited.code === 'RATE' && sim.rateLimitNext === 9 && Date.now() - t429 < 1000 && /30 minutes/.test(limited.message), `${limited && limited.code} ${limited && limited.message} left ${sim.rateLimitNext} in ${Date.now() - t429} ms`);
const callsBefore = sim.calls.length;
let again = null;
try { await S.api('/me'); } catch (e) { again = e; }
check('...and further calls fail the same way without reaching Spotify', !!again && again.code === 'RATE' && sim.calls.length === callsBefore && sim.rateLimitNext === 9);
check('...the panel can ask how long is left', S.rateLimitedFor() > 1700 && S.rateLimitedFor() <= 1800, String(S.rateLimitedFor()));
{
  const c = await S.countsToday();
  check('...and the count when the limit began is kept, with the refused call not counted', !!c.limit && c.limit.retryAfter === 1800 && c.limit.requests === apiCalls() && c.requests === apiCalls(), JSON.stringify(c) + ' calls ' + apiCalls());
}
check('...and the limit is written down, so reopening the panel does not knock on Spotify again', storage.data.spotifyLimit > Date.now() + 1700e3, String(storage.data.spotifyLimit));
{
  // A freshly opened page (a new copy of the module) learns it from storage, with no call.
  const S2 = await import(EXT_DIR + 'spotify.js?fresh');
  const n = sim.calls.length;
  let e2 = null;
  try { await S2.api('/me'); } catch (e) { e2 = e; }
  check('a reopened panel knows about the limit without asking Spotify', !!e2 && e2.code === 'RATE' && sim.calls.length === n && /30 minutes/.test(e2.message), e2 && e2.message);
  await S2.clearRateLimit();
}
await S.clearRateLimit(); // (tests only: in real use it ends when the time is up)
check('clearing it also clears the note in storage', !storage.data.spotifyLimit);
sim.rateLimitNext = 0;
sim.retryAfter = '0';
check('once the limit is over, calls go through again', (await S.api('/me')).id === 'jkidd');

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
