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
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Pause', 3000, `${row(5)} .play`);
    check('row says Playing', (await label(page, 5)) === 'Pause');
    check('player docked on screen', await onScreen(page, '#dock'));
    check('no hint when it started', (await page.$eval('#dock-hint', (e) => e.textContent)) === '');

    await page.click(`${row(5)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Play', 3000, `${row(5)} .play`);
    check('clicking Playing pauses (despite the trailing "still playing" update)', (await label(page, 5)) === 'Play');
    await tick(400);
    check('stays Paused', (await label(page, 5)) === 'Play');
    check('the paused song\'s row is still the outlined one', await page.$eval(row(5), (e) => e.classList.contains('current') && getComputedStyle(e).outlineStyle === 'solid' && parseFloat(getComputedStyle(e).outlineWidth) >= 2));
    await page.click(`${row(5)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Pause', 3000, `${row(5)} .play`);
    check('clicking Paused resumes', (await label(page, 5)) === 'Pause');

    // A slow click on another song while one plays: reports arrive between press and release.
    const id6 = await idOf(page, 6);
    await page.$eval(row(6), (e) => e.scrollIntoView({ block: 'center' }));
    await tick(200);
    const box = await (await page.$(`${row(6)} .play`)).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await tick(600);
    await page.mouse.up();
    await waitFor(page, (s2) => document.querySelector(s2).textContent === 'Pause', 5000, `${row(6)} .play`);
    check('a slow click while another song plays still lands', (await started(page)).pop() === id6, (await started(page)).join(','));

    // Two songs pressed in quick succession: only the last one plays.
    const id2 = await idOf(page, 2);
    const id3 = await idOf(page, 3);
    await page.click(`${row(2)} .play`);
    await tick(60);
    await page.click(`${row(3)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Pause', 5000, `${row(3)} .play`);
    await tick(800);
    check('quick switch: the last song pressed is Playing', (await label(page, 3)) === 'Pause');
    check('quick switch: the earlier one is not', (await label(page, 2)) === 'Play', await label(page, 2));
    const s = await started(page);
    check('quick switch: last start in the embed is the last song pressed', s[s.length - 1] === id3, `${id2}->${id3}: ${s.join(',')}`);

    // Next / Prev move through the list in display order.
    const id4 = await idOf(page, 4);
    await page.click('#dock-next');
    await waitFor(page, (s2) => document.querySelector(s2).textContent === 'Pause', 5000, `${row(4)} .play`);
    check('Next plays the next song in the list', (await started(page)).pop() === id4);
    await page.click('#dock-prev');
    await waitFor(page, (s2) => document.querySelector(s2).textContent === 'Pause', 5000, `${row(3)} .play`);
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
      await waitFor(page, (s) => document.querySelector(s).textContent === 'Pause', 3000, `${row(3)} .play`);
      check(`${mode} end: its row says Playing`, (await label(page, 3)) === 'Pause');
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
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Pause', 5000, `${row(1)} .play`);
    const id2 = await idOf(page, 2);
    await page.click(`${row(2)} .play`);
    await waitFor(page, (s) => document.querySelector(s).textContent === 'Pause', 5000, `${row(2)} .play`);
    await tick(500);
    check('after switching, the previous song is not shown as Playing', (await label(page, 1)) === 'Play', await label(page, 1));
    check('after switching, the embed really started the new song (a stale report did not fake it)',
      (await started(page)).includes(id2), JSON.stringify(await fake(page)));
  });

  const playlist = { id: 'PL1', url: 'https://open.spotify.com/playlist/PL1', name: 'Explore finds, Oct 5', keys: [], uris: [] };
  // The playlist line has no Play button any more (v0.10.2): it played in the panel's own player,
  // and people couldn't tell where. The name links to the playlist on Spotify.
  await session({ name: 'playlist', embed: { durationMs: 1500 }, store: { playlist } }, async (page) => {
    check('the playlist line names the playlist on Spotify, with a link and no Play button', await page.evaluate(() => {
      const line = document.querySelector('.pl-line');
      return /^to playlist: Explore finds, Oct 5$/.test(line.textContent.trim()) && line.querySelector('a').href === 'https://open.spotify.com/playlist/PL1' && !line.querySelector('button');
    }), await page.$eval('.pl-line', (e) => e.textContent));
    check('the Add button comes first, the playlist name under it, the auto-add checkbox under that', await page.evaluate(() => {
      const r = (q) => document.querySelector(q).getBoundingClientRect(); const b = r('#build-btn'); const l = r('#pl-to'); const c = r('.toggle');
      return l.top >= b.bottom && l.top - b.bottom < 14 && Math.abs(l.left - b.left) < 2 && c.top >= l.bottom;
    }));
    check('...and a long playlist name shows in full (it wraps, it isn\'t cut off)', await page.evaluate(() => {
      const a = document.querySelector('#pl-link'); const before = a.textContent;
      a.textContent = 'Explore finds, Oct 6-902 and a much longer name than fits on one line';
      const ok = a.scrollWidth <= a.parentElement.clientWidth + 1 && a.getBoundingClientRect().right <= innerWidth && getComputedStyle(a).textOverflow !== 'ellipsis';
      a.textContent = before;
      return ok;
    }));
    const btn = () => page.$eval('#build-btn', (e) => ({ text: e.textContent, disabled: e.disabled }));
    const b0 = await btn();
    check('auto-add off: the button offers to add the new songs', /^Add \d+ new songs$/.test(b0.text) && !b0.disabled, JSON.stringify(b0));
    await page.click('#auto-sync');
    await waitFor(page, () => document.querySelector('#build-btn').textContent === 'Songs added', 8000);
    const b1 = await btn();
    check('auto-add on: the songs are added and the button only says so, greyed out', b1.text === 'Songs added' && b1.disabled, JSON.stringify(b1));
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
