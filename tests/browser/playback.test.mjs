// Playback in real Chrome against fake-embed.html, which reproduces the real embed's observed
// protocol (ready timing, placeholder and stale updates, trailing update after pause, both end
// styles). Headless Chrome doesn't enforce autoplay, so "starts" here means the panel drove the
// embed correctly — not that Chrome would allow sound. That is checked in the real extension.
import { open, onScreen } from './harness.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const waitFor = async (page, fn, ms = 10000, arg) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(fn, arg)) return true; await tick(50); }
  return false;
};
const row = (n) => `#list > li.row:nth-child(${n})`;
const label = (page, n) => page.$eval(`${row(n)} .play`, (e) => e.textContent);
const idOf = async (page, n) => `t${(await page.$eval(`${row(n)} .title`, (e) => e.textContent)).split(' ')[1]}`;
const fake = (page) => page.evaluate(() => window.__fake.slice());
const commands = async (page) => (await fake(page)).filter((e) => e.event === 'cmd').map((e) => e.command);
const started = async (page) => (await fake(page)).filter((e) => e.event === 'started').map((e) => e.id);
const allMatched = (n) => Object.values(window.__store.matches).filter((m) => m.status === 'matched').length >= n;

async function session(opts, fn) {
  const t = await open({ songs: 12, ...opts });
  try {
    await waitFor(t.page, allMatched, 20000, 12);
    await fn(t.page);
    check(`${opts.name}: no page errors`, t.errors.length === 0, t.errors.join(' | '));
  } finally {
    await t.close();
  }
}

