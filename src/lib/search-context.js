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

  /**
   * Validate whether a URL is a valid LinkedIn job search results page with
   * the 'Past 24 hours' filter applied.
   *
   * @param {string|URL} urlInput - The URL string or URL object.
   * @returns {{ valid: boolean, code?: string, reason?: string }}
   */
  function validateSearchUrl(urlInput) {
    let url;
    try {
      url = typeof urlInput === 'string' ? new URL(urlInput) : urlInput;
    } catch (_) {
      return {
        valid: false,
        code: 'INVALID_URL',
        reason: 'Invalid URL.',
      };
    }

    if (!url || !url.hostname || !url.hostname.includes('linkedin.com')) {
      return {
        valid: false,
        code: 'NOT_LINKEDIN',
        reason: 'Please open LinkedIn in the active tab.',
      };
    }

    const cleanPath = url.pathname.replace(/\/+$/, '');
    if (!cleanPath.startsWith('/jobs/search')) {
      return {
        valid: false,
        code: 'NOT_SEARCH_PAGE',
        reason: 'Please navigate to a LinkedIn job search results page (linkedin.com/jobs/search) to crawl jobs.',
      };
    }

    const fTPR = url.searchParams.get('f_TPR');
    if (fTPR !== 'r86400') {
      return {
        valid: false,
        code: 'FILTER_REQUIRED',
        reason: 'Please apply the "Past 24 hours" date posted filter on LinkedIn before crawling jobs.',
      };
    }

    return { valid: true };
  }

  /**
   * Return a new URL string with the `start` parameter set to 0 (page 1).
   *
   * @param {string} urlString
   * @returns {string}
   */
  function getPage1Url(urlString) {
    try {
      const url = new URL(urlString);
      url.searchParams.set('start', '0');
      return url.toString();
    } catch (_) {
      return urlString;
    }
  }

  return { parseSearchContext, validateSearchUrl, getPage1Url };
});

