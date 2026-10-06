// The captured-songs list. Keyed: existing rows stay in the DOM (so nothing re-animates);
// rows for songs captured since the last render roll in from the top.
import { $, el, postUrl, searchUrl } from './dom.js';
import { coreTitle } from './spotify.js';
import { matchOf, inPlaylist } from './store.js';

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
        if (e.animationName === 'new-glow') {
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
  const sig = JSON.stringify([isSong, !!st.excluded[t.key], t.title, t.artist, t.posts[0] && postUrl(t.posts[0]),
    t.posts.length, note, choose, choose && ctx.picker.key === t.key]);

  if (li._sig !== sig) {
    li._sig = sig;
    buildRow(li, t, { isSong, excluded: !!st.excluded[t.key], note, choose, pickerOpen: ctx.picker.key === t.key });
  }
  if (li._play) {
    const p = ctx.rowPlayback(t);
    if (li._play.textContent !== p.label) li._play.textContent = p.label;
    li._play.classList.toggle('on', !!p.on);
    li._play.disabled = !!p.disabled;
  }
}

function buildRow(li, t, { isSong, excluded, note, choose, pickerOpen }) {
  const entering = li.classList.contains('enter');
  li.className = `row${isSong ? '' : ' no-check'}${excluded ? ' skipped' : ''}${entering ? ' enter' : ''}`;
  li.replaceChildren();
  li._play = null;

  if (isSong) {
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
    main.href = postUrl(t.posts[0]);
    main.target = '_blank';
    main.title = 'Open a post that uses this audio';
  }
  main.append(
    el('span', 'title', t.title),
    el('span', 'artist', !isSong && t.artist ? `@${t.artist}` : t.artist || 'Unknown artist')
  );
  if (note) main.append(el('span', note[0], note[1]));
  li.append(main);

  const side = el('div', 'side');
  if (t.posts.length > 1) side.append(el('span', 'seen', `${t.posts.length} posts`));
  if (isSong) {
    if (choose) {
      const b = el('button', 'play', pickerOpen ? 'Close' : 'Choose');
      b.title = 'Pick the right song from Spotify search results';
      b.addEventListener('click', () => li._ctx.onChoose(li._t));
      side.append(b);
    } else {
      const b = el('button', 'play', 'Play');
      b.addEventListener('click', () => li._ctx.onPlayButton(li._t));
      li._play = b;
      side.append(b);
    }
  }
  li.append(side);
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
