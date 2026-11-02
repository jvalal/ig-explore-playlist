// Spotify Web API client for a personal development-mode app.
// Auth: Authorization Code with PKCE (no client secret needed); how the login window opens is
// platform-specific (platform.js).
// Endpoints follow Spotify's February 2026 revision:
//   POST /me/playlists, POST /playlists/{id}/items, GET /search (limit max 10),
//   PUT / DELETE /me/library and GET /me/library/contains (they replaced /me/tracks).

import * as P from './platform.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
// The library pair is for the "+" (save to Liked Songs) and was added in v0.9.0. Someone who
// connected before that has a token without it: canSave() is false until they connect once more.
const LIBRARY_SCOPES = ['user-library-modify', 'user-library-read'];
const SCOPES = ['playlist-modify-private', 'playlist-modify-public', ...LIBRARY_SCOPES].join(' ');
// Bump when matching changes, so songs an older matcher gave up on get another try.
export const MATCHER_VERSION = 3;

export const redirectUri = () => P.redirectUri();

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

function codedError(message, code) {
  const e = new Error(message);
  if (code) e.code = code;
  return e;
}

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
    // "invalid_client: Failed to get client": Spotify doesn't know this Client ID any more
    // (seen 2026-10-30, the app deleted or reset on Spotify). Reconnecting with it can't work.
    if (j.error === 'invalid_client') {
      const gone = codedError('Spotify doesn\'t recognise your Client ID any more. The app may have been deleted on Spotify. In Settings, press Start over and set up a new app.', 'INPUT');
      gone.refused = true;
      throw gone;
    }
    throw codedError(j.error_description || j.error || `Spotify login failed (${r.status}).`,
      j.error === 'invalid_grant' ? 'AUTH' : undefined);
  }
  const prev = await getAuth();
  return setAuth({
    access_token: j.access_token,
    // Spotify may rotate the refresh token; keep the old one only if it didn't send a new one.
    refresh_token: j.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    scope: j.scope || prev.scope || null,
  });
}

export async function connect() {
  const { clientId } = await getAuth();
  if (!clientId) throw codedError('Paste your Spotify Client ID first.', 'INPUT');
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

  let back;
  try {
    back = await P.launchAuth(url.toString());
  } catch (err) {
    // Chrome: "The user did not approve access." when the login window is closed, and
    // "Authorization page could not be loaded." when Spotify shows an error page instead.
    if (err && err.code) throw err; // the platform already said it in words (the iPhone build does)
    const text = (err && err.message) || '';
    if (/could not be loaded/i.test(text)) {
      // Seen for real (2026-10-11) with the Client ID of an app that had been deleted on Spotify.
      const refused = codedError('Spotify doesn\'t recognise this app. It may have been deleted, or it doesn\'t list the Redirect URI shown under "By hand". Create a new app, or fix this one, then connect again.', 'INPUT');
      refused.refused = true; // the setup steps go back to step 1
      throw refused;
    }
    throw codedError('The Spotify window was closed before it finished. Press Connect Spotify to try again.', 'INPUT');
  }
  const params = new URL(back).searchParams;
  const authError = params.get('error');
  if (authError) {
    const message = authError === 'access_denied'
      ? 'Spotify login was cancelled or denied. Try Connect again.'
      : authError === 'server_error'
        ? "Spotify didn't let this account in. If the app is yours, the account needs Spotify Premium. If someone gave you the key, ask them to add your Spotify email under User Management in their app."
        : `Spotify returned: ${authError}`;
    throw codedError(message, 'INPUT');
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

// One refresh at a time. Callers that need a token while a refresh is running wait for
// it instead of starting their own: with refresh-token rotation, a second parallel refresh
// could store a token that is already dead.
let refreshing = null;

// Returns a usable access token. `rejected` is a token the API just answered 401 to:
// it is never returned again, but if someone else already replaced it, that newer token is used.
async function accessToken(rejected = null) {
  if (refreshing) return (await refreshing).access_token;
  const a = await getAuth();
  if (refreshing) return (await refreshing).access_token;
  const fresh = a.access_token && a.expires_at - 60_000 > Date.now();
  if (fresh && a.access_token !== rejected) return a.access_token;
  if (!a.refresh_token) throw codedError('Connect Spotify first.', 'AUTH');
  refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh_token, client_id: a.clientId })
    .finally(() => { refreshing = null; });
  return (await refreshing).access_token;
}

