// The panel's copy of chrome.storage.local. Loaded once, then kept current from
// storage.onChanged deltas (only the keys that changed), instead of re-reading everything
// on every capture the bridge writes.
export const KEYS = ['tracks', 'log', 'samples', 'matches', 'excluded', 'spotify', 'playlist'];

const DEFAULTS = {
  tracks: () => ({}),
  log: () => [],
  samples: () => [],
  matches: () => ({}),
  excluded: () => ({}),
  spotify: () => ({}),
  playlist: () => null,
};

export function createStore() {
  const st = Object.fromEntries(KEYS.map((k) => [k, DEFAULTS[k]()]));
  const listeners = new Set();
  const emit = (keys) => listeners.forEach((f) => f(keys));

  const put = (key, value) => {
    st[key] = value === undefined ? DEFAULTS[key]() : value;
  };

  // Our own writes come back through onChanged, possibly after we've already written a
  // newer value. Applying such an echo would briefly revert memory, and a write made in
  // that moment would lose data. So echoes of our own writes are recognized and skipped.
  const echoes = new Map(); // key -> JSON of values we wrote, oldest first
  const noteWrite = (key, value) => {
    const list = echoes.get(key) || [];
    list.push(JSON.stringify(value ?? null));
    if (list.length > 20) list.shift();
    echoes.set(key, list);
  };
  const isEcho = (key, value) => {
    const list = echoes.get(key);
    const i = list ? list.indexOf(JSON.stringify(value ?? null)) : -1;
    if (i < 0) return false;
    list.splice(0, i + 1);
    return true;
  };

  return {
    st,
    subscribe(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    async load() {
      const s = await chrome.storage.local.get(KEYS);
      for (const k of KEYS) put(k, s[k]);
      emit(new Set(KEYS));
    },
    // Wire after load(); applies only what changed.
    watch() {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const keys = new Set(Object.keys(changes)
          .filter((k) => KEYS.includes(k) && !isEcho(k, changes[k].newValue)));
        if (!keys.size) return;
        for (const k of keys) put(k, changes[k].newValue);
        emit(keys);
      });
    },
    // Updates memory first (so the UI reflects it at once), then storage.
    async set(patch) {
      for (const [k, v] of Object.entries(patch)) { put(k, v); noteWrite(k, v); }
      emit(new Set(Object.keys(patch)));
      await chrome.storage.local.set(patch);
    },
    async remove(keys) {
      for (const k of keys) { put(k, undefined); noteWrite(k, undefined); }
      emit(new Set(keys));
      await chrome.storage.local.remove(keys);
    },
  };
}

// ---------- derived views ----------

export const connected = (st) => !!(st.spotify && st.spotify.refresh_token);

// Newest finds first. first_seen never changes, so existing rows never reshuffle.
export function list(st, kind, { exploreOnly = false } = {}) {
  return Object.values(st.tracks)
    .filter((t) => t.kind === kind && (!exploreOnly || (t.areas && t.areas.explore)))
    .sort((a, b) => b.first_seen - a.first_seen || a.key.localeCompare(b.key));
}

export const matchOf = (st, t) => st.matches[t.key];
export const inPlaylist = (st, t) => !!(st.playlist && st.playlist.keys.includes(t.key));

// Songs the next Build would add.
export function pending(st, opts) {
  return list(st, 'song', opts).filter((t) => {
    const m = matchOf(st, t);
    return !st.excluded[t.key] && !inPlaylist(st, t) && !(m && m.status === 'none');
  });
}
