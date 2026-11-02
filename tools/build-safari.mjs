// Assembles the Safari (iPhone) build in dist/safari from extension/ plus platforms/safari/.
//   node tools/build-safari.mjs
// Shared code stays in extension/; only these differ:
//   manifest.json  no side panel or key; popup = the panel page; loopback redirect permission
//   background.js  no side panel; runs the Spotify login; registers the MAIN-world capture
//   platform.js    Spotify login through a tab + loopback redirect (no chrome.identity)
//   popup.css      popup width on macOS
//   onboarding.*   the iPhone setup page (opens on install and from the popup)
// Desktop-only files are left out.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const plat = path.join(root, 'platforms', 'safari');
// --mac: the Mac build (dist/safari-mac). Mac Safari has no side panel and its popup closes when
// you click back into the page, so it has no popup: the toolbar button opens the panel in a window.
const MAC = process.argv.includes('--mac');
const out = path.join(root, 'dist', MAC ? 'safari-mac' : 'safari');
// Desktop-only: the pop-out mini player (no windows API on iPhone).
const DESKTOP_ONLY = new Set(['player.html', 'mini.js', 'mini.css']);
const REPLACED = new Set(['manifest.json', 'background.js', 'platform.js']);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (DESKTOP_ONLY.has(f) || REPLACED.has(f)) continue;
  fs.copyFileSync(path.join(src, f), path.join(out, f));
}
for (const f of ['background.js', 'platform.js', 'popup.css', 'onboarding.html', 'onboarding.js', 'onboarding.css']) {
  fs.copyFileSync(path.join(plat, f), path.join(out, f));
}

const desktop = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(plat, 'manifest.json'), 'utf8'));
manifest.version = desktop.version;
if (MAC) delete manifest.action.default_popup;
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// The dashboard helper puts the Redirect URI into Spotify's form: Safari's loopback one, not Chrome's.
const REDIRECT = fs.readFileSync(path.join(plat, 'platform.js'), 'utf8').match(/REDIRECT = '([^']+)'/)[1];
const helper = path.join(out, 'spotify-dashboard.js');
const helperSrc = fs.readFileSync(helper, 'utf8');
const chromeRedirect = 'const REDIRECT = `https://${chrome.runtime.id}.chromiumapp.org/`;';
if (!helperSrc.includes(chromeRedirect)) { console.error('spotify-dashboard.js: Redirect URI line not found'); process.exit(1); }
fs.writeFileSync(helper, helperSrc.replace(chromeRedirect, `const REDIRECT = '${REDIRECT}';`));

const page = path.join(out, 'sidepanel.html');
fs.writeFileSync(page, fs.readFileSync(page, 'utf8')
  .replace('<link rel="stylesheet" href="sidepanel.css">', '<link rel="stylesheet" href="sidepanel.css">\n  <link rel="stylesheet" href="popup.css">'));

// Every file the manifest and the page refer to must exist.
const refs = [manifest.background.service_worker, manifest.action.default_popup, 'onboarding.html', 'sidepanel.html', ...manifest.content_scripts.flatMap((c) => c.js)].filter(Boolean);
const missing = refs.filter((f) => !fs.existsSync(path.join(out, f)));
if (missing.length) { console.error('missing:', missing); process.exit(1); }
console.log(`Built ${path.relative(root, out)} (version ${manifest.version}): ${fs.readdirSync(out).length} files`);
