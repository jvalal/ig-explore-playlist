// Pop-out mini player (player.html, a small popup window that outlives the side panel).
// Same embed control (player.js) and queue logic (playback.js) as the panel. The queue is the
// song list in storage, so Prev/Next and auto-advance keep working after the panel is closed.
// While this window is open it is the only player: the panel sends its Play presses here as
// runtime messages { type: 'ef-player', cmd, key }, and this page publishes what it's doing in
// storage key `nowPlaying` ({ host: 'mini', key, playlist, status }) so the panel's rows match.
import * as S from './spotify.js';
import { $, quietWhenOrphaned } from './dom.js';
import { createStore, list, matchOf } from './store.js';
import { MatchQueue } from './match-queue.js';
import { Player } from './player.js';
import { Playback } from './playback.js';

quietWhenOrphaned();
const store = createStore();
const { st } = store;
const params = new URLSearchParams(location.search);
const fromWindow = Number(params.get('from')) || null; // the browser window the panel is in
const songs = () => list(st, 'song');
const byKey = (key) => songs().find((t) => t.key === key);
// Found once: with "Keep on top" these elements move to another document, where $ can't see them.
const ui = Object.fromEntries(['wrap', 'now', 'pos', 'frame', 'prev', 'next', 'pip', 'back', 'hint', 'start', 'start-btn', 'away', 'away-btn',
  'float', 'float-art', 'float-title', 'float-artist', 'float-prev', 'float-play', 'float-next', 'float-save', 'float-time', 'float-back', 'float-hint']
  .map((id) => [id, $(`#mini-${id}`)]));

const queue = new MatchQueue({
  getMatch: (key) => st.matches[key],
  setMatch: (key, m) => store.set({ matches: { ...st.matches, [key]: m } }),
  match: (t) => S.matchTrack(t),
  onChange: () => render(),
});

// ---------- diagnostic trace (storage key `playerTrace`, included in the panel's Debug data) ----------
// Records what happens when a song moves between windows, to find why Keep on top started at
// 0:00 in the user's Chrome. Starts fresh with each mini window; keeps the last 800 entries.
const t0 = Date.now();
let traceBuf = [];
let traceTimer = null;
function trace(ev, d = {}) {
  traceBuf.push({ ms: Date.now() - t0, ev, ...d });
  if (traceBuf.length > 800) traceBuf = traceBuf.slice(-800);
  clearTimeout(traceTimer);
  traceTimer = setTimeout(() => { try { chrome.storage.local.set({ playerTrace: { started: new Date(t0).toISOString(), entries: traceBuf } }).catch(() => {}); } catch (_) {} }, 500);
}
trace('mini-open', { url: location.search });

const HINTS = {
  error: 'The Spotify player didn\'t load. Try Next or Play again.',
};
const hint = (text) => { ui.hint.textContent = text || ''; };
// A new window hasn't been clicked yet, and Chrome may refuse to start sound in it (seen when
// popping out from the side panel). Our own Play button gives it that click; after one click
// the window may start songs by itself, so Next and auto-advance keep going.
const needClick = (on) => { ui.start.hidden = !on; };
// A line under the floating window's controls. growFloat makes room for it (set while that
// window is open; Chrome allows the resize only shortly after a click in it).
const HELD = 'Chrome held the start. Close this window and press Play there.';
let growFloat = () => {};
function floatHint(text) {
  ui['float-hint'].textContent = text || '';
  growFloat();
}

