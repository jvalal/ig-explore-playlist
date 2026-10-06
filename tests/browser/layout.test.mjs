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
} catch (err) {
  check('browser test crashed', false, err.stack);
}
done();
