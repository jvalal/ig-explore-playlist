// Matching Instagram songs to Spotify search results.
import { EXT_DIR } from '../ext-dir.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();
globalThis.chrome = {};
const S = await import(EXT_DIR + 'spotify.js');

const c = (name, ...artists) => ({ uri: `spotify:track:${name}`, name, artists: artists.map((a) => ({ name: a })) });
const T = (title, artist) => ({ title, artist });
const pick = (t, cands) => { const h = S.pickBest(t, cands); return h ? h.track.name : null; };

check('"Song 1" is not "Song 10"', pick(T('Song 1', 'Artist'), [c('Song 10', 'Artist')]) === null);
check('"Future" is not "Future Islands"', pick(T('Seasons', 'Future'), [c('Seasons', 'Future Islands')]) === null);
check('"Love" is not "Love Me Do"', pick(T('Love', 'The Beatles'), [c('Love Me Do', 'The Beatles')]) === null);
check('two-word title inside a slightly longer one still matches', pick(T('Bad Habit', 'Steve Lacy'), [c('Bad Habit Reprise', 'Steve Lacy')]) === 'Bad Habit Reprise');
check('original beats remix when both are offered (remix listed first)',
  pick(T('Nights', 'Frank Ocean'), [c('Nights - Remix', 'Frank Ocean'), c('Nights', 'Frank Ocean')]) === 'Nights');
check('original beats a live version', pick(T('Heroes', 'David Bowie'), [c('Heroes - Live', 'David Bowie'), c('Heroes', 'David Bowie')]) === 'Heroes');
check('a remix is still accepted when it is the only option', pick(T('Nights', 'Frank Ocean'), [c('Nights - Remix', 'Frank Ocean')]) === 'Nights - Remix');
check('the remix wins when Instagram says remix', pick(T('Nights (Remix)', 'Frank Ocean'), [c('Nights', 'Frank Ocean'), c('Nights - Remix', 'Frank Ocean')]) === 'Nights - Remix');
check('a remaster counts as the same song', pick(T('Heroes', 'David Bowie'), [c('Heroes - 2017 Remaster', 'David Bowie')]) === 'Heroes - 2017 Remaster');
check('karaoke is rejected', pick(T('Heroes', 'David Bowie'), [c('Heroes (Karaoke Version)', 'David Bowie')]) === null);
check('a cover by someone else is rejected', pick(T('Heroes', 'David Bowie'), [c('Heroes (Cover)', 'Tribute Band')]) === null);
check('feat. in the Instagram title and artist list still matches',
  pick(T('Sicko Mode (feat. Drake)', 'Travis Scott, Drake'), [c('SICKO MODE', 'Travis Scott')]) === 'SICKO MODE');
check('a featured artist alone can confirm the match', pick(T('Sicko Mode', 'Drake & Travis Scott'), [c('SICKO MODE', 'Travis Scott')]) === 'SICKO MODE');
check('accents and punctuation are ignored', pick(T('Beyoncé’s Song', 'Beyoncé'), [c("Beyonce's Song", 'Beyoncé')]) !== null);
check('no artist: exact title, top result only', pick(T('Midnight City', ''), [c('Midnight City', 'M83')]) === 'Midnight City');
check('no artist: an exact title that is not the top result is not trusted',
  pick(T('Midnight City', ''), [c('Midnight Rain', 'Taylor Swift'), c('Midnight City', 'M83')]) === null);
check('no artist: a loose title is rejected', pick(T('Midnight', ''), [c('Midnight City', 'M83')]) === null);

const q = S.buildQueries(T('Sicko Mode (feat. Drake)', 'Travis Scott, Drake'));
check('queries go from strict to broad', q[0][0] === 'track:"Sicko Mode" artist:"Travis Scott"' && q[q.length - 1][0] === 'Sicko Mode', JSON.stringify(q));
check('search limit never exceeds 10', q.every(([, n]) => n <= 10));

done();