// Chrome doesn't start a newly loaded song while this window is minimized: logged out the embed
// never starts, logged in it says it's playing but stays silent (the user's Chrome, v0.8.6, Next
// from the floating window). Not minimized, it starts, even behind other windows. So the window
// comes back (without taking focus) before anything is started in it.
async function shown() {
  if (document.visibilityState === 'visible') return;
  const me = await chrome.windows.getCurrent();
  if (me.state !== 'minimized') return;
  trace('unminimize');
  const visible = new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    document.addEventListener('visibilitychange', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  await chrome.windows.update(me.id, { state: 'normal', focused: false }).catch(() => {});
  await visible;
}

// Runs a playback action and explains a failed start, like the panel's startSong.
async function run(action) {
  hint('');
  needClick(false);
  try {
    await shown();
    const status = await action();
    trace('result', { status });
    if (status === 'blocked') {
      needClick(true);
      floatHint(HELD);
    }
    else if (HINTS[status]) hint(HINTS[status]);
  } catch (err) {
    hint((err && err.message) || 'Something went wrong.');
  }
}

function makePlayer(frame) {
  const win = frame.ownerDocument === document ? 'mini' : 'floating';
  return new Player(frame, {
    trace: (ev, d) => trace(ev, { win, ...d }),
    onChange: (state) => {
      if (state.status === 'playing') { hint(''); needClick(false); }
      changed();
    },
    onEnded: () => run(() => playback.step(1)),
  });
}

const playback = new Playback({
  player: makePlayer(ui.frame),
  getSongs: songs,
  getMatch: (t) => matchOf(st, t),
  request: (t) => queue.request(t, { urgent: true }),
  onChange: () => changed(),
  onNotFound: (t) => hint(`Couldn't find "${t.title}" on Spotify. Use Choose in the panel.`),
});

// ---------- what's playing: on screen and in storage ----------
let published = '';
function changed() {
  const np = {
    host: 'mini',
    key: playback.wantKey || playback.key || null,
    playlist: playback.playlistLoaded,
    status: playback.wantKey ? 'loading' : playback.status,
  };
  const sig = JSON.stringify(np);
  if (sig !== published) {
    published = sig;
    chrome.storage.local.set({ nowPlaying: { ...np, at: Date.now() } }).catch(() => {});
  }
  render();
}

function render() {
  const t = byKey(playback.wantKey || playback.key);
  const pl = playback.playlistLoaded && st.playlist;
  ui.now.textContent = pl ? `Playlist: ${st.playlist.name}` : t ? `${t.title} · ${t.artist || 'Unknown artist'}` : 'Nothing playing';
  document.title = t ? `${t.title} · Explore finds` : 'Explore finds player';
  if (pl) {
    ui.pos.textContent = '';
    ui.prev.disabled = true;
    ui.next.disabled = true;
    return;
  }
  const { i, n } = playback.position();
  ui.pos.textContent = i >= 0 ? `${i + 1} of ${n}` : '';
  ui.prev.disabled = i <= 0;
  ui.next.disabled = i < 0 || i >= n - 1;
  renderFloat();
}

// ---------- controls ----------
// Closing the floating window (its X) closes the whole player: this window too, and the music
// with it. Only "Bring the controls back here" keeps this window and moves the controls back.
let bringBack = false;
ui['away-btn'].addEventListener('click', () => {
  bringBack = true;
  if (window.documentPictureInPicture && documentPictureInPicture.window) documentPictureInPicture.window.close();
});
// Removed by id, not window.close(): the user saw Back to panel in the floating window leave
// this window open in their Chrome (v0.9.5; not reproduced, it closed in Chrome for Testing).
function closePlayer() {
  try {
    chrome.windows.getCurrent().then((w) => chrome.windows.remove(w.id)).catch(() => window.close());
  } catch (_) {
    window.close(); // the extension was reloaded under this window
  }
}
ui['start-btn'].addEventListener('click', () => { trace('click-our-play'); run(() => playback.player.resume()); });
ui.prev.addEventListener('click', () => run(() => playback.step(-1)));
ui.next.addEventListener('click', () => run(() => playback.step(1)));
// The reverse of Pop out: open the side panel, hand the song back to its docked player (storage
// key `popIn`), and close this window (the floating window closes with it).
// Called straight from the click: sidePanel.open needs the user's gesture.
function backToPanel(say) {
  trace('back-to-panel', { floating: say !== hint });
  if (!fromWindow) { say('No browser window to go back to.'); return; }
  chrome.sidePanel.open({ windowId: fromWindow }).catch((err) => say(`Couldn't open the panel: ${err.message}`));
  const what = playback.playlistLoaded ? { playlist: true } : { key: playback.key, startAt: playback.player.currentSeconds() };
  chrome.storage.local.set({ popIn: { ...what, windowId: fromWindow, at: Date.now() } }).then(() => {
    chrome.windows.update(fromWindow, { focused: true }).catch(() => {});
    closePlayer();
  });
}
ui.back.addEventListener('click', () => backToPanel(hint));
ui['float-back'].addEventListener('click', () => backToPanel((text) => { ui['float-hint'].textContent = text; }));

// ---------- commands from the side panel ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'ef-player') return;
  const t = msg.key ? byKey(msg.key) : null;
  if (msg.cmd === 'play' && t) run(() => playback.playSong(t, { startAt: msg.startAt || 0 }));
  else if (msg.cmd === 'toggle' && t) run(() => playback.click(t));
  else if (msg.cmd === 'playlist' && st.playlist) run(() => playback.clickPlaylist(st.playlist));
  else if (msg.cmd === 'next') run(() => playback.step(1));
  else if (msg.cmd === 'prev') run(() => playback.step(-1));
  else if (msg.cmd === 'close') window.close();
});

