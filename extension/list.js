// The captured-songs list. Keyed: existing rows stay in the DOM (so nothing re-animates);
// rows for songs captured since the last render roll in from the top.
import { $, el, postUrl, searchUrl, webLink } from './dom.js';
import { coreTitle } from './spotify.js';
import { matchOf, inPlaylist } from './store.js';

const PLAY_ICON = 'M2.500 1l7 4-7 4z';
const PAUSE_ICON = 'M2 1h2.200v8H2zM5.800 1H8v8H5.800z';
// Repeatable pseudo-random numbers (0..1) from a string, for a song's wave shape.
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const rowEls = new Map();
let knownKeys = null;

// After Clear: forget every row, and let everything captured afterwards roll in.
export function resetList() {
  rowEls.clear();
  $('#list').replaceChildren();
  knownKeys = new Set();
}

// ctx: { st, items, finding(key), rowPlayback(t) -> {label, on, disabled}, picker: {key, items},
//        onToggleExclude(t, on), onPlayButton(t), onChoose(t), onUse(t, candidate) }
export function renderList(ctx) {
  const ol = $('#list');
  const animate = knownKeys !== null;
  let stagger = 0;
  const nodes = [];
  for (const t of ctx.items) {
    let li = rowEls.get(t.key);
    if (!li) {
      li = el('li');
      rowEls.set(t.key, li);
    }
    if (animate && !knownKeys.has(t.key)) {
      li.classList.add('enter');
      li.style.animationDelay = `${Math.min(stagger++, 8) * 70}ms`;
      li.addEventListener('animationend', (e) => {
        if (e.animationName.startsWith('new-glow')) { // new-glow, or new-glow-card in the light look
          li.classList.remove('enter');
          li.style.animationDelay = '';
        }
      });
    }
    fillRow(li, t, ctx);
    nodes.push(li);
    if (ctx.picker.key === t.key) nodes.push(pickerRow(t, ctx));
  }
  knownKeys = new Set(Object.keys(ctx.st.tracks));

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

// A row is rebuilt only when what it shows changes. The play button is otherwise updated in
// place: replacing it between mousedown and mouseup swallows the click, and the player
// reports several times a second while a song plays.
function fillRow(li, t, ctx) {
  li._t = t;
  li._ctx = ctx;
  const { st } = ctx;
  const isSong = t.kind === 'song';
  const m = matchOf(st, t);
  let note = null;
  if (isSong) {
    if (ctx.finding(t.key)) note = ['note', 'Finding on Spotify…'];
    else if (m && m.status === 'none') note = ['note miss', 'Not found automatically'];
    else if (m && m.status === 'matched' && coreTitle(m.name) !== coreTitle(t.title)) note = ['note', `Spotify match: ${m.name}`];
    else if (inPlaylist(st, t)) note = ['note', 'In playlist'];
  }
  const choose = isSong && m && m.status === 'none';
  // With a playlist, a row says which side of it the song is on: already in it (a mark where
  // the checkbox was), or new, which is what the Add button counts (checked, and on Spotify).
  const inPl = isSong && inPlaylist(st, t);
  const fresh = isSong && !!st.playlist && !inPl && !st.excluded[t.key] && !choose;
  const sig = JSON.stringify([isSong, !!st.excluded[t.key], t.title, t.artist, t.posts[0] && postUrl(t.posts[0]),
    t.posts.length, note, choose, choose && ctx.picker.key === t.key, inPl, fresh]);

  if (li._sig !== sig) {
    li._sig = sig;
    buildRow(li, t, { isSong, excluded: !!st.excluded[t.key], note, choose, pickerOpen: ctx.picker.key === t.key, inPl, fresh });
  }
  if (li._play) {
    // A round icon button; the word (Play / Pause / Starting…) is there for screen readers and
    // as the tooltip. Updated in place, never rebuilt (see above).
    const p = ctx.rowPlayback(t);
    if (li._play.textContent !== p.label) {
      li._play.querySelector('.sr').textContent = p.label;
      li._play.querySelector('path').setAttribute('d', p.label === 'Pause' ? PAUSE_ICON : PLAY_ICON);
      li._play.title = p.label;
    }
    li._play.classList.toggle('on', !!p.on);
    li._play.disabled = !!p.disabled;
    li.classList.toggle('current', !!p.current); // the song in the player: tinted
    li.classList.toggle('playing', !!p.on);      // ...and while it plays, its bars move
  } else li.classList.remove('current', 'playing');
}

function buildRow(li, t, { isSong, excluded, note, choose, pickerOpen, inPl, fresh }) {
  const entering = li.classList.contains('enter');
  li.className = `row${isSong ? '' : ' no-check'}${excluded ? ' skipped' : ''}${entering ? ' enter' : ''}${li.classList.contains('current') ? ' current' : ''}${li.classList.contains('playing') ? ' playing' : ''}`;
  li.replaceChildren();
  li._play = null;

  if (inPl) {
    const mark = el('span', 'in-pl-mark');
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', 'In your playlist');
    mark.title = 'In your playlist';
    mark.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M4.800 8.300l2.200 2.200 4.200-4.600"/></svg>';
    li.append(mark);
  } else if (isSong) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !excluded;
    cb.title = 'Include in playlist';
    cb.setAttribute('aria-label', `Include ${t.title} in playlist`);
    cb.addEventListener('change', () => li._ctx.onToggleExclude(li._t, cb.checked));
    li.append(cb);
  }

  const main = el(t.posts[0] ? 'a' : 'div', 'main');
  if (t.posts[0]) {
    main.href = webLink(postUrl(t.posts[0]));
    main.target = '_blank';
    main.title = 'Open a post that uses this audio';
  }
  main.append(
    el('span', 'title', t.title),
    el('span', 'artist', !isSong && t.artist ? `@${t.artist}` : t.artist || 'Unknown artist')
  );
  if (note) main.append(el('span', note[0], note[1]));
  li.append(main);

  // Right-hand side, left to right: post count, the wave, "New", the button.
  const side = el('div', 'side');
  if (t.posts.length > 1) side.append(el('span', 'seen', `${t.posts.length} posts`));
  if (isSong && !choose) side.append(waveFor(t));
  if (fresh) {
    const badge = el('span', 'new', 'New');
    badge.title = 'Not in your playlist yet';
    side.append(badge);
  }
  if (isSong) {
    if (choose) {
      const b = el('button', 'play', pickerOpen ? 'Close' : 'Choose');
      b.title = 'Pick the right song from Spotify search results';
      b.addEventListener('click', () => li._ctx.onChoose(li._t));
      side.append(b);
    } else {
      const b = el('button', 'play round');
      b.innerHTML = `<svg class="icon" viewBox="0 0 10 10" aria-hidden="true"><path d="${PLAY_ICON}"/></svg><span class="sr">Play</span>`;
      b.title = 'Play';
      b.addEventListener('click', () => li._ctx.onPlayButton(li._t));
      li._play = b;
      side.append(b);
    }
  }
  li.append(side);
}

