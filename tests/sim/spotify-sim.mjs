// Simulated Spotify: token endpoint, /me, /search, /me/playlists, /playlists/{id}/items.
// Access tokens are checked: a request with an unknown token gets 401.
export function makeSim(opts = {}) {
  const sim = {
    tracks: {},
    calls: [],
    tokenRequests: 0,
    validTokens: new Set(['t0']),
    tokenSeq: 0,
    rotateRefresh: !!opts.rotateRefresh,
    refreshToken: 'r0',
    rateLimitNext: 0,     // next N API calls get 429
    failAddItems: 0,      // next N add-items calls get 500
    tokenDelayMs: opts.tokenDelayMs ?? 20,
    playlists: {},
    searchOverride: null, // (q) => items | undefined
  };
  const json = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h] ?? null },
    json: async () => body,
  });

  sim.fetch = async (url, o = {}) => {
    const u = new URL(String(url));
    const m = o.method || 'GET';
    if (u.host === 'accounts.spotify.com' && u.pathname === '/api/token') {
      sim.tokenRequests++;
      await new Promise((r) => setTimeout(r, sim.tokenDelayMs));
      const body = new URLSearchParams(o.body);
      if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') !== sim.refreshToken) {
        sim.calls.push('token -> 400 invalid_grant');
        return json(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' });
      }
      const tok = `t${++sim.tokenSeq}`;
      sim.validTokens.add(tok);
      const res = { access_token: tok, expires_in: 3600, scope: 'playlist-modify-private playlist-modify-public' };
      if (sim.rotateRefresh) { sim.refreshToken = `r${sim.tokenSeq}`; res.refresh_token = sim.refreshToken; }
      sim.calls.push('token -> 200');
      return json(200, res);
    }

    const p = u.pathname.replace('/v1', '');
    const auth = (o.headers && o.headers.Authorization) || '';
    let res;
    if (sim.rateLimitNext > 0) {
      sim.rateLimitNext--;
      res = json(429, {}, { 'Retry-After': '0' });
    } else if (!sim.validTokens.has(auth.replace('Bearer ', ''))) {
      res = json(401, { error: { status: 401, message: 'The access token expired' } });
    } else if (p === '/me') {
      res = json(200, { id: 'jkidd', display_name: 'Jkidd' });
    } else if (p === '/search') {
      const q = u.searchParams.get('q');
      const over = sim.searchOverride && sim.searchOverride(q);
      const items = over || Object.values(sim.tracks)
        .filter((t) => q.toLowerCase().includes(t.name.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length);
      res = json(200, { tracks: { items } });
    } else if (p === '/me/playlists' && m === 'POST') {
      const id = `PL${Object.keys(sim.playlists).length + 1}`;
      sim.playlists[id] = { name: JSON.parse(o.body).name, uris: [] };
      res = json(201, { id, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` } });
    } else if (/^\/playlists\/[^/]+\/items$/.test(p) && m === 'POST') {
      const id = decodeURIComponent(p.split('/')[2]);
      if (sim.failAddItems > 0) {
        sim.failAddItems--;
        res = json(500, { error: { message: 'Spotify had a problem adding songs.' } });
      } else {
        sim.playlists[id].uris.push(...JSON.parse(o.body).uris);
        res = json(201, { snapshot_id: 's' });
      }
    } else res = json(404, {});
    sim.calls.push(`${m} ${p} -> ${res.status}`);
    return res;
  };

  sim.addTrack = (id, name, artist) => {
    sim.tracks[id] = {
      id, uri: `spotify:track:${id}`, name, artists: [{ name: artist }],
      album: { images: [{ url: `img-${id}` }] }, external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    };
  };
  return sim;
}

// A chrome.storage.local stand-in that reports real change records.
export function makeChromeStorage(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  const listeners = [];
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const fire = (changes) => { if (Object.keys(changes).length) listeners.forEach((l) => l(changes, 'local')); };
  const local = {
    sets: 0,
    get: async (keys) => {
      const ks = keys === undefined || keys === null ? Object.keys(data) : [].concat(keys);
      return Object.fromEntries(ks.filter((k) => k in data).map((k) => [k, clone(data[k])]));
    },
    set: async (o) => {
      local.sets++;
      const changes = {};
      for (const [k, v] of Object.entries(clone(o))) { changes[k] = { oldValue: data[k], newValue: v }; data[k] = v; }
      setTimeout(() => fire(changes), 5); // Chrome delivers change events asynchronously
    },
    remove: async (ks) => {
      const changes = {};
      for (const k of [].concat(ks)) if (k in data) { changes[k] = { oldValue: data[k] }; delete data[k]; }
      setTimeout(() => fire(changes), 5);
    },
  };
  return { data, local, onChanged: { addListener: (f) => listeners.push(f) } };
}