// Recent API calls (method, path, status) for the debug export. Never holds tokens.
export const callLog = [];
const MAX_429_RETRIES = 4;
// Spotify's 429 says how long to wait (Retry-After). A few seconds: wait and try again. Longer
// means the app is being throttled (it can be many minutes): stop asking until then. Knocking
// during a limit keeps it in place, and each call used to wait up to 2 minutes, which left every
// pressed song on "Finding on Spotify…".
const SHORT_WAIT_S = 5;
// The time it ends is also kept in storage (key `spotifyLimit`): a panel opened later knows
// without asking Spotify again.
let limitedUntil = 0;
let limitLoaded = false;
export const rateLimitedFor = () => Math.max(0, Math.ceil((limitedUntil - Date.now()) / 1000)); // seconds left
export async function clearRateLimit() {
  limitedUntil = 0;
  await chrome.storage.local.remove('spotifyLimit').catch(() => {});
}
async function loadRateLimit() {
  if (limitLoaded) return;
  limitLoaded = true;
  const { spotifyLimit } = await chrome.storage.local.get('spotifyLimit').catch(() => ({}));
  if (Number(spotifyLimit) > limitedUntil) limitedUntil = Number(spotifyLimit);
}
function rateError() {
  const s = rateLimitedFor();
  const wait = s >= 5400 ? `about ${Math.round(s / 3600)} hours` : s >= 90 ? `about ${Math.round(s / 60)} minutes` : s > 1 ? `${s} seconds` : 'a moment';
  return codedError(`Spotify is limiting how often this app can ask. Try again in ${wait}. Songs already found still play.`, 'RATE');
}

