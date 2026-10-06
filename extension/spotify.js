// Spotify Web API client for a personal development-mode app.
// Auth: Authorization Code with PKCE via chrome.identity (no client secret needed).
// Endpoints follow Spotify's February 2026 revision:
//   POST /me/playlists, POST /playlists/{id}/items, GET /search (limit max 10).

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'playlist-modify-private playlist-modify-public';
export const MATCHER_VERSION = 2;
export const hasPlaybackScope = (auth) => !!(auth && auth.scope && auth.scope.includes('user-modify-playback-state'));

export const redirectUri = () => chrome.identity.getRedirectURL();

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (bytes = 48) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
};
const pkceChallenge = async (v) =>
  b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAuth() {
  return (await chrome.storage.local.get('spotify')).spotify || {};
}
async function setAuth(patch) {
  const next = { ...(await getAuth()), ...patch };
  await chrome.storage.local.set({ spotify: next });
  return next;
}

export async function saveClientId(id) {
  await setAuth({ clientId: id.trim(), access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null });
}

export async function disconnect() {
  await setAuth({ access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null });
}

async function tokenRequest(body) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || `Spotify login failed (${r.status}).`);
    if (j.error === 'invalid_grant') e.code = 'AUTH';
    throw e;
  }
  const prev = await getAuth();
  return setAuth({
    access_token: j.access_token,
    refresh_token: j.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    scope: j.scope || prev.scope || null,
  });
}

export async function connect() {
  const { clientId } = await getAuth();
  if (!clientId) {
    const e = new Error('Paste your Spotify Client ID first.');
    e.code = 'INPUT';
    throw e;
  }
  const verifier = randomString(48);
  const state = randomString(12);
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await pkceChallenge(verifier),
    state,
  }).toString();

  const back = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  const params = new URL(back).searchParams;
  const authError = params.get('error');
  if (authError) {
    const e = new Error(
      authError === 'server_error' || authError === 'access_denied'
        ? (authError === 'access_denied'
          ? 'Spotify login was cancelled or denied. Try Connect again.'
          : "Spotify rejected the login. In your Spotify app's settings, open User Management and add the email of the Spotify account you're logging in with, then try again.")
        : `Spotify returned: ${authError}`);
    e.code = 'INPUT';
    throw e;
  }
  if (params.get('state') !== state) throw new Error('Login response did not match. Try connecting again.');

  await tokenRequest({
    grant_type: 'authorization_code',
    code: params.get('code'),
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  const me = await api('/me');
  await setAuth({ user: me.display_name || me.id });
}

async function accessToken(force = false) {
  const a = await getAuth();
  if (!force && a.access_token && a.expires_at - 60_000 > Date.now()) return a.access_token;
  if (!a.refresh_token) {
    const e = new Error('Connect Spotify first.');
    e.code = 'AUTH';
    throw e;
  }
  const n = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh_token, client_id: a.clientId });
  return n.access_token;
}

export const callLog = [];

export async function api(path, { method = 'GET', body, query } = {}, attempt = 0) {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(attempt > 0 && api._lastWas401)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  api._lastWas401 = r.status === 401;
  callLog.push({ at: Date.now(), method, path: path + (query && query.device_id ? ' (to device)' : ''), status: r.status });
  if (callLog.length > 60) callLog.shift();

  if (r.status === 401 && attempt === 0) return api(path, { method, body, query }, 1);
  if (r.status === 429 && attempt < 4) {
    const wait = Math.min(30, Number(r.headers.get('Retry-After')) || 2);
    await sleep(wait * 1000);
    return api(path, { method, body, query }, attempt + 1);
  }
  const isPlayer = path.startsWith('/me/player');
  if (isPlayer && r.status === 404) {
    const e = new Error('Spotify has no active device for that command.');
    e.code = 'NO_DEVICE';
    throw e;
  }
  if (r.status === 403) {
    const e = new Error(isPlayer
      ? 'Spotify blocked playback control (403). This needs Premium on the connected account.'
      : 'Spotify refused the request (403). In your Spotify developer app, check that your account is listed under User Management and that Premium is active.');
    if (isPlayer) e.code = 'PLAYER_FORBIDDEN';
    throw e;
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j.error && j.error.message) || `Spotify error ${r.status}.`);
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ---------- Matching Instagram tracks to Spotify ----------

