// Side panel controller: wires storage, the list, matching, playback and the playlist together.
import * as S from './spotify.js';
import { $, setMsg, ago, EXPLORE_URL, quietWhenOrphaned } from './dom.js';
import { createStore, connected, list, matchFor, matchOf, pending, inPlaylist, noteAdded, isExcluded, withChoice } from './store.js';
import { MatchQueue } from './match-queue.js';
import { renderList, resetList, showProgress, glowLate } from './list.js';
import { buildPlaylist, syncMatched, defaultName } from './build.js';
import { renderGoal } from './goal.js';
import { renderSetup, wireSetup, openSettingsForSetup } from './setup.js';
import { downloadCsv, downloadDebug } from './exports.js';
import { saveBackup, restoreBackup, backupIfDue } from './backup.js';
import { Player } from './player.js';
import { Playback } from './playback.js';
import { initWelcome, renderWelcome } from './welcome.js';
import { watchExploreTab } from './explore-tab.js';

quietWhenOrphaned();

const store = createStore();
const { st } = store;

const ui = {
  busy: false,                       // building a playlist
  picker: { key: null, items: null }, // manual-match picker (items null while loading)
  onExplore: true,                    // the tab in front is Instagram Explore
};

const songs = () => list(st, 'song');

// ---------- errors ----------
const EXPECTED = new Set(['AUTH', 'INPUT', 'RATE']);
function handleError(err) {
  if (!(err && EXPECTED.has(err.code))) console.warn('[Explore Playlist Gen]', err);
  if (err && err.code === 'AUTH') {
    setMsg('Spotify needs you to connect again, in Settings.', true);
  } else {
    setMsg((err && err.message) || 'Something went wrong.', true);
  }
}

// Spotify answers 404 ("Resource not found") when the playlist we add to isn't there any more,
// e.g. it was deleted in Spotify. The panel forgets it, so the next press makes a new one; the
// songs stay in the list. Returns true if that was the problem.
async function playlistGone(err) {
  if (!(err && err.code === 'NOT_FOUND' && st.playlist)) return false;
  const { name } = st.playlist;
  await store.set({ playlist: null, playlistUndo: st.playlist, prefs: { ...st.prefs, autoSync: false } });
  $('#pl-name').value = defaultName();
  setMsg(`"${name}" isn't on Spotify any more. Press the button to put these songs in a new playlist.`, true);
  return true;
}

// ---------- matching ----------
const queue = new MatchQueue({
  getMatch: (key) => matchFor(st, key),
  setMatch: (key, m) => store.set({ matches: { ...st.matches, [key]: m } }),
  match: (t) => S.matchTrack(t),
  onChange: () => render(),
  onError: (err) => { if (err.code === 'AUTH' || err.code === 'RATE') handleError(err); },
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
    const shown = `${state.trackId}|${state.status}`;
    
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
    openSettingsForSetup();
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
  if (!np || np.key !== t.key) return { label: 'Play', on: false, disabled: false };
  if (np.status === 'loading') return { label: 'Starting…', on: false, disabled: true, current: true };
  if (np.status === 'playing') return { label: 'Pause', on: true, disabled: false, current: true };
  if (np.status === 'paused') return { label: 'Play', on: false, disabled: false, current: true };
  return { label: 'Play', on: false, disabled: false };
}

function playRow(t) {
  if (!miniOpen) return startSong(() => playback.click(t));
  if (!connected(st)) return startSong(async () => undefined); // shows the connect prompt
  const np = remote();
  return tellMini(np && np.key === t.key ? 'toggle' : 'play', t.key);
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
  const t = songs().find((x) => x.key === popIn.key);
  return t ? startSong(() => playback.playSong(t, { startAt: popIn.startAt || 0 })) : undefined;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.popIn && changes.popIn.newValue) takePopIn();
});

async function popOut() {
  // The song continues where it is (startAt).
  const what = { key: playback.key || playback.wantKey, startAt: playback.player.currentSeconds() };
  if (!what.key) return;
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
  const on = !miniOpen && !!(playback.key || playback.wantKey);
  $('#dock').hidden = !on;
  if (!on) return;
  const { i, n } = playback.position();
  $('#dock-pos').textContent = i >= 0 ? `${i + 1} of ${n}` : '';
  $('#dock-prev').disabled = i <= 0;
  $('#dock-next').disabled = i < 0 || i >= n - 1;
}

