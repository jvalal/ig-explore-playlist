// Safari (iPhone) build: replaces extension/platform.js. See extension/platform.js for the contract.
// Safari has no chrome.identity, so Spotify's login opens in a normal tab. Spotify redirects to a
// loopback address (nothing listens there); the extension sees that URL, takes it, and closes
// the tab. Spotify allows http only for loopback IP literals, hence 127.0.0.1 with a fixed port.
export const PLATFORM = 'safari';
export const REDIRECT = 'http://127.0.0.1:43821/explore-finds';
export const redirectUri = () => REDIRECT;

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export async function launchAuth(url) {
  const tab = await chrome.tabs.create({ url });
  return new Promise((resolve, reject) => {
    let done = false;
    const isRedirect = (u) => typeof u === 'string' && u.startsWith(REDIRECT);
    const onUpdated = (id, info, t) => {
      if (id === tab.id && (isRedirect(info.url) || isRedirect(t && t.url))) finish(resolve, info.url || t.url);
    };
    const onNav = (d) => { if (d.tabId === tab.id && isRedirect(d.url)) finish(resolve, d.url); };
    const onRemoved = (id) => {
      if (id === tab.id) finish(reject, Object.assign(new Error('Spotify login was closed. Try Connect again.'), { code: 'INPUT' }));
    };
    const timer = setTimeout(() => finish(reject, new Error('Spotify login timed out. Try Connect again.')), LOGIN_TIMEOUT_MS);
    function finish(settle, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (chrome.webNavigation) chrome.webNavigation.onBeforeNavigate.removeListener(onNav);
      if (settle === resolve) chrome.tabs.remove(tab.id).catch(() => {});
      settle(value);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    if (chrome.webNavigation) chrome.webNavigation.onBeforeNavigate.addListener(onNav);
  });
}

// The popup closes when the login tab opens, so the whole login runs in the background script
// (background.js answers 'ef-connect'). The popup shows the result the next time it opens.
export async function runConnect() {
  const r = await chrome.runtime.sendMessage({ type: 'ef-connect' });
  if (r && r.error) throw Object.assign(new Error(r.error), { code: r.code });
}
