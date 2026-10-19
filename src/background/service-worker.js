
/**
 * src/background/service-worker.js
 */

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;

  // Configure this tab without awaiting the Promise.
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "src/popup/popup.html",
    enabled: true
  }).catch((error) => {
    console.error("[LJS] Failed to configure side panel:", error);
  });

  // Call immediately within the toolbar-click gesture.
  chrome.sidePanel.open({
    tabId: tab.id
  }).catch((error) => {
    console.error("[LJS] Failed to open side panel:", error);
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  console.debug("[LJS] Extension installed/updated:", details.reason);
});
