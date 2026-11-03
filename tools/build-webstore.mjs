// Assembles the Chrome Web Store upload in dist/webstore and zips it.
//   node tools/build-webstore.mjs   → dist/explore-finds-store.zip
// Same files as extension/ (no tests, tools or design files live there); only the manifest differs:
//   no "key"   a new Web Store item is refused with one (forum reports; Google's docs don't say);
//              the Web Store gives the item its own ID (so its own Spotify Redirect URI;
//              redirectUri() and the dashboard helper read the ID at run time)
//   name       without "(test build)", which keeps the unpacked copy apart in chrome://extensions
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const out = path.join(root, 'dist', 'webstore');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (f) => path.basename(f) !== '.DS_Store' });

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
delete manifest.key;
manifest.name = manifest.name.replace(/\s*\(test build\)$/, '');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Every file the manifest refers to must exist, and the store needs a 128 px icon.
if ('key' in manifest) { console.error('store manifest still has a key'); process.exit(1); }
const refs = [manifest.background.service_worker, manifest.side_panel.default_path,
  ...manifest.content_scripts.flatMap((c) => c.js), ...Object.values(manifest.icons || {})];
const missing = refs.filter((f) => !fs.existsSync(path.join(out, f)));
if (missing.length) { console.error('missing:', missing); process.exit(1); }
if (!manifest.icons || !manifest.icons['128']) { console.error('manifest has no 128 px icon'); process.exit(1); }
if (manifest.description.length > 132) { console.error('description over 132 characters'); process.exit(1); }

const zip = path.join(root, 'dist', 'explore-finds-store.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
console.log(`Built ${path.relative(root, zip)} ("${manifest.name}" ${manifest.version}, ${fs.readdirSync(out).length} files)`);
