/**
 * src/lib/card-extractor.js
 *
 * Extracts structured job data from a LinkedIn jobs page DOM.
 * Does NOT touch chrome.* or window directly.
 *
 * UMD wrapper — works as CommonJS module in tests and as a plain script
 * injected into the browser page, where it merges onto the global LJS namespace.
 *
 * IMPORTANT: parsePostedLabel is accessed via `root.LJS.parsePostedLabel` at
 * call time so that both browser (LJS on self/globalThis) and Node tests
 * (LJS on globalThis, populated by requiring posted-time-parser.js first)
 * work correctly.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function (root) {

  // ── Constants ─────────────────────────────────────────────────────────────

  const JOB_ID_RE = /job-card-component-ref-(\d{6,})$/;
  const VALID_JOB_ID_RE = /^\d{6,}$/;
  const JOBS_VIEW_RE = /\/jobs\/view\/(\d{6,})/;
  const VALID_URL_RE = /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/;
  const LOCATION_WORKPLACE_RE = /^(.*)\s*\((On-site|Remote|Hybrid)\)$/i;
  const VERIFIED_JOB_RE = /\(Verified job\)$/i;
  const WORKPLACE_CANONICAL = { 'on-site': 'On-site', 'remote': 'Remote', 'hybrid': 'Hybrid' };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Collapse internal whitespace and trim.
   * @param {string} s
   * @returns {string}
   */
  function cleanText(s) {
    if (!s) return '';
    return String(s).replace(/\s+/g, ' ').trim();
  }

  /**
   * Read "twin text" from a paragraph element that contains both a screen-
   * reader span and an aria-hidden visual span.
   *
   * @param {Element} p
   * @returns {{ sr: string, visible: string }}
   */
  function readTwinText(p) {
    // Screen-reader text: first child span WITHOUT aria-hidden='true'
    const spans = p.querySelectorAll('span');
    let srSpan = null;
    for (const span of spans) {
      if (span.getAttribute('aria-hidden') !== 'true') {
        // Only direct child spans of p, not nested
        if (span.parentElement === p) {
          srSpan = span;
          break;
        }
      }
    }

    // Visible text: first child span WITH aria-hidden='true'
    let visibleSpan = null;
    for (const span of spans) {
      if (span.getAttribute('aria-hidden') === 'true' && span.parentElement === p) {
        visibleSpan = span;
        break;
      }
    }

    let sr = '';
    let visible = '';

    if (srSpan || visibleSpan) {
      sr = srSpan ? cleanText(srSpan.textContent) : '';

      if (visibleSpan) {
        // Clone and remove all child elements to avoid sub-element text duplication
        const clone = visibleSpan.cloneNode(true);
        // Remove all element children, keep only direct text nodes
        const children = Array.from(clone.children);
        for (const child of children) {
          clone.removeChild(child);
        }
        visible = cleanText(clone.textContent);
      }
    } else {
      // No spans — fall back to full text content
      const text = cleanText(p.textContent);
      sr = text;
      visible = text;
    }

    return { sr, visible };
  }

  /**
   * Check whether a paragraph contains only separator characters (· or whitespace).
   * @param {Element} p
   * @returns {boolean}
   */
  function isSeparator(p) {
    return /^[\s·]*$/.test(p.textContent);
  }

  /**
   * Extract a job ID from a card element.
   * Priority: componentkey attribute → /jobs/view/ anchor → data-* attributes.
   *
   * @param {Element} card
   * @returns {string|null}
   */
  function extractJobId(card) {
    // a) Digits at end of componentkey
    const ck = card.getAttribute('componentkey') || '';
    const ckMatch = JOB_ID_RE.exec(ck);
    if (ckMatch && VALID_JOB_ID_RE.test(ckMatch[1])) {
      return ckMatch[1];
    }

    // b) Digits from /jobs/view/ anchor inside card
    const anchor = card.querySelector('a[href*="/jobs/view/"]');
    if (anchor) {
      const m = JOBS_VIEW_RE.exec(anchor.getAttribute('href') || '');
      if (m && VALID_JOB_ID_RE.test(m[1])) return m[1];
    }

    // c) data-* attributes
    for (const attr of ['data-occludable-job-id', 'data-job-id']) {
      const val = card.getAttribute(attr);
      if (val && VALID_JOB_ID_RE.test(val.trim())) return val.trim();
    }

    // data-entity-urn containing urn:li:jobPosting:
    const urn = card.getAttribute('data-entity-urn') || '';
    const urnMatch = /urn:li:jobPosting:(\d{6,})/.exec(urn);
    if (urnMatch && VALID_JOB_ID_RE.test(urnMatch[1])) return urnMatch[1];

    return null;
  }

  /**
   * Find all outermost job card elements in the document.
   *
   * @param {Document} doc
   * @returns {Element[]}
   */
  function findCards(doc) {
    // Step 1: primary strategy — componentkey attribute
    let candidates = Array.from(
      doc.querySelectorAll("[componentkey^='job-card-component-ref-']")
    );

    if (candidates.length > 0) {
      // Keep only outermost — drop any node nested inside another match
      return candidates.filter(
        node => node.parentElement == null ||
          node.parentElement.closest("[componentkey^='job-card-component-ref-']") == null
      );
    }

    // Step 2: fallback strategies
    const seen = new Set();
    const fallback = [];

    const tryAdd = (el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      fallback.push(el);
    };

    for (const el of doc.querySelectorAll('[data-occludable-job-id]')) tryAdd(el);
    for (const el of doc.querySelectorAll('[data-job-id]')) tryAdd(el);
    for (const el of doc.querySelectorAll('[data-entity-urn*="urn:li:jobPosting:"]')) tryAdd(el);
    for (const anchor of doc.querySelectorAll('a[href*="/jobs/view/"]')) {
      // Find closest reasonable container
      let container = anchor.parentElement;
      while (container && container !== doc.body) {
        if (container.querySelectorAll('a[href*="/jobs/view/"]').length === 1) {
          tryAdd(container);
          break;
        }
        container = container.parentElement;
      }
    }

    return fallback;
  }

  // ── Main export ───────────────────────────────────────────────────────────

  /**
   * Extract structured job records from a LinkedIn jobs page document.
   *
   * @param {Document} doc - The page document (or a fragment document in tests).
   * @param {Date} [now=new Date()] - Timestamp to use for `extractedAt`.
   * @returns {{ jobs: Object[], stats: { cardsFound: number, jobsExtracted: number, malformedSkipped: number } }}
   */
  function extractJobsFromDocument(doc, now) {
    if (!now) now = new Date();
    const extractedAt = now.toISOString();

    const cards = findCards(doc);
    const stats = { cardsFound: cards.length, jobsExtracted: 0, malformedSkipped: 0 };
    const jobs = [];

    for (let originalIndex = 0; originalIndex < cards.length; originalIndex++) {
      const card = cards[originalIndex];
      try {
        const job = extractSingleCard(card, originalIndex, extractedAt);
        if (job === null) {
          stats.malformedSkipped++;
        } else {
          jobs.push(job);
          stats.jobsExtracted++;
        }
      } catch (err) {
        stats.malformedSkipped++;
      }
    }

    return { jobs, stats };
  }

  /**
   * Extract a single job record from a card element.
   * Returns null if the card is malformed (missing title).
   *
   * @param {Element} card
   * @param {number} originalIndex
   * @param {string} extractedAt
   * @returns {Object|null}
   */
  function extractSingleCard(card, originalIndex, extractedAt) {
    const id = extractJobId(card);

    // ── Collect and classify paragraphs ────────────────────────────────────
    const paragraphs = Array.from(card.querySelectorAll('p'));

    let postingParagraph = null;    // Element
    let viewed = null;
    let earlyApplicant = null;
    let easyApply = null;
    let promoted = null;
    const contentCandidates = [];   // paragraphs that are content (title/company/location)

    for (const p of paragraphs) {
      // Skip separator-only paragraphs
      if (isSeparator(p)) continue;

      const rawText = cleanText(p.textContent);
      const lower = rawText.toLowerCase();

      // Posting label detection: starts with Posted/Reposted OR parser recognises it
      // Use sr text (first non-aria-hidden span) for classification
      const { sr: srText } = readTwinText(p);
      const parseResult = root.LJS.parsePostedLabel(srText || rawText);

      if (/^(posted|reposted)\b/i.test(srText || rawText) || parseResult.status === 'parsed') {
        // It's a posting paragraph
        if (postingParagraph === null) postingParagraph = p;
        continue;
      }

      if (/^viewed$/i.test(lower)) { viewed = true; continue; }
      if (/^be an early applicant$/i.test(lower)) { earlyApplicant = true; continue; }
      if (/^easy apply$/i.test(lower)) { easyApply = true; continue; }
      if (/^promoted$/i.test(lower)) { promoted = true; continue; }

      // Content candidate
      contentCandidates.push(p);
    }

    // ── Title ───────────────────────────────────────────────────────────────
    let title = null;
    let verified = null;

    const titleP = contentCandidates[0] || null;
    if (titleP) {
      const { sr, visible } = readTwinText(titleP);

      // Prefer visible text (stripped of icon elements)
      let titleText = visible;

      // If visible is empty, fall back to sr minus "(Verified job)" suffix
      if (!titleText) {
        titleText = sr.replace(VERIFIED_JOB_RE, '').trim();
      }

      if (!titleText) {
        // Last fallback: dismiss button aria-label
        const dismissBtn = card.querySelector('button[aria-label^="Dismiss "]');
        if (dismissBtn) {
          const label = dismissBtn.getAttribute('aria-label') || '';
          const m = /^Dismiss (.+?) job$/i.exec(label);
          if (m) titleText = m[1];
        }
      }

      if (titleText) {
        title = titleText;
        // Verified: sr ends with "(Verified job)" (case-insensitive)
        if (VERIFIED_JOB_RE.test(sr)) verified = true;
      }
    } else {
      // Try dismiss button as fallback when no content paragraphs found
      const dismissBtn = card.querySelector('button[aria-label^="Dismiss "]');
      if (dismissBtn) {
        const label = dismissBtn.getAttribute('aria-label') || '';
        const m = /^Dismiss (.+?) job$/i.exec(label);
        if (m) title = m[1];
      }
    }

    // No title → malformed
    if (!title) return null;

    // ── Company and Location ────────────────────────────────────────────────
    const companyP = contentCandidates[1] || null;
    const locationP = contentCandidates[2] || null;

    const company = companyP ? cleanText(companyP.textContent) || null : null;
    const rawLocation = locationP ? cleanText(locationP.textContent) || null : null;

    let location = null;
    let workplaceType = null;

    if (rawLocation) {
      const locMatch = LOCATION_WORKPLACE_RE.exec(rawLocation);
      if (locMatch) {
        location = cleanText(locMatch[1]) || null;
        workplaceType = WORKPLACE_CANONICAL[locMatch[2].toLowerCase()] || locMatch[2];
      } else {
        location = rawLocation;
      }
    }

    // ── Posting time ────────────────────────────────────────────────────────
    let postedText = null;
    let ageMinutes = null;
    let reposted = null;
    let timeStatus = 'missing';

    if (postingParagraph) {
      const { sr: pSr, visible: pVisible } = readTwinText(postingParagraph);
      // Prefer sr (screen-reader) text which has full "Posted X ago"
      const rawPosted = pSr || pVisible;
      postedText = rawPosted || null;

      if (postedText) {
        const parsed = root.LJS.parsePostedLabel(postedText);
        ageMinutes = parsed.ageMinutes;
        timeStatus = parsed.status === 'parsed' ? 'parsed' : 'unrecognized';
        if (parsed.reposted) reposted = true;
      } else {
        timeStatus = 'missing';
      }
    }

    // ── URL ─────────────────────────────────────────────────────────────────
    let url = null;
    let urlSource = null;

    const anchor = card.querySelector('a[href*="/jobs/view/"]');
    if (anchor) {
      const href = anchor.getAttribute('href') || '';
      const m = JOBS_VIEW_RE.exec(href);
      if (m) {
        const anchorId = m[1];
        const candidate = `https://www.linkedin.com/jobs/view/${anchorId}/`;
        if (VALID_URL_RE.test(candidate)) {
          url = candidate;
          urlSource = 'anchor';
        }
      }
    }

    if (!url && id) {
      const candidate = `https://www.linkedin.com/jobs/view/${id}/`;
      if (VALID_URL_RE.test(candidate)) {
        url = candidate;
        urlSource = 'built-from-id';
      }
    }

    return {
      id: id || null,
      title,
      company: company || null,
      location: location || null,
      workplaceType: workplaceType || null,
      postedText: postedText || null,
      ageMinutes: ageMinutes !== undefined ? ageMinutes : null,
      timePrecision: 'approximate',
      timeStatus,
      reposted: reposted || null,
      url: url || null,
      urlSource: urlSource || null,
      easyApply: easyApply || null,
      promoted: promoted || null,
      viewed: viewed || null,
      verified: verified || null,
      earlyApplicant: earlyApplicant || null,
      originalIndex,
      source: 'linkedin-rendered-card',
      extractedAt,
    };
  }

  return { extractJobsFromDocument };
});

