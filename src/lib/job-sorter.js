/**
 * src/lib/job-sorter.js
 *
 * Sorts job records by estimated posting age.
 *
 * Modes:
 *   'newest'   (default) – known ages ascending (smaller ageMinutes = newer),
 *                          then unknown ages; ties by originalIndex.
 *   'oldest'             – known ages descending, then unknown; ties by
 *                          originalIndex.
 *   'original'           – by originalIndex ascending (restore LinkedIn order).
 *
 * UMD wrapper — works as CommonJS module in tests and as a plain script in
 * the browser, where it merges onto the global `LJS` namespace.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /**
   * Sort an array of job records without mutating the input.
   *
   * @param {Object[]} jobs - Array of job records.
   * @param {'newest'|'oldest'|'original'} [mode='newest'] - Sort mode.
   * @returns {Object[]} A new sorted array.
   */
  function sortJobs(jobs, mode) {
    if (!mode) mode = 'newest';

    // Return a shallow copy so callers can compare against the original
    const copy = jobs.slice();

    if (mode === 'original') {
      copy.sort((a, b) => a.originalIndex - b.originalIndex);
      return copy;
    }

    copy.sort((a, b) => {
      const aKnown = a.ageMinutes != null;
      const bKnown = b.ageMinutes != null;

      // Unknown ages always go last regardless of mode
      if (aKnown && !bKnown) return -1;
      if (!aKnown && bKnown) return 1;
      if (!aKnown && !bKnown) return a.originalIndex - b.originalIndex;

      // Both known — sort by age
      const ageDiff = mode === 'oldest'
        ? b.ageMinutes - a.ageMinutes   // descending (older first)
        : a.ageMinutes - b.ageMinutes;  // ascending  (newer first)

      if (ageDiff !== 0) return ageDiff;

      // Tie-break by originalIndex
      return a.originalIndex - b.originalIndex;
    });

    return copy;
  }

  return { sortJobs };
});

