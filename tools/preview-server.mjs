// Serves the Safari build's popup page on your Wi-Fi so it can be opened on a phone:
//   node tools/preview-server.mjs   then open the printed address on the phone (same Wi-Fi).
// Preview only: sample data, no capture, no Spotify login (see tools/preview-stub.js).
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'safari');
const PORT = Number(process.env.PORT) || 8790;
spawnSync(process.execPath, [path.join(root, 'tools', 'build-safari.mjs')], { stdio: 'inherit' });
const manifest = fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/sidepanel.html';
  if (p === '/preview-stub.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(`window.__PREVIEW_MANIFEST = ${manifest};\n${fs.readFileSync(path.join(root, 'tools', 'preview-stub.js'), 'utf8')}`);
    return;
  }
  const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/sidepanel.html') body = body.toString().replace('<script type="module"', '<script src="preview-stub.js"></script>\n  <script type="module"');
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Preview running. On your phone (same Wi-Fi), open:\n${ips.map((ip) => `  http://${ip}:${PORT}/`).join('\n')}`);
});