$('#dock-prev').addEventListener('click', () => startSong(() => playback.step(-1)));
$('#dock-next').addEventListener('click', () => startSong(() => playback.step(1)));
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
      // The choices open under the row, which can be below the bottom of the panel.
      setTimeout(() => {
        const p = document.querySelector('#list > li.picker');
        if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
      }, 60);
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
  $('#pl-to').hidden = !pl;
  $('#pl-undo').hidden = !!pl || !st.playlistUndo;
  $('#pl-new').hidden = !pl;
  if (pl) {
    $('#pl-link').textContent = pl.name;
    $('#pl-link').href = pl.url || '#';
    $('#auto-sync').checked = !!st.prefs.autoSync;
  }
  if (!$('#pl-name').value) $('#pl-name').value = defaultName();

  const btn = $('#build-btn');
  if (!connected(st)) {
    btn.textContent = 'Connect Spotify to build a playlist';
    btn.disabled = ui.busy;
  } else if (pl && st.prefs.autoSync) {
    // Auto-add does the adding: the button only reports, and can't be pressed. Songs Spotify
    // doesn't have are never added by it, so they don't count as still to come.
    const coming = pending(st).filter((t) => { const m = matchOf(st, t); return !m || m.status === 'matched'; }).length;
    btn.textContent = coming ? `Adding ${coming} new ${coming === 1 ? 'song' : 'songs'}…` : 'Songs added';
    btn.disabled = true;
  } else if (pl) {
    btn.textContent = n ? `Add ${n} new ${n === 1 ? 'song' : 'songs'}` : 'No new songs yet';
    btn.disabled = ui.busy || !n;
  } else {
    btn.textContent = n ? `Create it on Spotify with ${n} ${n === 1 ? 'song' : 'songs'}` : 'No songs to add yet';
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
  const last = log.length ? ` Last checked ${ago(log[log.length - 1].at)}.` : '';
  $('#status').textContent = `${posts.size} Explore ${posts.size === 1 ? 'post' : 'posts'} checked, ` +
    `${n} ${n === 1 ? 'song' : 'songs'} found.${last}`;
}

// ---------- songs that arrive above what is on screen ----------
// New songs go in at the top. Scrolled down, Chrome keeps the rows on screen where they are
// (the page grows above them), so nothing would show that songs arrived. A pill under the
// pinned block says how many, with the new rows' swell and glow; pressing it, or scrolling up,
// goes to them, and they glow once more when they come into view.
const unseen = new Set();
const listTopHidden = () => $('#list').getBoundingClientRect().top < $('#build').getBoundingClientRect().bottom;
function newAbove(rows) {
  if (!rows.length) return;
  rows.forEach((li) => unseen.add(li));
  const pill = $('#new-above');
  $('#new-above-text').textContent = `${unseen.size} new ${unseen.size === 1 ? 'song' : 'songs'}`;
  pill.hidden = false;
  pill.classList.remove('swell');
  void pill.offsetWidth; // swell again for each arrival
  pill.classList.add('swell');
}
function forgetNewAbove() {
  unseen.clear();
  $('#new-above').hidden = true;
}
window.addEventListener('scroll', () => {
  if (!unseen.size || listTopHidden()) return;
  glowLate(unseen);
  forgetNewAbove();
}, { passive: true });
$('#new-above').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const items = list(st, 'song');
    renderGoal(items.length, Number(st.prefs.goal) || 0);

    const hidden = listTopHidden(); // before the new rows go in
    const entered = renderList({
      st,
      items,
      picker: ui.picker,
      finding: (key) => queue.isFinding(key),
      rowPlayback: (t) => (miniOpen ? remoteRowState(t) : playback.rowState(t)),
      onToggleExclude: (t, include) => {
        store.set({ excluded: withChoice(st, [t], include) });
      },
      onPlayButton: playRow,
      onChoose: togglePicker,
      onUse: useCandidate,
    });
    if (hidden) newAbove(entered);
    $('#empty').hidden = items.length > 0;
    renderExploreNote();
    renderCheckAll();
    renderStatus();
    renderSetup(st);
    renderWelcome();
    renderBuild();
    renderDock();
  });
}

// ---------- how far the song is ----------
// The wave on the current row fills as the song plays. The list isn't re-rendered for this (see
// "Things that broke before"): twice a second, the bars' classes are set from the player's
// position. While the mini player has the song, the panel doesn't know the position: no fill.
setInterval(() => {
  if (miniOpen || !playback.key) { showProgress(null); return; }
  const { duration } = player.state;
  showProgress(duration ? Math.min(1, (player.currentSeconds() * 1000) / duration) : 0);
}, 500);

// ---------- select all / none ----------
// Covers the songs that have a checkbox (those not in the playlist yet). Ticked when all are
// included, a dash when some are, empty when none.
const selectable = () => songs().filter((t) => !inPlaylist(st, t));
function renderCheckAll() {
  const all = selectable();
  const included = all.filter((t) => !isExcluded(st, t)).length;
  $('#check-all-row').hidden = all.length === 0;
  $('#check-all').checked = all.length > 0 && included === all.length;
  $('#check-all').indeterminate = included > 0 && included < all.length;
  $('#check-all-text').textContent = included === all.length ? 'All selected' : included ? `${included} of ${all.length} selected` : 'None selected';
}
$('#check-all').addEventListener('change', (e) => {
  store.set({ excluded: withChoice(st, selectable(), e.target.checked) });
});