try {
  await session({ name: 'main', embed: { durationMs: 60000 } }, async (page) => {
    const id5 = await idOf(page, 5);
    await page.click(`${row(5)} .play`);
    await waitFor(page, () => window.__fake.some((e) => e.event === 'started'));
    check('one click on Play starts the clicked song', (await started(page))[0] === id5, JSON.stringify(await fake(page)));
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Playing', 3000, `${row(5)} .play`);
    check('row says Playing', (await label(page, 5)) === 'Playing');
    check('player docked on screen', await onScreen(page, '#dock'));
    check('no hint when it started', (await page.$eval('#dock-hint', (e) => e.textContent)) === '');

    await page.click(`${row(5)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Paused', 3000, `${row(5)} .play`);
    check('clicking Playing pauses (despite the trailing "still playing" update)', (await label(page, 5)) === 'Paused');
    await tick(400);
    check('stays Paused', (await label(page, 5)) === 'Paused');
    await page.click(`${row(5)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Playing', 3000, `${row(5)} .play`);
    check('clicking Paused resumes', (await label(page, 5)) === 'Playing');

    // A slow click on another song while one plays: reports arrive between press and release.
    const id6 = await idOf(page, 6);
    await page.$eval(row(6), (e) => e.scrollIntoView({ block: 'center' }));
    await tick(200);
    const box = await (await page.$(`${row(6)} .play`)).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await tick(600);
    await page.mouse.up();
    await waitFor(page, (s2) => document.querySelector(s2).textContent === 'Playing', 5000, `${row(6)} .play`);
    check('a slow click while another song plays still lands', (await started(page)).pop() === id6, (await started(page)).join(','));

    // Two songs pressed in quick succession: only the last one plays.
    const id2 = await idOf(page, 2);
    const id3 = await idOf(page, 3);
    await page.click(`${row(2)} .play`);
    await tick(60);
    await page.click(`${row(3)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Playing', 5000, `${row(3)} .play`);
    await tick(800);
    check('quick switch: the last song pressed is Playing', (await label(page, 3)) === 'Playing');
    check('quick switch: the earlier one is not', (await label(page, 2)) === 'Play', await label(page, 2));
    const s = await started(page);
    check('quick switch: last start in the embed is the last song pressed', s[s.length - 1] === id3, `${id2}->${id3}: ${s.join(',')}`);

    // Next / Prev move through the list in display order.
    const id4 = await idOf(page, 4);
    await page.click('#dock-next');
    await waitFor(page, (s2) => document.querySelector(s2).textContent === 'Playing', 5000, `${row(4)} .play`);
    check('Next plays the next song in the list', (await started(page)).pop() === id4);
    await page.click('#dock-prev');
    await waitFor(page, (s2) => document.querySelector(s2).textContent === 'Playing', 5000, `${row(3)} .play`);
    check('Prev goes back', (await started(page)).pop() === id3);

    const cmds = await commands(page);
    check('never sends toggle or play (only resume/pause)', cmds.every((c) => c === 'resume' || c === 'pause'), cmds.join(','));

    await page.click('#dock-close');
    await tick(200);
    check('Close hides the player and unloads the embed', !(await onScreen(page, '#dock')) &&
      (await page.$eval('#dock-frame', (e) => e.src)) === 'about:blank');
  });

  for (const mode of ['full', 'preview']) {
    await session({ name: `end (${mode})`, embed: { mode, durationMs: 1500 } }, async (page) => {
      const next = await idOf(page, 3);
      await page.click(`${row(2)} .play`);
      const ok = await waitFor(page, (id) => window.__fake.filter((e) => e.event === 'started').map((e) => e.id).includes(id), 9000, next);
      check(`${mode} end: the next song starts by itself`, ok, JSON.stringify((await fake(page)).filter((e) => e.event !== 'cmd')));
      await waitFor(page, (s) => document.querySelector(s).textContent === 'Playing', 3000, `${row(3)} .play`);
      check(`${mode} end: its row says Playing`, (await label(page, 3)) === 'Playing');
    });
  }

  await session({ name: 'late ready', embed: { readyDelayMs: 1200, durationMs: 60000 } }, async (page) => {
    await page.click(`${row(1)} .play`);
    await waitFor(page, () => window.__fake.some((e) => e.event === 'started'), 6000);
    const f = await fake(page);
    check('ready after load: still starts, with exactly one resume', f.filter((e) => e.event === 'started').length === 1 &&
      f.filter((e) => e.command === 'resume').length === 1, JSON.stringify(f));
  });

  await session({ name: 'replay same song', embed: { durationMs: 60000 } }, async (page) => {
    // Stale update: the outgoing document posts once more after the iframe navigates.
    await page.click(`${row(1)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Playing', 5000, `${row(1)} .play`);
    const id2 = await idOf(page, 2);
    await page.click(`${row(2)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Playing', 5000, `${row(2)} .play`);
    await tick(500);
    check('after switching, the previous song is not shown as Playing', (await label(page, 1)) === 'Play', await label(page, 1));
    check('after switching, the embed really started the new song (a stale report did not fake it)',
      (await started(page)).includes(id2), JSON.stringify(await fake(page)));
  });

  const playlist = { id: 'PL1', url: 'https://open.spotify.com/playlist/PL1', name: 'Explore finds, Oct 5', keys: [], uris: [] };
  await session({ name: 'playlist', embed: { durationMs: 1500 }, store: { playlist } }, async (page) => {
    const pl = () => page.$eval('#pl-play', (e) => e.textContent);
    check('Play sits on the playlist line, next to its name', await page.evaluate(() => {
      const b = document.querySelector('#pl-play'); const a = document.querySelector('#pl-link');
      const rb = b.getBoundingClientRect(); const ra = a.getBoundingClientRect();
      return !!b.closest('.pl-line') && rb.left > ra.right - 1 && Math.abs((rb.top + rb.bottom) / 2 - (ra.top + ra.bottom) / 2) < 6;
    }));
    check('it reads as strong text, not a full button', await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#pl-play'));
      return cs.borderTopWidth === '0px' && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && Number(cs.fontWeight) >= 700;
    }));
    check('label starts as Play', (await pl()) === 'Play');
    await page.click('#pl-play');
    await waitFor(page, () => document.querySelector('#pl-play').textContent === 'Pause', 5000);
    const f = await fake(page);
    check('Play playlist loads the playlist embed and starts it', f.some((e) => e.event === 'started' && e.id === 'PL1'), JSON.stringify(f));
    check('player shows "Playlist", Prev/Next off', (await page.$eval('#dock-pos', (e) => e.textContent)) === 'Playlist' &&
      (await page.$eval('#dock-prev', (e) => e.disabled)) && (await page.$eval('#dock-next', (e) => e.disabled)));
    await waitFor(page, () => window.__fake.some((e) => e.event === 'next-item'), 5000);
    await tick(600);
    check('the embed moves through the playlist by itself; still playing', (await pl()) === 'Pause');
    check('no song from the list was started meanwhile', (await started(page)).every((id) => id === 'PL1'), (await started(page)).join(','));
    await page.click('#pl-play');
    await waitFor(page, () => document.querySelector('#pl-play').textContent === 'Resume', 3000);
    check('Pause pauses the playlist', (await pl()) === 'Resume');
    await page.click('#pl-play');
    await waitFor(page, () => document.querySelector('#pl-play').textContent === 'Pause', 3000);
    check('Resume continues it', (await pl()) === 'Pause');
    await page.$eval(row(2), (e) => e.scrollIntoView({ block: 'center' }));
    await page.click(`${row(2)} .play`);
    await waitFor(page, (s2) => document.querySelector(s2).textContent === 'Playing', 5000, `${row(2)} .play`);
    check('a song\'s Play takes over from the playlist', (await label(page, 2)) === 'Playing' && (await pl()) === 'Play');
    check('only resume/pause were sent', (await commands(page)).every((c) => c === 'resume' || c === 'pause'));
  });

  await session({ name: 'blocked', embed: { block: true } }, async (page) => {
    await page.click(`${row(2)} .play`);
    await waitFor(page, () => document.querySelector('#dock-hint').textContent !== '', 9000);
    check('if the embed does not start: the panel says to press play in the player',
      (await page.$eval('#dock-hint', (e) => e.textContent)).includes('Press play in the player'));
    check('blocked: row offers Play, does not claim Playing', (await label(page, 2)) === 'Play', await label(page, 2));
  });
} catch (err) {
  check('playback tests ran without crashing', false, err.stack);
}
done();
