// Real-browser check of Back up / Restore, with the real chrome.downloads and file picker.
// Not part of `npm test`. Run:  node ../tools/build-webstore.mjs && node real/backup.real.mjs
// Loads two copies side by side in Chrome for Testing: the unpacked extension (pinned ID, with
// songs) and the store build from dist/webstore (no key, so its own ID and empty storage: a
// freshly loaded copy). Backs up from the first, restores into the second, counts the rows.
import puppeteer from 'puppeteer';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OLD_DIR = path.join(root, 'extension');
const NEW_DIR = path.join(root, 'dist', 'webstore');
if (!fs.existsSync(path.join(NEW_DIR, 'manifest.json'))) { console.log('FAIL  run node tools/build-webstore.mjs first'); process.exit(1); }
const CFT = process.env.CFT_PATH || path.join(os.homedir(), '.cache/cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const OLD_ID = 'adnfnkniiefhlojabhejngpkefohmnhg';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-backup-'));
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-downloads-'));
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));

const browser = await puppeteer.launch({
  executablePath: CFT, headless: false, userDataDir: profile,
  args: [`--disable-extensions-except=${OLD_DIR},${NEW_DIR}`, `--load-extension=${OLD_DIR},${NEW_DIR}`, '--no-first-run'],
});
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (_) {} await tick(200); } return false; };
const files = () => fs.readdirSync(downloads).filter((f) => f.endsWith('.json'));
const rowCount = (page) => page.evaluate(() => document.querySelectorAll('#list > li.row').length);

try {
  let newId = null;
  await waitFor(() => {
    const ids = browser.targets().map((t) => t.url()).filter((u) => u.startsWith('chrome-extension://')).map((u) => new URL(u).host);
    newId = ids.find((id) => id !== OLD_ID) || null;
    return ids.includes(OLD_ID) && newId;
  });
  check('both copies are loaded, the store build under its own ID', !!newId && newId !== OLD_ID, newId);

  // The old copy, with 25 songs, a playlist and a Spotify login.
  const old = await browser.newPage();
  await old.goto(`chrome-extension://${OLD_ID}/sidepanel.html`);
  await old.evaluate(async () => {
    const tracks = {};
    for (let i = 0; i < 25; i++) tracks[`k${i}`] = { key: `k${i}`, kind: 'song', title: `Song ${i}`, artist: `Artist ${i}`, first_seen: 1000 + i, last_seen: 1000 + i, posts: [{ code: `c${i}`, type: 'clips' }], areas: { explore: 1 } };
    await chrome.storage.local.set({
      tracks, welcomed: true, excluded: { k4: true },
      playlist: { id: 'PL', url: 'u', name: 'Old playlist', keys: ['k0'], uris: ['spotify:track:x'] },
      spotify: { clientId: 'a'.repeat(32), access_token: 'SECRET_ACCESS', refresh_token: 'SECRET_REFRESH', expires_at: 0, user: 'me' },
    });
  });
  await old.reload();
  await waitFor(async () => (await rowCount(old)) === 25);
  check('opening the panel with songs and no backup yet saves the weekly one, no dialog', await waitFor(() => files().length === 1), files().join());

  await old.evaluate(() => document.querySelector('#backup-save').click());
  await waitFor(() => files().length === 2 && !files().some((f) => f.endsWith('.crdownload')));
  check('Back up saves a second file to Downloads', files().length === 2, files().join());
  check('...saying so in the panel', /Saved a backup of 25 captures/.test(await old.$eval('#backup-msg', (e) => e.textContent)));
  const file = path.join(downloads, files().sort().pop());
  const text = fs.readFileSync(file, 'utf8');
  check('the file has no Spotify tokens', !text.includes('SECRET_ACCESS') && !text.includes('SECRET_REFRESH'));

  // The fresh copy: empty, then Restore through the real file picker.
  const fresh = await browser.newPage();
  await fresh.goto(`chrome-extension://${newId}/sidepanel.html`);
  await fresh.evaluate(() => chrome.storage.local.set({ welcomed: true }));
  await tick(500);
  check('the fresh copy starts with no songs', (await rowCount(fresh)) === 0);
  const input = await fresh.$('#backup-file');
  await input.uploadFile(file);
  await waitFor(async () => (await rowCount(fresh)) === 25);
  check('Restore brings the full list back', (await rowCount(fresh)) === 25, `${await rowCount(fresh)} rows`);
  const got = await fresh.evaluate(() => chrome.storage.local.get(['excluded', 'playlist', 'spotify']));
  check('choices, playlist and Client ID come back; the login does not', got.excluded.k4 === true && got.playlist.id === 'PL' && got.spotify.clientId === 'a'.repeat(32) && !got.spotify.access_token, JSON.stringify(got.spotify));
  check('the panel says what came back', (await fresh.$eval('#backup-msg', (e) => e.textContent)) === 'Restored. 25 songs added back, 25 in the list.', await fresh.$eval('#backup-msg', (e) => e.textContent));
} finally {
  await browser.close();
}
done();
