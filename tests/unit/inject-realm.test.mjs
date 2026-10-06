// inject.js can be injected twice into one page (re-attach after an update). It must not throw,
// must not patch fetch twice, and must not leak names into the page.
import vm from 'vm';
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const SRC = fs.readFileSync(EXT_DIR + 'inject.js', 'utf8');

function makePage() {
  const posted = [];
  const page = {
    location: { href: 'https://www.instagram.com/explore/', pathname: '/explore/', origin: 'https://www.instagram.com' },
    postMessage: (m) => posted.push(m),
    addEventListener: () => {},
    console, setTimeout, URL, URLSearchParams, FormData: class {},
    XMLHttpRequest: function () {},
    document: { addEventListener: () => {}, querySelectorAll: () => [] },
  };
  page.XMLHttpRequest.prototype = { open() {}, send() {} };
  page.window = page;
  page.fetch = async () => ({ clone: () => ({ text: async () => JSON.stringify({ items: [{ code: 'P1', media_type: 2, music_asset_info: { title: 'Song', display_artist: 'Artist' } }] }) }) });
  const ctx = vm.createContext(page);
  const run = () => { try { vm.runInContext(SRC, ctx); return null; } catch (e) { return e; } };
  return { page, run, posted, ctx };
}

{
  const { run } = makePage();
  const e1 = run();
  const e2 = run();
  check('injected twice into one page: no error', !e1 && !e2, (e1 || e2 || {}).message);
}
{
  const { page, run, posted, ctx } = makePage();
  run();
  run();
  await page.fetch('https://www.instagram.com/graphql/query');
  await tick(50);
  check('fetch patched once, not twice (one capture per response)', posted.length === 1, `messages: ${posted.length}`);
  check('capture still extracts the song', posted[0] && posted[0].hits[0].title === 'Song');
  check("nothing leaks into the page's global scope", vm.runInContext('typeof IGMP', ctx) === 'undefined');
}
{
  const page = { __igmpInstalled: true, fetch: () => 'original' };
  vm.runInNewContext(SRC, { window: page, module: undefined });
  check('re-injecting leaves an already-patched page alone', page.fetch() === 'original');
}
done();
