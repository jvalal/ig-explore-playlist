// Simulates Spotify Connect behavior that matters here:
// - commands without device_id fail with 404 when no device is active
// - play with device_id to an INACTIVE device is "accepted" (202) but often doesn't start
// - transfer (PUT /me/player) activates a device after a short delay
// - GET /me/player returns 204 when nothing is active
export function makeSim(opts = {}) {
  const sim = {
    devices: opts.devices || [
      { id: 'phone', name: "Jason's iPhone", type: 'Smartphone', is_active: false, is_restricted: false, volume_percent: 70 },
      { id: 'mac', name: 'MacBook Pro', type: 'Computer', is_active: false, is_restricted: false, volume_percent: 60 },
    ],
    active: null, playing: false, list: [], idx: 0, calls: [],
    inactivePlayStarts: !!opts.inactivePlayStarts,
    startDelayMs: opts.startDelayMs || 0,          // desktop app slow to actually start
    needsTransferPlay: !!opts.needsTransferPlay,   // play accepted, only starts on transfer {play:true}
    stateIdSuffix: opts.stateIdSuffix || '',       // /me/player reports a different id for the same device
    rateLimitStateEvery: opts.rateLimitStateEvery || 0, // every Nth GET /me/player -> 429
    loaded: false, stateReads: 0, failPlay: !!opts.failPlay,
    stateEmptyUntilLoaded: !!opts.stateEmptyUntilLoaded, // /me/player says 204 after a transfer until something is loaded
    tracks: {},
  };
  const json = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
  const dev = (id) => sim.devices.find((d) => d.id === id);
  const item = () => {
    const k = sim.list[sim.idx];
    if (k && k.startsWith('ctx:')) return { uri: 'spotify:track:pl1', name: 'Playlist Track 1', artists: [{ name: 'Various' }], album: { images: [] } };
    return sim.tracks[k] || null;
  };
  sim.fetch = async (url, o = {}) => {
    const u = new URL(String(url));
    const m = o.method || 'GET';
    const body = o.body ? JSON.parse(o.body) : null;
    const did = u.searchParams.get('device_id');
    const p = u.pathname.replace('/v1', '');
    let res;
    const startLater = () => { sim.loaded = true; if (sim.needsTransferPlay) return; if (sim.startDelayMs) setTimeout(() => { sim.playing = true; }, sim.startDelayMs); else sim.playing = true; };
    if (p === '/me/player' && m === 'GET' && sim.rateLimitStateEvery && ++sim.stateReads % sim.rateLimitStateEvery === 0) {
      sim.calls.push(`${m} ${p} -> 429`);
      return { ok: false, status: 429, headers: { get: (h) => (h === 'Retry-After' ? '2' : null) }, json: async () => ({}) };
    }
    if (p === '/me/player/devices') res = json(200, { devices: sim.devices.map((d) => ({ ...d, is_active: d.id === sim.active })) });
    else if (p === '/me/player' && m === 'GET') {
      const ctx = (sim.list[0] || '').startsWith('ctx:') ? { uri: sim.list[0].slice(4) } : null;
      res = (sim.active && !(sim.stateEmptyUntilLoaded && !sim.loaded && !sim.playing)) ? json(200, { context: ctx, is_playing: sim.playing, device: { ...dev(sim.active), id: dev(sim.active).id + sim.stateIdSuffix, is_active: true }, item: item() }) : json(204, null);
    } else if (p === '/me/player' && m === 'PUT') {
      const id = body.device_ids[0];
      const realId = id.replace(sim.stateIdSuffix || '\u0000', '');
      if (!dev(realId).asleep) setTimeout(() => { sim.active = realId; if (body.play === false) sim.playing = false; if (body.play === true && sim.loaded) sim.playing = true; }, 400);
      res = json(204, null);
    } else if (p === '/me/player/play') {
      const target = did || sim.active;
      if (!target) res = json(404, { error: { message: 'Player command failed: No active device found' } });
      else if (target !== sim.active && !sim.inactivePlayStarts) res = json(202, null); // accepted, nothing happens
      else if (sim.failPlay) res = json(204, null); // claims success, stays silent
      else {
        sim.active = target;
        if (body && body.uris) { sim.list = body.uris; sim.idx = 0; }
        if (body && body.context_uri) { sim.list = ['ctx:' + body.context_uri]; sim.idx = 0; }
        if (body) startLater(); else if (!sim.needsTransferPlay) sim.playing = true;
        res = json(204, null);
      }
    } else if (['/me/player/pause', '/me/player/next', '/me/player/previous'].includes(p)) {
      const target = did || sim.active;
      if (!target || target !== sim.active) res = json(404, { error: { message: 'Player command failed: No active device found' } });
      else {
        if (p.endsWith('pause')) sim.playing = false;
        if (p.endsWith('next') && sim.idx < sim.list.length - 1) sim.idx++;
        if (p.endsWith('previous') && sim.idx > 0) sim.idx--;
        res = json(204, null);
      }
    } else if (p === '/me/player/currently-playing') {
      res = sim.active ? json(200, { is_playing: sim.playing, item: item() }) : json(204, null);
    } else if (p === '/search') {
      const q = u.searchParams.get('q');
      const hit = Object.values(sim.tracks).filter((t) => q.includes(t.name)).sort((a, b) => b.name.length - a.name.length)[0];
      res = json(200, { tracks: { items: hit ? [hit] : [] } });
    } else res = json(404, {});
    sim.calls.push(`${m} ${p}${did ? '?device_id=' + did : ''} -> ${res.status}`);
    return res;
  };
  sim.addTrack = (id, name, artist) => {
    sim.tracks['spotify:track:' + id] = { id, uri: 'spotify:track:' + id, name, artists: [{ name: artist }], album: { images: [{ url: 'img-' + id }] }, external_urls: { spotify: 'u' } };
  };
  return sim;
}