// How much the app asks of Spotify per day (storage key `spotifyCounts`, by local date, last 14
// days), to learn where Spotify's limit is: it doesn't say. `limit` is the count when a long
// limit began. Temporary (v0.11.10); shown in the panel's header and in Debug data.
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let counting = Promise.resolve();
function count(change) {
  counting = counting.then(async () => {
    const { spotifyCounts = {} } = await chrome.storage.local.get('spotifyCounts');
    const day = dayKey();
    const c = spotifyCounts[day] || { requests: 0, searches: 0, songs: 0 };
    change(c);
    const days = Object.keys(spotifyCounts).filter((k) => k !== day).sort().slice(-13);
    await chrome.storage.local.set({ spotifyCounts: { ...Object.fromEntries(days.map((k) => [k, spotifyCounts[k]])), [day]: c } });
  }).catch(() => {});
  return counting;
}
export async function countsToday() {
  const { spotifyCounts = {} } = await chrome.storage.local.get('spotifyCounts').catch(() => ({}));
  return spotifyCounts[dayKey()] || { requests: 0, searches: 0, songs: 0 };
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  await loadRateLimit();
  if (rateLimitedFor()) throw rateError();
  let token = await accessToken();
  let refreshed = false;
  let waits = 0;
  let r;
  for (;;) {
    r = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    callLog.push({ at: Date.now(), method, path, status: r.status });
    if (callLog.length > 60) callLog.shift();
    await count((c) => { c.requests++; if (path === '/search') c.searches++; });

    if (r.status === 401 && !refreshed) {
      refreshed = true;
      token = await accessToken(token);
      continue;
    }
    if (r.status === 429) {
      const header = Number(r.headers.get('Retry-After'));
      const after = Number.isFinite(header) && header >= 0 ? header : 2;
      if (after > SHORT_WAIT_S) {
        limitedUntil = Date.now() + after * 1000;
        await chrome.storage.local.set({ spotifyLimit: limitedUntil }).catch(() => {});
        await count((c) => { c.limit = { at: Date.now(), retryAfter: after, requests: c.requests, searches: c.searches, songs: c.songs }; });
        throw rateError();
      }
      if (waits < MAX_429_RETRIES) {
        waits++;
        await sleep(after * 1000);
        continue;
      }
    }
    break;
  }

  if (r.status === 401) throw codedError('Spotify needs you to connect again.', 'AUTH');
  if (r.status === 403) {
    const j = await r.json().catch(() => ({}));
    if (/scope/i.test((j.error && j.error.message) || '')) throw codedError('Spotify needs one more permission for this. Connect Spotify again.', 'SCOPE');
    throw new Error('Spotify refused the request (403). In your Spotify developer app, check that your account is listed under User Management and that Premium is active.');
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw codedError((j.error && j.error.message) || `Spotify error ${r.status}.`, r.status === 404 ? 'NOT_FOUND' : undefined);
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ---------- Matching Instagram tracks to Spotify ----------

// Versions that are not the song the post used. A hit on one of these costs a lot.
const JUNK = /\b(karaoke|tribute|cover|nightcore|8d audio|made famous|originally performed)\b/;
// Real versions of the song (still acceptable), but the plain original should win.
// Remasters are treated as the same recording, so "remaster" is deliberately absent.
const VERSION = /\b(remix|mix|live|acoustic|sped up|slowed|reverb|instrumental|edit|extended|demo|unplugged|a cappella|acapella|re recorded)\b/g;
const JUNK_PENALTY = 0.5;
const VERSION_PENALTY = 0.1;

export function normalize(s) {
  return (s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const compact = (s) => normalize(s).replace(/ /g, '');
const words = (s) => s.split(' ').filter(Boolean);

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
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Whole-word containment: "artist 1" is not inside "artist 10".
const hasWords = (long, short) => !!short && ` ${long} `.includes(` ${short} `);

// One title inside the other only counts when the shorter one is substantial:
// at least two words and at least half the longer title. "love" is not "love me do".
function contains(a, b) {
  const [lo, sh] = words(a).length >= words(b).length ? [a, b] : [b, a];
  const ns = words(sh).length;
  return ns >= 2 && ns / words(lo).length >= 0.5 && hasWords(lo, sh);
}

function sameArtist(a, b) {
  if (a === b || a.replace(/ /g, '') === b.replace(/ /g, '')) return true;
  // "joy crookes" vs "joy crookes and the band", but not "future" vs "future islands"
  const [lo, sh] = a.length >= b.length ? [a, b] : [b, a];
  return sh.length >= 4 && sh.length / lo.length >= 0.6 && hasWords(lo, sh);
}

const versionWords = (s) => new Set(normalize(s).match(VERSION) || []);

// Penalty for a candidate that is a different version than the one on Instagram.
function versionPenalty(igTitle, candName) {
  const ig = normalize(igTitle);
  const cand = normalize(candName);
  if (JUNK.test(cand) && !JUNK.test(ig)) return JUNK_PENALTY;
  const igv = versionWords(igTitle);
  for (const w of versionWords(candName)) if (!igv.has(w)) return VERSION_PENALTY;
  return 0;
}

// Without an artist the title is the only evidence, so only an exact core-title match
// counts, and pickBest only considers the top search result (see there). In practice
// inject.js only reports songs that have display_artist, so this is a safety net.
const NO_ARTIST_SCORE = 0.75;

export function scoreCandidate(track, cand) {
  const ct = coreTitle(track.title);
  const cc = coreTitle(cand.name);
  let tScore;
  if (ct === cc || ct.replace(/ /g, '') === cc.replace(/ /g, '')) tScore = 1;
  else if (ct && cc && contains(ct, cc)) tScore = 0.8;
  else tScore = jaccard(ct, cc);

  const ig = splitArtists(track.artist);
  let s;
  if (!ig.length) {
    if (tScore < 1) return 0;
    s = NO_ARTIST_SCORE;
  } else {
    const sp = (cand.artists || []).map((a) => normalize(a.name));
    let aScore;
    if (ig.some((a) => sp.some((b) => sameArtist(a, b)))) aScore = 1;
    else aScore = jaccard(ig.join(' '), sp.join(' '));
    // A confirmed artist lets the title be looser; otherwise both must be solid.
    if (aScore === 1 ? tScore < 0.6 : (tScore < 0.7 || aScore < 0.67)) return 0;
    s = tScore * 0.6 + aScore * 0.4;
  }
  if (compact(cand.name) === compact(track.title)) s += 0.05; // exact version, e.g. the live cut
  return s - versionPenalty(track.title, cand.name);
}

const ACCEPT = 0.72;
// A match this good has the same core title, a confirmed artist and no version words,
// so no cleaner version can exist: further searches could only add the cosmetic +0.05
// exact-title bonus (for example "Song" over "Song - 2011 Remaster").
const CONFIDENT = 1;

export function pickBest(track, candidates) {
  const list = (candidates || []).filter((c) => c && c.uri);
  // No artist: only trust Spotify's own top result.
  const pool = splitArtists(track.artist).length ? list : list.slice(0, 1);
  let best = null;
  let bestScore = 0;
  for (const c of pool) {
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

export async function matchTrack(track, { pause = 100 } = {}) {
  let best = null;
  await count((c) => { c.songs++; });
  for (const [q, limit] of buildQueries(track)) {
    const res = await api('/search', { query: { q, type: 'track', limit: String(limit) } });
    const hit = pickBest(track, res && res.tracks && res.tracks.items);
    if (hit && (!best || hit.score > best.score)) best = hit;
    if (best && best.score >= CONFIDENT) break;
    if (pause) await sleep(pause);
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

// ---------- Library (Liked Songs) ----------

// Does this connection (storage key `spotify`) have the permission to save songs?
export const canSave = (auth) => {
  const granted = ((auth && auth.refresh_token && auth.scope) || '').split(' ');
  return LIBRARY_SCOPES.every((s) => granted.includes(s));
};
const library = (method, uri, path = '/me/library') => api(path, { method, query: { uris: uri } });
export const saveToLibrary = (uri) => library('PUT', uri);
export const removeFromLibrary = (uri) => library('DELETE', uri);
export const inLibrary = async (uri) => { const r = await library('GET', uri, '/me/library/contains'); return !!(r && r[0]); };

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
