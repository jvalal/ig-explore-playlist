import { makeSim } from '../sim/spotify-sim.mjs';
import { boot, tick, track, rowBy } from './harness.mjs';
const EXT = new URL('../../extension/', import.meta.url).pathname;
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const waitUntil = async (fn, ms = 6000) => { const e = Date.now() + ms; while (Date.now() < e) { if (fn()) return true; await tick(100); } return false; };
const sim = makeSim();
sim.addTrack('a', 'Song A', 'Artist A'); sim.addTrack('b', 'Song B', 'Artist B'); sim.addTrack('x', 'Some Other Song', 'Somebody');
const extra = [];
const baseFetch = sim.fetch;
sim.fetch = async (url, o = {}) => {
  const u = new URL(String(url)); const p = u.pathname.replace('/v1', '');
  const json = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
  if (p === '/me/playlists') { extra.push('create'); return json(201, { id: 'PLX', external_urls: { spotify: 'u' } }); }
  if (p.startsWith('/playlists/')) { extra.push('add ' + JSON.parse(o.body).uris.join(',')); return json(201, { snapshot_id: 's' }); }
  if (p === '/search' && u.searchParams.get('q').includes('Mystery')) return json(200, { tracks: { items: [sim.tracks['spotify:track:x']] } });
  return baseFetch(url, o);
};
const { store, fire, $ } = await boot(EXT, sim);
store.tracks = { k1: track('k1', 'Song A', 'Artist A', 1000) }; fire(); await tick(100);
store.tracks.k2 = track('k2', 'Song B', 'Artist B', 2000);
store.tracks.k3 = track('k3', 'Mystery Tune', 'Unknown', 3000); fire(); await tick(100);
const titles = [...document.querySelectorAll('#list > li.row')].map((li) => li.querySelector('.title').textContent + (li.classList.contains('enter') ? '*' : ''));
check('new songs roll in at the top, existing row not re-animated', JSON.stringify(titles) === '["Mystery Tune*","Song B*","Song A"]', JSON.stringify(titles));
await waitUntil(() => store.matches.k3); await tick(60); console.log('  (k3 match status:', store.matches.k3.status + ')');
check('miss gets the Choose button', rowBy('Mystery Tune').querySelector('.play').textContent === 'Choose');
rowBy('Mystery Tune').querySelector('.play').click();
await waitUntil(() => document.querySelector('#list > li.picker button'));
document.querySelector('#list > li.picker button').click(); await tick(150);
check('picking a candidate matches it', store.matches.k3.status === 'matched' && store.matches.k3.manual === true);
$('#build-btn').click();
await waitUntil(() => store.playlist && store.playlist.keys.length === 3);
check('playlist created with all three songs', extra[0] === 'create' && extra[1] && extra[1].split(',').length === 3, extra.join(' | '));
check('button switches to Add mode', $('#build-btn').textContent === 'No new songs yet', $('#build-btn').textContent);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
