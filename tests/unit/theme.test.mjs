// theme.js: light / dark / follow system, set on <html> before the page is drawn.
import vm from 'vm';
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();
const src = fs.readFileSync(EXT_DIR + 'theme.js', 'utf8');

function load({ stored, systemDark = false, brokenStorage = false } = {}) {
  const data = stored === undefined ? {} : { 'ef-theme': stored };
  const mqListeners = [];
  const winListeners = {};
  const mq = { matches: systemDark, addEventListener: (t, f) => mqListeners.push(f) };
  const root = { dataset: {} };
  const win = { matchMedia: () => mq, addEventListener: (t, f) => { winListeners[t] = f; } };
  const sandbox = {
    window: win, document: { documentElement: root },
    localStorage: {
      getItem: (k) => { if (brokenStorage) throw new Error('blocked'); return k in data ? data[k] : null; },
      setItem: (k, v) => { if (brokenStorage) throw new Error('blocked'); data[k] = String(v); },
    },
  };
  vm.runInNewContext(src, sandbox);
  return { root, data, api: win.efTheme, system: (isDark) => { mq.matches = isDark; mqListeners.forEach((f) => f()); }, storageEvent: (key) => winListeners.storage({ key }) };
}

let t = load();
check('nothing chosen: follow system, light when the system is light', t.root.dataset.theme === 'system' && t.root.dataset.scheme === 'light' && t.api.get() === 'system');
t = load({ systemDark: true });
check('nothing chosen, dark system: dark', t.root.dataset.scheme === 'dark');
t.system(false);
check('...and it follows the system when that changes', t.root.dataset.scheme === 'light');

t = load({ stored: 'light', systemDark: true });
check('Light chosen wins over a dark system', t.root.dataset.theme === 'light' && t.root.dataset.scheme === 'light');
t.system(true);
check('...and stays light when the system changes', t.root.dataset.scheme === 'light');
t = load({ stored: 'dark' });
check('Dark chosen wins over a light system', t.root.dataset.scheme === 'dark');

t = load();
t.api.set('dark');
check('choosing Dark applies it at once and remembers it', t.root.dataset.scheme === 'dark' && t.data['ef-theme'] === 'dark' && t.api.get() === 'dark');
t.api.set('system');
check('back to Follow system', t.root.dataset.theme === 'system' && t.root.dataset.scheme === 'light');
t.data['ef-theme'] = 'dark'; // another page of the extension changed it
t.storageEvent('ef-theme');
check('a change made in another window (the panel, for the mini player) is picked up', t.root.dataset.scheme === 'dark');

t = load({ stored: 'purple' });
check('an unknown stored value counts as Follow system', t.root.dataset.theme === 'system');
t = load({ brokenStorage: true, systemDark: true });
t.api.set('light');
check('with storage blocked it still works from the system setting, without throwing', t.root.dataset.scheme === 'dark');
done();
