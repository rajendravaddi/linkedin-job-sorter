/**
 * src/lib/job-filter.js
 *
 * Filters an array of job records based on user-supplied options.
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
   * Filter an array of job records.
   *
   * @param {Object[]} jobs - Array of job records.
   * @param {Object} [options={}] - Filter options.
   * @param {string}  [options.query]         - Case-insensitive match against title and company.
   * @param {boolean} [options.knownTimeOnly] - Keep only jobs where ageMinutes !== null.
   * @param {boolean} [options.easyApplyOnly] - Keep only jobs where easyApply === true.
   * @param {boolean} [options.hideViewed]    - Keep only jobs where viewed !== true.
   * @returns {Object[]} Filtered array (does NOT mutate input).
   */
  function filterJobs(jobs, options) {
    if (!options) options = {};
    const { query, knownTimeOnly, easyApplyOnly, hideViewed } = options;

    // Prepare query needle once
    const needle = query ? String(query).trim().toLowerCase() : '';

    return jobs.filter(function (job) {
      // Text query: match against title OR company (case-insensitive)
      if (needle) {
        const titleMatch = job.title ? job.title.toLowerCase().includes(needle) : false;
        const companyMatch = job.company ? job.company.toLowerCase().includes(needle) : false;
        if (!titleMatch && !companyMatch) return false;
      }

      // Only jobs with known posting time
      if (knownTimeOnly && job.ageMinutes == null) return false;

      // Only Easy Apply jobs
      if (easyApplyOnly && job.easyApply !== true) return false;

      // Hide viewed jobs
      if (hideViewed && job.viewed === true) return false;

      return true;
    });
  }

  return { filterJobs };
});

