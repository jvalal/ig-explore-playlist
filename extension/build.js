// Create the playlist, or add the songs found since the last build.
import * as S from './spotify.js';
import { pending, matchOf, noteAdded } from './store.js';

// "Explore finds, Oct 11, 2:30 PM": the time tells apart the playlists of one day.
export const defaultName = (d = new Date()) => `Explore finds, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ` +
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// report(text, isError) shows progress. Returns nothing; throws on Spotify errors.
export async function buildPlaylist({ store, queue, name, report }) {
  const { st } = store;
  const todo = pending(st);
  if (!todo.length) return;

  let i = 0;
  for (const t of todo) {
    i++;
    if (matchOf(st, t)) continue;
    report(`Finding songs on Spotify, ${i} of ${todo.length}…`);
    await queue.request(t, { urgent: true });
  }

  let pl = st.playlist;
  const have = new Set(pl ? pl.uris : []);
  const uris = [];
  const keys = [];
  const pairs = []; // [key, uri] of each song, for the record of what was ever added
  let missing = 0;
  for (const t of todo) {
    const m = matchOf(st, t);
    if (m && m.status === 'matched') {
      keys.push(t.key);
      pairs.push([t.key, m.uri]);
      if (!have.has(m.uri)) { have.add(m.uri); uris.push(m.uri); }
    } else missing++;
  }

  if (!keys.length) {
    report(`None of those ${missing} songs were found automatically. Use Choose on each to pick them.`, true);
    return;
  }

  if (!pl) {
    report('Creating the playlist…');
    const finalName = (name || '').trim() || defaultName();
    const created = await S.createPlaylist(finalName, 'Songs found on Instagram Explore, collected by Explore Finds.');
    pl = { id: created.id, url: created.url, name: finalName, keys: [], uris: [] };
    // Saved before adding songs: if adding fails, the next build adds to this playlist
    // instead of creating a second one.
    await store.set({ playlist: pl });
  }
  if (uris.length) {
    report('Adding songs to Spotify…');
    await S.addItems(pl.id, uris);
  }
  pl = { ...pl, keys: [...pl.keys, ...keys], uris: [...pl.uris, ...uris] };
  await store.set({ playlist: pl, added: noteAdded(st, pairs, pl.name) });

  const added = `Added ${uris.length} ${uris.length === 1 ? 'song' : 'songs'} to "${pl.name}".`;
  report(missing ? `${added} ${missing} need you to pick them with Choose.` : added);
}

// Auto-sync: adds songs that are already matched to the existing playlist. It never creates a
// playlist and never searches Spotify itself (background matching does that); unchecked songs
// and misses are skipped, as with Build. Returns how many songs were added.
export async function syncMatched({ store, report }) {
  const { st } = store;
  const pl = st.playlist;
  if (!pl) return 0;
  const have = new Set(pl.uris);
  const uris = [];
  const keys = [];
  const pairs = [];
  for (const t of pending(st)) {
    const m = matchOf(st, t);
    if (!m || m.status !== 'matched') continue;
    keys.push(t.key);
    pairs.push([t.key, m.uri]);
    if (!have.has(m.uri)) { have.add(m.uri); uris.push(m.uri); }
  }
  if (!keys.length) return 0;
  if (uris.length) await S.addItems(pl.id, uris);
  const latest = store.st.playlist;
  if (!latest || latest.id !== pl.id) return 0; // "Start a new playlist" was pressed meanwhile
  await store.set({ playlist: { ...latest, keys: [...latest.keys, ...keys], uris: [...latest.uris, ...uris] }, added: noteAdded(store.st, pairs, latest.name) });
  if (uris.length) report(`Added ${uris.length} new ${uris.length === 1 ? 'song' : 'songs'} to "${latest.name}".`);
  return uris.length;
}
