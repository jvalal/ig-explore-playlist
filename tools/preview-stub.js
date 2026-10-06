// Phone preview only (tools/preview-server.mjs): stands in for the extension APIs so the popup
// page can be opened as a normal web page. Sample songs; Spotify actions don't work here.
(() => {
  const now = Date.now();
  const song = (key, title, artist, i) => ({ key, kind: 'song', title, artist, first_seen: now - i * 60000, last_seen: now, posts: [{ code: `P${i}`, type: 'clips' }], areas: { explore: 1 } });
  const matched = (id, name, artists) => ({ status: 'matched', id, uri: `spotify:track:${id}`, name, artists, v: 3 });
  const data = {
    spotify: { clientId: 'preview', access_token: 'preview', refresh_token: 'preview', expires_at: now + 3.6e6, user: 'Preview' },
    tracks: {
      a: song('a', 'Cut To The Feeling', 'Carly Rae Jepsen', 1),
      b: song('b', 'Never Gonna Give You Up', 'Rick Astley', 2),
      c: song('c', 'I Might Fall', 'half.cool', 3),
    },
    matches: {
      a: matched('11dFghVXANMlKmJXsNCbNl', 'Cut To The Feeling', 'Carly Rae Jepsen'),
      b: matched('4uLU6hMCjMI75M1A2tKUQC', 'Never Gonna Give You Up', 'Rick Astley'),
      c: { status: 'none', v: 3 },
    },
    seen: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
    log: [{ at: now - 20000, page: '/explore/', area: 'explore', relevant: true, hits: 3, songs: 3 }],
    prefs: { goal: 10 },
    playlist: { id: 'preview', url: '#', name: 'Explore finds (preview)', keys: [], uris: [] },
  };
  // ?new shows what a first-time user sees: nothing captured, Spotify not connected.
  // The setup page always starts that way.
  if (new URLSearchParams(location.search).has('new') || location.pathname.endsWith('onboarding.html')) {
    for (const k of ['tracks', 'matches', 'seen', 'log', 'playlist', 'onboarding']) delete data[k];
    data.spotify = {};
    data.prefs = {};
  }
  const listeners = [];
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const fire = (changes) => setTimeout(() => listeners.forEach((l) => l(changes, 'local')), 5);
  const refuse = async () => { throw new Error('This is a preview: Spotify actions only work in the installed extension.'); };
  window.chrome = {
    storage: { local: {
      get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, clone(data[k])])),
      set: async (o) => { const c = {}; for (const [k, v] of Object.entries(clone(o))) { c[k] = { newValue: v }; data[k] = v; } fire(c); },
      remove: async (ks) => { const c = {}; for (const k of [].concat(ks)) { c[k] = {}; delete data[k]; } fire(c); },
    }, onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: {
      id: 'preview',
      getManifest: () => window.__PREVIEW_MANIFEST,
      getURL: (p) => `/${p}`,
      // Spotify login, faked: needs a Client ID, then "connects" after a moment.
      sendMessage: async (msg) => {
        if (!msg || msg.type !== 'ef-connect') return undefined;
        if (!(data.spotify && data.spotify.clientId)) return { error: 'Paste your Spotify Client ID first.', code: 'INPUT' };
        await new Promise((r) => setTimeout(r, 1200));
        await window.chrome.storage.local.set({ spotify: { ...data.spotify, access_token: 'preview', refresh_token: 'preview', expires_at: Date.now() + 3.6e6, user: 'Preview account' } });
        return { ok: true };
      },
    },
    tabs: { create: async ({ url }) => { location.href = url; } },
  };
  // No real Spotify account here: Web API calls fail with a plain message instead of a login loop.
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, o) => (/spotify\.com/.test(String(url)) ? refuse() : realFetch(url, o));
  addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.textContent = 'Preview on your phone: sample songs, real layout and player. Not the extension.';
    bar.style.cssText = 'position:sticky;top:0;z-index:9;padding:6px 12px;font:12px system-ui;background:#3346c9;color:#fff;text-align:center';
    document.body.prepend(bar);
  });
})();
