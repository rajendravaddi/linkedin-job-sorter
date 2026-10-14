/**
 * src/shared/messages.js
 *
 * Shared message type constants and error codes used by both the content
 * script and the popup / service worker.
 *
 * Uses a UMD wrapper so the file works both as a CommonJS module (in Node
 * tests) and as a plain script tag / content-script injection in the browser,
 * where everything is merged onto the global `LJS` namespace.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /** Message type sent from popup → content script to request extraction. */
  const MSG_EXTRACT = 'LJS_EXTRACT';

  // ── Error codes ──────────────────────────────────────────────────────────

  /** The current page is not a LinkedIn jobs page. */
  const UNSUPPORTED_PAGE = 'UNSUPPORTED_PAGE';

  /** A jobs page was found but contained no job cards. */
  const NO_CARDS = 'NO_CARDS';

  /** The content script threw an unexpected error during extraction. */
  const EXTRACTION_FAILED = 'EXTRACTION_FAILED';

  /** The popup could not establish a connection to the content-script tab. */
  const TAB_UNREACHABLE = 'TAB_UNREACHABLE';

  return {
    MSG_EXTRACT,
    UNSUPPORTED_PAGE,
    NO_CARDS,
    EXTRACTION_FAILED,
    TAB_UNREACHABLE,
  };
});

