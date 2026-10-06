// CSV of everything captured, and a debug dump. Tokens are never exported.
import { postUrl } from './dom.js';
import { matchOf, inPlaylist } from './store.js';

function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvText(st) {
  const head = ['kind', 'title', 'artist', 'posts', 'explore_hits', 'first_seen', 'last_seen',
    'example_post', 'spotify_match', 'spotify_url', 'in_playlist'];
  const rows = Object.values(st.tracks)
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.first_seen - a.first_seen)
    .map((t) => {
      const m = matchOf(st, t);
      return [t.kind, t.title, t.artist, t.posts.length, (t.areas && t.areas.explore) || 0,
        new Date(t.first_seen).toISOString(), new Date(t.last_seen).toISOString(),
        t.posts[0] ? postUrl(t.posts[0]) : '',
        m ? (m.status === 'matched' ? `${m.name} / ${m.artists}` : 'not found') : '',
        m && m.url ? m.url : '', inPlaylist(st, t) ? 'yes' : ''];
    });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function debugText(st, extra = {}) {
  const { spotify, ...rest } = st; // never export tokens
  return JSON.stringify({ exported_at: new Date().toISOString(), ...extra, ...rest }, null, 2);
}

export function downloadCsv(st) {
  download(`explore-finds-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', csvText(st));
}

export function downloadDebug(st, extra) {
  download(`explore-finds-debug-${Date.now()}.json`, 'application/json', debugText(st, extra));
}
