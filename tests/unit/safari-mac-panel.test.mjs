// Mac Safari has no side panel, and its popup closes when you click back into Instagram (the
// music with it). The Mac build drops the popup; the toolbar button opens the panel page as a
// narrow window docked beside the Safari window instead, and brings it back on later clicks.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeChromeStorage } from '../sim/spotify-sim.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(root, 'dist', 'safari-mac') + '/';

const b = spawnSync(process.execPath, [path.join(root, 'tools', 'build-safari.mjs'), '--mac'], { encoding: 'utf8' });
check('the Mac build assembles', b.status === 0, b.stderr || b.stdout);
const manifest = JSON.parse(fs.readFileSync(DIST + 'manifest.json', 'utf8'));
check('no popup, so the toolbar button reaches the extension', !manifest.action.default_popup, JSON.stringify(manifest.action));
const iphone = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'safari', 'manifest.json'), 'utf8'));
check('the iPhone build keeps its popup', iphone.action.default_popup === 'sidepanel.html');

const ev = () => { const ls = []; return { addListener: (f) => ls.push(f), fire: (...a) => ls.slice().forEach((f) => f(...a)) }; };
const storage = makeChromeStorage({});
const wins = new Map([[1, { id: 1, left: 0, top: 25, width: 1600, height: 1000 }]]);
const created = [];
const updates = [];
const windows = {
  onRemoved: ev(),
  get: async (id) => { if (!wins.has(id)) throw new Error('No window with id'); return { ...wins.get(id) }; },
  update: async (id, o) => { if (!wins.has(id)) throw new Error('No window with id'); updates.push([id, o]); Object.assign(wins.get(id), o); return wins.get(id); },
  create: async (o) => { const w = { id: 10 + created.length, ...o }; created.push(o); wins.set(w.id, w); return w; },
};
const action = { onClicked: ev(), setBadgeText: async () => {} };
globalThis.chrome = {
  storage: { local: storage.local, onChanged: storage.onChanged },
  tabs: { onUpdated: ev(), onRemoved: ev(), query: async () => [], create: async () => ({}) },
  runtime: { onMessage: ev(), onInstalled: ev(), onStartup: ev(), getURL: (p) => `safari-web-extension://x/${p}` },
  scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => {} },
  windows,
  action,
};
await import(DIST + 'background.js');

action.onClicked.fire({ id: 5, windowId: 1 });
await tick(30);
const w = created[0] || {};
check('a click opens the panel page in its own window', created.length === 1 && w.url === 'safari-web-extension://x/sidepanel.html', JSON.stringify(created));
check('...docked at the right edge, as tall as the Safari window', w.left + w.width === 1600 && w.top === 25 && w.height === 1000 && w.width >= 360 && w.width <= 440, JSON.stringify(w));
check('...and the Safari window makes room for it', wins.get(1).width === 1600 - w.width, JSON.stringify(wins.get(1)));

action.onClicked.fire({ id: 5, windowId: 1 });
await tick(30);
check('a second click brings the same panel forward, no second window', created.length === 1 && updates.some(([id, o]) => id === 10 && o.focused), JSON.stringify(updates));

windows.onRemoved.fire(10); wins.delete(10);
await tick(10);
action.onClicked.fire({ id: 5, windowId: 1 });
await tick(30);
check('closed, the next click opens a new one', created.length === 2, JSON.stringify(created));

// A narrow Safari window isn't squeezed further: the panel goes over its right edge instead.
wins.set(2, { id: 2, left: 100, top: 25, width: 800, height: 900 });
windows.onRemoved.fire(11); wins.delete(11);
await tick(10);
action.onClicked.fire({ id: 6, windowId: 2 });
await tick(30);
check('a narrow Safari window keeps its size', wins.get(2).width === 800 && created.length === 3, JSON.stringify([wins.get(2), created[2]]));

done();
