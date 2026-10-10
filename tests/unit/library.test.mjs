// Saving a song to the Spotify library (Liked Songs): the "+" in the floating player.
// Endpoints from Spotify's February 2026 revision: PUT / DELETE /me/library?uris=…,
// GET /me/library/contains?uris=… .
import { EXT_DIR } from '../ext-dir.mjs';
import { makeSim, makeChromeStorage } from '../sim/spotify-sim.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();
const OLD = 'playlist-modify-private playlist-modify-public';
const URI = 'spotify:track:11dFghVXANMlKmJXsNCbNl';

// Someone connected before the "+" existed: their token has the playlist permissions only.
const sim = makeSim({ rotateRefresh: true });
const storage = makeChromeStorage({
  spotify: { clientId: 'a'.repeat(32), access_token: 't0', refresh_token: 'r0', expires_at: Date.now() + 3.6e6, user: 'jkidd', scope: OLD },
});
let logins = 0;
globalThis.chrome = {
  storage: { local: storage.local, onChanged: storage.onChanged },
  identity: {
    getRedirectURL: () => 'https://abc.chromiumapp.org/',
    launchWebAuthFlow: async ({ url }) => {
      logins++;
      const q = new URL(url).searchParams;
      sim.grantOnLogin = q.get('scope');
      return `https://abc.chromiumapp.org/?code=c1&state=${q.get('state')}`;
    },
  },
};
globalThis.fetch = sim.fetch;
const S = await import(EXT_DIR + 'spotify.js');
const auth = () => storage.data.spotify;

check('an older connection can\'t save yet', S.canSave(auth()) === false);
check('...and playlists still work without the new permission', !!(await S.createPlaylist('P', 'd')).id);

// The one reconnect.
await S.connect();
check('connecting asks Spotify for the library permission', /user-library-modify/.test(sim.grantOnLogin) && /user-library-read/.test(sim.grantOnLogin), sim.grantOnLogin);
check('...and still for the playlist permissions', /playlist-modify-private/.test(sim.grantOnLogin) && /playlist-modify-public/.test(sim.grantOnLogin));
check('after it, saving is allowed', S.canSave(auth()) === true, auth().scope);

check('a song is not saved to start with', (await S.inLibrary(URI)) === false);
await S.saveToLibrary(URI);
check('save puts the song in the library', sim.library.has(URI) && sim.calls.some((c) => c === 'PUT /me/library -> 200'), sim.calls.slice(-2).join(' | '));
check('...and it then reads as saved', (await S.inLibrary(URI)) === true);
await S.removeFromLibrary(URI);
check('remove takes it out again', !sim.library.has(URI) && (await S.inLibrary(URI)) === false);

// Once only: the permission survives the token expiring and being refreshed.
await storage.local.set({ spotify: { ...auth(), expires_at: Date.now() - 1000 } });
const before = sim.tokenRequests;
await S.saveToLibrary(URI);
check('after a token refresh it still saves, with no second login', sim.tokenRequests === before + 1 && sim.library.has(URI) && S.canSave(auth()) && logins === 1,
  `logins: ${logins}, scope: ${auth().scope}`);

// A token that lacks the permission after all (Spotify answers 403): say what to do.
sim.scope = OLD;
let scopeErr = null;
try { await S.saveToLibrary(URI); } catch (e) { scopeErr = e; }
check('a refused save says to connect again, not to check User Management', !!scopeErr && scopeErr.code === 'SCOPE' && /Connect Spotify again/.test(scopeErr.message), scopeErr && scopeErr.message);

// Disconnecting forgets it (a new Connect asks for everything again, once).
await S.disconnect();
check('after Disconnect, saving waits for the next Connect', S.canSave(auth()) === false);
done();
