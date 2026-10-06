import * as S from './spotify.js';
import { EmbedPlayer } from './embed.js';

const $ = (s) => document.querySelector(s);
const KEYS = ['tracks', 'log', 'samples', 'matches', 'excluded', 'spotify', 'playlist', 'playbackDevice'];

let st = { tracks: {}, log: [], samples: [], matches: {}, excluded: {}, spotify: {}, playlist: null, playbackDevice: null };
let kind = 'song';
let exploreOnly = false;
let busy = false;
const finding = new Set();
let pickerKey = null;        // song whose manual-match picker is open
let pickerItems = null;      // candidates for that picker (null while loading)

// ---------- helpers ----------
const connected = () => !!(st.spotify && st.spotify.refresh_token);
const canControl = () => connected();
const postUrl = (p) => `https://www.instagram.com/${p.type === 'clips' ? 'reel' : 'p'}/${encodeURIComponent(p.code)}/`;
const searchUrl = (t) => `https://open.spotify.com/search/${encodeURIComponent(`${t.title} ${t.artist || ''}`.trim())}`;
const defaultName = () => `Explore finds, ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function setMsg(text, isError = false) {
  const m = $('#msg');
  m.textContent = text || '';
  m.classList.toggle('error', !!isError);
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// Newest finds first. first_seen never changes, so existing rows never reshuffle.
function list(k) {
  return Object.values(st.tracks)
    .filter((t) => t.kind === k && (!exploreOnly || (t.areas && t.areas.explore)))
    .sort((a, b) => b.first_seen - a.first_seen || a.key.localeCompare(b.key));
}

const inPlaylist = (t) => !!(st.playlist && st.playlist.keys.includes(t.key));
const matchOf = (t) => st.matches[t.key];

function pending() {
  return list('song').filter((t) => {
    const m = matchOf(t);
    return !st.excluded[t.key] && !inPlaylist(t) && !(m && m.status === 'none');
  });
}

async function setMatch(key, m) {
  st.matches[key] = m;
  await chrome.storage.local.set({ matches: st.matches });
}

const EXPECTED = new Set(['AUTH', 'NO_DEVICE', 'DEVICE_ASLEEP', 'NOT_STARTED', 'PLAYER_FORBIDDEN', 'INPUT']);
function handleError(err) {
  if (!(err && EXPECTED.has(err.code))) console.warn('[Explore Finds]', err);
  if (err && err.code === 'AUTH') {
    $('#setup').open = true;
    setMsg('Spotify needs you to connect again.', true);
  } else {
    setMsg((err && err.message) || 'Something went wrong.', true);
  }
}

// ---------- rows ----------
function fillRow(li, t) {
  const isSong = t.kind === 'song';
  const entering = li.classList.contains('enter');
  li.className = `row${isSong ? '' : ' no-check'}${st.excluded[t.key] ? ' skipped' : ''}${entering ? ' enter' : ''}`;
  li.replaceChildren();

  if (isSong) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !st.excluded[t.key];
    cb.title = 'Include in playlist';
    cb.setAttribute('aria-label', `Include ${t.title} in playlist`);
    cb.addEventListener('change', async () => {
      if (cb.checked) delete st.excluded[t.key];
      else st.excluded[t.key] = true;
      await chrome.storage.local.set({ excluded: st.excluded });
    });
    li.append(cb);
  }

  const main = el(t.posts[0] ? 'a' : 'div', 'main');
  if (t.posts[0]) {
    main.href = postUrl(t.posts[0]);
    main.target = '_blank';
    main.title = 'Open a post that uses this audio';
  }
  main.append(
    el('span', 'title', t.title),
    el('span', 'artist', !isSong && t.artist ? `@${t.artist}` : t.artist || 'Unknown artist')
  );
  li.append(main);

  const m = matchOf(t);
  if (isSong) {
    let note = null;
    if (finding.has(t.key)) note = el('span', 'note', 'Finding on Spotify…');
    else if (m && m.status === 'none') note = el('span', 'note miss', 'Not found automatically');
    else if (m && m.status === 'matched' && S.coreTitle(m.name) !== S.coreTitle(t.title)) {
      note = el('span', 'note', `Spotify match: ${m.name}`);
    } else if (inPlaylist(t)) note = el('span', 'note', 'In playlist');
    if (note) main.append(note);
  }

  const side = el('div', 'side');
  if (t.posts.length > 1) side.append(el('span', 'seen', `${t.posts.length} posts`));
  if (isSong) {
    if (m && m.status === 'none') {
      const b = el('button', 'play', pickerKey === t.key ? 'Close' : 'Choose');
      b.title = 'Pick the right song from Spotify search results';
      b.addEventListener('click', () => togglePicker(t));
      side.append(b);
    } else {
      const current = nowKey === t.key && !playlistMode;
      const playing = current && embed.state.playing;
      const label = startingKey === t.key ? 'Starting…' : current ? (playing ? 'Playing' : 'Paused') : 'Play';
      const b = el('button', `play${playing ? ' on' : ''}`, label);
      b.disabled = finding.has(t.key) || startingKey === t.key;
      b.addEventListener('click', () => {
        if (!current) playTrack(t);
        else if (playing) embed.pause();
        else embed.resume();
      });
      side.append(b);
    }
  }
  li.append(side);
}

function pickerRow(t) {
  const li = el('li', 'picker');
  if (!pickerItems) {
    li.append(el('p', null, 'Searching Spotify…'));
    return li;
  }
  li.append(el('p', null, pickerItems.length ? 'Pick the right version:' : 'Spotify search came back empty.'));
  const ul = el('ul');
  for (const c of pickerItems) {
    const row = el('li');
    const label = el('span');
    label.append(document.createTextNode(c.name + ' '), el('small', null, c.artists));
    const use = el('button', null, 'Use');
    use.addEventListener('click', async () => {
      await setMatch(t.key, c);
      pickerKey = null;
      pickerItems = null;
      setMsg(`Matched "${t.title}" to ${c.name} by ${c.artists}.`);
    });
    row.append(label, use);
    ul.append(row);
  }
  li.append(ul);
  const actions = el('div', 'row-actions');
  const a = el('a', null, 'Search Spotify yourself');
  a.href = searchUrl(t);
  a.target = '_blank';
  actions.append(a);
  li.append(actions);
  return li;
}

async function togglePicker(t) {
  if (pickerKey === t.key) {
    pickerKey = null;
    pickerItems = null;
    render();
    return;
  }
  pickerKey = t.key;
  pickerItems = null;
  render();
  try {
    const items = await S.searchCandidates(t);
    if (pickerKey === t.key) {
      pickerItems = items;
      render();
    }
  } catch (err) {
    pickerKey = null;
    handleError(err);
    render();
  }
}

// Keyed list: existing rows stay in the DOM (so nothing re-animates);
// rows for songs captured since the last render roll in from the top.
const rowEls = new Map();
let knownKeys = null;

function renderList(items) {
  const ol = $('#list');
  const animate = knownKeys !== null;
  let stagger = 0;
  const nodes = [];
  for (const t of items) {
    let li = rowEls.get(t.key);
    if (!li) {
      li = el('li');
      rowEls.set(t.key, li);
    }
    if (animate && !knownKeys.has(t.key)) {
      li.classList.add('enter');
      li.style.animationDelay = `${Math.min(stagger++, 8) * 70}ms`;
      li.addEventListener('animationend', (e) => {
        if (e.animationName === 'new-glow') {
          li.classList.remove('enter');
          li.style.animationDelay = '';
        }
      });
    }
    fillRow(li, t);
    nodes.push(li);
    if (pickerKey === t.key) nodes.push(pickerRow(t));
  }
  knownKeys = new Set(Object.keys(st.tracks));

  let cursor = ol.firstChild;
  for (const n of nodes) {
    if (n === cursor) cursor = cursor.nextSibling;
    else ol.insertBefore(n, cursor);
  }
  while (cursor) {
    const nx = cursor.nextSibling;
    cursor.remove();
    cursor = nx;
  }
}

// ---------- panel rendering ----------
function renderSetup() {
  $('#redirect-uri').textContent = S.redirectUri();
  const ok = connected();
  $('#setup-steps').hidden = ok;
  $('#setup-done').hidden = !ok;
  const needsScope = false; // in-panel player needs no extra Spotify permission
  $('#scope-note').hidden = !needsScope;
  $('#reconnect').hidden = !needsScope;
  $('#setup-summary').textContent = !ok ? 'Connect Spotify' : needsScope ? 'Spotify connected, one-click play is off' : 'Spotify connected';
  $('#sp-user').textContent = (st.spotify && st.spotify.user) || 'your account';
  if (!$('#setup').dataset.touched) $('#setup').open = !ok || needsScope;
  const cid = $('#client-id');
  if (document.activeElement !== cid && st.spotify && st.spotify.clientId) cid.value = st.spotify.clientId;
}

function renderBuild() {
  const pl = st.playlist;
  const n = pending().length;
  $('#build-new').hidden = !!pl;
  $('#build-existing').hidden = !pl;
  $('#pl-play').hidden = !pl;
  $('#pl-new').hidden = !pl;
  if (pl) {
    $('#pl-link').textContent = pl.name;
    $('#pl-link').href = pl.url || '#';
  }
  if (!$('#pl-name').value) $('#pl-name').value = defaultName();

  const btn = $('#build-btn');
  if (!connected()) {
    btn.textContent = 'Connect Spotify to build a playlist';
    btn.disabled = busy;
  } else if (pl) {
    btn.textContent = n ? `Add ${n} new ${n === 1 ? 'song' : 'songs'}` : 'No new songs yet';
    btn.disabled = busy || !n;
  } else {
    btn.textContent = n ? `Create playlist with ${n} ${n === 1 ? 'song' : 'songs'}` : 'No songs to add yet';
    btn.disabled = busy || !n;
  }
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    $('#n-song').textContent = list('song').length;
    $('#n-original').textContent = list('original').length;
    document.querySelectorAll('.segment button').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.kind === kind)));

    const items = list(kind);
    renderList(items);
    $('#empty').hidden = items.length > 0;

    const log = st.log || [];
    if (!log.length) $('#status').textContent = 'Waiting for Instagram';
    else {
      const withHits = log.filter((l) => l.hits > 0).length;
      $('#status').textContent =
        `${log.length} responses checked, ${withHits} had music. Last ${ago(log[log.length - 1].at)}.`;
    }
    renderSetup();
    renderBuild();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function load() {
  const s = await chrome.storage.local.get(KEYS);
  st = {
    tracks: s.tracks || {}, log: s.log || [], samples: s.samples || [],
    matches: s.matches || {}, excluded: s.excluded || {},
    spotify: s.spotify || {}, playlist: s.playlist || null, playbackDevice: s.playbackDevice || null,
  };
  render();
  prematch();
}

// While the panel is open, quietly match new songs (newest first) so Play is
// instant and misses show up early. Songs the older matcher gave up on get
// another pass with the broader search.
const needsMatch = (t) => {
  const m = matchOf(t);
  return !m || (m.status === 'none' && (m.v || 1) < S.MATCHER_VERSION);
};
let prematchRunning = false;
async function prematch() {
  if (prematchRunning || !connected()) return;
  prematchRunning = true;
  try {
    for (;;) {
      const next = list('song').find((t) => needsMatch(t) && !finding.has(t.key));
      if (!next || !connected()) break;
      try {
        await setMatch(next.key, await S.matchTrack(next));
      } catch (err) {
        if (err.code === 'AUTH') handleError(err);
        break; // try again on the next capture rather than hammering the API
      }
      await sleep(600);
    }
  } finally {
    prematchRunning = false;
  }
}

// ---------- playback (in-panel Spotify player, docked at the bottom) ----------
let nowKey = null;       // song loaded in the player
let startingKey = null;  // song whose Play was just pressed
let playlistMode = false;
let playToken = 0;
const embed = new EmbedPlayer($('#dock-frame'), {
  onChange: () => { renderDock(); render(); },
  onEnded: () => step(1),
});

function renderDock() {
  const on = !!embed.state.trackId;
  $('#dock').hidden = !on;
  if (!on) return;
  const songs = list('song');
  const i = songs.findIndex((t) => t.key === nowKey);
  $('#dock-pos').textContent = playlistMode ? 'Playlist' : i >= 0 ? `${i + 1} of ${songs.length}` : '';
  $('#dock-prev').disabled = playlistMode || i <= 0;
  $('#dock-next').disabled = playlistMode || i < 0 || i >= songs.length - 1;
}

async function ensureMatch(t) {
  let m = matchOf(t);
  if (m) return m;
  finding.add(t.key);
  render();
  try {
    m = await S.matchTrack(t);
    await setMatch(t.key, m);
    return m;
  } finally {
    finding.delete(t.key);
    render();
  }
}

async function playTrack(t) {
  if (!connected()) {
    $('#setup').open = true;
    setMsg('Connect Spotify to play songs here.', true);
    return;
  }
  const token = ++playToken;
  startingKey = t.key;
  render();
  let m;
  try {
    m = await ensureMatch(t);
  } catch (err) {
    startingKey = null;
    handleError(err);
    render();
    return;
  }
  if (token !== playToken) return; // another song was pressed meanwhile
  if (m.status !== 'matched') {
    startingKey = null;
    setMsg(`Couldn't find "${t.title}" automatically. Use Choose to pick it.`, true);
    render();
    return;
  }
  nowKey = t.key;
  playlistMode = false;
  $('#dock').hidden = false;
  $('#dock-hint').textContent = '';
  const ok = await embed.play(m.id, 'track');
  if (token !== playToken) return;
  startingKey = null;
  showStartHint(ok);
  render();
  renderDock();
}

