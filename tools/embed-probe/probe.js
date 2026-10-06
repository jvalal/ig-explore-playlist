// Records everything that passes between this page and the Spotify embed, with timestamps,
// so the embed's real message protocol can be documented from observation.
const ORIGIN = 'https://open.spotify.com';
const ALLOW = 'autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture';
const $ = (s) => document.querySelector(s);
const T0 = performance.now();
const log = [];

let frame = $('#frame');
let gen = 0;            // increments every time the iframe src changes
let srcSetAt = 0;       // performance.now() of the last src change
let loadsThisGen = 0;
let pending = null;     // { cmd, when: 'load' | 'first' } queued by a "Load + command" button

$('#ver').textContent = `v${chrome.runtime.getManifest().version} · ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || ''}`;

const now = () => Math.round((performance.now() - T0) * 10) / 10;
const activation = () => ({
  active: navigator.userActivation?.isActive ?? null,
  everActive: navigator.userActivation?.hasBeenActive ?? null,
});

function clip(v) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s === undefined) return String(v);
    if (s.length > 4000) return s.slice(0, 4000) + `…[${s.length} chars]`;
    return typeof v === 'string' ? v : JSON.parse(s);
  } catch (_) {
    return `[unserializable ${Object.prototype.toString.call(v)}]`;
  }
}

function add(kind, fields) {
  const entry = {
    t: now(),
    wall: new Date().toISOString(),
    kind,
    gen,
    sinceSrc: srcSetAt ? Math.round(performance.now() - srcSetAt) : null,
    ...fields,
  };
  log.push(entry);
  render(entry);
  return entry;
}

// ---------- receive ----------
window.addEventListener('message', (e) => {
  const fromFrame = e.source === frame.contentWindow;
  add('recv', {
    origin: e.origin,
    fromFrame,
    loadsThisGen,
    dataType: typeof e.data,
    data: clip(e.data),
  });
  if (pending && pending.when === 'first' && fromFrame && e.origin === ORIGIN) {
    const p = pending;
    pending = null;
    send(p.cmd, `auto: first message after load (gen ${gen})`);
  }
});

// ---------- send ----------
function send(payload, why = 'button') {
  const asString = $('#asString').checked;
  const data = asString ? JSON.stringify(payload) : payload;
  const cw = frame.contentWindow;
  add('send', { why, asString, data: clip(data), targetOrigin: ORIGIN, frameSrc: frame.src, activation: activation() });
  if (cw) cw.postMessage(data, ORIGIN);
}

// ---------- iframe lifecycle ----------
function trackId(which) {
  const v = $(`#track${which}`).value.trim();
  const m = v.match(/(?:track[/:])([A-Za-z0-9]{22})/) || v.match(/^([A-Za-z0-9]{22})$/);
  return m ? m[1] : null;
}

function wireFrame(f) {
  f.addEventListener('load', () => {
    loadsThisGen++;
    add('frame', { event: 'load', src: f.src, loadsThisGen });
    if (pending && pending.when === 'load') {
      const p = pending;
      pending = null;
      send(p.cmd, `auto: iframe load event (gen ${gen})`);
    } else if (pending && pending.when === 'delay') {
      const p = pending;
      const g = gen;
      pending = null;
      setTimeout(() => { if (g === gen) send(p.cmd, `auto: 8 s after load, no click (gen ${g})`); }, 8000);
    }
  });
}
wireFrame(frame);

function setSrc(src, why) {
  gen++;
  loadsThisGen = 0;
  srcSetAt = performance.now();
  add('frame', { event: 'set-src', src, why, activation: activation(), allow: frame.getAttribute('allow') });
  frame.src = src;
}

// Rebuild the iframe when the autoplay-permission checkbox changes, so its allow attribute applies.
$('#noAutoplay').addEventListener('change', (e) => {
  const f = document.createElement('iframe');
  f.id = 'frame';
  f.title = 'Spotify player';
  f.setAttribute('allow', e.target.checked ? ALLOW.replace('autoplay; ', '') : ALLOW);
  frame.replaceWith(f);
  frame = f;
  wireFrame(f);
  add('frame', { event: 'iframe-recreated', allow: f.getAttribute('allow') });
});

