// Side panel controller: wires storage, the list, matching, playback and the playlist together.
import * as S from './spotify.js';
import { $, setMsg, ago, EXPLORE_URL } from './dom.js';
import { createStore, connected, list, matchOf, pending } from './store.js';
import { MatchQueue } from './match-queue.js';
import { renderList, resetList } from './list.js';
import { buildPlaylist, syncMatched, defaultName } from './build.js';
import { renderGoal } from './goal.js';
import { renderSetup, wireSetup, openSetup } from './setup.js';
import { downloadCsv, downloadDebug } from './exports.js';
import { Player } from './player.js';
import { Playback } from './playback.js';

const store = createStore();
const { st } = store;

const ui = {
  busy: false,                       // building a playlist
  picker: { key: null, items: null }, // manual-match picker (items null while loading)
};

const songs = () => list(st, 'song');

// ---------- errors ----------
const EXPECTED = new Set(['AUTH', 'INPUT']);
function handleError(err) {
  if (!(err && EXPECTED.has(err.code))) console.warn('[Explore Finds]', err);
  if (err && err.code === 'AUTH') {
    openSetup();
    setMsg('Spotify needs you to connect again.', true);
  } else {
    setMsg((err && err.message) || 'Something went wrong.', true);
  }
}

// ---------- matching ----------
const queue = new MatchQueue({
  getMatch: (key) => st.matches[key],
  setMatch: (key, m) => store.set({ matches: { ...st.matches, [key]: m } }),
  match: (t) => S.matchTrack(t),
  onChange: () => render(),
  onError: (err) => { if (err.code === 'AUTH') handleError(err); },
});

// While the panel is open, quietly match new songs (newest first) so Play is instant
// and misses show up early.
function prematch() {
  if (connected(st)) queue.background(songs());
}

// ---------- playback ----------
let lastShown = '';
const player = new Player($('#dock-frame'), {
  // Position reports arrive several times a second; only a status or song change needs a render.
  onChange: (state) => {
    if (state.status === 'playing') $('#dock-hint').textContent = ''; // e.g. pressed play in the player
    const shown = `${state.type}|${state.trackId}|${state.status}`;
    
    if (shown === lastShown) return;
    lastShown = shown;
    render();
  },
  onEnded: () => startSong(() => playback.step(1)),
});

const playback = new Playback({
  player,
  getSongs: songs,
  getMatch: (t) => matchOf(st, t),
  request: (t) => queue.request(t, { urgent: true }),
  onChange: () => render(),
  onNotFound: (t) => setMsg(`Couldn't find "${t.title}" automatically. Use Choose to pick it.`, true),
});

// Only speaks up when starting failed. In real Chrome the side panel may start the
// embed without a fresh click (verified 2026-10-05), so there is no blanket tip.
const START_HINTS = {
  blocked: 'It didn\'t start. Press play in the player once.',
  error: 'The Spotify player didn\'t load. Try Play again.',
};
function showStartHint(status) {
  $('#dock-hint').textContent = START_HINTS[status] || '';
}

async function startSong(run) {
  if (!connected(st)) {
    openSetup();
    setMsg('Connect Spotify to play songs here.', true);
    return;
  }
  $('#dock-hint').textContent = '';
  try {
    const status = await run();
    if (status && status !== 'none' && status !== 'superseded') showStartHint(status);
  } catch (err) {
    handleError(err);
  }
}

// ---------- mini player (pop-out window) ----------
// While it's open it is the only player: Play presses go there as messages, and the rows show
// what it reports in storage (`nowPlaying`). The docked player stays closed meanwhile.
let miniOpen = false;
async function readMini() {
  try {
    miniOpen = !!(await chrome.storage.session.get('miniWindowId')).miniWindowId;
  } catch (_) {
    miniOpen = false;
  }
  render();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && 'miniWindowId' in changes) readMini();
});
const remote = () => (miniOpen && st.nowPlaying && st.nowPlaying.host === 'mini' ? st.nowPlaying : null);
const tellMini = (cmd, key) => {
  if (miniOpen) chrome.runtime.sendMessage({ type: 'ef-player', cmd, key }).catch(() => {});
};

