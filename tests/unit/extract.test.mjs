// Capture: the parser on Instagram-shaped JSON, plus the fetch / XHR / embedded-HTML paths in a page.
import vm from 'vm';
import fs from 'fs';
import { createRequire } from 'module';
import { EXT_DIR } from '../ext-dir.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const require = createRequire(import.meta.url);
const IGMP = require(EXT_DIR + 'inject.js');
const SRC = fs.readFileSync(EXT_DIR + 'inject.js', 'utf8');

// --- parser
const rest = { sectional_items: [{ layout_content: { medias: [
  { media: { code: 'C1', media_type: 2, product_type: 'clips', user: { username: 'dj' },
    clips_metadata: { music_info: { music_asset_info: { title: 'Midnight City', display_artist: 'M83', audio_cluster_id: '111' } }, original_sound_info: null } } },
  { media: { code: 'C2', media_type: 2, product_type: 'clips',
    clips_metadata: { music_info: null, original_sound_info: { original_audio_title: 'Original audio', audio_asset_id: 9, ig_artist: { username: 'skater' } } } } },
  { media: { code: 'C3', media_type: 1, music_metadata: { music_info: { music_asset_info: { title: 'Midnight City', display_artist: 'M83' } } } } },
  { media: { code: 'C4', media_type: 1 } },
] } }] };
const r1 = IGMP.extractFromText(JSON.stringify(rest));
check('REST: two song hits and one original audio',
  r1.filter((h) => h.kind === 'song').length === 2 && r1.filter((h) => h.kind === 'original').length === 1,
  JSON.stringify(r1.map((h) => `${h.kind}:${h.post.code}`)));
check('REST: each hit carries its post shortcode and owner', r1.every((h) => h.post && h.post.code) && r1.find((h) => h.post.code === 'C1').post.owner === 'dj');

const g1 = { data: { x: { edges: [{ node: { media: { code: 'G1', product_type: 'clips', clips_metadata: { music_info: { music_asset_info: { title: 'Bad Habit', display_artist: 'Steve Lacy' } } } } } }] } } };
const g2 = { data: { code: 'G2', media_type: 2, clips_metadata: { music_info: { music_asset_info: { title: 'Nights', display_artist: 'Frank Ocean' } } } } };
const r2 = IGMP.extractFromText('for (;;);' + JSON.stringify(g1) + '\n' + JSON.stringify(g2));
check('streamed GraphQL with for(;;); prefix parses every line', r2.map((h) => h.title).join(',') === 'Bad Habit,Nights', r2.map((h) => h.title).join(','));
check('irrelevant responses are skipped cheaply', !IGMP.looksRelevant('{"data":{"user":{"username":"x"}}}'));

const dup = { items: [{ code: 'D1', media_type: 2, a: { title: 'Same', display_artist: 'X' }, b: { title: 'Same', display_artist: 'X' } }] };
check('the same song twice in one post is reported once', IGMP.extractFromText(JSON.stringify(dup)).length === 1);

let deep = { title: 'Deep', display_artist: 'Down' };
for (let i = 0; i < 60; i++) deep = { n: deep };
check('deeply nested music is still found', IGMP.extract({ code: 'X', media_type: 1, d: deep }).length === 1);

// --- page paths, run the way Chrome runs the MAIN-world script
function makePage({ embedded = [] } = {}) {
  const posted = [];
  const docListeners = {};
  class FakeXHR {
    constructor() { this.listeners = {}; this.responseType = ''; }
    open() {}
    send() {}
    addEventListener(t, f) { this.listeners[t] = f; }
    finish(responseType, value) {
      this.responseType = responseType;
      if (responseType === 'json') this.response = value; else this.responseText = value;
      this.listeners.load && this.listeners.load();
    }
  }
  const page = {
    location: { href: 'https://www.instagram.com/explore/', pathname: '/explore/', origin: 'https://www.instagram.com' },
    postMessage: (m) => posted.push(m),
    addEventListener: () => {},
    console, setTimeout, URL, URLSearchParams, FormData: class {},
    XMLHttpRequest: FakeXHR,
    document: {
      addEventListener: (t, f) => { docListeners[t] = f; },
      querySelectorAll: () => embedded.map((t) => ({ textContent: t })),
    },
    fetch: async () => ({ clone: () => ({ text: async () => '{}' }) }),
  };
  page.window = page;
  vm.runInContext(SRC, vm.createContext(page));
  return { page, posted, docListeners, FakeXHR };
}