// Chrome usually lets the player start after a click, but it isn't guaranteed;
// say so once per session, and always when the player reports it didn't start.
let hintedThisSession = false;
let hintTimer = null;
function showStartHint(ok) {
  clearTimeout(hintTimer);
  if (!ok) {
    $('#dock-hint').textContent = 'If it hasn\'t started, tap play in the player.';
  } else if (!hintedThisSession) {
    hintedThisSession = true;
    $('#dock-hint').textContent = 'No sound? Tap play in the player once.';
    hintTimer = setTimeout(() => { $('#dock-hint').textContent = ''; }, 8000);
  } else {
    $('#dock-hint').textContent = '';
  }
}

// Moves through the list (newest first, same order as shown), skipping songs not on Spotify.
async function step(dir) {
  const songs = list('song');
  let i = songs.findIndex((t) => t.key === nowKey);
  if (i < 0) return;
  for (i += dir; i >= 0 && i < songs.length; i += dir) {
    const m = matchOf(songs[i]);
    if (!m || m.status === 'matched') return playTrack(songs[i]);
  }
}

$('#dock-prev').addEventListener('click', () => step(-1));
$('#dock-next').addEventListener('click', () => step(1));
$('#dock-close').addEventListener('click', () => stopEverything());

async function stopEverything() {
  playToken++;
  embed.stop();
  nowKey = null;
  startingKey = null;
  playlistMode = false;
  $('#dock-hint').textContent = '';
  renderDock();
  render();
}

