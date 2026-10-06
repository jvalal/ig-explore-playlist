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

chrome.runtime.onInstalled.addListener(({ reason }) => {
  registerMainWorldCapture();
  if (reason === 'install' || reason === 'update') reattachToOpenTabs();
});
chrome.runtime.onStartup.addListener(registerMainWorldCapture);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ef-connect') return undefined;
  S.connect().then(() => sendResponse({ ok: true }), (err) => sendResponse({ error: err.message, code: err.code || null }));
  return true; // answers asynchronously
});
