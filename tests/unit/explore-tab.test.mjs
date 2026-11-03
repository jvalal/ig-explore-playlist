// When the tab in front isn't Instagram Explore, the panel shows "Open Instagram Explore" under
// the title, and hides it again once the person is there (explore-tab.js).
import { makeSim } from '../sim/spotify-sim.mjs';
import { boot, track } from './harness.mjs';
import { suite, waitUntil } from '../check.mjs';
import { EXT_DIR } from '../ext-dir.mjs';

const { check, done } = suite();
const { isExplore } = await import(`${EXT_DIR}explore-tab.js`);

check('Explore, and a post opened from it, count as Explore',
  isExplore('https://www.instagram.com/explore/') && isExplore('https://www.instagram.com/explore/search/') && isExplore('https://www.instagram.com/p/abc/') && isExplore('https://www.instagram.com/reel/abc/'));
check('the home feed, a profile, another site and no address do not',
  !isExplore('https://www.instagram.com/') && !isExplore('https://www.instagram.com/someone/') && !isExplore('https://example.com/explore/') && !isExplore(undefined) && !isExplore('https://www.instagram.com/explorer/'));

// The tab in front, and the tab events the panel listens to.
let front = { id: 1, url: undefined }; // another site: no address without a host permission
const on = { activated: [], updated: [] };
const tabs = {
  query: async () => [front],
  onActivated: { addListener: (f) => on.activated.push(f) },
  onUpdated: { addListener: (f) => on.updated.push(f) },
};
const go = (url) => { front = { ...front, url }; on.updated.forEach((f) => f(front.id, { url }, front)); };
const switchTo = (url) => { front = { id: front.id + 1, url }; on.activated.forEach((f) => f({ tabId: front.id })); };

const { $, external } = await boot(makeSim(), { tracks: { k1: track('k1', 'Song A', 'Artist A', 1000) } }, { tabs });
const shown = () => !$('#explore-note').hidden;

await waitUntil(shown);
check('on another site, the link is there', shown());
check('...and opens Instagram Explore in a new tab', /^https:\/\/www\.instagram\.com\/explore\/#weblink$/.test($('#explore-note-link').href) && $('#explore-note-link').target === '_blank', $('#explore-note-link').href);
switchTo('https://www.instagram.com/explore/');
await waitUntil(() => !shown());
check('switching to an Explore tab hides it', !shown());
go('https://www.instagram.com/p/abc/');
await waitUntil(() => shown(), 400);
check('opening a post from the grid keeps it hidden', !shown());
go('https://www.instagram.com/');
await waitUntil(shown);
check('going to the home feed in the same tab brings it back', shown());

// With nothing captured, the empty text has the link already: only one is shown.
await external({ tracks: {} });
await waitUntil(() => !$('#empty').hidden);
check('with an empty list, only the empty text has the link', !$('#empty').hidden && !shown());
await external({ tracks: { k1: track('k1', 'Song A', 'Artist A', 1000) } });
await waitUntil(shown);
check('songs again, away from Explore: the link is back under the title', $('#empty').hidden && shown());

done();
