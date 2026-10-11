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

  // A song's Play is a round icon-only button (the word is for screen readers).
  const pb = await page.$eval('#list > li.row .play.round', (b) => { const r = b.getBoundingClientRect(); const sr = b.querySelector('.sr').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(b).borderRadius, word: b.textContent, wordSize: Math.round(sr.width), icon: !!b.querySelector('svg path') }; });
  check('a row\'s Play is a round icon button, its word kept for screen readers only', pb.w === pb.h && pb.w >= 28 && pb.w <= 34 && pb.icon && pb.word === 'Play' && pb.wordSize <= 1, JSON.stringify(pb));

  // Select all/none sits in the block above the list, in line with the rows' checkboxes.
  const col = await page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const a = r('#check-all'); const b = r('#list input[type=checkbox]'); return { all: Math.round(a.left), row: Math.round(b.left), inBuild: !!document.querySelector('#check-all').closest('#build'), above: a.bottom <= b.top }; });
  check('Select all/none is above the list, lined up with the rows\' checkboxes', Math.abs(col.all - col.row) <= 1 && col.inBuild && col.above, JSON.stringify(col));

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
  // Appearance: Light (Daylight), Dark, Follow system.
  const look = () => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, scheme: document.documentElement.dataset.scheme, bg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily.split(',')[0].trim(), picked: (document.querySelector('.theme-pick input:checked') || {}).value, rowBorder: getComputedStyle(document.querySelector('#list > li.row')).borderTopWidth, rowRadius: getComputedStyle(document.querySelector('#list > li.row')).borderTopLeftRadius }));
  const pick = async (v) => { await page.evaluate((val) => document.querySelector(`.theme-pick input[value="${val}"]`).closest('label').click(), v); await tick(150); return look(); };
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); // whatever this Mac is set to
  await tick(150);
  const l0 = await look();
  check('Settings has a theme choice, on Follow system to start; a light system shows Daylight', l0.picked === 'system' && l0.theme === 'system' && l0.scheme === 'light' && /Manrope/.test(l0.font) && l0.rowBorder === '1px' && l0.rowRadius === '12px', JSON.stringify(l0));
  const ld = await pick('dark');
  check('Dark: the dark look, whatever the system says', ld.scheme === 'dark' && ld.bg !== l0.bg && !/Manrope/.test(ld.font) && ld.picked === 'dark', JSON.stringify(ld));
  const ll = await pick('light');
  check('Light: Daylight again', ll.scheme === 'light' && ll.bg === l0.bg && /Manrope/.test(ll.font), JSON.stringify(ll));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await tick(150);
  check('Light stays light on a dark system', (await look()).scheme === 'light');
  const ls = await pick('system');
  check('Follow system: goes dark with the system', ls.scheme === 'dark' && ls.theme === 'system', JSON.stringify(ls));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await tick(150);
  check('...and light again with it', (await look()).scheme === 'light');
  check('the font file is bundled with the extension (nothing fetched from the web)', await page.evaluate(async () => (await fetch(new URL('manrope-latin.woff2', location.href).href)).ok && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Manrope')));

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
  await tick(300); // it scrolls into view a moment after it opens
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
  // New songs arriving: each row glows and swells a little, one after another, then settles.
  for (const scheme of ['light', 'dark']) {
    await g.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await tick(200);
    await g.page.evaluate(async (tag) => {
      const { tracks } = await chrome.storage.local.get('tracks');
      const now = Date.now();
      for (let i = 0; i < 3; i++) { const k = `song|roll ${tag} ${i}|x`; tracks[k] = { key: k, kind: 'song', title: `Roll ${tag} ${i}`, artist: 'X', first_seen: now + i, last_seen: now, posts: [{ code: `r${tag}${i}`, type: 'clips' }], areas: { explore: 1 } }; }
      window.__peaks = [];
      await chrome.storage.local.set({ tracks });
      const t0 = performance.now();
      const watch = () => {
        const rows = [...document.querySelectorAll('#list > li.row.enter')];
        rows.forEach((r, i) => { const sc = parseFloat(getComputedStyle(r).scale) || 1; const p = window.__peaks[i] || (window.__peaks[i] = { max: 1, at: 0 }); if (sc > p.max) { p.max = sc; p.at = performance.now() - t0; } });
        if (performance.now() - t0 < 1400) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }, scheme);
    await tick(1600);
    const peaks = await g.page.evaluate(() => window.__peaks);
    check(`${scheme}: each new row swells a little, the rows one after another`, peaks.length === 3 && peaks.every((p) => p.max > 1.02 && p.max < 1.06) && peaks[0].at < peaks[1].at && peaks[1].at < peaks[2].at, JSON.stringify(peaks));
    await tick(1600);
    const after = await g.page.evaluate(() => ({ entering: document.querySelectorAll('#list > li.row.enter').length, scale: getComputedStyle(document.querySelector('#list > li.row')).scale, bg: getComputedStyle(document.querySelector('#list > li.row')).backgroundColor, other: getComputedStyle(document.querySelector('#list > li.row:nth-child(8)')).backgroundColor }));
    check(`${scheme}: then they settle, the same size and colour as the other rows`, after.entering === 0 && (after.scale === 'none' || after.scale === '1') && after.bg === after.other, JSON.stringify(after));
  }
  check('goal/auto-add: no page errors', g.errors.length === 0, g.errors.join(' | '));
  await g.page.screenshot({ path: new URL('./last-run-goal.png', import.meta.url).pathname });
  await g.close();

  // Scrolled down the list while songs arrive at the top: what is on screen stays where it is,
  // and a pill under the pinned block says songs arrived (the user: "not 100% sure that songs
  // are being added above the fold").
  const a = await open({ songs: 30 });
  await waitFor(a.page, () => document.querySelectorAll('#list > li.row').length === 30);
  const addSongs = (n, tag) => a.page.evaluate(async (n, tag) => {
    const { tracks } = await chrome.storage.local.get('tracks');
    for (let i = 0; i < n; i++) tracks[`${tag}${i}`] = { key: `${tag}${i}`, kind: 'song', title: `Song ${i}`, artist: `Artist ${i}`, first_seen: Date.now() + i, last_seen: Date.now() + i, posts: [{ code: `${tag}${i}`, type: 'clips' }], areas: { explore: 1 } };
    await chrome.storage.local.set({ tracks });
  }, n, tag);
  const pill = () => a.page.evaluate(() => { const p = document.querySelector('#new-above'); const r = p.getBoundingClientRect(); return { shown: !p.hidden && r.width > 0 && r.top >= document.querySelector('#build').getBoundingClientRect().bottom && r.bottom < innerHeight, text: p.textContent.trim(), swell: p.classList.contains('swell') }; });
  await addSongs(1, 'top');
  await tick(900);
  check('at the top of the list a new song just rolls in: no pill', !(await pill()).shown && (await a.page.evaluate(() => scrollY)) === 0, JSON.stringify(await pill()));
  await a.page.evaluate(() => { window.scrollTo(0, 900); window.__mid = [...document.querySelectorAll('#list > li.row')].find((li) => li.getBoundingClientRect().top > 400); });
  await tick(300);
  const top0 = await a.page.evaluate(() => Math.round(window.__mid.getBoundingClientRect().top));
  await addSongs(3, 'n');
  await tick(1200);
  const st1 = await a.page.evaluate(() => ({ top: Math.round(window.__mid.getBoundingClientRect().top), y: Math.round(scrollY), rows: document.querySelectorAll('#list > li.row').length }));
  check('scrolled down: songs added above leave the rows on screen where they are', st1.rows === 34 && Math.abs(st1.top - top0) <= 2 && st1.y > 900, JSON.stringify({ top0, ...st1 }));
  const p1 = await pill();
  check('...and a pill under the pinned block says how many arrived, with a swell', p1.shown && p1.text === '3 new songs' && p1.swell, JSON.stringify(p1));
  await addSongs(1, 'o');
  await tick(700);
  check('...counting on as more arrive', (await pill()).text === '4 new songs', JSON.stringify(await pill()));
  await a.page.click('#new-above');
  await waitFor(a.page, () => scrollY === 0, 4000);
  await tick(200);
  const st2 = await a.page.evaluate(() => ({ y: scrollY, late: document.querySelectorAll('#list > li.row.late').length, first4: [...document.querySelectorAll('#list > li.row')].slice(0, 4).every((li) => li.classList.contains('late')) }));
  check('pressing it goes to the top, where those songs glow once more; the pill is gone', st2.y === 0 && st2.late === 4 && st2.first4 && !(await pill()).shown, JSON.stringify({ ...st2, pill: await pill() }));
  await tick(2600);
  check('...and then they settle like any other row', (await a.page.evaluate(() => document.querySelectorAll('#list > li.row.late, #list > li.row.enter').length)) === 0);
  check('new songs above: no page errors', a.errors.length === 0, a.errors.join(' | '));
  await a.close();

  // First run: Back and Next sit right under the drawing, not at the bottom of the panel.
  const w = await open({ songs: 3, store: { welcomed: false, spotify: {} } });
  await waitFor(w.page, () => !document.querySelector('#welcome').hidden, 4000);
  const nav = () => w.page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const art = document.querySelector('.w-step.on .w-art').getBoundingClientRect(); const n = r('.w-nav'); return { gap: Math.round(n.top - art.bottom), below: Math.round(innerHeight - n.bottom), left: Math.round(n.left - art.left), right: Math.round(n.right - art.right) }; });
  const n1 = await nav();
  check('walkthrough: Next is just under the drawing, lined up with it, well clear of the bottom', n1.gap >= 8 && n1.gap <= 30 && n1.below > 80 && Math.abs(n1.left) <= 1 && Math.abs(n1.right) <= 1, JSON.stringify(n1));
  if (process.env.SHOT) await w.page.screenshot({ path: `${process.env.SHOT}/w1.png` });
  await w.page.click('#w-bars button:nth-child(4)');
  await tick(300);
  const n4 = await w.page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { gap: Math.round(r('.w-nav').top - r('#w-setup-slot').bottom), top: Math.round(r('.w-step.on').top), back: r('#w-back').bottom <= innerHeight, go: document.querySelector('#w-go').hidden }; });
  check('...and on the Connect step Back follows the setup steps, on screen, with no second button', n4.gap >= 8 && n4.gap <= 30 && n4.back && n4.go && n4.top < 80, JSON.stringify(n4));
  if (process.env.SHOT) await w.page.screenshot({ path: `${process.env.SHOT}/w4.png` });
  await w.page.click('#w-skip');
  await w.page.click('#open-settings');
  await tick(500);
  const cards = await w.page.evaluate(() => ({ folds: document.querySelectorAll('#settings details:not(#by-hand)').length, steps: document.querySelector('#setup-steps').getBoundingClientRect().height > 50, how: document.querySelector('#show-welcome').getBoundingClientRect().height > 10 }));
  check('Settings: the Spotify and How it works cards are open, with nothing to fold', cards.folds === 0 && cards.steps && cards.how, JSON.stringify(cards));
  if (process.env.SHOT) await w.page.screenshot({ path: `${process.env.SHOT}/s.png` });
  check('walkthrough: no page errors', w.errors.length === 0, w.errors.join(' | '));
  await w.close();
} catch (err) {
  check('browser test crashed', false, err.stack);
}
done();
