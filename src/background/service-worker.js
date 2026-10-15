/**
 * src/background/service-worker.js
 *
 * Service worker for the LinkedIn Job Sorter extension.
 * - Opens the side panel when the extension toolbar icon is clicked.
 * - Logs install/update events for debugging.
 */

// Open the side panel in the current tab whenever the toolbar icon is clicked.
chrome.action.onClicked.addListener(function (tab) {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onInstalled.addListener(function (details) {
  console.debug('[LJS] Extension installed/updated:', details.reason);
});
