import vm from 'vm'; import fs from 'fs';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// --- bridge: works while alive, detaches silently once the extension is reloaded
const store = {}; const warns = []; let handler = null; let removed = false;
const runtime = { id: 'abc' };
const win = { addEventListener: (t, f) => { handler = f; }, removeEventListener: (t, f) => { if (f === handler) removed = true; } };
win.window = win;
const sandbox = {
  window: win, URL, Promise, setTimeout,
  console: { warn: (...a) => warns.push(a.join(' ')) },
  chrome: { runtime, storage: { local: {
    get: async () => { if (!runtime.id) throw new Error('Extension context invalidated.'); return JSON.parse(JSON.stringify(store)); },
    set: async (o) => { if (!runtime.id) throw new Error('Extension context invalidated.'); Object.assign(store, o); } } } },
};
vm.runInNewContext(fs.readFileSync(new URL('../../extension/', import.meta.url).pathname + 'bridge.js', 'utf8'), sandbox);
const msg = (title) => ({ source: win, data: { __igMusicProbe: true, page: '/explore/', at: Date.now(), url: 'https://www.instagram.com/graphql/query', hits: [{ kind: 'song', title, artist: 'X', post: { code: title } }] } });
handler(msg('Live Song')); await tick();
check('captures while the extension is live', !!store.tracks && Object.keys(store.tracks).length === 1);
delete runtime.id; // extension reloaded underneath this tab
handler(msg('After Reload')); await tick();
check('after reload: detaches instead of throwing', removed, '');
check('after reload: no "context invalidated" warnings', warns.length === 0, warns.join(' | '));

// --- background: reattaches to open Instagram tabs on update, not on Chrome updates
const injected = [];
const listeners = {};
const bg = {
  console, Promise,
  chrome: {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { onStartup: { addListener: () => {} }, onInstalled: { addListener: (f) => (listeners.installed = f) } },
    tabs: { query: async (q) => (q.url === 'https://www.instagram.com/*' ? [{ id: 7 }, { id: 9 }] : []) },
    scripting: { executeScript: async (o) => injected.push(`${o.target.tabId}:${o.files[0]}:${o.world || 'ISOLATED'}`) },
  },
};
vm.runInNewContext(fs.readFileSync(new URL('../../extension/', import.meta.url).pathname + 'background.js', 'utf8'), bg);
listeners.installed({ reason: 'chrome_update' }); await tick();
check('does nothing on a Chrome browser update', injected.length === 0);
listeners.installed({ reason: 'update' }); await tick();
check('on extension update: fresh scripts in every open Instagram tab',
  JSON.stringify(injected) === JSON.stringify(['7:inject.js:MAIN', '7:bridge.js:ISOLATED', '9:inject.js:MAIN', '9:bridge.js:ISOLATED']), injected.join(', '));

// --- inject.js won't double-patch a page that already has it
const page = { __igmpInstalled: true, fetch: () => 'original' };
vm.runInNewContext(fs.readFileSync(new URL('../../extension/', import.meta.url).pathname + 'inject.js', 'utf8'), { window: page, module: undefined });
check('re-injecting inject.js leaves an already-patched page alone', page.fetch() === 'original');

console.log(`\n${pass} passed, ${fail} failed`);
