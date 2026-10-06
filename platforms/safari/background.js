// Safari (iPhone) build background: replaces extension/background.js (no side panel in Safari).
import * as S from './spotify.js';

// Instagram tabs open during an install or update keep the old capture script; give them fresh
// copies (same as the desktop build).
async function reattachToOpenTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['inject.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'] });
    } catch (err) {
      console.warn('[Explore Finds] could not reattach to tab', tab.id, err);
    }
  }
}

// Safari's support for `world: "MAIN"` in manifest content scripts is unconfirmed; Apple says
// registerContentScripts supports it (Safari 16.4+). Register it here as well. inject.js guards
// against running twice in one page.
async function registerMainWorldCapture() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['ef-inject-main'] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{
      id: 'ef-inject-main', js: ['inject.js'], matches: ['https://www.instagram.com/*'], runAt: 'document_start', world: 'MAIN',
    }]);
  } catch (err) {
    console.warn('[Explore Finds] could not register the capture script', err);
  }
}

// The number on the extension's button: songs found on Explore so far (same as the popup's
// list). There's no side panel on iPhone, so this is how progress shows while you scroll.
async function updateBadge() {
  try {
    const { tracks = {} } = await chrome.storage.local.get('tracks');
    const n = Object.values(tracks).filter((t) => t.kind === 'song' && t.areas && t.areas.explore).length;
    await chrome.action.setBadgeText({ text: n ? (n > 999 ? '999+' : String(n)) : '' });
  } catch (err) {
    console.warn('[Explore Finds] could not update the button count', err);
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'tracks' in changes) updateBadge();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  registerMainWorldCapture();
  updateBadge();
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  if (reason === 'install' || reason === 'update') reattachToOpenTabs();
});
chrome.runtime.onStartup.addListener(() => { registerMainWorldCapture(); updateBadge(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ef-connect') return undefined;
  S.connect().then(() => sendResponse({ ok: true }), (err) => sendResponse({ error: err.message, code: err.code || null }));
  return true; // answers asynchronously
});
