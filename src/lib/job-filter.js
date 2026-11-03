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
   * @param {string}  [options.query]               - Case-insensitive match against title and company.
   * @param {boolean} [options.easyApply]           - Keep only Easy Apply jobs (when externalSite is false).
   * @param {boolean} [options.externalSite]        - Keep only External site jobs (when easyApply is false).
   * @param {boolean} [options.easyApplyOnly]       - Legacy alias for easyApply.
   * @param {boolean} [options.hideViewed]          - Keep only jobs where viewed !== true.
   * @param {boolean} [options.hideApplied]         - Keep only jobs where applied !== true.
   * @param {Set|string[]} [options.deselectedCompanies] - Set/array of company names to exclude.
   * @param {Set|string[]} [options.selectedCompanies]   - Set/array of company names to include.
   * @returns {Object[]} Filtered array (does NOT mutate input).
   */
  function filterJobs(jobs, options) {
    if (!options) options = {};
    const {
      query,
      knownTimeOnly,
      easyApplyOnly,
      easyApply: optEasyApply,
      externalSite: optExternalSite,
      hideViewed,
      hideApplied,
      deselectedCompanies,
      selectedCompanies,
    } = options;

    // Apply process flags (checking both or checking neither has no difference)
    const easyApply = Boolean(optEasyApply != null ? optEasyApply : easyApplyOnly);
    const externalSite = Boolean(optExternalSite);

    // Prepare query needle once
    const needle = query ? String(query).trim().toLowerCase() : '';

    return jobs.filter(function (job) {
      // Text query: match against title OR company (case-insensitive)
      if (needle) {
        const titleMatch = job.title ? job.title.toLowerCase().includes(needle) : false;
        const companyMatch = job.company ? job.company.toLowerCase().includes(needle) : false;
        if (!titleMatch && !companyMatch) return false;
      }

      // Only jobs with known posting time (legacy option support)
      if (knownTimeOnly && job.ageMinutes == null) return false;

      // Apply process:
      // If only easyApply is checked -> only keep easyApply === true
      // If only externalSite is checked -> only keep easyApply !== true
      // If both or neither are checked -> no filter
      if (easyApply && !externalSite) {
        if (job.easyApply !== true) return false;
      } else if (!easyApply && externalSite) {
        if (job.easyApply === true) return false;
      }

      // Hide viewed jobs
      if (hideViewed && job.viewed === true) return false;

      // Hide applied jobs
      if (hideApplied && job.applied === true) return false;

      // Company filters
      const companyName = (job.company && job.company.trim()) ? job.company.trim() : 'Unknown Company';

      if (deselectedCompanies) {
        const ds = deselectedCompanies;
        const isDeselected = (ds.has ? ds.has(companyName) : ds.includes(companyName)) ||
                             (job.company && (ds.has ? ds.has(job.company) : ds.includes(job.company)));
        if (isDeselected) return false;
      }

      if (selectedCompanies) {
        const sc = selectedCompanies;
        const isSelected = (sc.has ? sc.has(companyName) : sc.includes(companyName)) ||
                           (job.company && (sc.has ? sc.has(job.company) : sc.includes(job.company)));
        if (!isSelected) return false;
      }

      return true;
    });
  }

  return { filterJobs };
});

