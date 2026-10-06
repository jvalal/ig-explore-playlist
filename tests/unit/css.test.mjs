import { JSDOM } from 'jsdom'; import fs from 'fs';
const show = (dir) => {
  const html = fs.readFileSync(dir + 'sidepanel.html', 'utf8')
    .replace('<link rel="stylesheet" href="sidepanel.css">', `<style>${fs.readFileSync(dir + 'sidepanel.css', 'utf8')}</style>`)
    .replace(/<script.*<\/script>/, '');
  const { window } = new JSDOM(html);
  const d = (sel) => window.getComputedStyle(window.document.querySelector(sel)).display;
  return { dock: d('#dock'), plPlay: d('#pl-play'), empty: d('#empty'), hint: d('#dock-hint') };
};
const after = show(new URL('../../extension/', import.meta.url).pathname);
const ok = Object.values(after).every((v) => v === 'none');
console.log(ok ? 'PASS  every hidden element stays hidden with the real stylesheet' : 'FAIL', JSON.stringify(after));