// ---------- playlist ----------
async function build() {
  if (!connected(st)) {
    openSettingsForSetup();
    return;
  }
  if (ui.busy || !pending(st).length) return;
  ui.busy = true;
  render();
  const isNew = !st.playlist;
  try {
    await syncing; // an auto-add in flight finishes first, so nothing is added twice
    // A new playlist starts with auto-add off: it is ticked for that playlist, once it exists.
    if (isNew && st.prefs.autoSync) await store.set({ prefs: { ...st.prefs, autoSync: false } });
    await buildPlaylist({ store, queue, name: $('#pl-name').value, report: setMsg });
    if (isNew && st.playlist && st.playlistUndo) await store.set({ playlistUndo: null }); // the new one replaces it
  } catch (err) {
    if (!(await playlistGone(err))) handleError(err);
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
    .catch(async (err) => { syncPausedUntil = Date.now() + 60_000; if (!(await playlistGone(err))) handleError(err); })
    .finally(() => { syncing = null; render(); });
}

$('#auto-sync').addEventListener('change', async (e) => {
  await store.set({ prefs: { ...st.prefs, autoSync: e.target.checked } });
  if (e.target.checked) { syncPausedUntil = 0; scheduleSync(0); }
});
$('#goal').addEventListener('change', (e) => store.set({ prefs: { ...st.prefs, goal: Number(e.target.value) || 0 } }));
// The x on the new-playlist box: back to the playlist that was current, nothing created or added.
$('#pl-undo').addEventListener('click', async () => {
  const back = st.playlistUndo;
  if (!back || st.playlist) return;
  await store.set({ playlist: back, playlistUndo: null });
  setMsg(`Back to "${back.name}".`);
});
$('#pl-new').addEventListener('click', async () => {
  $('#pl-name').value = defaultName();
  await store.set({ playlist: null, playlistUndo: st.playlist, prefs: { ...st.prefs, autoSync: false } });
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

// ---------- today's Spotify use (temporary: to learn where Spotify's limit is) ----------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const FLIP_MS = 340; // both halves, as in sidepanel.css
const flipTimers = new WeakMap();
// One digit of a flip counter: top and bottom halves, and the two that move during a flip.
function setFlap(flap, d, animate) {
  const old = flap.dataset.d;
  if (old === d) return;
  flap.dataset.d = d;
  const [top, bot, foldTop, foldBot] = flap.children;
  clearTimeout(flipTimers.get(flap));
  flap.classList.remove('flipping');
  if (!animate || old === undefined) { top.textContent = bot.textContent = d; return; }
  foldTop.textContent = bot.textContent = old; // the old top falls; the old bottom shows until covered
  top.textContent = foldBot.textContent = d;
  void flap.offsetWidth; // restart the animation when a digit changes again mid-flip
  flap.classList.add('flipping');
  flipTimers.set(flap, setTimeout(() => { bot.textContent = d; flap.classList.remove('flipping'); }, FLIP_MS));
}
function setFlip(el, n, width, animate) {
  const text = String(n).padStart(width, '0');
  if (el.children.length !== text.length) {
    el.replaceChildren(...[...text].map(() => {
      const flap = document.createElement('span');
      flap.className = 'flap';
      flap.innerHTML = '<b class="top"></b><b class="bot"></b><b class="fold-top"></b><b class="fold-bot"></b>';
      return flap;
    }));
    animate = false;
  }
  [...text].forEach((d, i) => setFlap(el.children[i], d, animate));
}
let countShown = false;
async function renderApiCount() {
  const c = await S.countsToday();
  const el = $('#api-count');
  el.hidden = !c.requests;
  setFlip($('#flip-songs'), c.songs, 3, countShown);
  setFlip($('#flip-requests'), c.requests, 4, countShown);
  countShown = true;
  const text = `${plural(c.songs, 'song')} looked up today, ${plural(c.requests, 'Spotify request')}`;
  el.setAttribute('aria-label', text);
  el.title = `${text} (${c.searches} ${c.searches === 1 ? 'search' : 'searches'}, ${c.requests - c.searches} other)` +
    (c.limit ? `. Spotify's limit began at ${new Date(c.limit.at).toLocaleTimeString()}, after ${plural(c.limit.requests, 'request')}` : '');
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.spotifyCounts) renderApiCount();
});
renderApiCount();

// ---------- list controls & exports ----------

$('#dl-csv').addEventListener('click', () => downloadCsv(st));
$('#dl-json').addEventListener('click', async () => {
  const { playerTrace = null, spotifyCounts = null } = await chrome.storage.local.get(['playerTrace', 'spotifyCounts']); // the mini player's log
  downloadDebug(st, { version: chrome.runtime.getManifest().version, playback: { player: player.state, key: playback.key }, recent_spotify_calls: S.callLog, spotify_counts: spotifyCounts, player_trace: playerTrace });
});

// ---------- backup ----------
const backupMsg = (text) => { $('#backup-msg').textContent = text; };
$('#backup-save').addEventListener('click', async () => {
  try {
    const n = await saveBackup();
    backupMsg(`Saved a backup of ${n} ${n === 1 ? 'capture' : 'captures'} to Downloads.`);
  } catch (err) {
    console.warn('[Explore Playlist Gen] backup', err);
    backupMsg(`Couldn't save the backup: ${err.message}`);
  }
});
$('#backup-restore').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // the same file can be picked again
  if (!file) return;
  try {
    const { songs: n, added } = await restoreBackup(await file.text());
    backupMsg(`Restored. ${added} ${added === 1 ? 'song' : 'songs'} added back, ${n} in the list.`);
  } catch (err) {
    backupMsg(err.message);
  }
});
// The weekly backup is checked when the panel opens and when songs arrive.
// Needs chrome.downloads, which Safari doesn't have: there the card and its heading are hidden.
$('#backup').hidden = $('#backup').previousElementSibling.hidden = !chrome.downloads;
function weeklyBackup() {
  if (!chrome.downloads) return;
  backupIfDue(Object.keys(st.tracks).length > 0)
    .catch((err) => console.warn('[Explore Playlist Gen] weekly backup', err));
}

