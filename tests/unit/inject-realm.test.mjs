import vm from 'vm'; import fs from 'fs';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

// One page = one shared realm, like a real Instagram tab.
function makePage() {
  const posted = [];
  let fetchPatches = 0;
  const page = {
    location: { href: 'https://www.instagram.com/explore/', pathname: '/explore/', origin: 'https://www.instagram.com' },
    postMessage: (m) => posted.push(m),
    addEventListener: () => {},
    console,
    setTimeout,
    URL, URLSearchParams, FormData: class {},
    XMLHttpRequest: function () {},
    document: { addEventListener: () => {}, querySelectorAll: () => [] },
  };
  page.XMLHttpRequest.prototype = { open() {}, send() {} };
  page.window = page;
  page.fetch = async () => ({ clone: () => ({ text: async () => JSON.stringify({ items: [{ code: 'P1', media_type: 2, music_asset_info: { title: 'Song', display_artist: 'Artist' } }] }) }) });
  const ctx = vm.createContext(page);
  const run = (file) => { try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx); return null; } catch (e) { return e; } };
  return { page, run, posted, ctx };
}

const NEW = new URL('../../extension/', import.meta.url).pathname + 'inject.js';


{ const { run } = makePage(); const e1 = run(NEW), e2 = run(NEW);
  check('new version injected twice into one page: no error', !e1 && !e2, e2 && e2.message); }

{ const { run } = makePage(); run(NEW); const e = run(NEW);
  check('injected a second time into the same page: still no error', !e, e && e.message); }

{ const { page, run, posted } = makePage(); run(NEW); run(NEW);
  await page.fetch('https://www.instagram.com/graphql/query'); await new Promise((r) => setTimeout(r, 50));
  check('fetch patched once, not twice (one capture per response)', posted.length === 1, `messages: ${posted.length}`);
  check('capture still extracts the song', posted[0] && posted[0].hits[0].title === 'Song');
  check('nothing leaks into the page\'s global scope', vm.runInContext('typeof IGMP', vm.createContext(page)) === 'undefined'); }

console.log(`\n${pass} passed, ${fail} failed`);
