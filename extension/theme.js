// Light / dark / follow system. Runs before the page is drawn (a plain script in <head>), so the
// right colours are there from the first frame.
//   <html data-theme="light|dark|system">  what the person chose (Settings; default: system)
//   <html data-scheme="light|dark">        what is shown; the stylesheet keys on this
// The choice is kept in localStorage (key ef-theme), which every page of the extension shares:
// a change in the panel reaches the mini player through the `storage` event.
(() => {
  const KEY = 'ef-theme';
  const CHOICES = ['light', 'dark', 'system'];
  const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const get = () => {
    try {
      const t = localStorage.getItem(KEY);
      return CHOICES.includes(t) ? t : 'system';
    } catch (_) {
      return 'system';
    }
  };
  const apply = () => {
    const t = get();
    const root = document.documentElement;
    root.dataset.theme = t;
    root.dataset.scheme = t === 'system' ? (dark && dark.matches ? 'dark' : 'light') : t;
  };
  const set = (t) => {
    try { localStorage.setItem(KEY, CHOICES.includes(t) ? t : 'system'); } catch (_) {}
    apply();
  };
  apply();
  if (dark && dark.addEventListener) dark.addEventListener('change', apply);
  window.addEventListener('storage', (e) => { if (!e.key || e.key === KEY) apply(); });
  window.efTheme = { get, set, apply };
})();
