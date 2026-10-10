// Layout in real Chrome: sticky footer after scrolling, hidden elements, picker placement.
// Playback is deliberately not covered here.
import { open, onScreen } from './harness.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const waitFor = async (page, fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(fn)) return true; await tick(100); }
  return false;
};

try {
  const t = await open({ songs: 40, misses: ['Mystery Tune'] });
  const { page } = t;
  await waitFor(page, () => document.querySelectorAll('#list > li.row').length === 41);
  check('no Original audio tab', !(await page.$('.segment')) && !(await page.evaluate(() => document.body.textContent.includes('Original audio'))));
  check('song count shown', (await page.$eval('#n-song', (e) => e.textContent)) === '41 songs');
  check('debug data is a small link, not a full button', await page.$eval('#dl-json', (e) => e.classList.contains('linkish') && !!e.closest('.version')));
  check('every captured song is listed', (await page.$$eval('#list > li.row', (l) => l.length)) === 41);
  check('player hidden before anything plays', !(await onScreen(page, '#dock')));
  check('empty-state text hidden when there are songs', !(await onScreen(page, '#empty')));
  check('setup steps hidden when connected', !(await onScreen(page, '#setup-steps')));
  check('"Start a new playlist" hidden before a playlist exists', !(await onScreen(page, '#pl-new')));

  // Order, top to bottom: count (with Clear captures), player and playlist, the list, Download CSV.
  const order = await page.evaluate(() => { const top = (q) => Math.round(document.querySelector(q).getBoundingClientRect().top + scrollY); return { count: top('#n-song'), clear: top('#clear'), build: top('#build'), list: top('#list'), csv: top('#dl-csv') }; });
  check('order: count, then player and playlist, then the list, then Download CSV',
    order.count < order.build && order.build < order.list && order.list < order.csv, JSON.stringify(order));

  // Settings: slides in from the right and pushes the songs out; the back arrow returns.
  const screens = () => page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const vis = (q) => getComputedStyle(document.querySelector(q)).visibility; return { main: Math.round(r('#main').left), settings: Math.round(r('#settings').left), w: innerWidth, mainVis: vis('#main'), setVis: vis('#settings'), back: Math.round(r('#settings-back').left + r('#settings-back').top) }; });
  const s0 = await screens();
  check('Settings starts off screen to the right, out of sight', s0.settings >= s0.w && s0.setVis === 'hidden' && s0.main === 0, JSON.stringify(s0));
  check('Spotify setup, version and Debug data are in Settings, not on the songs screen', await page.evaluate(() => ['#setup', '#version', '#dl-json'].every((q) => !!document.querySelector(q).closest('#settings'))));
  await page.click('#open-settings');
  await tick(500);
  const s1 = await screens();
  check('the gear slides Settings in and the songs out to the left', s1.settings === 0 && s1.setVis === 'visible' && s1.main <= -s1.w && s1.mainVis === 'hidden', JSON.stringify(s1));
  check('...with a back arrow in the upper left', s1.back < 60 && await onScreen(page, '#settings-back') && await onScreen(page, '#setup'), JSON.stringify(s1));
  await page.click('#settings-back');
  await tick(500);
  const s2 = await screens();
  check('the back arrow brings the songs back', s2.main === 0 && s2.mainVis === 'visible' && s2.settings >= s2.w && s2.setVis === 'hidden', JSON.stringify(s2));
  check('Clear captures is on the song count line', Math.abs(order.clear - order.count) < 12, JSON.stringify(order));

  for (const where of ['middle', 'end']) {
    await page.evaluate((w) => window.scrollTo(0, w === 'end' ? document.body.scrollHeight : document.body.scrollHeight / 2), where);
    await tick(200);
    const r = await page.$eval('#build', (e) => ({ top: Math.round(e.getBoundingClientRect().top), bottom: Math.round(e.getBoundingClientRect().bottom) }));
    check(`the player and playlist block stays pinned to the top (scrolled to ${where})`, Math.abs(r.top) <= 1 && r.bottom > 40, JSON.stringify(r));
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await waitFor(page, () => {
    const b = [...document.querySelectorAll('#list > li.row')].find((li) => li.querySelector('.title').textContent === 'Mystery Tune');
    return b && b.querySelector('.play').textContent === 'Choose';
  }, 30000);
  const choose = await page.evaluateHandle(() => [...document.querySelectorAll('#list > li.row')]
    .find((li) => li.querySelector('.title').textContent === 'Mystery Tune').querySelector('.play'));
  await choose.click();
  await waitFor(page, () => document.querySelector('#list > li.picker button'));
  check('picker opens directly under its row', await page.evaluate(() => {
    const p = document.querySelector('#list > li.picker');
    return !!p && p.previousElementSibling.querySelector('.title').textContent === 'Mystery Tune';
  }));
  check('picker is on screen', await onScreen(page, '#list > li.picker'));
  check('picker lists Spotify candidates with Use buttons', (await page.$$eval('#list > li.picker li button', (l) => l.length)) >= 1);
  check('no page errors', t.errors.length === 0, t.errors.join(' | '));
  await t.close();

  // Goal and auto-add controls, with a playlist and a goal set.
  const g = await open({ songs: 12, store: { prefs: { goal: 20, autoSync: false }, playlist: { id: 'PL1', url: 'u', name: 'Explore finds, Oct 5', keys: [], uris: [] } } });
  await waitFor(g.page, () => document.querySelector('#n-song').textContent.startsWith('12 of 20'));
  check('goal: count and menu share one line', await g.page.evaluate(() => {
    const a = document.querySelector('#n-song').getBoundingClientRect(); const b = document.querySelector('.goal').getBoundingClientRect();
    return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 6 && b.left > a.right;
  }));
  check('goal: progress bar visible and 60% full', await onScreen(g.page, '#goal-bar') &&
    (await g.page.$eval('#goal-fill', (e) => Math.round(e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width * 100))) === 60);
  check('auto-add toggle shows under the playlist line', await onScreen(g.page, '#auto-sync') &&
    await g.page.evaluate(() => document.querySelector('.toggle').getBoundingClientRect().top >= document.querySelector('.pl-line').getBoundingClientRect().bottom));
  check('auto-add checkbox sits right next to its words', await g.page.evaluate(() => {
    const box = document.querySelector('#auto-sync').getBoundingClientRect(); const label = document.querySelector('.toggle').getBoundingClientRect();
    return box.width < 24 && box.left - label.left < 4;
  }));
  check('goal/auto-add: no page errors', g.errors.length === 0, g.errors.join(' | '));
  await g.page.screenshot({ path: new URL('./last-run-goal.png', import.meta.url).pathname });
  await g.close();
} catch (err) {
  check('browser test crashed', false, err.stack);
}
done();