const JUNK = /\b(karaoke|tribute|cover|instrumental|sped up|slowed|nightcore|8d audio|made famous|originally performed)\b/;

export function normalize(s) {
  return (s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const compact = (s) => normalize(s).replace(/ /g, '');

// Title without (Album Version), [Remastered], " - Live", "feat. X".
export function coreTitle(s) {
  return normalize(
    (s || '')
      .replace(/\s*[([].*?[)\]]/g, '')
      .replace(/\s+-\s+.*$/, '')
      .replace(/\s+(feat|ft)\.?\s.*$/i, '')
  );
}

const rawCore = (s) =>
  (s || '').replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '')
    .replace(/\s+(feat|ft)\.?\s.*$/i, '').replace(/"/g, '').trim();

const ARTIST_SPLIT = /,|&|\s+x\s+|\s+(?:feat|ft)\.?\s+|\s+with\s+/i;
export const splitArtists = (s) => (s || '').split(ARTIST_SPLIT).map(normalize).filter(Boolean);
const rawArtists = (s) => (s || '').split(ARTIST_SPLIT).map((a) => a.replace(/"/g, '').trim()).filter(Boolean);

function jaccard(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Whole-word containment: "artist 1" is not inside "artist 10".
const hasWords = (long, short) => !!short && ` ${long} `.includes(` ${short} `);

function sameArtist(a, b) {
  if (a === b || a.replace(/ /g, '') === b.replace(/ /g, '')) return true;
  // "joy crookes" vs "joy crookes and the band", but not "future" vs "future islands"
  const [lo, sh] = a.length >= b.length ? [a, b] : [b, a];
  return sh.length >= 4 && sh.length / lo.length >= 0.6 && hasWords(lo, sh);
}

export function scoreCandidate(track, cand) {
  const ct = coreTitle(track.title);
  const cc = coreTitle(cand.name);
  let tScore;
  if (ct === cc || ct.replace(/ /g, '') === cc.replace(/ /g, '')) tScore = 1;
  else if (ct && cc && (hasWords(ct, cc) || hasWords(cc, ct))) tScore = 0.8;
  else tScore = jaccard(ct, cc);

  const ig = splitArtists(track.artist);
  const sp = (cand.artists || []).map((a) => normalize(a.name));
  let aScore;
  if (!ig.length) aScore = tScore === 1 ? 0.6 : 0;
  else if (ig.some((a) => sp.some((b) => sameArtist(a, b)))) aScore = 1;
  else aScore = jaccard(ig.join(' '), sp.join(' '));

  // A confirmed artist lets the title be looser; otherwise both must be solid.
  if (aScore === 1 ? tScore < 0.6 : (tScore < 0.7 || aScore < 0.67)) return 0;
  let s = tScore * 0.6 + aScore * 0.4;
  if (compact(cand.name) === compact(track.title)) s += 0.05; // exact version, e.g. the live cut
  if (JUNK.test(normalize(cand.name)) && !JUNK.test(normalize(track.title))) s -= 0.5;
  return s;
}

const ACCEPT = 0.72;

export function pickBest(track, candidates) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates || []) {
    if (!c || !c.uri) continue;
    const s = scoreCandidate(track, c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return bestScore >= ACCEPT ? { track: best, score: bestScore } : null;
}

const toMatch = (t, extra = {}) => {
  const imgs = (t.album && t.album.images) || [];
  return {
    status: 'matched',
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    image: imgs.length ? imgs[imgs.length - 1].url : null,
    url: t.external_urls && t.external_urls.spotify,
    at: Date.now(),
    v: MATCHER_VERSION,
    ...extra,
  };
};

// Several passes, from strict to broad. Stops early on a confident match,
// otherwise keeps the best candidate seen across every pass.
export function buildQueries(track) {
  const title = rawCore(track.title) || track.title.replace(/"/g, '');
  const artists = rawArtists(track.artist);
  const q = [];
  if (artists[0]) {
    q.push([`track:"${title}" artist:"${artists[0]}"`, 5]);
    q.push([`${title} ${artists[0]}`, 10]);
  }
  for (const a of artists.slice(1, 3)) q.push([`track:"${title}" artist:"${a}"`, 5]);
  if (title !== track.title && artists[0]) q.push([`${track.title.replace(/"/g, '')} ${artists[0]}`, 10]);
  q.push([title, 10]);
  const seen = new Set();
  return q.filter(([s]) => (seen.has(s) ? false : seen.add(s)));
}

export async function matchTrack(track) {
  let best = null;
  for (const [q, limit] of buildQueries(track)) {
    const res = await api('/search', { query: { q, type: 'track', limit: String(limit) } });
    const hit = pickBest(track, res && res.tracks && res.tracks.items);
    if (hit && (!best || hit.score > best.score)) best = hit;
    if (best && best.score >= 0.95) break;
    await sleep(100);
  }
  return best ? toMatch(best.track) : { status: 'none', at: Date.now(), v: MATCHER_VERSION };
}

// For picking a match by hand when automatic matching misses.
export async function searchCandidates(track) {
  const title = rawCore(track.title) || track.title.replace(/"/g, '');
  const artist = rawArtists(track.artist)[0] || '';
  const out = new Map();
  for (const q of [`${title} ${artist}`.trim(), title]) {
    const res = await api('/search', { query: { q, type: 'track', limit: '10' } });
    for (const t of (res && res.tracks && res.tracks.items) || []) if (t && t.id && !out.has(t.id)) out.set(t.id, t);
  }
  return [...out.values()]
    .sort((a, b) => scoreCandidate(track, b) - scoreCandidate(track, a))
    .slice(0, 8)
    .map((t) => toMatch(t, { manual: true }));
}

// ---------- Playlists ----------

export async function createPlaylist(name, description) {
  const p = await api('/me/playlists', { method: 'POST', body: { name, description, public: false } });
  return { id: p.id, url: p.external_urls && p.external_urls.spotify };
}

export async function addItems(playlistId, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: 'POST',
      body: { uris: uris.slice(i, i + 100) },
    });
  }
}

// ---------- Playback on the user's Spotify devices (Premium) ----------
// Spotify Connect helpers (not used by the in-panel player; kept for reference).
// Every command names its device explicitly; the old player.js handled
// waking the device and confirming that audio really started.

const dq = (deviceId) => (deviceId ? { device_id: deviceId } : undefined);

export async function getDevices() {
  const r = await api('/me/player/devices');
  return (r && r.devices) || [];
}
export const getPlaybackState = () => api('/me/player');
export const transferPlayback = (deviceId, play = false) =>
  api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } });
export const playUris = (uris, deviceId) =>
  api('/me/player/play', { method: 'PUT', query: dq(deviceId), body: { uris } });
export const playContext = (contextUri, deviceId) =>
  api('/me/player/play', { method: 'PUT', query: dq(deviceId), body: { context_uri: contextUri } });
export const resume = (deviceId) => api('/me/player/play', { method: 'PUT', query: dq(deviceId) });
export const pause = (deviceId) => api('/me/player/pause', { method: 'PUT', query: dq(deviceId) });
export const next = (deviceId) => api('/me/player/next', { method: 'POST', query: dq(deviceId) });
export const previous = (deviceId) => api('/me/player/previous', { method: 'POST', query: dq(deviceId) });