const songJson = (title) => ({ items: [{ code: 'P1', media_type: 2, music_asset_info: { title, display_artist: 'Artist' } }] });

{
  // Opening a post changes the URL to /p/…; each capture says which page it was opened from.
  const { page, posted } = makePage();
  const xhrAt = (path, title) => {
    page.location.pathname = path;
    const x = new page.XMLHttpRequest();
    x.open('GET', 'https://www.instagram.com/api/v1/media/1/info/');
    x.send(null);
    x.finish('json', songJson(title));
  };
  xhrAt('/p/AAA/', 'Opened from Explore');
  xhrAt('/reel/BBB/', 'Next post in the same modal');
  xhrAt('/', 'Home feed');
  xhrAt('/p/CCC/', 'Opened from Home');
  await tick(20);
  const via = Object.fromEntries(posted.map((m) => [m.hits[0].title, `${m.page} via ${m.via}`]));
  check('a post opened from Explore reports via /explore/', via['Opened from Explore'] === '/p/AAA/ via /explore/', JSON.stringify(via));
  check('moving to the next post keeps via /explore/', via['Next post in the same modal'] === '/reel/BBB/ via /explore/');
  check('a post opened from Home reports via /', via['Opened from Home'] === '/p/CCC/ via /');
}

{
  const { page, posted } = makePage();
  const x = new page.XMLHttpRequest();
  x.open('POST', 'https://www.instagram.com/api/v1/discover/web/explore_grid/');
  x.send('fb_api_req_friendly_name=ExploreGrid');
  x.finish('json', songJson('From XHR json'));
  await tick(20);
  check('XHR with responseType json is captured', posted[0] && posted[0].hits[0].title === 'From XHR json', JSON.stringify(posted[0] && posted[0].hits));
  check('XHR capture records the GraphQL friendly name', posted[0] && posted[0].name === 'ExploreGrid');

  const y = new page.XMLHttpRequest();
  y.open('GET', 'https://www.instagram.com/graphql/query');
  y.send();
  y.finish('', JSON.stringify(songJson('From XHR text')));
  await tick(20);
  check('XHR with a text response is captured', posted[1] && posted[1].hits[0].title === 'From XHR text');

  const z = new page.XMLHttpRequest();
  z.open('GET', 'https://cdn.example.com/x.json');
  z.send();
  check('requests to other hosts are not inspected', z.listeners.load === undefined);
}

{
  const { posted, docListeners } = makePage({ embedded: [JSON.stringify(songJson('From the page HTML')), '{"nothing":1}'] });
  docListeners.DOMContentLoaded();
  await tick(20);
  check('songs embedded in the page HTML are captured', posted.length === 1 && posted[0].hits[0].title === 'From the page HTML' && posted[0].name === 'embedded-html');
}

{
  // Music fields present but nothing extractable (e.g. all null): the export gets excerpts.
  const noSong = JSON.stringify({ items: [{ code: 'E1', media_type: 2, clips_metadata: { music_info: null, original_sound_info: null, music_asset_info: { title: null, display_artist: null } } }] });
  const { posted, docListeners } = makePage({ embedded: [noSong] });
  docListeners.DOMContentLoaded();
  await tick(20);
  const m = posted[0];
  check('relevant response with no songs: reported with zero hits', m && m.relevant && m.hits.length === 0);
  check('...and a diagnostic sample with excerpts around the music fields',
    m && /^\[no songs extracted\]/.test(m.sample) && m.sample.includes('"display_artist":null') && m.sample.includes('parsedObjects=1'),
    m && m.sample && m.sample.slice(0, 160));
}

{
  const { page, posted } = makePage();
  page.fetch = page.fetch; // patched copy is installed on page.fetch already
  for (let i = 0; i < 7; i++) {
    const x = new page.XMLHttpRequest();
    x.open('GET', 'https://www.instagram.com/graphql/query');
    x.send();
    x.finish('', JSON.stringify(songJson(`Song ${i}`)));
  }
  await tick(30);
  const withSample = posted.filter((m) => m.sample).length;
  check('raw samples are sent for the first 5 captures only', posted.length === 7 && withSample === 5, `${withSample} of ${posted.length}`);
}

done();
