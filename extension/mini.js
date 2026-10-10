// Pop-out mini player (player.html, a small popup window that outlives the side panel).
// Same embed control (player.js) and queue logic (playback.js) as the panel. The queue is the
// song list in storage, so Prev/Next and auto-advance keep working after the panel is closed.
// While this window is open it is the only player: the panel sends its Play presses here as
// runtime messages { type: 'ef-player', cmd, key }, and this page publishes what it's doing in
// storage key `nowPlaying` ({ host: 'mini', key, playlist, status }) so the panel's rows match.
import * as S from './spotify.js';
import { $ } from './dom.js';
import { createStore, list, matchOf } from './store.js';
import { MatchQueue } from './match-queue.js';
import { Player } from './player.js';
import { Playback } from './playback.js';

const store = createStore();
const { st } = store;
const params = new URLSearchParams(location.search);
const fromWindow = Number(params.get('from')) || null; // the browser window the panel is in
const songs = () => list(st, 'song');
const byKey = (key) => songs().find((t) => t.key === key);
// Found once: with "Keep on top" these elements move to another document, where $ can't see them.
const ui = Object.fromEntries(['wrap', 'now', 'pos', 'frame', 'prev', 'next', 'pip', 'back', 'hint', 'start', 'start-btn', 'away', 'away-btn',
  'float', 'float-art', 'float-title', 'float-artist', 'float-prev', 'float-play', 'float-next', 'float-time', 'float-back', 'float-hint']
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
  traceTimer = setTimeout(() => chrome.storage.local.set({ playerTrace: { started: new Date(t0).toISOString(), entries: traceBuf } }).catch(() => {}), 500);
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
      ui['float-hint'].textContent = 'Chrome held the start. Close this window and press Play there.';
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
ui['away-btn'].addEventListener('click', () => {
  if (window.documentPictureInPicture && documentPictureInPicture.window) documentPictureInPicture.window.close();
});
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
    window.close();
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
  const label = status === 'playing' ? 'Pause' : status === 'loading' ? 'Starting…' : 'Play';
  ui['float-play'].disabled = status === 'loading' || !(t || pl);
  ui['float-play'].querySelector('span').textContent = label;
  ui['float-play'].querySelector('path').setAttribute('d', label === 'Pause' ? PAUSE_ICON : PLAY_ICON);
  ui['float-prev'].disabled = ui.prev.disabled;
  ui['float-next'].disabled = ui.next.disabled;
  const { duration } = playback.player.state;
  const at = playback.player.currentSeconds();
  ui['float-time'].textContent = duration ? `${mmss(at)} / ${mmss(duration / 1000)}` : '';
  if (status === 'playing') ui['float-hint'].textContent = '';
}

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
      const [mine, settings] = await Promise.all([chrome.tabs.getZoom(), chrome.tabs.getZoomSettings().catch(() => ({}))]);
      let stored = 0;
      try { stored = Number(localStorage.getItem('floatZoom')) || 0; } catch (_) {}
      const guess = stored || Math.max(mine, settings.defaultZoomFactor || 1);
      const pip = await window.documentPictureInPicture.requestWindow({ width: Math.round(360 * guess), height: Math.ceil((h + 6) * guess) });
      const zoom = Math.round((pip.devicePixelRatio / (window.devicePixelRatio / mine)) * 100) / 100 || guess;
      try { localStorage.setItem('floatZoom', String(zoom)); } catch (_) {}
      // If the guess was too small: Chrome lets this window grow only right after a click in it.
      pip.addEventListener('click', () => {
        const cut = Math.ceil(ui.float.getBoundingClientRect().bottom) - pip.innerHeight;
        if (cut <= 0) return;
        trace('floating-grow', { cut, inner: [pip.innerWidth, pip.innerHeight] });
        try { pip.resizeBy(0, Math.ceil((cut + 6) * zoom)); } catch (err) { trace('floating-grow-failed', { message: err.message }); }
      });
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
      trace('floating-open', { zoom, guess, mine, inner: [pip.innerWidth, pip.innerHeight], controls: Math.ceil(h) });
      pip.addEventListener('pagehide', () => {
        trace('floating-closed', { status: playback.status, at: playback.player.currentSeconds() });
        clearInterval(floatTimer);
        ui.float.hidden = true;
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
addEventListener('pagehide', () => { chrome.storage.local.remove('nowPlaying').catch(() => {}); });