function remoteRowState(t) {
  const np = remote();
  if (!np || np.playlist || np.key !== t.key) return { label: 'Play', on: false, disabled: false };
  if (np.status === 'loading') return { label: 'Starting…', on: false, disabled: true };
  if (np.status === 'playing') return { label: 'Playing', on: true, disabled: false };
  if (np.status === 'paused') return { label: 'Paused', on: false, disabled: false };
  return { label: 'Play', on: false, disabled: false };
}
function remotePlaylistState() {
  const np = remote();
  if (!np || !np.playlist) return { label: 'Play', disabled: false };
  return { loading: { label: 'Starting…', disabled: true }, playing: { label: 'Pause', disabled: false },
    paused: { label: 'Resume', disabled: false } }[np.status] || { label: 'Play', disabled: false };
}

function playRow(t) {
  if (!miniOpen) return startSong(() => playback.click(t));
  if (!connected(st)) return startSong(async () => undefined); // shows the connect prompt
  const np = remote();
  return tellMini(np && !np.playlist && np.key === t.key ? 'toggle' : 'play', t.key);
}

// Back to panel (from the mini player): it leaves `popIn` in storage and closes itself; the
// panel in that window picks the song up in its docked player once the mini window is gone.
async function takePopIn() {
  const { popIn } = await chrome.storage.local.get('popIn');
  if (!popIn || Date.now() - popIn.at > 15000) return;
  const me = await chrome.windows.getCurrent();
  if (popIn.windowId && popIn.windowId !== me.id) return;
  await chrome.storage.local.remove('popIn');
  for (let i = 0; i < 30 && miniOpen; i++) await new Promise((r) => setTimeout(r, 100));
  if (popIn.playlist && st.playlist) return startSong(() => playback.clickPlaylist(st.playlist));
  const t = songs().find((x) => x.key === popIn.key);
  return t ? startSong(() => playback.playSong(t, { startAt: popIn.startAt || 0 })) : undefined;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.popIn && changes.popIn.newValue) takePopIn();
});

async function popOut() {
  // The song continues where it is (startAt); a playlist starts again from its first song.
  const what = playback.playlistLoaded ? { playlist: true }
    : { key: playback.key || playback.wantKey, startAt: playback.player.currentSeconds() };
  if (!what.playlist && !what.key) return;
  stopPlayback(); // one player at a time
  const win = await chrome.windows.getCurrent();
  const r = await chrome.runtime.sendMessage({ type: 'ef-open-mini', ...what, from: win.id });
  if (r && r.error) setMsg(`Couldn't open the mini player: ${r.error}`, true);
}

function stopPlayback() {
  playback.stop();
  $('#dock-hint').textContent = '';
}

function renderDock() {
  const on = !miniOpen && !!(playback.key || playback.wantKey || playback.playlistLoaded);
  $('#dock').hidden = !on;
  if (!on) return;
  if (playback.playlistLoaded && !playback.wantKey) {
    $('#dock-pos').textContent = 'Playlist';
    $('#dock-prev').disabled = true;
    $('#dock-next').disabled = true;
    return;
  }
  const { i, n } = playback.position();
  $('#dock-pos').textContent = i >= 0 ? `${i + 1} of ${n}` : '';
  $('#dock-prev').disabled = i <= 0;
  $('#dock-next').disabled = i < 0 || i >= n - 1;
}

$('#dock-prev').addEventListener('click', () => startSong(() => playback.step(-1)));
$('#dock-next').addEventListener('click', () => startSong(() => playback.step(1)));
$('#dock-close').addEventListener('click', stopPlayback);
$('#pl-play').addEventListener('click', () => {
  if (!st.playlist) return;
  if (miniOpen) tellMini('playlist');
  else startSong(() => playback.clickPlaylist(st.playlist));
});
$('#dock-popout').addEventListener('click', popOut);

