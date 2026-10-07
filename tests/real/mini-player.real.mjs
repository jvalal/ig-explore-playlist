// Real-browser check of the pop-out mini player, with the real Spotify embed (needs network).
// Not part of `npm test`. Run:  node real/mini-player.real.mjs
// Uses Chrome for Testing (CFT_PATH), because branded Chrome no longer loads unpacked extensions
// from the command line. Headful, so Chrome's autoplay rules apply; audio output is muted.
// The panel page is opened as a tab: automation can't open the side panel, and closing the tab
// unloads the page the same way closing the side panel does.
import puppeteer from 'puppeteer';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { EXT_DIR } from '../ext-dir.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const CFT = process.env.CFT_PATH || path.join(os.homedir(), '.cache/cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const ID = 'adnfnkniiefhlojabhejngpkefohmnhg'; // pinned by the manifest key
const BASE = `chrome-extension://${ID}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-real-'));
// Two real tracks (seen in the embed probe logs). Newest first: A is row 1, B is row 2.
const A = { key: 'kA', id: '11dFghVXANMlKmJXsNCbNl', title: 'Cut To The Feeling', artist: 'Carly Rae Jepsen' };
const B = { key: 'kB', id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley' };

const browser = await puppeteer.launch({
  executablePath: CFT, headless: false, userDataDir: profile,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--mute-audio', '--no-first-run'],
});
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (_) {} await tick(200); } return false; };
const pageFor = async (pred, ms = 15000) => {
  let p = null;
  await waitFor(async () => { for (const t of browser.targets()) if (pred(t.url())) { p = await t.page(); if (p) return true; } return false; }, ms);
  return p;
};
// Position reports from the embed, collected inside a page (the mini player or its PiP window).
const listen = (page) => page.evaluate(() => {
  window.__pos = [];
  const add = (w) => w.addEventListener('message', (e) => {
    const p = e.data && e.data.type === 'playback_update' && e.data.payload;
    if (p && p.playingURI) window.__pos.push({ at: Date.now(), uri: p.playingURI, pos: p.position, paused: p.isPaused });
  });
  add(window);
  window.__listenPip = () => { if (window.documentPictureInPicture && documentPictureInPicture.window) add(documentPictureInPicture.window); };
});
const advancing = async (page, uri, ms = 6000) => {
  await page.evaluate(() => { window.__pos = []; });
  await tick(ms);
  const pos = await page.evaluate((u) => window.__pos.filter((p) => p.uri === u && !p.paused).map((p) => p.pos), uri);
  return { ok: pos.length >= 3 && pos[pos.length - 1] > pos[0] + 2000, first: pos[0], last: pos[pos.length - 1], n: pos.length };
};

const startTargets = new Set((await browser.pages()).map((p) => p.target())); // the empty first tab
try {
  // ---- set up the panel with two matched songs
  let panel = await browser.newPage();
  await panel.goto(`${BASE}/sidepanel.html`);
  await panel.evaluate(async (A, B) => {
    const now = Date.now();
    const t = (s, i) => ({ key: s.key, kind: 'song', title: s.title, artist: s.artist, first_seen: now - i * 1000, last_seen: now, posts: [], areas: { explore: 1 } });
    const m = (s) => ({ status: 'matched', id: s.id, uri: `spotify:track:${s.id}`, name: s.title, artists: s.artist, v: 3 });
    await chrome.storage.local.set({
      spotify: { clientId: 'x'.repeat(32), access_token: 't', refresh_token: 'r', expires_at: now + 3.6e6, user: 'Test' },
      tracks: { [A.key]: t(A, 0), [B.key]: t(B, 1) }, matches: { [A.key]: m(A), [B.key]: m(B) },
    });
  }, A, B);
  await panel.reload();
  await panel.waitForSelector('#list > li.row:nth-child(2) .play');

  // ---- play in the panel (docked)
  await panel.click('#list > li.row:nth-child(1) .play');
  const docked = await waitFor(() => panel.$eval('#list > li.row:nth-child(1) .play', (e) => e.textContent === 'Playing'), 15000);
  check('panel: one click on Play starts the song in the docked player', docked,
    await panel.$eval('#list > li.row:nth-child(1) .play', (e) => e.textContent));

  // ---- pop out
  await panel.click('#dock-popout');
  const mini = await pageFor((u) => u.startsWith(`${BASE}/player.html`));
  check('Pop out opens player.html in its own window', !!mini);
  await listen(mini);
  const miniPlaying = await waitFor(() => mini.evaluate(async () => ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).status === 'playing'), 20000);
  const np1 = await mini.evaluate(async () => (await chrome.storage.local.get('nowPlaying')).nowPlaying);
  check('the mini player plays the same song', miniPlaying && np1.key === A.key, JSON.stringify(np1) + ' hint: ' + (await mini.$eval('#mini-hint', (e) => e.textContent)));
  check('...and shows its title', /Cut To The Feeling/.test(await mini.$eval('#mini-now', (e) => e.textContent)));
  check('the docked player closed (only one player)', await panel.$eval('#dock', (e) => e.hidden));
  const winInfo = await mini.evaluate(async () => { const w = await chrome.windows.getCurrent(); return { type: w.type, width: w.width, height: w.height }; });
  check('mini window is a 360x200 popup', winInfo.type === 'popup' && winInfo.width === 360 && winInfo.height === 200, JSON.stringify(winInfo));
  check('panel row mirrors the mini player', await waitFor(() => panel.$eval('#list > li.row:nth-child(1) .play', (e) => e.textContent === 'Playing'), 5000));

  // ---- close the panel; audio continues
  await panel.close();
  await tick(1000);
  const cont = await advancing(mini, `spotify:track:${A.id}`);
  check('after the panel closes, the song keeps playing in the mini player', cont.ok, JSON.stringify(cont));

  // ---- Next from the mini player
  await mini.click('#mini-next');
  const nextOk = await waitFor(() => mini.evaluate(async (k) => { const np = (await chrome.storage.local.get('nowPlaying')).nowPlaying || {}; return np.key === k && np.status === 'playing'; }, B.key), 20000);
  const cont2 = await advancing(mini, `spotify:track:${B.id}`);
  check('Next works from the mini player with the panel closed', nextOk && cont2.ok, JSON.stringify(cont2));
  check('mini player shows the new song and position', /Never Gonna Give You Up/.test(await mini.$eval('#mini-now', (e) => e.textContent)) &&
    (await mini.$eval('#mini-pos', (e) => e.textContent)) === '2 of 2');

  // ---- a new panel sends Play to the open mini player; no second window
  panel = await browser.newPage();
  await panel.goto(`${BASE}/sidepanel.html`);
  await panel.waitForSelector('#list > li.row:nth-child(1) .play');
  check('reopened panel shows the mini player\'s song as Playing', await waitFor(() => panel.$eval('#list > li.row:nth-child(2) .play', (e) => e.textContent === 'Playing'), 5000));
  await panel.click('#list > li.row:nth-child(1) .play');
  const viaPanel = await waitFor(() => mini.evaluate(async (k) => { const np = (await chrome.storage.local.get('nowPlaying')).nowPlaying || {}; return np.key === k && np.status === 'playing'; }, A.key), 20000);
  check('Play in the panel plays in the mini player when it\'s open', viaPanel);
  check('...and the panel\'s docked player stays closed', await panel.$eval('#dock', (e) => e.hidden));
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'ef-open-mini' }));
  await tick(800);
  const popups = await panel.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] })).length);
  check('opening the mini player again focuses it instead of a second window', popups === 1, `popup windows: ${popups}`);

  // ---- song ends -> next. Logged out, the embed plays ~17-30 s previews, so A really ends here.
  const advanced = await waitFor(() => mini.evaluate(async (k) => { const np = (await chrome.storage.local.get('nowPlaying')).nowPlaying || {}; return np.key === k && np.status === 'playing'; }, B.key), 45000);
  check('when a song ends in the mini player, the next one starts by itself', advanced,
    JSON.stringify(await mini.evaluate(async () => (await chrome.storage.local.get('nowPlaying')).nowPlaying)));

  // ---- Keep on top (Document Picture-in-Picture)
  const hasApi = await mini.evaluate(() => 'documentPictureInPicture' in window);
  check('Document PiP API exists in the extension page (player.html)', hasApi);
  if (hasApi) {
    await mini.click('#mini-pip');
    const opened = await waitFor(() => mini.evaluate(() => !!(window.documentPictureInPicture && documentPictureInPicture.window)), 5000);
    check('"Keep on top" opens an always-on-top window from player.html', opened, await mini.$eval('#mini-hint', (e) => e.textContent).catch(() => ''));
    if (opened) {
      await mini.evaluate(() => window.__listenPip());
      const cur = await mini.evaluate(async () => ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).key);
      const curId = cur === A.key ? A.id : B.id;
      // A fresh profile's autoplay rules make the start in a new floating window slow or blocked.
      // Measure it; if it never starts, the player must at least say to press play.
      const t0 = Date.now();
      let inPip = await waitFor(() => mini.evaluate(async () => ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).status === 'playing'), 12000);
      const secs = Math.round((Date.now() - t0) / 1000);
      if (inPip) check(`floating window: the song starts by itself (took ~${secs} s)`, true);
      else {
        // Chrome refused to start sound in the new window: our own Play button must show, and
        // one click on it must start the song (the fix for "pop-out doesn't auto-resume").
        const btnShown = await mini.evaluate(() => !documentPictureInPicture.window.document.querySelector('#mini-start').hidden);
        check('floating window refused to start: our Play button shows', btnShown);
        const pipTarget = browser.targets().find((t) => t.type() === 'page' && t.url() === 'about:blank' && !startTargets.has(t));
        const pp = pipTarget && await pipTarget.page();
        if (pp) await pp.click('#mini-start-btn');
        inPip = await waitFor(() => mini.evaluate(async () => ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).status === 'playing'), 15000);
        check('one click on our Play button starts it', inPip, pp ? '' : 'could not reach the floating window');
      }
      const cont3 = await advancing(mini, `spotify:track:${curId}`);
      if (inPip) check('...and the song plays inside the floating window', cont3.ok, JSON.stringify(cont3));
      const pipControls = await mini.evaluate(() => !!documentPictureInPicture.window.document.querySelector('#mini-next'));
      check('...with the controls moved into it', pipControls);
      const state = await mini.evaluate(async () => (await chrome.windows.getCurrent()).state);
      check('the original mini window gets out of the way (minimized), no blank window left', state === 'minimized', state);
      check('...and says where the player went if someone opens it', await mini.evaluate(() => !document.querySelector('#mini-away').hidden));
      await mini.evaluate(() => documentPictureInPicture.window.close());
      const back = await waitFor(() => mini.evaluate(async () => !!document.querySelector('#mini-next') && ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).status === 'playing'), 20000);
      check('closing it puts the player back in the mini window, still playing', back);
      const state2 = await mini.evaluate(async () => (await chrome.windows.getCurrent()).state);
      check('...and the mini window comes back (not minimized)', state2 === 'normal', state2);
      check('...without the "playing in the floating window" note', await mini.evaluate(() => document.querySelector('#mini-away').hidden));
    }
  }

  // ---- closing the mini window clears its state
  const miniTarget = mini.target();
  await mini.close();
  await tick(800);
  const after = await panel.evaluate(async () => ({ np: (await chrome.storage.local.get('nowPlaying')).nowPlaying || null, win: (await chrome.storage.session.get('miniWindowId')).miniWindowId || null }));
  check('closing the mini window clears it; the panel goes back to its own player', !after.np && !after.win, JSON.stringify(after) + miniTarget.url());

  // ---- Back to panel: the reverse of Pop out (side panel opens, song moves back, mini closes)
  await panel.close(); // only the real side panel should pick the song up
  const fresh = await browser.newPage();
  await fresh.goto(`${BASE}/sidepanel.html`); // a panel tab, only to start a song and pop it out
  await fresh.waitForSelector('#list > li.row:nth-child(1) .play');
  await fresh.click('#list > li.row:nth-child(1) .play');
  await waitFor(() => fresh.$eval('#list > li.row:nth-child(1) .play', (e) => e.textContent === 'Playing'), 15000);
  await fresh.click('#dock-popout');
  const mini2 = await pageFor((u) => u.startsWith(`${BASE}/player.html`));
  await waitFor(() => mini2.evaluate(async () => ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).status === 'playing'), 20000);
  await fresh.close();
  await tick(500);
  const created = [];
  browser.on('targetcreated', (t) => created.push(t));
  await mini2.click('#mini-back');
  await waitFor(() => created.some((t) => t.url().startsWith(`${BASE}/sidepanel.html`)), 8000);
  const sideT = created.find((t) => t.url().startsWith(`${BASE}/sidepanel.html`));
  const side = sideT && ((await sideT.page()) || (await sideT.asPage().catch(() => null)));
  check('Back to panel opens the side panel', !!side, `new targets: ${created.map((t) => `${t.type()} ${t.url().slice(0, 60)}`).join(' | ')}`);
  check('...and closes the mini window', await waitFor(() => !browser.targets().some((t) => t.url().startsWith(`${BASE}/player.html`)), 5000));
  const resumed = side && await waitFor(() => side.$eval('#list > li.row:nth-child(1) .play', (e) => e.textContent === 'Playing'), 20000);
  check('...and the docked player in the panel plays the same song', !!resumed && !(await side.$eval('#dock', (e) => e.hidden)),
    side ? await side.$eval('#dock-hint', (e) => e.textContent) : 'no side panel');

  // ---- your issue 1, from the real side panel: Pop out, then does the mini window start?
  if (side) {
    await side.click('#dock-popout');
    const mini3 = await waitFor(() => browser.targets().some((t) => t.url().startsWith(`${BASE}/player.html`)), 8000)
      && await browser.targets().find((t) => t.url().startsWith(`${BASE}/player.html`)).page();
    const started = mini3 && await waitFor(() => mini3.evaluate(async () => ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).status === 'playing'), 12000);
    if (started) check('from the real side panel, Pop out starts the song by itself', true);
    else if (mini3) {
      const btn = await mini3.evaluate(() => !document.querySelector('#mini-start').hidden);
      check('from the real side panel the start was refused: our Play button shows', btn);
      await mini3.click('#mini-start-btn');
      const ok = await waitFor(() => mini3.evaluate(async () => ((await chrome.storage.local.get('nowPlaying')).nowPlaying || {}).status === 'playing'), 15000);
      check('...and one click on it starts the song', ok);
      await mini3.click('#mini-next');
      const auto = await waitFor(() => mini3.evaluate(async (k) => { const np = (await chrome.storage.local.get('nowPlaying')).nowPlaying || {}; return np.key === k && np.status === 'playing'; }, B.key), 20000);
      check('...after that one click, Next plays without another click', auto);
    } else check('Pop out from the real side panel opened the mini window', false);
  }
} catch (err) {
  check('real-browser run finished', false, err.stack);
} finally {
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
done();
