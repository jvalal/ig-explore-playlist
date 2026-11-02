// Spotify answers a token refresh with `invalid_client: Failed to get client` when the saved
// Client ID belongs to an app that no longer exists (deleted or reset on Spotify).
// The panel must explain that in plain words, not show Spotify's raw text.
import { EXT_DIR } from '../ext-dir.mjs';
import { makeChromeStorage } from '../sim/spotify-sim.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();

const storage = makeChromeStorage({
  spotify: { clientId: 'a'.repeat(32), access_token: 'expired', refresh_token: 'r0', expires_at: Date.now() - 1000, user: 'jkidd' },
});
globalThis.chrome = { storage: { local: storage.local, onChanged: storage.onChanged } };
globalThis.fetch = async (url) => {
  if (String(url).includes('accounts.spotify.com/api/token')) {
    return new Response(JSON.stringify({ error: 'invalid_client', error_description: 'Failed to get client' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('{}', { status: 500 });
};
const S = await import(EXT_DIR + 'spotify.js');

let err = null;
try { await S.api('/me'); } catch (e) { err = e; }

check('invalid_client fails the call', !!err);
check('invalid_client is reported as a setup problem (INPUT)', err && err.code === 'INPUT', err && err.code);
check('the message does not repeat Spotify\'s raw text', err && !/Failed to get client/i.test(err.message), err && err.message);
check('the message names the Client ID', err && /Client ID/.test(err.message), err && err.message);
check('setup is sent back to the start', err && err.refused === true);

done();