// ---------- picker ----------
async function togglePicker(t) {
  if (ui.picker.key === t.key) {
    ui.picker = { key: null, items: null };
    render();
    return;
  }
  ui.picker = { key: t.key, items: null };
  render();
  try {
    const items = await S.searchCandidates(t);
    if (ui.picker.key === t.key) {
      ui.picker = { key: t.key, items };
      render();
    }
  } catch (err) {
    ui.picker = { key: null, items: null };
    handleError(err);
    render();
  }
}

async function useCandidate(t, c) {
  ui.picker = { key: null, items: null };
  await store.set({ matches: { ...st.matches, [t.key]: c } });
  setMsg(`Matched "${t.title}" to ${c.name} by ${c.artists}.`);
}

// ---------- rendering ----------
const PLAY_ICON = 'M2 1l7 4-7 4z';
const PAUSE_ICON = 'M2 1h2.2v8H2zM5.8 1H8v8H5.8z';

function renderBuild() {
  const pl = st.playlist;
  const n = pending(st).length;
  $('#build-new').hidden = !!pl;
  $('#build-existing').hidden = !pl;
  $('#pl-new').hidden = !pl;
  if (pl) {
    $('#pl-link').textContent = pl.name;
    $('#pl-link').href = pl.url || '#';
    const p = miniOpen ? remotePlaylistState() : playback.playlistState();
    $('#pl-play span').textContent = p.label;
    $('#pl-play path').setAttribute('d', p.label === 'Pause' ? PAUSE_ICON : PLAY_ICON);
    $('#pl-play').disabled = p.disabled;
    $('#auto-sync').checked = !!st.prefs.autoSync;
    $('#pl-play').setAttribute('aria-label', `${p.label} playlist ${pl.name}`);
  }
  if (!$('#pl-name').value) $('#pl-name').value = defaultName();

  const btn = $('#build-btn');
  if (!connected(st)) {
    btn.textContent = 'Connect Spotify to build a playlist';
    btn.disabled = ui.busy;
  } else if (pl) {
    btn.textContent = n ? `Add ${n} new ${n === 1 ? 'song' : 'songs'}` : 'No new songs yet';
    btn.disabled = ui.busy || !n;
  } else {
    btn.textContent = n ? `Create playlist with ${n} ${n === 1 ? 'song' : 'songs'}` : 'No songs to add yet';
    btn.disabled = ui.busy || !n;
  }
}

function renderStatus() {
  // Posts, not responses: one response carries many posts. Posts behind listed songs count
  // too (finds saved before v0.6.11 have no `seen` entries), so posts ≥ songs.
  const log = (st.log || []).filter((l) => l.area === 'explore');
  const songs = list(st, 'song');
  if (!log.length && !songs.length) { $('#status').textContent = 'Waiting for Instagram Explore'; return; }
  const posts = new Set(st.seen || []);
  for (const t of songs) for (const p of t.posts || []) posts.add(p.code);
  const n = songs.length;
  const last = log.length ? ` Last ${ago(log[log.length - 1].at)}.` : '';
  $('#status').textContent = `${posts.size} Explore ${posts.size === 1 ? 'post' : 'posts'} checked, ` +
    `${n} ${n === 1 ? 'song' : 'songs'} found.${last}`;
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const items = list(st, 'song');
    renderGoal(items.length, Number(st.prefs.goal) || 0);

    renderList({
      st,
      items,
      picker: ui.picker,
      finding: (key) => queue.isFinding(key),
      rowPlayback: (t) => (miniOpen ? remoteRowState(t) : playback.rowState(t)),
      onToggleExclude: (t, include) => {
        const excluded = { ...st.excluded };
        if (include) delete excluded[t.key];
        else excluded[t.key] = true;
        store.set({ excluded });
      },
      onPlayButton: playRow,
      onChoose: togglePicker,
      onUse: useCandidate,
    });
    $('#empty').hidden = items.length > 0;
    renderStatus();
    renderSetup(st);
    renderBuild();
    renderDock();
  });
}

