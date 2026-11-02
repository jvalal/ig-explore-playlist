// Safari: the Spotify login only finishes if the extension may see accounts.spotify.com and the
// loopback page it lands on. Safari never asks for a page that fails to load (127.0.0.1), so
// Connect asks for both sites first, while the click still counts as the person's gesture.
import path from 'path';
import { fileURLToPath } from 'url';
import { suite } from '../check.mjs';

const { check, done } = suite();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let asked = null;
let granted = false;
const sent = [];
globalThis.chrome = {
  permissions: { request: async (o) => { asked = o; return granted; } },
  runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true }; } },
};
const P = await import(path.join(root, 'platforms', 'safari', 'platform.js'));

let err = null;
try { await P.runConnect(); } catch (e) { err = e; }
check('Connect asks Safari for the login sites', !!asked && asked.origins.includes('http://127.0.0.1/*') && asked.origins.includes('https://accounts.spotify.com/*'), JSON.stringify(asked));
check('turned down: no login starts', sent.length === 0);
check('...and it says why, in plain words', err && err.code === 'INPUT' && /Allow/.test(err.message), err && err.message);

granted = true;
err = null;
try { await P.runConnect(); } catch (e) { err = e; }
check('allowed: the login starts', !err && sent.length === 1 && sent[0].type === 'ef-connect', err && err.message);

done();
