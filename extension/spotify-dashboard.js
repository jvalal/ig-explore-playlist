// Setup helper on Spotify's developer dashboard (content script, developer.spotify.com/dashboard*).
//  - On "Create app": fills the empty fields (name, description, Redirect URI, Web API).
//    The person still ticks Spotify's terms and clicks Save themselves.
//  - On an app's page (/dashboard/{Client ID}): offers "Use this app in Explore Finds", which
//    saves that Client ID the same way the panel's Save button does.
// Field ids observed on the live page, 2026-10-06: #name, #description, #newRedirectUri,
// button[aria-label="Add redirect URI"], checkbox labelled "Web API", #termsAccepted.
(() => {
  try {
    if (window.__efDashboardFor === chrome.runtime.id) return;
    window.__efDashboardFor = chrome.runtime.id;
  } catch (_) {
    return;
  }

  const REDIRECT = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const APP_NAME = 'Explore Finds';
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
      .b { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 340px;
        font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #10162a; background: #fff;
        border: 1px solid #c9d0e4; border-radius: 12px; padding: 12px 14px; box-shadow: 0 6px 24px #0003; }
      .t { font-weight: 700; margin-bottom: 4px; color: #3346c9; }
      .a { display: flex; gap: 8px; margin-top: 10px; }
      button { font: inherit; font-weight: 600; border-radius: 8px; padding: 6px 10px; cursor: pointer;
        border: 1px solid #3346c9; background: #3346c9; color: #fff; }
      button.q { background: none; color: #3346c9; border-color: #c9d0e4; }
    </style><div class="b" role="status"><div class="t">Explore Finds</div><div class="m"></div><div class="a"></div></div>`;
    root.querySelector('.m').innerHTML = html;
    const bar = root.querySelector('.a');
    for (const [label, fn, quiet] of [...actions, ['Close', () => hide(), true]]) {
      const b = document.createElement('button');
      b.textContent = label;
      if (quiet) b.className = 'q';
      b.addEventListener('click', fn);
      bar.append(b);
    }
  }
  const hide = () => { if (host) { host.remove(); host = null; } };

  // ---------- Create app: fill what's empty ----------
  // React-controlled inputs only notice the native value setter plus an input event.
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const byLabel = (text) => [...document.querySelectorAll('input[type="checkbox"]')]
    .find((c) => c.labels && c.labels[0] && c.labels[0].textContent.trim() === text);

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

    banner(`${done.length ? `Filled in the ${done.join(', ')}.` : 'The form already has what Explore Finds needs.'}
      Tick Spotify's terms box and click <b>Save</b>. Then this helper picks up the new app.`);
    return true;
  }

  // ---------- App page: offer to use this Client ID ----------
  async function offerClientId(clientId) {
    let current = null;
    try { current = ((await chrome.storage.local.get('spotify')).spotify || {}).clientId || null; } catch (_) { return; }
    if (current === clientId) {
      banner('Explore Finds is already set to use this app. If you haven\'t yet, click <b>Connect Spotify</b> in the Explore Finds panel.');
      return;
    }
    banner(`Use this app (<code>${clientId.slice(0, 6)}…</code>) with Explore Finds?`, [[
      'Use this app', async () => {
        try {
          const s = (await chrome.storage.local.get('spotify')).spotify || {};
          // Same as the panel's Save: a new Client ID starts a fresh login.
          await chrome.storage.local.set({ spotify: { ...s, clientId, access_token: null, refresh_token: null, expires_at: 0, user: null, scope: null } });
          banner('Saved. Now click <b>Connect Spotify</b> in the Explore Finds panel.');
        } catch (_) {
          banner('Couldn\'t save it (the extension was probably reloaded). Reload this page and try again.');
        }
      },
    ]]);
  }

  // ---------- follow the dashboard's in-page navigation ----------
  let handledPath = null;
  let fillTries = 0;
  function check() {
    const path = location.pathname;
    if (path !== handledPath) { handledPath = path; fillTries = 0; hide(); }
    if (path === '/dashboard/create') {
      if (fillTries >= 0 && fillTries < 20) {
        fillTries = fillCreateForm() ? -1 : fillTries + 1;
        if (fillTries === 20) banner('Couldn\'t fill this form automatically. The setup steps in the Explore Finds panel list the values to use.');
      }
      return;
    }
    const m = path.match(APP_PATH);
    if (m && fillTries === 0) { fillTries = -1; offerClientId(m[1].toLowerCase()); }
  }
  check();
  setInterval(check, 500);

  if (typeof module !== 'undefined' && module.exports) module.exports = { check, REDIRECT };
})();