document.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
  const which = b.dataset.load;
  const id = trackId(which);
  add('ui', { click: b.textContent, activation: activation() });
  if (!id) { add('note', { text: `Track ${which} is not a Spotify track link or ID` }); return; }
  pending = b.dataset.then ? { cmd: { command: b.dataset.then }, when: b.dataset.when } : null;
  setSrc(`${ORIGIN}/embed/track/${id}?utm_source=generator`, b.textContent);
}));

$('#unload').addEventListener('click', () => {
  add('ui', { click: 'Unload' });
  pending = null;
  setSrc('about:blank', 'Unload');
});

document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
  add('ui', { click: b.textContent, activation: activation() });
  send(JSON.parse(b.dataset.cmd));
}));

$('#resumeLater').addEventListener('click', () => {
  add('ui', { click: 'resume in 8 s', activation: activation() });
  const g = gen;
  setTimeout(() => { if (g === gen) send({ command: 'resume' }, 'auto: 8 s timer, no click'); }, 8000);
});

$('#loadUriB').addEventListener('click', () => {
  add('ui', { click: 'loadUri B', activation: activation() });
  const id = trackId('B');
  if (id) send({ command: 'loadUri', uri: `spotify:track:${id}` });
});

$('#sendCustom').addEventListener('click', () => {
  add('ui', { click: 'Send custom', activation: activation() });
  let payload;
  try { payload = JSON.parse($('#custom').value); } catch (err) {
    add('note', { text: `Custom JSON did not parse: ${err.message}` });
    return;
  }
  send(payload, 'custom');
});

$('#addNote').addEventListener('click', () => {
  const text = $('#note').value.trim();
  if (text) add('note', { text });
  $('#note').value = '';
});
$('#note').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addNote').click(); });

// Clicking inside the cross-origin player moves focus into it, which blurs this window.
// That is how presses inside the embed show up in the log.
window.addEventListener('blur', () => add('focus', { event: 'window-blur', activeElement: document.activeElement?.id || document.activeElement?.tagName }));
window.addEventListener('focus', () => add('focus', { event: 'window-focus' }));
document.addEventListener('visibilitychange', () => add('focus', { event: 'visibility', state: document.visibilityState }));

// ---------- output ----------
const logEl = $('#log');
function line(e) {
  const { t, kind, gen: g, sinceSrc } = e;
  const rest = { ...e };
  for (const k of ['t', 'wall', 'kind', 'gen', 'sinceSrc']) delete rest[k];
  return `${String(t).padStart(9)} g${g} +${sinceSrc ?? '-'} ${kind.padEnd(5)} ${JSON.stringify(rest)}`;
}
function render(e) {
  const div = document.createElement('div');
  div.className = e.kind;
  div.textContent = line(e);
  logEl.append(div);
  while (logEl.childElementCount > 300) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
  const recv = log.filter((x) => x.kind === 'recv').length;
  $('#summary').textContent = `${log.length} entries, ${recv} received`;
}

function header() {
  return {
    probe: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    page: location.href,
    startedAt: new Date(Date.now() - (performance.now() - T0)).toISOString(),
    exportedAt: new Date().toISOString(),
  };
}

// Compact: runs of received messages with the same shape keep their first 3 and last 1 entries.
function compact() {
  const shape = (e) => (e.kind === 'recv' ? `${e.origin}|${e.dataType}|${e.data && typeof e.data === 'object' ? (e.data.type ?? e.data.event ?? Object.keys(e.data).sort().join(',')) : 'str'}` : null);
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length <= 5) out.push(...run.map(line));
    else {
      out.push(...run.slice(0, 3).map(line));
      const gaps = run.slice(1).map((e, i) => e.t - run[i].t);
      const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      out.push(`          … ${run.length - 4} more like this (avg ${avg} ms apart) …`);
      out.push(line(run[run.length - 1]));
    }
    run = [];
  };
  for (const e of log) {
    const s = shape(e);
    if (s && run.length && shape(run[0]) === s) run.push(e);
    else { flush(); if (s) run.push(e); else out.push(line(e)); }
  }
  flush();
  return `${JSON.stringify(header())}\n${out.join('\n')}`;
}

$('#copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(compact());
  $('#copy').textContent = 'Copied';
  setTimeout(() => { $('#copy').textContent = 'Copy compact log'; }, 1500);
});

$('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...header(), log }, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `embed-probe-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

$('#clear').addEventListener('click', () => {
  log.length = 0;
  logEl.replaceChildren();
  $('#summary').textContent = '';
});

add('note', { text: 'probe started', activation: activation() });
