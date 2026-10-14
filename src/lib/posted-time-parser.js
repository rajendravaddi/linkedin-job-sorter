/**
 * src/lib/posted-time-parser.js
 *
 * Parses LinkedIn "Posted X ago" / "Reposted X ago" / "just now" labels
 * into a numeric age in minutes.
 *
 * UMD wrapper — works as CommonJS module in tests and as a plain script
 * in the browser where it is merged onto the global `LJS` namespace.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  // ── Constants ─────────────────────────────────────────────────────────────

  /** Minutes per unit keyword. */
  const UNIT_MULTIPLIERS = {
    min: 1, mins: 1, minute: 1, minutes: 1,
    hr: 60, hrs: 60, hour: 60, hours: 60,
    day: 1440, days: 1440,
    week: 10080, weeks: 10080,
  };

  /**
   * Master regex.  Groups:
   *   1 → optional prefix: "posted" | "reposted"
   *   2 → quantity: digits, "a", or "an"
   *   3 → unit keyword (min / hr / day / week + plurals)
   *  (no groups for "just now" — detected by absence of group 2)
   */
  const POSTED_RE = /^(?:(posted|reposted)\s+)?(?:(\d+|an?)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)\s+ago|just now)$/i;

  /**
   * Used to detect "looks like a posting label but didn't fully match" —
   * these get status 'unrecognized' rather than null.
   */
  const LOOKS_LIKE_POSTING_RE = /^(?:posted|reposted)\b|ago$/i;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Collapse internal whitespace and trim a string.
   * @param {string} s
   * @returns {string}
   */
  function collapseWS(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Parse a LinkedIn posting-time label and return a rich result object.
   *
   * @param {string|null|undefined} text - The raw label text.
   * @returns {{ ageMinutes: number|null, reposted: boolean, precision: string, status: string }}
   */
  function parsePostedLabel(text) {
    // Null / undefined guard
    if (text == null) {
      return { ageMinutes: null, reposted: false, precision: 'approximate', status: 'unrecognized' };
    }

    const normalised = collapseWS(String(text));

    const match = POSTED_RE.exec(normalised);
    if (match) {
      const reposted = (match[1] || '').toLowerCase() === 'reposted';

      // "just now" path — groups 2 & 3 are undefined
      if (match[2] === undefined) {
        return { ageMinutes: 0, reposted, precision: 'low', status: 'parsed' };
      }

      // Quantity: "a" / "an" → 1, otherwise parseInt
      const qty = /^an?$/i.test(match[2]) ? 1 : parseInt(match[2], 10);
      const multiplier = UNIT_MULTIPLIERS[match[3].toLowerCase()];
      const ageMinutes = qty * multiplier;

      return { ageMinutes, reposted, precision: 'approximate', status: 'parsed' };
    }

    // Didn't match — decide status
    if (LOOKS_LIKE_POSTING_RE.test(normalised)) {
      return { ageMinutes: null, reposted: false, precision: 'approximate', status: 'unrecognized' };
    }

    // Not a posting label at all
    return { ageMinutes: null, reposted: false, precision: 'approximate', status: 'not-a-label' };
  }

  /**
   * Convenience wrapper — returns only the numeric age in minutes (or null).
   *
   * @param {string|null|undefined} text
   * @returns {number|null}
   */
  function parsePostedAge(text) {
    return parsePostedLabel(text).ageMinutes;
  }

  return { parsePostedLabel, parsePostedAge };
});

