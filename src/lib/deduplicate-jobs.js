/**
 * src/lib/deduplicate-jobs.js
 *
 * Removes duplicate job records from an array.
 * Duplicates are identified by `id` (if not null) or by normalised `url`.
 * On collision, the record with the lower originalIndex is kept and null
 * fields are filled from the later duplicate.
 *
 * UMD wrapper — works as CommonJS module in tests and as a plain script
 * in the browser, where it merges onto the global `LJS` namespace.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /**
   * Boolean fields that should merge with OR (true wins over null).
   * @type {string[]}
   */
  const BOOLEAN_FIELDS = [
    'easyApply', 'promoted', 'viewed', 'verified', 'earlyApplicant', 'reposted',
  ];

  /**
   * Scalar fields that may be filled from a later duplicate when null in the
   * earlier record.  ageMinutes has special handling and is NOT listed here.
   * @type {string[]}
   */
  const FILLABLE_FIELDS = [
    'company', 'location', 'workplaceType', 'postedText',
    'timePrecision', 'timeStatus', 'url', 'urlSource', 'title',
  ];

  /**
   * Merge fields from `src` into `dest` in place.
   * - Null scalar fields in dest are filled from src.
   * - ageMinutes: keep dest value if known; never replace with null; if both
   *   known and differ, keep dest (earlier record).
   * - Booleans: merge with OR (true beats null).
   *
   * @param {Object} dest - The record to merge INTO (lower originalIndex).
   * @param {Object} src  - The later duplicate to merge FROM.
   */
  function mergeInto(dest, src) {
    // Fill scalar nulls
    for (const field of FILLABLE_FIELDS) {
      if (dest[field] == null && src[field] != null) {
        dest[field] = src[field];
      }
    }

    // ageMinutes: never replace a known value with null
    if (dest.ageMinutes == null && src.ageMinutes != null) {
      dest.ageMinutes = src.ageMinutes;
    }
    // If both known and differ, keep dest (earlier record) — no action needed.

    // Boolean fields: OR merge
    for (const field of BOOLEAN_FIELDS) {
      if (src[field] === true) dest[field] = true;
    }
  }

  /**
   * Normalise a URL string to a canonical form for deduplication purposes.
   * Lowercases the host, strips trailing slash.
   *
   * @param {string|null} url
   * @returns {string|null}
   */
  function normaliseUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      return (u.hostname.toLowerCase() + u.pathname).replace(/\/$/, '');
    } catch (_) {
      return url.trim().toLowerCase().replace(/\/$/, '');
    }
  }

  /**
   * Deduplicate an array of job records.
   *
   * @param {Object[]} jobs - Array of job records (not mutated).
   * @returns {{ jobs: Object[], duplicatesRemoved: number }}
   */
  function deduplicateJobs(jobs) {
    const byId = new Map();   // id string → index in `result`
    const byUrl = new Map();  // normalised url → index in `result`
    const result = [];
    let duplicatesRemoved = 0;

    for (const job of jobs) {
      // Determine dedup key
      if (job.id != null) {
        if (byId.has(job.id)) {
          // Merge into earlier record
          mergeInto(result[byId.get(job.id)], job);
          duplicatesRemoved++;
          continue;
        }
        const idx = result.length;
        byId.set(job.id, idx);
        // Also register URL so URL-keyed lookups won't re-add this
        const nu = normaliseUrl(job.url);
        if (nu) byUrl.set(nu, idx);
        result.push(Object.assign({}, job));
      } else if (job.url != null) {
        const nu = normaliseUrl(job.url);
        if (nu && byUrl.has(nu)) {
          mergeInto(result[byUrl.get(nu)], job);
          duplicatesRemoved++;
          continue;
        }
        const idx = result.length;
        if (nu) byUrl.set(nu, idx);
        result.push(Object.assign({}, job));
      } else {
        // No id and no URL — cannot deduplicate, always keep
        result.push(Object.assign({}, job));
      }
    }

    return { jobs: result, duplicatesRemoved };
  }

  return { deduplicateJobs };
});

