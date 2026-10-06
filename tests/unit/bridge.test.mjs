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
  b.send(b.msg('One'));
  b.send(b.msg('Two'));
  b.send(b.msg('Three', '/reels/'));
  b.send(b.msg('One'));
  await tick(100);
  check('nothing is written before the batch window ends', b.sets() === 0);
  await tick(600);
  check('a burst of captures becomes one storage write', b.sets() === 1, `writes: ${b.sets()}`);
  check('every capture in the burst was merged', Object.keys(b.store.tracks || {}).length === 3 && b.store.log.length === 4);
  check('a repeat capture counts toward its area', b.store.tracks['song|one|x'].areas.explore === 2);
  check('captures on Reels are tagged as reels', b.store.tracks['song|three|x'].areas.reels === 1);
  // Real case: on /explore/, Instagram also loads the home feed; that is not an Explore find.
  const home = b.msg('Friend', '/explore/');
  home.data.name = 'PolarisFeedTimelineRootV2Query';
  b.send(home);
  const home2 = b.msg('Friend2', '/explore/');
  home2.data.url = 'https://www.instagram.com/api/v1/feed/timeline/';
  b.send(home2);
  await tick(600);
  check('home-feed response on the Explore page is tagged home, not explore',
    JSON.stringify(b.store.tracks['song|friend|x'].areas) === '{"home":1}', JSON.stringify(b.store.tracks['song|friend|x'].areas));
  check('home-feed REST endpoint is tagged home too', JSON.stringify(b.store.tracks['song|friend2|x'].areas) === '{"home":1}');
  check('the log records the corrected area', b.store.log.filter((l) => l.area === 'home').length === 2);
  b.send({ source: {}, data: { __igMusicProbe: true } });
  b.send({ source: b.msg('x').source, data: { other: true } });
  await tick(600);
  check('messages from other sources or without the tag are ignored', b.sets() === 2);

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
    runtime: { onStartup: { addListener: () => {} }, onInstalled: { addListener: (f) => { listeners.installed = f; } } },
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