// ---------- window sizes ----------
// The windows have fixed sizes, but the player can be taller: Chrome's zoom above 100% makes
// everything bigger, and the Play row for a refused start adds a line. Either way the bottom
// (that Play button included) was cut off. Window sizes are in screen points, page sizes in
// page pixels; the page zoom converts one into the other.
// The mini window follows the player's height as it changes.
let unfit = null;
function fitMini(on) {
  if (unfit) unfit();
  unfit = null;
  if (!on) return;
  const ro = new ResizeObserver(async () => {
    const diff = Math.ceil(ui.wrap.getBoundingClientRect().bottom) - window.innerHeight;
    if (!diff) return;
    const [zoom, me] = await Promise.all([chrome.tabs.getZoom(), chrome.windows.getCurrent()]);
    const height = me.height + Math.round(diff * zoom);
    if (me.state === 'normal' && height > 100) chrome.windows.update(me.id, { height }).catch(() => {});
  });
  ro.observe(ui.wrap);
  unfit = () => ro.disconnect();
}

// ---------- keep on top (Document Picture-in-Picture) ----------
// The music stays where it is, in this window's embed; only our controls move to the floating
// window. Moving the embed reloaded it, and Chrome won't start sound in a new window without a
// click there. Logged in, the embed even reported "playing" for ~350 ms, then paused itself
// without moving (the user's trace, 2026-10-08).
const PLAY_ICON = 'M2 1l7 4-7 4z';
const PAUSE_ICON = 'M2 1h2.2v8H2zM5.8 1H8v8H5.8z';
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let floatTimer = null;
// The floating window's zoom as measured at its last opening (a new key: `floatZoom` could hold
// a wrong value from v0.8.8 to v0.9.1).
const ZOOM_KEY = 'floatZoom2';

function renderFloat() {
  if (ui.float.hidden) return;
  const t = byKey(playback.wantKey || playback.key);
  const pl = playback.playlistLoaded && st.playlist;
  const m = t && matchOf(st, t);
  ui['float-title'].textContent = pl ? st.playlist.name : t ? t.title : 'Nothing playing';
  ui['float-artist'].textContent = pl ? 'Playlist' : t ? t.artist || 'Unknown artist' : '';
  const art = !pl && m && m.image;
  ui['float-art'].hidden = !art;
  if (art && ui['float-art'].src !== art) ui['float-art'].src = art;
  const status = playback.wantKey ? 'loading' : playback.status;
  // Icon only; the state is in its label (screen readers, tooltip).
  const label = status === 'playing' ? 'Pause' : status === 'loading' ? 'Starting…' : 'Play';
  ui['float-play'].disabled = status === 'loading' || !(t || pl);
  ui['float-play'].setAttribute('aria-label', label);
  ui['float-play'].title = label;
  ui['float-play'].querySelector('path').setAttribute('d', label === 'Pause' ? PAUSE_ICON : PLAY_ICON);
  ui['float-prev'].disabled = ui.prev.disabled;
  ui['float-next'].disabled = ui.next.disabled;
  const { duration } = playback.player.state;
  const at = playback.player.currentSeconds();
  ui['float-time'].textContent = duration ? `${mmss(at)} / ${mmss(duration / 1000)}` : '';
  if (status === 'playing' && ui['float-hint'].textContent === HELD) floatHint('');
  renderSave(pl ? null : m);
}

