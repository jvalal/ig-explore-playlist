// Clicking the toolbar icon opens the side panel instead of a popup.
const openOnClick = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.runtime.onStartup.addListener(openOnClick);
openOnClick();

// Instagram tabs that were open during an install or update keep running the
// old capture script, which can no longer save anything. Give them fresh copies
// so capture continues without reloading the tab.
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

chrome.runtime.onInstalled.addListener(({ reason }) => {
  openOnClick();
  if (reason === 'install' || reason === 'update') reattachToOpenTabs();
});

// ---------- mini player window ----------
// One pop-out player window at a time. Its id lives in storage.session (cleared when the browser
// quits) and is checked against the real window list, so a stale id never blocks a new window.
const MINI_SIZE = { width: 360, height: 200 };

async function miniWindowId() {
  const { miniWindowId: id } = await chrome.storage.session.get('miniWindowId');
  if (!id) return null;
  try {
    await chrome.windows.get(id);
    return id;
  } catch (_) {
    await chrome.storage.session.remove('miniWindowId');
    return null;
  }
}

// what: { key, startAt? (seconds) }, the song. from: the normal window the request came from, so
// "Back to panel" can open the side panel there.
async function openMini(what = {}, from = null) {
  const id = await miniWindowId();
  if (id) {
    await chrome.windows.update(id, { focused: true });
    if (what.key) chrome.runtime.sendMessage({ type: 'ef-player', cmd: 'play', key: what.key, startAt: what.startAt }).catch(() => {});
    return id;
  }
  const q = new URLSearchParams();
  if (what.key) q.set('key', what.key);
  if (what.startAt > 0) q.set('t', String(Math.floor(what.startAt)));
  if (from) q.set('from', String(from));
  const w = await chrome.windows.create({ type: 'popup', url: `player.html?${q}`, ...MINI_SIZE, focused: true });
  await chrome.storage.session.set({ miniWindowId: w.id });
  return w.id;
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { miniWindowId: mini } = await chrome.storage.session.get('miniWindowId');
  if (id !== mini) return;
  await chrome.storage.session.remove('miniWindowId');
  const { nowPlaying } = await chrome.storage.local.get('nowPlaying');
  if (nowPlaying && nowPlaying.host === 'mini') await chrome.storage.local.remove('nowPlaying');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'ef-open-mini') return undefined;
  openMini(msg, msg.from || (sender.tab && sender.tab.windowId) || null)
    .then((id) => sendResponse({ ok: true, windowId: id }), (err) => sendResponse({ error: err.message }));
  return true;
});
