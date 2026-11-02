// Safari build background (iPhone and Mac): replaces extension/background.js (no side panel in Safari).
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
      console.warn('[Explore Playlist Gen] could not reattach to tab', tab.id, err);
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
    console.warn('[Explore Playlist Gen] could not register the capture script', err);
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
    console.warn('[Explore Playlist Gen] could not update the button count', err);
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

// Mac: the build has no popup, so the toolbar button lands here. The panel page opens as a narrow
// window docked at the right of the Safari window, which makes room for it when it is wide enough.
// (On iPhone the popup takes the click and this never fires.)
const PANEL_WIDTH = 400;
const MIN_PAGE_WIDTH = 900; // narrower than this, the panel goes over the page's right edge
// Kept in storage too: Safari unloads an idle background script, and a forgotten id would mean
// a second panel window on the next click.
let panelWindowId = null;
const rememberPanel = (id) => { panelWindowId = id; return chrome.storage.local.set({ panelWindowId: id }); };

async function openPanel(fromWindowId) {
  if (panelWindowId === null) panelWindowId = (await chrome.storage.local.get('panelWindowId')).panelWindowId ?? null;
  if (panelWindowId !== null) {
    try { await chrome.windows.update(panelWindowId, { focused: true }); return; } catch (_) { await rememberPanel(null); }
  }
  const from = await chrome.windows.get(fromWindowId);
  const left = from.left + from.width - PANEL_WIDTH;
  if (from.width - PANEL_WIDTH >= MIN_PAGE_WIDTH) await chrome.windows.update(from.id, { width: from.width - PANEL_WIDTH });
  const url = chrome.runtime.getURL('sidepanel.html');
  const place = { url, left, top: from.top, width: PANEL_WIDTH, height: from.height, focused: true };
  const w = await chrome.windows.create({ ...place, type: 'popup' }).catch(() => chrome.windows.create(place));
  await rememberPanel(w.id);
}
if (chrome.action.onClicked && chrome.windows) {
  chrome.action.onClicked.addListener((tab) => openPanel(tab.windowId).catch((err) => console.warn('[Explore Playlist Gen] could not open the panel', err)));
  chrome.windows.onRemoved.addListener(async (id) => {
    const { panelWindowId: saved } = await chrome.storage.local.get('panelWindowId');
    if (id === panelWindowId || id === saved) await rememberPanel(null);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ef-connect') return undefined;
  S.connect().then(() => sendResponse({ ok: true }), (err) => sendResponse({ error: err.message, code: err.code || null }));
  return true; // answers asynchronously
});
