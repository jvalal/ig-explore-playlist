// Receives captures from inject.js and merges them into extension storage.
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

  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const trackKey = (h) =>
    h.kind === 'song'
      ? `song|${norm(h.title)}|${norm(h.artist)}`
      : `orig|${h.audio_id || `${norm(h.title)}|${norm(h.artist)}`}`;

  const areaOf = (path) => {
    if (!path) return 'other';
    if (path.startsWith('/explore')) return 'explore';
    if (path.startsWith('/reels')) return 'reels';
    if (path.startsWith('/reel/') || path.startsWith('/p/')) return 'post';
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

  async function merge(msg) {
    const store = await chrome.storage.local.get(['tracks', 'log', 'samples']);
    const tracks = store.tracks || {};
    const log = store.log || [];
    const samples = store.samples || [];
    const area = areaOf(msg.page);

    for (const h of msg.hits || []) {
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
      area,
      url: shortUrl(msg.url),
      name: msg.name || null,
      relevant: !!msg.relevant,
      hits: (msg.hits || []).length,
    });
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);

    if (msg.sample && samples.length < MAX_SAMPLES) {
      samples.push({ at: msg.at, page: msg.page, url: msg.url, name: msg.name || null, text: msg.sample });
    }

    await chrome.storage.local.set({ tracks, log, samples });
  }

  // After the extension is reloaded, this copy of the script can no longer
  // reach storage. It steps aside quietly; background.js injects a fresh one.
  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  let chain = Promise.resolve();
  const onMessage = (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== true) return;
    if (!alive()) {
      window.removeEventListener('message', onMessage);
      return;
    }
    const msg = e.data;
    chain = chain.then(() => merge(msg)).catch((err) => {
      if (!alive()) window.removeEventListener('message', onMessage);
      else console.warn('[Explore Finds]', err);
    });
  };
  window.addEventListener('message', onMessage);

  if (typeof module !== 'undefined' && module.exports) module.exports = { merge, trackKey, areaOf };
})();