// ---------- "+": save the song to the Spotify library (Liked Songs) ----------
// The floating window has our controls, not Spotify's, so it gets its own "+". It needs a
// Spotify permission older connections don't have: the first press opens Spotify's approval
// once (S.connect), then saves. Whether a song is already saved is looked up once per song.
const PLUS_ICON = 'M4.25 1h1.5v3.25H9v1.5H5.75V9h-1.5V5.75H1v-1.5h3.25z';
const CHECK_ICON = 'M3.9 8.3L1 5.4l1.1-1.1 1.8 1.8L7.9 2 9 3.1z';
const saved = new Map(); // track uri -> true | false | 'asking'
let saving = false;

function renderSave(m) {
  const btn = ui['float-save'];
  const uri = m && m.status === 'matched' ? m.uri : null;
  btn.hidden = !uri;
  if (!uri) return;
  if (!saved.has(uri) && S.canSave(st.spotify)) {
    saved.set(uri, 'asking');
    S.inLibrary(uri).then((yes) => saved.set(uri, yes), () => saved.delete(uri)).then(() => renderFloat());
  }
  const on = saved.get(uri) === true;
  const label = on ? 'Saved to Liked Songs. Press to remove.' : 'Save to Liked Songs';
  btn.disabled = saving;
  btn.classList.toggle('saved', on);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.querySelector('path').setAttribute('d', on ? CHECK_ICON : PLUS_ICON);
}

ui['float-save'].addEventListener('click', async () => {
  const t = byKey(playback.wantKey || playback.key);
  const m = t && matchOf(st, t);
  if (!m || !m.uri || saving) return;
  saving = true;
  renderFloat();
  try {
    if (!S.canSave(st.spotify)) {
      trace('float-save-permission');
      floatHint('Approve once in the Spotify window to save songs.');
      await S.connect();
      floatHint('');
    }
    const remove = saved.get(m.uri) === true;
    await (remove ? S.removeFromLibrary(m.uri) : S.saveToLibrary(m.uri));
    saved.set(m.uri, !remove);
    trace('float-save', { saved: !remove });
  } catch (err) {
    trace('float-save-failed', { message: err && err.message });
    floatHint((err && err.message) || 'Couldn\'t save the song.');
  }
  saving = false;
  renderFloat();
});

ui['float-play'].addEventListener('click', () => {
  trace('float-play', { status: playback.status });
  if (playback.status === 'playing') playback.player.pause();
  else run(() => playback.player.resume());
});
ui['float-prev'].addEventListener('click', () => run(() => playback.step(-1)));
ui['float-next'].addEventListener('click', () => run(() => playback.step(1)));

