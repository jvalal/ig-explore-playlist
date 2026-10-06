export const $ = (s) => document.querySelector(s);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function setMsg(text, isError = false) {
  const m = $('#msg');
  m.textContent = text || '';
  m.classList.toggle('error', !!isError);
}

export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const postUrl = (p) => `https://www.instagram.com/${p.type === 'clips' ? 'reel' : 'p'}/${encodeURIComponent(p.code)}/`;
export const searchUrl = (t) => `https://open.spotify.com/search/${encodeURIComponent(`${t.title} ${t.artist || ''}`.trim())}`;
