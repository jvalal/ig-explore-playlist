// Setup helper on Spotify's developer dashboard (content script, developer.spotify.com/dashboard*).
// It coaches the person through making the app Explore Playlist Gen needs, and tells the panel where
// they are (storage key `setupSeen`), so the steps in the panel follow along.
//  - App list (/dashboard), while Explore Playlist Gen has no app yet: points at "Create app".
//  - "Create app": fills the empty fields (name, description, Redirect URI, Web API) and points
//    at Spotify's terms box, then at Save. The person ticks the terms and clicks Save themselves.
//  - The new app's page, reached from that form: its Client ID is saved at once.
//  - Any other app page (/dashboard/{Client ID}): offers "Use this app", and says so when the app
//    lacks Explore Playlist Gen's Redirect URI.
//  - User Management of the app in use: how to let a friend in.
// Observed on the live pages (2026-10-06 and 2026-10-11): #name, #description, #newRedirectUri,
// button[aria-label="Add redirect URI"], checkbox labelled "Web API", #termsAccepted, a submit
// button "Save"; the list links to /dashboard/create; an app page lists its Redirect URIs as
// text and links to /dashboard/{id}/users, which has #name, #email and "Add user" (5 at most).
// The owner of an app does not need to be on that list (the user's own app has none).
(() => {
  try {
    if (window.__efDashboardFor === chrome.runtime.id) return;
    window.__efDashboardFor = chrome.runtime.id;
  } catch (_) {
    return;
  }

  const REDIRECT = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const APP_NAME = 'Explore Playlist Gen';
  const APP_DESC = 'Personal tool: turns songs from my Instagram Explore feed into a Spotify playlist.';
  const APP_PATH = /^\/dashboard\/([0-9a-f]{32})(?:\/|$)/i;

  // ---------- small banner, isolated from the page's styles ----------
  let host = null;
  function banner(html, actions = []) {
    if (!host) {
      host = document.createElement('div');
      host.id = 'explore-finds-helper';
      host.attachShadow({ mode: 'open' });
      document.documentElement.append(host);
    }
    const root = host.shadowRoot;
    root.innerHTML = `<style>
      .b { position: fixed; right: 16px; top: 50%; transform: translateY(-50%); z-index: 2147483647;
        box-sizing: border-box; width: 340px; max-width: calc(100vw - 32px);
        font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #10162a; background: #fff;
        border: 2px solid #4a53e0; border-radius: 12px; padding: 12px 14px; box-shadow: 0 0 0 4px #4a53e033, 0 6px 24px #0003; }
      .t { font-weight: 700; margin-bottom: 4px; color: #3346c9; }
      .a { display: flex; gap: 8px; margin-top: 10px; }
      button { font: inherit; font-weight: 600; border-radius: 8px; padding: 6px 10px; cursor: pointer;
        border: 1px solid #3346c9; background: #3346c9; color: #fff; }
      button.q { background: none; color: #3346c9; border-color: #c9d0e4; }
    </style><div class="b" role="status"><div class="t">Explore Playlist Gen</div><div class="m"></div><div class="a"></div></div>`;
    root.querySelector('.m').innerHTML = html;
    const bar = root.querySelector('.a');
    for (const [label, fn, quiet] of [...actions, ['Close', () => hide(), true]]) {
      const b = document.createElement('button');
      b.textContent = label;
      if (quiet) b.className = 'q';
      b.addEventListener('click', fn);
      bar.append(b);
    }
    place();
  }
  // Where the person is looking: beside the form's fields when there is room to their right,
  // else at the right edge; always at mid-height, so it stays in view while the page scrolls.
  function place() {
    const box = host && host.shadowRoot.querySelector('.b');
    if (!box) return;
    const field = document.querySelector('form #name');
    const r = field && field.getBoundingClientRect();
    const beside = !!r && r.width > 0 && r.right + 24 + (box.offsetWidth || 340) + 16 <= innerWidth;
    box.style.left = beside ? `${Math.round(r.right + 24)}px` : '';
    box.style.right = beside ? 'auto' : '';
  }
  addEventListener('resize', place);
  const hide = () => { if (host) { host.remove(); host = null; } point(null); };

  // A ring around the thing on Spotify's page to press next.
  function point(el) {
    for (const old of document.querySelectorAll('[data-ef-next]')) if (old !== el) old.removeAttribute('data-ef-next');
    if (!el || el.hasAttribute('data-ef-next')) return;
    if (!document.querySelector('#explore-finds-ring')) {
      const style = document.createElement('style');
      style.id = 'explore-finds-ring';
      style.textContent = `[data-ef-next] { outline: 3px solid #3346c9 !important; outline-offset: 4px !important; border-radius: 6px; animation: ef-ring 1.2s ease-in-out infinite; }
        @keyframes ef-ring { 50% { outline-color: #9aa8f5; outline-offset: 7px; } }
        @media (prefers-reduced-motion: reduce) { [data-ef-next] { animation: none; } }`;
      (document.head || document.documentElement).append(style);
    }
    el.setAttribute('data-ef-next', '');
  }

  // Tell the panel where the person is, so its steps follow along.
  let lastSeen = '';
  function seen(page, extra = {}) {
    const key = JSON.stringify([page, extra]);
    if (key === lastSeen) return;
    lastSeen = key;
    try { chrome.storage.local.set({ setupSeen: { page, ...extra, at: Date.now() } }).catch(() => {}); } catch (_) { /* extension reloaded */ }
  }
  const storedClientId = async () => ((await chrome.storage.local.get('spotify')).spotify || {}).clientId || null;
  async function useApp(clientId) {
    const s = (await chrome.storage.local.get('spotify')).spotify || {};
    // Same as the panel's Save: a new Client ID starts a fresh login.
    await chrome.storage.local.set({ spotify: { ...s, clientId, access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null } });
  }

  // ---------- Create app: fill what's empty, then point at what is left ----------
  // React-controlled inputs only notice the native value setter plus an input event.
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const byLabel = (text) => [...document.querySelectorAll('input[type="checkbox"]')]
    .find((c) => c.labels && c.labels[0] && c.labels[0].textContent.trim() === text);

  let filledNote = '';
  function fillCreateForm() {
    const name = document.querySelector('#name');
    const desc = document.querySelector('#description');
    const uri = document.querySelector('#newRedirectUri');
    const add = document.querySelector('button[aria-label="Add redirect URI"]');
    const webApi = byLabel('Web API');
    if (!name || !desc || !uri || !add || !webApi) return false; // not rendered yet, or the page changed

    const done = [];
    if (!name.value) { setValue(name, APP_NAME); done.push('name'); }
    if (!desc.value) { setValue(desc, APP_DESC); done.push('description'); }
    // Added URIs are listed on the page; don't add ours twice.
    const listed = [...document.querySelectorAll('main *, form *')].some((e) => e.childElementCount === 0 && e.textContent.trim() === REDIRECT);
    if (!listed) { setValue(uri, REDIRECT); add.click(); done.push('Redirect URI'); }
    if (!webApi.checked) { webApi.click(); done.push('Web API'); }
    filledNote = done.length ? `Filled in the ${done.join(', ')}.` : 'The form already has what Explore Playlist Gen needs.';
    return true;
  }
  // What is left is the person's: Spotify's terms box, then Save. Called twice a second.
  let termsShown = null;
  function coachCreateForm() {
    const terms = document.querySelector('#termsAccepted');
    const save = [...document.querySelectorAll('form button[type="submit"], main button[type="submit"]')].find((b) => /save/i.test(b.textContent));
    const ticked = !!(terms && terms.checked);
    point(ticked ? save : (terms && terms.labels && terms.labels[0]) || terms);
    seen('create', { filled: true, terms: ticked });
    place();
    if (termsShown === ticked) return;
    if (termsShown === null && terms && terms.scrollIntoView) terms.scrollIntoView({ block: 'center' });
    termsShown = ticked;
    banner(ticked
      ? '<b>Step 1 of 2.</b> Now click <b>Save</b>. Your new app is picked up by itself.'
      : `<b>Step 1 of 2.</b> ${filledNote} Tick Spotify's terms box and click <b>Save</b>. Your new app is picked up by itself.`);
  }

  // ---------- App page ----------
  const NEXT = '<b>Step 2 of 2.</b> Go back to the Explore Playlist Gen panel and press <b>Connect Spotify</b>.';
  // The page lists its Redirect URIs as text; it renders a moment after the address changes.
  const lacksRedirect = () => {
    const text = (document.querySelector('main') || document.body).textContent || '';
    return /Redirect URIs/.test(text) && !text.includes(REDIRECT);
  };
  const REDIRECT_HELP = `This app doesn't list Explore Playlist Gen's Redirect URI yet. Click <b>Edit</b>, add this one, and save:<br><code>${REDIRECT}</code>`;
  const copyRedirect = ['Copy it', () => { try { navigator.clipboard.writeText(REDIRECT); } catch (_) { /* no clipboard */ } }, true];

  async function onAppPage(clientId, fromCreate) {
    let current = null;
    try { current = await storedClientId(); } catch (_) { return; }
    if (fromCreate && current !== clientId) {
      // They just made this app for Explore Playlist Gen: no need to ask.
      try {
        await useApp(clientId);
        banner(`Your app is saved in Explore Playlist Gen. ${NEXT}`);
      } catch (_) {
        banner('Couldn\'t save it (the extension was probably reloaded). Reload this page and try again.');
      }
      return;
    }
    if (current === clientId) {
      if (lacksRedirect()) banner(REDIRECT_HELP, [copyRedirect]);
      else banner('Explore Playlist Gen is already set to use this app. If you haven\'t yet, click <b>Connect Spotify</b> in the Explore Playlist Gen panel.');
      return;
    }
    seen('app');
    banner(`Use this app (<code>${clientId.slice(0, 6)}…</code>) with Explore Playlist Gen?${lacksRedirect() ? `<br><br>${REDIRECT_HELP}` : ''}`, [[
      'Use this app', async () => {
        try {
          await useApp(clientId);
          banner(lacksRedirect() ? `Saved. ${REDIRECT_HELP}<br><br>Then: ${NEXT}` : `Saved. ${NEXT}`, lacksRedirect() ? [copyRedirect] : []);
        } catch (_) {
          banner('Couldn\'t save it (the extension was probably reloaded). Reload this page and try again.');
        }
      },
    ], ...(lacksRedirect() ? [copyRedirect] : [])]);
  }

  // User Management of the app Explore Playlist Gen uses: how to let someone else in.
  async function onUsersPage(clientId) {
    let current = null;
    try { current = await storedClientId(); } catch (_) { return; }
    if (current !== clientId) return;
    banner('To let a friend use Explore Playlist Gen with your key, add their name and the email of their Spotify account here (five people at most), then give them your Client ID. You don\'t need to add yourself.');
  }

  // The app list, for someone who has no app in Explore Playlist Gen yet.
  async function onListPage() {
    let current = null;
    try { current = await storedClientId(); } catch (_) { return; }
    if (current) return;
    const create = document.querySelector('a[href="/dashboard/create"]');
    const apps = [...document.querySelectorAll('a[href^="/dashboard/"]')].filter((a) => APP_PATH.test(a.getAttribute('href')));
    point(apps.length ? null : create);
    seen('list');
    banner(apps.length
      ? '<b>Step 1 of 2.</b> You already have a Spotify app, and Spotify allows one per person. Open it, and Explore Playlist Gen will offer to use it.'
      : '<b>Step 1 of 2.</b> Click <b>Create app</b>. Explore Playlist Gen fills in the form for you.');
  }

  // ---------- follow the dashboard's in-page navigation ----------
  let handledPath = null;
  let previousPath = null;
  let fillTries = 0;
  function check() {
    const path = location.pathname;
    if (path !== handledPath) { previousPath = handledPath; handledPath = path; fillTries = 0; termsShown = null; hide(); }
    if (path === '/dashboard/create') {
      if (fillTries >= 0 && fillTries < 20) {
        fillTries = fillCreateForm() ? -1 : fillTries + 1;
        if (fillTries === 20) {
          banner('Couldn\'t fill this form automatically. The setup steps in the Explore Playlist Gen panel list the values to use ("By hand").');
          seen('create', { filled: false });
        }
      }
      if (fillTries === -1) coachCreateForm();
      return;
    }
    if (fillTries !== 0) return;
    fillTries = -1;
    const m = path.match(APP_PATH);
    if (m && /^\/dashboard\/[0-9a-f]{32}\/users\/?$/i.test(path)) onUsersPage(m[1].toLowerCase());
    else if (m) onAppPage(m[1].toLowerCase(), previousPath === '/dashboard/create');
    else if (/^\/dashboard\/?$/.test(path)) onListPage();
  }
  check();
  setInterval(check, 500);

  if (typeof module !== 'undefined' && module.exports) module.exports = { check, REDIRECT };
})();
