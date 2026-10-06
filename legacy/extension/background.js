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
      console.warn('[Explore Finds] could not reattach to tab', tab.id, err);
    }
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  openOnClick();
  if (reason === 'install' || reason === 'update') reattachToOpenTabs();
});
