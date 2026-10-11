export const $ = (s) => document.querySelector(s);

// When the extension is reloaded, Chrome closes its pages (the panel, the mini player). Whatever
// they still try on the way out fails with "Extension context invalidated" and lands on the
// extension's Errors page. There is nothing to do about it by then, so it isn't reported.
export function quietWhenOrphaned() {
  const gone = (reason) => /Extension context invalidated/i.test(String((reason && reason.message) || reason || ''));
  window.addEventListener('error', (e) => { if (gone(e.error || e.message)) e.preventDefault(); });
  window.addEventListener('unhandledrejection', (e) => { if (gone(e.reason)) e.preventDefault(); });
}

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function setMsg(text, isError = false) {
  // The same line on the songs screen and in Settings' Spotify steps, whichever is in view.
  for (const m of [$('#msg'), $('#setup-msg')]) {
    if (!m) continue;
    m.textContent = text || '';
    m.classList.toggle('error', !!isError);
  }
}

export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const postUrl = (p) => `https://www.instagram.com/${p.type === 'clips' ? 'reel' : 'p'}/${encodeURIComponent(p.code)}/`;
// For links people tap. On iPhone, tapping an instagram.com link opens the Instagram app
// (Universal Links); Instagram's own app-site-association excludes any URL with the fragment
// #weblink, so those stay in the browser (checked 2026-10-06). Harmless on desktop.
export const webLink = (url) => `${url.split('#')[0]}#weblink`;
export const EXPLORE_URL = webLink('https://www.instagram.com/explore/');
export const searchUrl = (t) => `https://open.spotify.com/search/${encodeURIComponent(`${t.title} ${t.artist || ''}`.trim())}`;
