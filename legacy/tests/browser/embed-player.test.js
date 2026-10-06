const { open, onScreen } = require('./harness');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const waitFor = async (page, fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(fn)) return true; await sleep(100); } return false; };
const dir = require('path').resolve(__dirname, '../../extension') + '/';
const rowSel = (n) => `#list > li.row:nth-child(${n})`;
const events = (page) => page.evaluate(() => window.__embedEvents.slice());

(async () => {
  // 1. Main flow: scrolled list, one click -> sound
  let t = await open(dir, { songs: 25, fakeEmbed: true });
  let { page } = t;
  await waitFor(page, () => Object.values(window.__store.matches).filter((m) => m.status === 'matched').length >= 25, 30000);
  check('player hidden before anything plays', !(await onScreen(page, '#dock')));
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), rowSel(20));
  await sleep(300);
  const title = await page.$eval(rowSel(20) + ' .title', (e) => e.textContent);
  await page.click(rowSel(20) + ' .play');
  await waitFor(page, () => window.__embedEvents.length > 0, 8000);
  let ev = await events(page);
  check('one click on Play: the player starts with sound', ev[0] && ev[0].played, JSON.stringify(ev));
  check('it loaded the song that was clicked', ev[0] && ev[0].played === 't' + title.split(' ')[1], `${title} -> ${ev[0] && (ev[0].played || ev[0].blocked)}`);
  await sleep(300);
  check('player is docked at the bottom and on screen', await onScreen(page, '#dock') &&
    (await page.$eval('#dock', (e) => e.getBoundingClientRect().bottom)) > 500, String(await page.$eval('#dock', (e) => Math.round(e.getBoundingClientRect().top))));
  check('row shows Playing', (await page.$eval(rowSel(20) + ' .play', (e) => e.textContent)) === 'Playing');
  check('first play of the session shows the one-time sound tip', (await page.$eval('#dock-hint', (e) => e.textContent)).startsWith('No sound?'));
  await page.screenshot({ path: require('path').join(__dirname, 'last-run-playing.png') });

  // 2. Pause / resume from the row
  await page.click(rowSel(20) + ' .play'); await sleep(400);
  check('clicking the playing row pauses', (await page.$eval(rowSel(20) + ' .play', (e) => e.textContent)) === 'Paused');
  await page.click(rowSel(20) + ' .play'); await sleep(400);
  check('clicking again resumes', (await page.$eval(rowSel(20) + ' .play', (e) => e.textContent)) === 'Playing');

  // 3. Next / Prev, and automatic advance when a song ends (6s clips)
  const cur = Number(title.split(' ')[1]);
  let before = (await events(page)).length;
  await page.click('#dock-next');
  await waitFor(page, `window.__embedEvents.length > ${before}`, 8000);
  ev = await events(page);
  check('Next plays the next song in the list', ev[ev.length - 1].played === 't' + (cur - 1), JSON.stringify(ev[ev.length - 1]));
  before = ev.length;
  await page.click('#dock-prev');
  await waitFor(page, `window.__embedEvents.length > ${before}`, 8000);
  ev = await events(page);
  check('Prev goes back', ev[ev.length - 1].played === 't' + cur, JSON.stringify(ev[ev.length - 1]));
  before = ev.length;
  await waitFor(page, `window.__embedEvents.length > ${before}`, 10000);
  ev = await events(page);
  check('when a song ends, the next one starts by itself', ev.length > before && ev[ev.length - 1].played === 't' + (cur - 1), JSON.stringify(ev.slice(before)));
  check('position shown in the player', /of 25/.test(await page.$eval('#dock-pos', (e) => e.textContent)), await page.$eval('#dock-pos', (e) => e.textContent));

  // 4. Close and Clear
  await page.click('#dock-close'); await sleep(300);
  check('Close player hides it and stops audio', !(await onScreen(page, '#dock')) && (await page.$eval('#dock-frame', (e) => e.src)) === 'about:blank');
  await page.click(rowSel(3) + ' .play');
  await waitFor(page, () => document.querySelector('#dock-frame').src.includes('/embed/'), 5000);
  await sleep(800);
  await page.click('#clear'); await page.click('#clear'); await sleep(500);
  check('Clear captures also resets the player', !(await onScreen(page, '#dock')) && (await page.$eval('#dock-frame', (e) => e.src)) === 'about:blank');
  check('no page errors', t.errors.length === 0, t.errors.join(' | '));
  await t.close();

  // If the player reports it didn't start, the panel says what to do
  t = await open(dir, { songs: 5, fakeEmbed: true, forceBlock: true });
  await waitFor(t.page, () => Object.keys(window.__store.matches).length >= 5, 20000);
  await t.page.click(rowSel(2) + ' .play');
  await waitFor(t.page, () => document.querySelector('#dock-hint').textContent.includes("hasn't started"), 8000);
  check('blocked start: panel tells you to tap play in the player', (await t.page.$eval('#dock-hint', (e) => e.textContent)).includes('tap play in the player'));
  check('blocked start: row does not claim Playing', (await t.page.$eval(rowSel(2) + ' .play', (e) => e.textContent)) !== 'Playing');
  await t.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
