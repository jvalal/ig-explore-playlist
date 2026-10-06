// Side panel controller: wires storage, the list, matching, playback and the playlist together.
import * as S from './spotify.js';
import { $, setMsg, ago } from './dom.js';
import { createStore, connected, list, matchOf, pending } from './store.js';
import { MatchQueue } from './match-queue.js';
import { renderList, resetList } from './list.js';
import { buildPlaylist, defaultName } from './build.js';
import { renderSetup, wireSetup, openSetup } from './setup.js';
import { downloadCsv, downloadDebug } from './exports.js';
import { Player } from './player.js';
import { Playback } from './playback.js';

const store = createStore();
const { st } = store;

const ui = {
  kind: 'song',
  exploreOnly: false,
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

function stopPlayback() {
  playback.stop();
  $('#dock-hint').textContent = '';
}

function renderDock() {
  const on = !!(playback.key || playback.wantKey || playback.playlistLoaded);
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
$('#pl-play').addEventListener('click', () => { if (st.playlist) startSong(() => playback.clickPlaylist(st.playlist)); });

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
function renderBuild() {
  const pl = st.playlist;
  const n = pending(st).length;
  $('#build-new').hidden = !!pl;
  $('#build-existing').hidden = !pl;
  $('#pl-new').hidden = !pl;
  if (pl) {
    $('#pl-link').textContent = pl.name;
    $('#pl-link').href = pl.url || '#';
    const p = playback.playlistState();
    $('#pl-play').textContent = p.label;
    $('#pl-play').disabled = p.disabled;
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
  const log = st.log || [];
  if (!log.length) $('#status').textContent = 'Waiting for Instagram';
  else {
    const withHits = log.filter((l) => l.hits > 0).length;
    $('#status').textContent =
      `${log.length} responses checked, ${withHits} had music. Last ${ago(log[log.length - 1].at)}.`;
  }
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    $('#n-song').textContent = list(st, 'song').length;
    $('#n-original').textContent = list(st, 'original').length;
    document.querySelectorAll('.segment button').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.kind === ui.kind)));

    const items = list(st, ui.kind, { exploreOnly: ui.exploreOnly });
    renderList({
      st,
      items,
      picker: ui.picker,
      finding: (key) => queue.isFinding(key),
      rowPlayback: (t) => playback.rowState(t),
      onToggleExclude: (t, include) => {
        const excluded = { ...st.excluded };
        if (include) delete excluded[t.key];
        else excluded[t.key] = true;
        store.set({ excluded });
      },
      onPlayButton: (t) => startSong(() => playback.click(t)),
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
    await buildPlaylist({ store, queue, name: $('#pl-name').value, report: setMsg });
  } catch (err) {
    handleError(err);
  } finally {
    ui.busy = false;
    render();
  }
}

$('#build-btn').addEventListener('click', build);
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
    queue.cancelAll();
    stopPlayback();
  },
});

// ---------- list controls & exports ----------
document.querySelectorAll('.segment button').forEach((b) =>
  b.addEventListener('click', () => { ui.kind = b.dataset.kind; render(); }));
$('#explore-only').addEventListener('change', (e) => { ui.exploreOnly = e.target.checked; render(); });

$('#dl-csv').addEventListener('click', () => downloadCsv(st));
$('#dl-json').addEventListener('click', () =>
  downloadDebug(st, { playback: { player: player.state, key: playback.key }, recent_spotify_calls: S.callLog }));

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
  ui.picker = { key: null, items: null };
  resetList(); // songs captured after this roll in
  await store.remove(['tracks', 'log', 'samples', 'matches', 'excluded']);
  setMsg('Cleared. Your Spotify connection and playlist are kept.');
});

// ---------- start ----------
store.subscribe((keys) => {
  render();
  if (keys.has('tracks') || keys.has('spotify')) prematch();
});
$('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
setInterval(render, 30_000); // keep "Last … ago" fresh
await store.load();
store.watch();
