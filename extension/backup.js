// Back up and restore everything in chrome.storage.local except the Spotify login, so a lost or
// reinstalled extension (or the store copy, which has its own storage) can get its list back.
export const APP = 'explore-playlist-gen-backup';
const FORMAT = 1;
export const WEEK = 7 * 24 * 3600 * 1000;
export const LAST_KEY = 'lastBackupAt'; // when the last backup file was saved (not itself backed up)

// What each kept key holds, and so how a restore merges it. Keys not listed (nowPlaying, popIn,
// panelWindowId: who is playing / which window is open right now) are neither saved nor restored.
const MAPS = ['tracks', 'matches', 'excluded', 'spotifyCounts']; // { id: entry }, merged per entry
const LISTS = ['log', 'samples', 'seen', 'playerTrace'];          // arrays, merged as a union
const VALUES = ['playlist', 'playlistUndo', 'prefs', 'spotifyLimit', 'welcomed', 'setupSeen']; // kept as a whole
export const BACKUP_KEYS = [...MAPS, ...LISTS, ...VALUES, 'added', 'spotify'];

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const empty = (v) => v === undefined || v === null || (isMap(v) && !Object.keys(v).length) || (Array.isArray(v) && !v.length);
// When an entry was last true: a track's last sighting, else its `at` (matches, added, limits).
const stamp = (e) => (isMap(e) && (Number(e.last_seen) || Number(e.at))) || 0;

// Tokens never leave the browser; the Client ID (not a secret) comes along, so a restored copy
// only needs Connect.
export function makeBackup(all, version) {
  const data = {};
  for (const k of BACKUP_KEYS) if (all[k] !== undefined) data[k] = all[k];
  data.spotify = all.spotify && all.spotify.clientId ? { clientId: all.spotify.clientId } : {};
  return { app: APP, format: FORMAT, version, exported_at: new Date().toISOString(), data };
}

// A file from disk is untrusted: refuse anything that isn't our backup, and drop entries the
// panel couldn't render. Throws with a sentence for the person.
export function readBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch (_) { throw new Error("That file isn't a backup (it isn't JSON)."); }
  if (!b || b.app !== APP || !isMap(b.data)) throw new Error("That file isn't an Explore Playlist Gen backup.");
  if (b.format > FORMAT) throw new Error('That backup is from a newer version. Update the extension first.');
  const data = {};
  for (const k of MAPS) if (isMap(b.data[k])) data[k] = b.data[k];
  for (const k of LISTS) if (Array.isArray(b.data[k])) data[k] = b.data[k];
  for (const k of VALUES) if (b.data[k] !== undefined) data[k] = b.data[k];
  if (isMap(b.data.added)) data.added = { keys: isMap(b.data.added.keys) ? b.data.added.keys : {}, uris: isMap(b.data.added.uris) ? b.data.added.uris : {} };
  if (data.tracks) data.tracks = Object.fromEntries(Object.entries(data.tracks).filter(([key, t]) => validTrack(key, t)));
  const id = b.data.spotify && b.data.spotify.clientId;
  if (typeof id === 'string' && /^[0-9a-f]{32}$/i.test(id)) data.spotify = { clientId: id };
  return data;
}

const validTrack = (key, t) => isMap(t) && t.key === key && typeof t.kind === 'string' && typeof t.title === 'string' &&
  Array.isArray(t.posts) && Number.isFinite(t.first_seen) && Number.isFinite(t.last_seen);

// Entry by entry, the newer one wins; on a tie (or no time to compare) what is here stays.
function mergeMap(cur, inc) {
  const out = { ...(isMap(cur) ? cur : {}) };
  for (const [id, e] of Object.entries(inc)) if (!(id in out) || stamp(e) > stamp(out[id])) out[id] = e;
  return out;
}

function mergeList(cur, inc) {
  const base = Array.isArray(cur) ? cur : [];
  const have = new Set(base.map((x) => JSON.stringify(x)));
  return [...base, ...inc.filter((x) => !have.has(JSON.stringify(x)))];
}

// cur: storage as it is now. inc: readBackup's result. Returns the keys to write.
export function mergeBackup(cur, inc) {
  const out = {};
  for (const k of MAPS) if (inc[k]) out[k] = mergeMap(cur[k], inc[k]);
  for (const k of LISTS) if (inc[k]) out[k] = mergeList(cur[k], inc[k]);
  for (const k of VALUES) {
    if (empty(inc[k])) continue;
    if (empty(cur[k]) || stamp(inc[k]) > stamp(cur[k])) out[k] = inc[k];
  }
  if (inc.added) {
    const a = isMap(cur.added) ? cur.added : {};
    out.added = { keys: mergeMap(a.keys, inc.added.keys), uris: mergeMap(a.uris, inc.added.uris) };
  }
  // A Client ID already here stays (it may be connected); the login itself is never restored.
  if (inc.spotify && !(cur.spotify && cur.spotify.clientId)) out.spotify = { ...(cur.spotify || {}), clientId: inc.spotify.clientId };
  return out;
}

export const backupName = (d = new Date()) => `explore-playlist-gen-backup-${d.toISOString().slice(0, 10)}.json`;

// Saved straight into Downloads, no Save dialog (chrome.downloads), so the weekly one is silent.
export async function saveBackup() {
  const all = await chrome.storage.local.get(BACKUP_KEYS);
  const text = JSON.stringify(makeBackup(all, chrome.runtime.getManifest().version));
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  // Marked first, so another panel page (another window) seeing the same capture doesn't save a
  // second file; put back if the download fails, so the weekly one tries again.
  const { [LAST_KEY]: before = 0 } = await chrome.storage.local.get(LAST_KEY);
  await chrome.storage.local.set({ [LAST_KEY]: Date.now() });
  try {
    await chrome.downloads.download({ url, filename: backupName(), conflictAction: 'uniquify', saveAs: false });
  } catch (err) {
    await chrome.storage.local.set({ [LAST_KEY]: before });
    throw err;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return Object.keys(all.tracks || {}).length;
}

// The weekly one: only when there is something to keep and the last is a week old. One at a
// time, so two captures arriving together don't save two files.
let due = null;
export function backupIfDue(hasData, now = Date.now()) {
  if (!hasData) return Promise.resolve(false);
  due = due || chrome.storage.local.get(LAST_KEY)
    .then(({ [LAST_KEY]: last = 0 }) => (now - last < WEEK ? false : saveBackup().then(() => true)))
    .finally(() => { due = null; });
  return due;
}

export async function restoreBackup(text) {
  const inc = readBackup(text);
  const cur = await chrome.storage.local.get(BACKUP_KEYS);
  const patch = mergeBackup(cur, inc);
  await chrome.storage.local.set(patch);
  const songs = (t) => Object.values(t || {}).filter((x) => x.kind === 'song').length;
  const after = songs(patch.tracks || cur.tracks);
  return { songs: after, added: after - songs(cur.tracks) };
}
