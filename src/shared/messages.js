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

  /** Message type sent from popup → crawler to start crawling from page 1. */
  const MSG_CRAWL_START = 'LJS_CRAWL_START';

  /** Message type sent from popup → crawler to continue crawling from current page. */
  const MSG_CRAWL_CONTINUE = 'LJS_CRAWL_CONTINUE';

  /** Message type sent from popup → crawler to stop an in-progress crawl. */
  const MSG_CRAWL_STOP = 'LJS_CRAWL_STOP';

  /** Message type sent from crawler → popup reporting single-page progress. */
  const MSG_CRAWL_PROGRESS = 'LJS_CRAWL_PROGRESS';

  /** Message type sent from crawler → popup when crawl run finishes. */
  const MSG_CRAWL_COMPLETE = 'LJS_CRAWL_COMPLETE';

  /** Message type sent from crawler → popup when crawl encounters an error. */
  const MSG_CRAWL_ERROR = 'LJS_CRAWL_ERROR';

  // ── Error codes ──────────────────────────────────────────────────────────

  /** The current page is not a LinkedIn jobs page. */
  const UNSUPPORTED_PAGE = 'UNSUPPORTED_PAGE';

  /** The current page is not a LinkedIn jobs search results page (/jobs/search-results). */
  const NOT_SEARCH_PAGE = 'NOT_SEARCH_PAGE';

  /** The 'Past 24 hours' date posted filter (f_TPR=r86400) is required before crawling. */
  const FILTER_REQUIRED = 'FILTER_REQUIRED';

  /** A jobs page was found but contained no job cards. */
  const NO_CARDS = 'NO_CARDS';

  /** The content script threw an unexpected error during extraction. */
  const EXTRACTION_FAILED = 'EXTRACTION_FAILED';

  /** The popup could not establish a connection to the content-script tab. */
  const TAB_UNREACHABLE = 'TAB_UNREACHABLE';

  /** The crawler timed out waiting for DOM cards to change after clicking Next. */
  const PAGE_CHANGE_TIMEOUT = 'PAGE_CHANGE_TIMEOUT';

  return {
    MSG_EXTRACT,
    MSG_CRAWL_START,
    MSG_CRAWL_CONTINUE,
    MSG_CRAWL_STOP,
    MSG_CRAWL_PROGRESS,
    MSG_CRAWL_COMPLETE,
    MSG_CRAWL_ERROR,
    UNSUPPORTED_PAGE,
    NOT_SEARCH_PAGE,
    FILTER_REQUIRED,
    NO_CARDS,
    EXTRACTION_FAILED,
    TAB_UNREACHABLE,
    PAGE_CHANGE_TIMEOUT,
  };
});