if ('documentPictureInPicture' in window) {
  ui.pip.hidden = false;
  ui.pip.addEventListener('click', async () => {
    try {
      trace('click-keep-on-top', { status: playback.status, at: playback.player.currentSeconds() });
      // Window sizes are in screen points; the controls' size in page pixels (× page zoom).
      // The floating window's zoom isn't this window's: in the user's Chrome it was 125% (the
      // default) with this window at 100%, and the controls were cut off. It can only be
      // measured once the window is open, so: the zoom measured last time, else the larger of
      // this window's and the default.
      ui.float.hidden = false;
      document.body.append(ui.float);
      renderFloat(); // measured with its text in: empty lines have no height
      const h = ui.float.getBoundingClientRect().height;
      // As wide as the controls need (they don't shrink), with the cover: squeezed to nothing,
      // the row's scroll width is what its buttons and the time take. 360 was too narrow in the
      // user's Chrome once the "+" was added: the time and Back to panel were cut off.
      ui.float.style.width = '0';
      const row = ui.float.querySelector('.float-controls').scrollWidth;
      const sub = ui.float.querySelector('.float-foot').scrollWidth; // the time and Back to panel
      ui.float.style.width = '';
      const w = Math.max(360, 20 + Math.max(74 + row, sub) + 8); // padding, cover beside the row, slack
      // A window's zoom, measured on the window itself: its width in screen points over its
      // width in page pixels. Up to v0.9.1 it came from chrome.tabs.getZoom and a
      // devicePixelRatio read right after opening, which in the user's Chrome gave 100% for a
      // floating window showing 125%; that wrong value was remembered and every later window
      // came out too small. The zoom settles a moment after the window opens.
      const zoomOf = (win) => Math.round((win.outerWidth / win.innerWidth) * 100) / 100 || 1;
      const mine = zoomOf(window);
      const settings = await chrome.tabs.getZoomSettings().catch(() => ({}));
      let stored = 0;
      try { stored = Number(localStorage.getItem(ZOOM_KEY)) || 0; } catch (_) {}
      // Never opened before: nothing says what its zoom will be (in the user's Chrome neither
      // this window's zoom nor the default predicted it, and the first window was cut off).
      // Assume at least 125%: slightly too big once is better than cut off once.
      const guess = stored || Math.max(mine, settings.defaultZoomFactor || 1, 1.25);
      const pip = await window.documentPictureInPicture.requestWindow({ width: Math.round(w * guess), height: Math.ceil((h + 6) * guess) });
      let zoom = guess;
      const measure = () => {
        if (pip.closed || !pip.innerWidth) return;
        zoom = zoomOf(pip);
        try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (_) {}
        trace('floating-zoom', { zoom, guess, inner: [pip.innerWidth, pip.innerHeight], outer: [pip.outerWidth, pip.outerHeight], want: [w, Math.ceil(h)] });
      };
      setTimeout(measure, 400);
      pip.addEventListener('resize', () => { zoom = zoomOf(pip); });
      // If the window came out too small (a wrong guess, or Chrome reusing an earlier size):
      // Chrome lets it grow only right after a click in it. `live` also makes room for a line
      // that appeared under the controls.
      growFloat = (live = true) => {
        const need = Math.max(h, live ? Math.ceil(ui.float.getBoundingClientRect().bottom) : 0);
        const dx = Math.max(0, w - pip.innerWidth);
        const dy = Math.max(0, need - pip.innerHeight);
        if (!dx && !dy) return;
        trace('floating-grow', { dx, dy, inner: [pip.innerWidth, pip.innerHeight] });
        try { pip.resizeBy(Math.ceil(dx * zoom), Math.ceil((dy ? dy + 6 : 0) * zoom)); } catch (err) { trace('floating-grow-failed', { message: err.message }); }
      };
      pip.addEventListener('click', () => growFloat());
      growFloat(false); // the click on Keep on top may still count
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) pip.document.head.append(link.cloneNode());
      pip.document.body.className = 'mini';
      pip.document.title = document.title;
      pip.document.body.append(ui.float);
      ui.pip.hidden = true;
      renderFloat();
      floatTimer = setInterval(renderFloat, 500); // the time display
      // The floating window lives only as long as this one, so this window can't close. It can't
      // minimize either (see shown()). It goes behind the browser window, and keeps playing.
      document.body.prepend(ui.away);
      ui.away.hidden = false;
      const me = await chrome.windows.getCurrent();
      if (fromWindow) chrome.windows.update(fromWindow, { focused: true }).catch(() => {});
      trace('floating-open', { zoom, guess, mine, inner: [pip.innerWidth, pip.innerHeight], outer: [pip.outerWidth, pip.outerHeight], want: [w, Math.ceil(h)], row, dpr: [window.devicePixelRatio, pip.devicePixelRatio] });
      pip.addEventListener('pagehide', () => {
        trace('floating-closed', { bringBack, status: playback.status, at: playback.player.currentSeconds() });
        clearInterval(floatTimer);
        if (!bringBack) { closePlayer(); return; }
        bringBack = false;
        ui.float.hidden = true;
        growFloat = () => {};
        ui['float-hint'].textContent = '';
        document.body.append(ui.float);
        ui.pip.hidden = false;
        ui.away.hidden = true;
        chrome.windows.update(me.id, { state: 'normal', focused: true }).catch(() => {});
      });
    } catch (err) {
      ui.float.hidden = true;
      hint(`Keep on top didn't open: ${err.message}`);
    }
  });
}

// ---------- start ----------
fitMini(true);
store.subscribe(() => render());
await store.load();
store.watch();
if (params.get('playlist') && st.playlist) run(() => playback.clickPlaylist(st.playlist));
else if (params.get('key') && byKey(params.get('key'))) {
  run(() => playback.playSong(byKey(params.get('key')), { startAt: Number(params.get('t')) || 0 }));
}
else changed();
// After the extension is reloaded this window is orphaned and chrome.* throws ("Extension context
// invalidated"); there is nothing left to tidy up then.
addEventListener('pagehide', () => { try { chrome.storage.local.remove('nowPlaying').catch(() => {}); } catch (_) {} });
