/**
 * src/lib/search-context.js
 *
 * Parses search context (keywords, location, date filter) from a LinkedIn
 * jobs search URL.
 *
 * UMD wrapper — works as CommonJS module in tests and as a plain script
 * injected into the browser page, where it merges onto `window.LJS`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /**
   * Map from LinkedIn's `f_TPR` query-parameter values to human-readable
   * date-filter labels.
   */
  const DATE_FILTER_LABELS = {
    r3600: 'Past hour',
    r86400: 'Past 24 hours',
    r604800: 'Past week',
    r2592000: 'Past month',
  };

  /**
   * Parse search context from a LinkedIn jobs page URL.
   *
   * @param {string} urlString - The full URL string (e.g. window.location.href).
   * @returns {{ keywords: string|null, location: string|null, dateFilterLabel: string|null }}
   */
  function parseSearchContext(urlString) {
    let url;
    try {
      url = new URL(urlString);
    } catch (_) {
      return { keywords: null, location: null, dateFilterLabel: null };
    }

    const keywords = url.searchParams.get('keywords') || null;
    const location = url.searchParams.get('location') || null;

    const fTPR = url.searchParams.get('f_TPR');
    let dateFilterLabel = null;
    if (fTPR) {
      dateFilterLabel = DATE_FILTER_LABELS[fTPR] || fTPR;
    }

    return { keywords, location, dateFilterLabel };
  }

  return { parseSearchContext };
});

