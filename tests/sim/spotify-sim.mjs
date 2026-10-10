// Simulated Spotify: token endpoint, /me, /search, /me/playlists, /playlists/{id}/items,
// /me/library (save, remove, contains).
// A library call without the library permission gets 403, like a token granted before it existed.
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
    library: new Set(),   // saved URIs (Liked Songs)
    scope: opts.scope ?? 'playlist-modify-private playlist-modify-public',
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
      // A new login grants what the app asks for; a refresh keeps what was granted.
      if (body.get('grant_type') === 'authorization_code' && sim.grantOnLogin) sim.scope = sim.grantOnLogin;
      const res = { access_token: tok, expires_in: 3600, scope: sim.scope };
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
    } else if (p === '/me/library' || p === '/me/library/contains') {
      const uris = (u.searchParams.get('uris') || '').split(',').filter(Boolean);
      const need = m === 'GET' ? 'user-library-read' : 'user-library-modify';
      if (!sim.scope.split(' ').includes(need)) res = json(403, { error: { status: 403, message: 'Insufficient client scope' } });
      else if (!uris.length || uris.length > 40) res = json(400, { error: { message: 'Bad uris' } });
      else if (p.endsWith('/contains') && m === 'GET') res = json(200, uris.map((x) => sim.library.has(x)));
      else if (m === 'PUT') { uris.forEach((x) => sim.library.add(x)); res = json(200, null); }
      else if (m === 'DELETE') { uris.forEach((x) => sim.library.delete(x)); res = json(200, null); }
      else res = json(404, {});
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
