// bridge.js: batches captures into storage, detaches when the extension is reloaded.
// background.js: re-attaches to open Instagram tabs on install/update only.
import vm from 'vm';
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();

function loadBridge() {
  const store = {};
  const warns = [];
  let handler = null;
  let removed = false;
  let sets = 0;
  const runtime = { id: 'abc' };
  const win = {
    addEventListener: (t, f) => { handler = f; },
    removeEventListener: (t, f) => { if (f === handler) removed = true; },
  };
  win.window = win;
  const dead = () => { if (!runtime.id) throw new Error('Extension context invalidated.'); };
  const sandbox = {
    window: win, URL, Promise, setTimeout, clearTimeout,
    console: { warn: (...a) => warns.push(a.join(' ')) },
    chrome: { runtime, storage: { local: {
      get: async () => { dead(); return JSON.parse(JSON.stringify(store)); },
      set: async (o) => { dead(); sets++; Object.assign(store, JSON.parse(JSON.stringify(o))); },
    } } },
  };
  vm.runInNewContext(fs.readFileSync(EXT_DIR + 'bridge.js', 'utf8'), sandbox);
  const msg = (title, page = '/explore/') => ({ source: win, data: { __igMusicProbe: true, page, at: Date.now(), url: 'https://www.instagram.com/graphql/query', hits: [{ kind: 'song', title, artist: 'X', post: { code: title, product_type: 'clips' } }] } });
  return { store, warns, runtime, msg, send: (m) => handler(m), removed: () => removed, sets: () => sets };
}

{
  const b = loadBridge();
  const quiet = () => { const m = b.msg('none'); m.data.hits = []; return m; };
  for (let i = 0; i < 5; i++) b.send(quiet());
  await tick(100);
  check('responses without music wait for the batch window', b.sets() === 0);
  await tick(600);
  check('...and a burst of them becomes one storage write', b.sets() === 1, `writes: ${b.sets()}`);
  b.send(b.msg('One'));
  await tick(30);
  check('a song is saved right away, not after the batch window', !!(b.store.tracks && b.store.tracks['song|one|x']), `writes: ${b.sets()}`);
  b.send(b.msg('Two'));
  b.send(b.msg('Three', '/reels/'));
  b.send(b.msg('One'));
  await tick(100);
  check('every Explore capture in the burst was merged, every response logged', Object.keys(b.store.tracks || {}).length === 2 && b.store.log.length === 9);
  check('a repeat capture counts toward its area', b.store.tracks['song|one|x'].areas.explore === 2);
  check('songs captured on Reels are not kept (Explore only)', !b.store.tracks['song|three|x'] && b.store.log.some((l) => l.area === 'reels'));
  // Real case: on /explore/, Instagram also loads the home feed; that is not an Explore find.
  const home = b.msg('Friend', '/explore/');
  home.data.name = 'PolarisFeedTimelineRootV2Query';
  b.send(home);
  const home2 = b.msg('Friend2', '/explore/');
  home2.data.url = 'https://www.instagram.com/api/v1/feed/timeline/';
  b.send(home2);
  await tick(600);
  check('home-feed response on the Explore page is not kept as a find', !b.store.tracks['song|friend|x'], JSON.stringify(b.store.tracks['song|friend|x']));
  check('home-feed REST endpoint is not kept either', !b.store.tracks['song|friend2|x']);
  check('both are logged as home', b.store.log.filter((l) => l.area === 'home').length === 2);

  // Real case (export 2026-10-05): posts opened from the Explore grid have URL /p/… .
  const opened = (title, page, via) => { const m = b.msg(title, page); m.data.via = via; return m; };
  b.send(opened('From Explore', '/p/DeC17p2CNcH/', '/explore/'));
  b.send(opened('From Home', '/p/DeIlg59mkaz/', '/'));
  b.send(opened('Direct', '/reel/Dd_9_UGOyE7/', null));
  await tick(600);
  check('a post opened from Explore is kept as an Explore find', JSON.stringify((b.store.tracks['song|from explore|x'] || {}).areas) === '{"explore":1}');
  check('a post opened from the home feed is not kept', !b.store.tracks['song|from home|x']);
  check('a post loaded directly is not kept', !b.store.tracks['song|direct|x']);
  check('the log counts songs separately from original audio', b.store.log.every((l) => typeof l.songs === 'number'));
  check('the log records where a post was opened from', b.store.log.some((l) => l.via === '/explore/' && l.area === 'explore'));
  const withPosts = b.msg('Seen', '/explore/');
  withPosts.data.posts = ['Q1', 'Q2', 'Seen'];
  b.send(withPosts);
  const homePosts = b.msg('Ignored', '/'); homePosts.data.posts = ['H1'];
  b.send(homePosts);
  await tick(600);
  check('Explore posts checked are recorded once each; other pages are not',
    ['Q1', 'Q2', 'Seen', 'One'].every((c) => b.store.seen.includes(c)) && !b.store.seen.includes('H1') &&
    new Set(b.store.seen).size === b.store.seen.length, JSON.stringify(b.store.seen));
  const before = b.sets();
  b.send({ source: {}, data: { __igMusicProbe: true } });
  b.send({ source: b.msg('x').source, data: { other: true } });
  await tick(600);
  check('messages from other sources or without the tag are ignored', b.sets() === before);

  delete b.runtime.id; // extension reloaded underneath this tab
  b.send(b.msg('After Reload'));
  await tick(600);
  check('after reload: detaches instead of throwing', b.removed());
  check('after reload: no "context invalidated" warnings', b.warns.length === 0, b.warns.join(' | '));
}

{
  const b = loadBridge();
  b.send(b.msg('Queued'));
  delete b.runtime.id; // dies while a batch is waiting
  await tick(700);
  check('a batch pending when the context dies is dropped quietly', b.removed() && b.warns.length === 0, b.warns.join(' | '));
}

// --- background
const injected = [];
const listeners = {};
const bg = {
  console, Promise,
  chrome: {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { onStartup: { addListener: () => {} }, onInstalled: { addListener: (f) => { listeners.installed = f; } }, onMessage: { addListener: () => {} } },
    windows: { onRemoved: { addListener: () => {} } },
    tabs: { query: async (q) => (q.url === 'https://www.instagram.com/*' ? [{ id: 7 }, { id: 9 }] : []) },
    scripting: { executeScript: async (o) => injected.push(`${o.target.tabId}:${o.files[0]}:${o.world || 'ISOLATED'}`) },
  },
};
vm.runInNewContext(fs.readFileSync(EXT_DIR + 'background.js', 'utf8'), bg);
listeners.installed({ reason: 'chrome_update' });
await tick();
check('background: does nothing on a Chrome browser update', injected.length === 0);
listeners.installed({ reason: 'update' });
await tick();
check('background: on extension update, fresh scripts in every open Instagram tab',
  JSON.stringify(injected) === JSON.stringify(['7:inject.js:MAIN', '7:bridge.js:ISOLATED', '9:inject.js:MAIN', '9:bridge.js:ISOLATED']), injected.join(', '));

done();
