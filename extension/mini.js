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
const ui = Object.fromEntries(['wrap', 'now', 'pos', 'frame', 'prev', 'next', 'pip', 'back', 'hint', 'start', 'start-btn', 'away', 'away-btn']
  .map((id) => [id, $(`#mini-${id}`)]));

const queue = new MatchQueue({
  getMatch: (key) => st.matches[key],
  setMatch: (key, m) => store.set({ matches: { ...st.matches, [key]: m } }),
  match: (t) => S.matchTrack(t),
  onChange: () => render(),
});

const HINTS = {
  error: 'The Spotify player didn\'t load. Try Next or Play again.',
};
const hint = (text) => { ui.hint.textContent = text || ''; };
// A new window hasn't been clicked yet, and Chrome may refuse to start sound in it (seen when
// popping out from the side panel). Our own Play button gives it that click; after one click
// the window may start songs by itself, so Next and auto-advance keep going.
const needClick = (on) => { ui.start.hidden = !on; };

// Runs a playback action and explains a failed start, like the panel's startSong.
async function run(action) {
  hint('');
  needClick(false);
  try {
    const status = await action();
    if (status === 'blocked') needClick(true);
    else if (HINTS[status]) hint(HINTS[status]);
  } catch (err) {
    hint((err && err.message) || 'Something went wrong.');
  }
}

function makePlayer(frame) {
  return new Player(frame, {
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
}

// ---------- controls ----------
ui['away-btn'].addEventListener('click', () => {
  if (window.documentPictureInPicture && documentPictureInPicture.window) documentPictureInPicture.window.close();
});
ui['start-btn'].addEventListener('click', () => run(() => playback.player.resume()));
ui.prev.addEventListener('click', () => run(() => playback.step(-1)));
ui.next.addEventListener('click', () => run(() => playback.step(1)));
ui.back.addEventListener('click', () => {
  // Called straight from the click: sidePanel.open needs the user's gesture.
  // The reverse of Pop out: open the side panel, hand the song back to its docked player
  // (storage key `popIn`), and close this window.
  if (!fromWindow) { hint('No browser window to go back to.'); return; }
  chrome.sidePanel.open({ windowId: fromWindow }).catch((err) => hint(`Couldn't open the panel: ${err.message}`));
  const what = playback.playlistLoaded ? { playlist: true } : { key: playback.key };
  chrome.storage.local.set({ popIn: { ...what, windowId: fromWindow, at: Date.now() } }).then(() => {
    chrome.windows.update(fromWindow, { focused: true }).catch(() => {});
    window.close();
  });
});

// ---------- commands from the side panel ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'ef-player') return;
  const t = msg.key ? byKey(msg.key) : null;
  if (msg.cmd === 'play' && t) run(() => playback.playSong(t));
  else if (msg.cmd === 'toggle' && t) run(() => playback.click(t));
  else if (msg.cmd === 'playlist' && st.playlist) run(() => playback.clickPlaylist(st.playlist));
  else if (msg.cmd === 'next') run(() => playback.step(1));
  else if (msg.cmd === 'prev') run(() => playback.step(-1));
  else if (msg.cmd === 'close') window.close();
});

// ---------- keep on top (Document Picture-in-Picture) ----------
// Moving an iframe to another document reloads it, so the song restarts there (the embed
// ignores seek). The player is rebuilt on a fresh iframe in whichever window shows it.
function rehost(container) {
  const old = playback.player;
  const was = { key: playback.key, playlist: old.state.type === 'playlist' };
  const frame = old.frame.cloneNode(false);
  frame.removeAttribute('src');
  old.stop();
  old.frame.replaceWith(frame);
  container.append(ui.wrap);
  playback.player = makePlayer(frame); // after the move: it listens on the new window
  return was;
}
function replay(was) {
  if (was.playlist && st.playlist) return run(() => playback.clickPlaylist(st.playlist));
  const t = was.key && byKey(was.key);
  playback.key = null;
  return t ? run(() => playback.playSong(t)) : changed();
}

if ('documentPictureInPicture' in window) {
  ui.pip.hidden = false;
  ui.pip.addEventListener('click', async () => {
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 360, height: 170 });
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) pip.document.head.append(link.cloneNode());
      pip.document.body.className = 'mini';
      pip.document.title = document.title;
      ui.pip.hidden = true;
      replay(rehost(pip.document.body));
      // The floating window lives only as long as this one, so this window can't close. It gets
      // out of the way instead (minimized), saying where the player went if someone finds it.
      document.body.append(ui.away);
      ui.away.hidden = false;
      const me = await chrome.windows.getCurrent();
      chrome.windows.update(me.id, { state: 'minimized' }).catch(() => {});
      pip.addEventListener('pagehide', () => {
        ui.pip.hidden = false;
        ui.away.hidden = true;
        replay(rehost(document.body));
        chrome.windows.update(me.id, { state: 'normal', focused: true }).catch(() => {});
      });
    } catch (err) {
      hint(`Keep on top didn't open: ${err.message}`);
    }
  });
}

// ---------- start ----------
store.subscribe(() => render());
await store.load();
store.watch();
if (params.get('playlist') && st.playlist) run(() => playback.clickPlaylist(st.playlist));
else if (params.get('key') && byKey(params.get('key'))) run(() => playback.playSong(byKey(params.get('key'))));
else changed();
addEventListener('pagehide', () => { chrome.storage.local.remove('nowPlaying').catch(() => {}); });