// ---------- playlist ----------
async function build() {
  if (!connected()) {
    $('#setup').open = true;
    $('#setup').dataset.touched = '1';
    $('#setup').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const todo = pending();
  if (!todo.length) return;
  busy = true;
  render();
  try {
    let i = 0;
    for (const t of todo) {
      i++;
      if (!matchOf(t)) {
        setMsg(`Finding songs on Spotify, ${i} of ${todo.length}…`);
        finding.add(t.key);
        render();
        await setMatch(t.key, await S.matchTrack(t));
        finding.delete(t.key);
      }
    }

    let pl = st.playlist;
    const have = new Set(pl ? pl.uris : []);
    const uris = [];
    const keys = [];
    let missing = 0;
    for (const t of todo) {
      const m = matchOf(t);
      if (m && m.status === 'matched') {
        keys.push(t.key);
        if (!have.has(m.uri)) { have.add(m.uri); uris.push(m.uri); }
      } else missing++;
    }

    if (!keys.length) {
      setMsg(`None of those ${missing} songs were found automatically. Use Choose on each to pick them.`, true);
      return;
    }

    if (!pl) {
      setMsg('Creating the playlist…');
      const name = $('#pl-name').value.trim() || defaultName();
      const created = await S.createPlaylist(name, 'Songs found on Instagram Explore, collected by Explore Finds.');
      pl = { id: created.id, url: created.url, name, keys: [], uris: [] };
    }
    if (uris.length) {
      setMsg('Adding songs to Spotify…');
      await S.addItems(pl.id, uris);
    }
    pl.keys.push(...keys);
    pl.uris.push(...uris);
    st.playlist = pl;
    await chrome.storage.local.set({ playlist: pl });

    const added = `Added ${uris.length} ${uris.length === 1 ? 'song' : 'songs'} to "${pl.name}".`;
    setMsg(missing ? `${added} ${missing} need you to pick them with Choose.` : added);
  } catch (err) {
    handleError(err);
  } finally {
    finding.clear();
    busy = false;
    render();
  }
}

async function playPlaylist() {
  const pl = st.playlist;
  if (!pl) return;
  playToken++;
  nowKey = null;
  startingKey = null;
  playlistMode = true;
  $('#dock').hidden = false;
  $('#dock-hint').textContent = '';
  const ok = await embed.play(pl.id, 'playlist');
  showStartHint(ok);
  render();
  renderDock();
}

$('#build-btn').addEventListener('click', build);
$('#pl-play').addEventListener('click', playPlaylist);
$('#pl-new').addEventListener('click', async () => {
  st.playlist = null;
  $('#pl-name').value = defaultName();
  await chrome.storage.local.set({ playlist: null });
  setMsg('The next playlist starts fresh. Your old one stays in Spotify.');
});

// ---------- setup ----------
$('#setup').addEventListener('toggle', () => { $('#setup').dataset.touched = '1'; });

$('#copy-redirect').addEventListener('click', async () => {
  await navigator.clipboard.writeText(S.redirectUri());
  $('#copy-redirect').textContent = 'Copied';
  setTimeout(() => { $('#copy-redirect').textContent = 'Copy'; }, 1500);
});

$('#save-client').addEventListener('click', async () => {
  const v = $('#client-id').value.trim();
  if (!/^[a-z0-9]{32}$/i.test(v)) {
    setMsg('That doesn\'t look like a Client ID. It should be 32 letters and numbers.', true);
    return;
  }
  await S.saveClientId(v);
  setMsg('Client ID saved. Now click Connect Spotify.');
});

async function doConnect() {
  try {
    setMsg('Opening Spotify login…');
    await S.connect();
    $('#setup').dataset.touched = '';
    setMsg('Spotify connected.');
    await load();
  } catch (err) {
    handleError(err);
  }
}

$('#connect').addEventListener('click', async () => {
  const v = $('#client-id').value.trim();
  if (v && (!st.spotify || st.spotify.clientId !== v)) await S.saveClientId(v);
  doConnect();
});
$('#reconnect').addEventListener('click', doConnect);

$('#disconnect').addEventListener('click', async () => {
  await stopEverything();
  await S.disconnect();
  setMsg('Spotify disconnected.');
});

// ---------- list controls & exports ----------
document.querySelectorAll('.segment button').forEach((b) =>
  b.addEventListener('click', () => { kind = b.dataset.kind; render(); }));
$('#explore-only').addEventListener('change', (e) => { exploreOnly = e.target.checked; render(); });

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

$('#dl-csv').addEventListener('click', () => {
  const head = ['kind', 'title', 'artist', 'posts', 'explore_hits', 'first_seen', 'last_seen',
    'example_post', 'spotify_match', 'spotify_url', 'in_playlist'];
  const rows = Object.values(st.tracks)
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.first_seen - a.first_seen)
    .map((t) => {
      const m = matchOf(t);
      return [t.kind, t.title, t.artist, t.posts.length, (t.areas && t.areas.explore) || 0,
        new Date(t.first_seen).toISOString(), new Date(t.last_seen).toISOString(),
        t.posts[0] ? postUrl(t.posts[0]) : '',
        m ? (m.status === 'matched' ? `${m.name} / ${m.artists}` : 'not found') : '',
        m && m.url ? m.url : '', inPlaylist(t) ? 'yes' : ''];
    });
  download(`explore-finds-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv',
    [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'));
});

$('#dl-json').addEventListener('click', () => {
  const { spotify, ...rest } = st; // never export tokens
  const playback = { player: embed.state, recent_spotify_calls: S.callLog };
  download(`explore-finds-debug-${Date.now()}.json`, 'application/json',
    JSON.stringify({ exported_at: new Date().toISOString(), playback, ...rest }, null, 2));
});

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
  await stopEverything();
  pickerKey = null;
  pickerItems = null;
  rowEls.clear();
  $('#list').replaceChildren();
  knownKeys = new Set(); // songs captured after this roll in
  await chrome.storage.local.remove(['tracks', 'log', 'samples', 'matches', 'excluded']);
  setMsg('Cleared. Your Spotify connection and playlist are kept.');
});

chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') load(); });
$('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
setInterval(render, 30_000); // keep "Last … ago" fresh
load();
