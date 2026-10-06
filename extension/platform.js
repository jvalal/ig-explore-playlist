// What differs between builds. This is the desktop Chrome version; the Safari (iPhone) build
// replaces this file with platforms/safari/platform.js.
//   redirectUri()   the Spotify Redirect URI for this build
//   launchAuth(url) opens Spotify's login and resolves to the URL Spotify redirected back to
//   runConnect(fn)  where the login runs: here, right in the panel
export const PLATFORM = 'chrome';
export const redirectUri = () => chrome.identity.getRedirectURL();
export const launchAuth = (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true });
export const runConnect = (connect) => connect();
