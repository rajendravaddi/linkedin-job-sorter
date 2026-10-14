/**
 * src/background/service-worker.js
 *
 * Minimal service worker for the LinkedIn Job Sorter extension.
 * Logs install/update events for debugging.
 */
chrome.runtime.onInstalled.addListener(function (details) {
  console.debug('[LJS] Extension installed/updated:', details.reason);
});

