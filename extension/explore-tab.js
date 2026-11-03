// Is the tab in front Instagram Explore? The panel shows an "Open Instagram Explore" link when it
// isn't. Tab addresses are readable only for instagram.com (our host permission); any other
// site reads as no address, which is "not Explore" too.
import { PLATFORM } from './platform.js';

// A post opened from the Explore grid changes the address to /p/… or /reel/…: still there.
export function isExplore(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'www.instagram.com' && /^\/(explore|p|reel)(\/|$)/.test(u.pathname);
  } catch (_) {
    return false;
  }
}

// Chrome's side panel belongs to a browser window; Safari's panel is a window (Mac) or popup
// (iPhone) of its own, so there it is the last browser window used.
const FRONT = PLATFORM === 'safari'
  ? { active: true, lastFocusedWindow: true, windowType: 'normal' }
  : { active: true, currentWindow: true };

// Calls onChange(true|false) now and whenever the tab in front or its address changes.
export function watchExploreTab(onChange) {
  if (!chrome.tabs || !chrome.tabs.query || !chrome.tabs.onActivated || !chrome.tabs.onUpdated) return; // then no link is shown
  let last = null;
  const check = async () => {
    let now = false;
    try {
      const [tab] = await chrome.tabs.query(FRONT);
      now = !!tab && isExplore(tab.url);
    } catch (_) { /* window closing */ }
    if (now !== last) onChange((last = now));
  };
  chrome.tabs.onActivated.addListener(check);
  chrome.tabs.onUpdated.addListener((id, change) => { if (change.url || change.status) check(); });
  if (chrome.windows && chrome.windows.onFocusChanged) chrome.windows.onFocusChanged.addListener(check);
  check();
}
