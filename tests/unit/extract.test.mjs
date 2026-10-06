// Capture parser: finds songs and original audio in Instagram-shaped JSON (REST and streamed GraphQL).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const IGMP = require('../../extension/inject.js');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const rest = { sectional_items: [{ layout_content: { medias: [
  { media: { code: 'C1', media_type: 2, product_type: 'clips', user: { username: 'dj' },
    clips_metadata: { music_info: { music_asset_info: { title: 'Midnight City', display_artist: 'M83', audio_cluster_id: '111' } }, original_sound_info: null } } },
  { media: { code: 'C2', media_type: 2, product_type: 'clips',
    clips_metadata: { music_info: null, original_sound_info: { original_audio_title: 'Original audio', audio_asset_id: 9, ig_artist: { username: 'skater' } } } } },
  { media: { code: 'C3', media_type: 1, music_metadata: { music_info: { music_asset_info: { title: 'Midnight City', display_artist: 'M83' } } } } },
  { media: { code: 'C4', media_type: 1 } },
] } }] };
const r1 = IGMP.extractFromText(JSON.stringify(rest));
check('REST: two song hits and one original audio', r1.filter((h) => h.kind === 'song').length === 2 && r1.filter((h) => h.kind === 'original').length === 1, JSON.stringify(r1.map((h) => h.kind + ':' + h.post.code)));
check('REST: each hit carries its post shortcode', r1.every((h) => h.post && h.post.code));

const g1 = { data: { x: { edges: [{ node: { media: { code: 'G1', product_type: 'clips', clips_metadata: { music_info: { music_asset_info: { title: 'Bad Habit', display_artist: 'Steve Lacy' } } } } } }] } } };
const g2 = { data: { code: 'G2', media_type: 2, clips_metadata: { music_info: { music_asset_info: { title: 'Nights', display_artist: 'Frank Ocean' } } } } };
const r2 = IGMP.extractFromText('for (;;);' + JSON.stringify(g1) + '\n' + JSON.stringify(g2));
check('streamed GraphQL with for(;;); prefix parses every line', r2.map((h) => h.title).join(',') === 'Bad Habit,Nights', r2.map((h) => h.title).join(','));
check('irrelevant responses are skipped cheaply', !IGMP.looksRelevant('{"data":{"user":{"username":"x"}}}'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
