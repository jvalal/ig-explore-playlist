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

  for (const where of ['middle', 'end']) {
    await page.evaluate((w) => window.scrollTo(0, w === 'end' ? document.body.scrollHeight : document.body.scrollHeight / 2), where);
    await tick(200);
    const r = await page.$eval('#build', (e) => ({ bottom: Math.round(e.getBoundingClientRect().bottom), vh: innerHeight }));
    check(`playlist footer stays pinned to the bottom (scrolled to ${where})`, Math.abs(r.bottom - r.vh) <= 1, JSON.stringify(r));
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