// The player and playlist block is pinned to the top and covers what scrolls under it. Tell the
// browser how tall it is, so anything scrolled into view (a row, a picker) stops below it.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    document.documentElement.style.scrollPaddingTop = `${Math.ceil($('#build').getBoundingClientRect().height) + 4}px`;
  }).observe($('#build'));
}

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
  forgetNewAbove();
  // `matches` (what each song is on Spotify) stays: a song captured again is recognised without
  // a new search. Clearing it made every Clear cost a search per song, and a day of that got the
  // app rate-limited by Spotify for 16 hours (2026-10-10).
  await store.remove(['tracks', 'log', 'samples', 'seen', 'excluded']);
  // A new round of captures gets a new playlist, named for now (the user's call, v0.11.10). As
  // with Start a new playlist: the old one stays on Spotify, the x goes back to it, auto-add off.
  $('#pl-name').value = defaultName();
  if (st.playlist) await store.set({ playlist: null, playlistUndo: st.playlist, prefs: { ...st.prefs, autoSync: false } });
  setMsg('Cleared. The next playlist starts fresh. Your old one stays in Spotify.');
});

// ---------- start ----------
store.subscribe((keys) => {
  render();
  if (keys.has('tracks') || keys.has('spotify')) prematch();
  if (keys.has('tracks')) weeklyBackup();
  if (['matches', 'tracks', 'excluded', 'playlist', 'prefs'].some((k) => keys.has(k))) scheduleSync();
});
$('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
$('#open-explore').href = EXPLORE_URL;
// Not on Explore: the link comes back under the title (the empty list has its own).
$('#explore-note-link').href = EXPLORE_URL;
function renderExploreNote() { $('#explore-note').hidden = ui.onExplore || !$('#empty').hidden; }
watchExploreTab((yes) => { ui.onExplore = yes; renderExploreNote(); });
// "reload that tab" in the empty text: reloads the Instagram tabs that are open (capture only
// starts in a tab loaded after the extension was installed).
$('#reload-ig').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
    await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id)));
    setMsg(tabs.length ? `Reloaded ${tabs.length === 1 ? 'your Instagram tab' : `${tabs.length} Instagram tabs`}.` : 'No Instagram tab is open. Use "Open Instagram Explore".', !tabs.length);
  } catch (err) {
    setMsg(`Couldn't reload Instagram: ${err.message}`, true);
  }
});
setInterval(render, 30_000); // keep "Last … ago" fresh
await store.load();
store.watch();
initWelcome({ connected: () => connected(st) });
// The record of songs ever added starts with the playlists known today (v0.11.14); when they
// were added isn't known.
if (!(await chrome.storage.local.get('added')).added) {
  let added = st.added;
  for (const pl of [st.playlistUndo, st.playlist]) {
    if (!pl) continue;
    const paired = pl.keys.length === pl.uris.length;
    added = noteAdded({ added }, paired ? pl.keys.map((k, i) => [k, pl.uris[i]]) : [...pl.keys.map((k) => [k, null]), ...pl.uris.map((u) => [null, u])], pl.name, null);
  }
  await store.set({ added });
}
await readMini();
takePopIn(); // the side panel may have just been opened by Back to panel