// The wave on the row of the song in the player (CSS shows it only there). Its shape is not the
// real sound: the extension can't hear Spotify's player. Each song gets its own shape, worked
// out from its name, so it looks the same every time. What is real is how far it is filled:
// the panel marks the bars up to the song's position (`showProgress`).
const WAVE_BARS = 18;
function waveFor(t) {
  const wave = el('span', 'wave');
  wave.setAttribute('aria-hidden', 'true');
  const rand = seeded(t.key);
  for (let i = 0; i < WAVE_BARS; i++) {
    const bar = el('i');
    // Taller toward the middle, like a waveform, with the song's own unevenness.
    const hump = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / WAVE_BARS);
    bar.style.setProperty('--h', (hump * (0.45 + 0.55 * rand())).toFixed(2));
    bar.style.setProperty('--t', `${Math.round(520 + 620 * rand())}ms`);
    bar.style.setProperty('--at', `-${Math.round(900 * rand())}ms`);
    wave.append(bar);
  }
  return wave;
}

// Fills the current row's wave up to `fraction` (0..1) of the song, like SoundCloud; null clears
// it (position unknown). Only classes on the bars change, so no button is ever replaced.
export function showProgress(fraction) {
  const wave = document.querySelector('#list > li.row.current .wave');
  if (!wave) return;
  const n = wave.children.length;
  for (let i = 0; i < n; i++) wave.children[i].classList.toggle('done', fraction !== null && (i + 0.5) / n <= fraction);
}

function pickerRow(t, ctx) {
  const li = el('li', 'picker');
  const items = ctx.picker.items;
  if (!items) {
    li.append(el('p', null, 'Searching Spotify…'));
    return li;
  }
  li.append(el('p', null, items.length ? 'Pick the right version:' : 'Spotify search came back empty.'));
  const ul = el('ul');
  for (const c of items) {
    const row = el('li');
    const label = el('span');
    label.append(document.createTextNode(c.name + ' '), el('small', null, c.artists));
    const use = el('button', null, 'Use');
    use.addEventListener('click', () => ctx.onUse(t, c));
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
