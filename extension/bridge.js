// Receives captures from inject.js and merges them into extension storage.
// Captures are batched: at most one storage write every FLUSH_MS, because every write
// wakes the side panel and the stored tracks object grows with every session.
(() => {
  // One live bridge per extension instance, even if injected more than once.
  try {
    if (window.__efBridgeFor === chrome.runtime.id) return;
    window.__efBridgeFor = chrome.runtime.id;
  } catch (_) {
    return;
  }
  const TAG = '__igMusicProbe';
  const MAX_LOG = 300;
  const MAX_SAMPLES = 5;
  const MAX_POSTS = 20;
  const FLUSH_MS = 500;

  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const trackKey = (h) =>
    h.kind === 'song'
      ? `song|${norm(h.title)}|${norm(h.artist)}`
      : `orig|${h.audio_id || `${norm(h.title)}|${norm(h.artist)}`}`;

  // Where a capture came from. The request itself wins over the page: Instagram's Explore
  // page also fetches the first page of the home feed (PolarisFeedTimelineRootV2Query, data
  // under xdt_api__v1__feed__timeline__connection), so the same home-feed posts were being
  // counted as Explore on every refresh (seen in a debug export, 2026-10-05).
  const HOME_FEED = /FeedTimeline|feed__timeline|\/feed\/timeline/i;
  // A post opened from the Explore grid (URL /p/… or /reel/…, `via` /explore…) is Explore.
  const areaOf = (path, name, url, via) => {
    if (HOME_FEED.test(name || '') || HOME_FEED.test(url || '')) return 'home';
    if (!path) return 'other';
    if (path.startsWith('/explore')) return 'explore';
    if (path.startsWith('/reels')) return 'reels';
    if (path.startsWith('/reel/') || path.startsWith('/p/')) return via && via.startsWith('/explore') ? 'explore' : 'post';
    if (path === '/') return 'home';
    return 'other';
  };

  const shortUrl = (url) => {
    try {
      const u = new URL(url);
      return u.pathname + (u.hash || '');
    } catch (_) {
      return String(url).slice(0, 200);
    }
  };

  function apply(store, msg) {
    const { tracks, log, samples } = store;
    const area = areaOf(msg.page, msg.name, msg.url, msg.via);

    // Explore finds only. Capture runs on every instagram.com page, and the Explore page also
    // loads the home feed; those responses are logged but their songs aren't kept.
    for (const h of area === 'explore' ? msg.hits || [] : []) {
      const k = trackKey(h);
      const t = tracks[k] || (tracks[k] = {
        key: k,
        kind: h.kind,
        title: h.title,
        artist: h.artist,
        audio_id: h.audio_id,
        explicit: !!h.explicit,
        duration_ms: h.duration_ms ?? null,
        first_seen: msg.at,
        last_seen: msg.at,
        posts: [],
        areas: {},
      });
      t.last_seen = msg.at;
      t.areas[area] = (t.areas[area] || 0) + 1;
      if (h.post && h.post.code && t.posts.length < MAX_POSTS &&
          !t.posts.some((p) => p.code === h.post.code)) {
        t.posts.push({ code: h.post.code, type: h.post.product_type, owner: h.post.owner });
      }
    }

    log.push({
      at: msg.at,
      page: msg.page,
      via: msg.via || null,
      area,
      url: shortUrl(msg.url),
      name: msg.name || null,
      relevant: !!msg.relevant,
      hits: (msg.hits || []).length,
      songs: (msg.hits || []).filter((h) => h.kind === 'song').length,
    });
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);

    if (msg.sample && samples.length < MAX_SAMPLES) {
      samples.push({ at: msg.at, page: msg.page, url: msg.url, name: msg.name || null, text: msg.sample });
    }
  }

  // One read and one write for any number of captures.
  async function mergeBatch(msgs) {
    const s = await chrome.storage.local.get(['tracks', 'log', 'samples']);
    const store = { tracks: s.tracks || {}, log: s.log || [], samples: s.samples || [] };
    for (const m of msgs) apply(store, m);
    await chrome.storage.local.set(store);
  }
  const merge = (msg) => mergeBatch([msg]);

  // After the extension is reloaded, this copy of the script can no longer
  // reach storage. It steps aside quietly; background.js injects a fresh one.
  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  let queue = [];
  let timer = null;
  let chain = Promise.resolve();

  const detach = () => {
    window.removeEventListener('message', onMessage);
    clearTimeout(timer);
    timer = null;
    queue = [];
  };

  const flush = () => {
    timer = null;
    if (!queue.length) return;
    if (!alive()) { detach(); return; }
    const batch = queue;
    queue = [];
    chain = chain.then(() => mergeBatch(batch)).catch((err) => {
      if (!alive()) detach();
      else console.warn('[Explore Finds]', err);
    });
  };

  function onMessage(e) {
    if (e.source !== window || !e.data || e.data[TAG] !== true) return;
    if (!alive()) { detach(); return; }
    queue.push(e.data);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }
  window.addEventListener('message', onMessage);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { merge, mergeBatch, trackKey, areaOf, flush, FLUSH_MS };
  }
})();