// ---------- playlist ----------
async function build() {
  if (!connected(st)) {
    openSetup();
    $('#setup').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (ui.busy || !pending(st).length) return;
  ui.busy = true;
  render();
  try {
    await syncing; // an auto-add in flight finishes first, so nothing is added twice
    await buildPlaylist({ store, queue, name: $('#pl-name').value, report: setMsg });
  } catch (err) {
    handleError(err);
  } finally {
    ui.busy = false;
    render();
  }
}

$('#build-btn').addEventListener('click', build);

// ---------- auto-add (optional) ----------
// Adds matched songs to the current playlist shortly after they're captured and matched.
// Spotify side only: it never creates a playlist and never touches Instagram.
let syncTimer = null;
let syncing = null;          // promise of the auto-add in flight
let syncPausedUntil = 0;     // after an error, wait before trying again
const autoSyncOn = () => !!(st.prefs.autoSync && st.playlist && connected(st));

function scheduleSync(delay = 1500) {
  if (!autoSyncOn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, Math.max(delay, syncPausedUntil - Date.now()));
}
function runSync() {
  if (!autoSyncOn()) return;
  if (ui.busy || syncing) { scheduleSync(2000); return; }
  syncing = syncMatched({ store, report: setMsg })
    .catch((err) => { syncPausedUntil = Date.now() + 60_000; handleError(err); })
    .finally(() => { syncing = null; render(); });
}

$('#auto-sync').addEventListener('change', async (e) => {
  await store.set({ prefs: { ...st.prefs, autoSync: e.target.checked } });
  if (e.target.checked) { syncPausedUntil = 0; scheduleSync(0); }
});
$('#goal').addEventListener('change', (e) => store.set({ prefs: { ...st.prefs, goal: Number(e.target.value) || 0 } }));
$('#pl-new').addEventListener('click', async () => {
  $('#pl-name').value = defaultName();
  await store.set({ playlist: null });
  setMsg('The next playlist starts fresh. Your old one stays in Spotify.');
});

// ---------- setup ----------
wireSetup({
  store,
  onError: handleError,
  onDisconnect: async () => {
    tellMini('close');
    queue.cancelAll();
    stopPlayback();
  },
});

// ---------- list controls & exports ----------

$('#dl-csv').addEventListener('click', () => downloadCsv(st));
$('#dl-json').addEventListener('click', () =>
  downloadDebug(st, { version: chrome.runtime.getManifest().version, playback: { player: player.state, key: playback.key }, recent_spotify_calls: S.callLog }));

let armTimer = null;
$('#clear').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) {
    b.classList.add('armed');
    b.textContent = 'Confirm clear';
    armTimer = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Clear captures'; }, 3000);
    return;
  }
  clearTimeout(armTimer);
  b.classList.remove('armed');
  b.textContent = 'Clear captures';
  queue.cancelAll();
  stopPlayback();
  tellMini('close');
  ui.picker = { key: null, items: null };
  resetList(); // songs captured after this roll in
  await store.remove(['tracks', 'log', 'samples', 'seen', 'matches', 'excluded']);
  setMsg('Cleared. Your Spotify connection and playlist are kept.');
});

// ---------- start ----------
store.subscribe((keys) => {
  render();
  if (keys.has('tracks') || keys.has('spotify')) prematch();
  if (['matches', 'tracks', 'excluded', 'playlist', 'prefs'].some((k) => keys.has(k))) scheduleSync();
});
$('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
$('#open-explore').href = EXPLORE_URL;
setInterval(render, 30_000); // keep "Last … ago" fresh
await store.load();
store.watch();
await readMini();
takePopIn(); // the side panel may have just been opened by Back to panel
