/**
 * src/content/content-script.js
 *
 * Injected into LinkedIn pages.  Listens for LJS_EXTRACT messages from the
 * popup and responds with extracted job data.
 *
 * Uses a guard so double-injection is safe (e.g., SPA navigation).
 */

// Guard against double injection
if (globalThis.__LJS_LOADED__) {
  // Already loaded — do nothing
} else {
  globalThis.__LJS_LOADED__ = true;

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type !== LJS.MSG_EXTRACT) return false;

    try {
      const pageUrl = window.location.href;
      const pathname = window.location.pathname;

      // Check page support
      if (!pathname.startsWith('/jobs/')) {
        sendResponse({
          ok: false,
          error: { code: LJS.UNSUPPORTED_PAGE, message: 'Not a LinkedIn jobs page' },
        });
        return false;
      }

      const now = new Date();
      const { jobs: rawJobs, stats } = LJS.extractJobsFromDocument(document, now);

      if (rawJobs.length === 0) {
        sendResponse({
          ok: false,
          error: { code: LJS.NO_CARDS, message: 'No job cards found on this page' },
        });
        return false;
      }

      const { jobs, duplicatesRemoved } = LJS.deduplicateJobs(rawJobs);
      const searchContext = LJS.parseSearchContext(pageUrl);

      const unknownAge    = jobs.filter(j => j.ageMinutes === null).length;
      const viewedCount   = jobs.filter(j => j.viewed === true).length;
      const appliedCount  = jobs.filter(j => j.applied === true).length;

      sendResponse({
        ok: true,
        url: pageUrl,
        searchContext,
        jobs,
        stats: {
          cardsFound: stats.cardsFound,
          jobsExtracted: stats.jobsExtracted,
          duplicatesRemoved,
          malformedSkipped: stats.malformedSkipped,
          unknownAge,
          viewedCount,
          appliedCount,
        },
        extractedAt: now.toISOString(),
      });
    } catch (err) {
      console.debug('[LJS] extraction error', err);
      sendResponse({
        ok: false,
        error: { code: LJS.EXTRACTION_FAILED, message: err.message },
      });
    }

    return false; // synchronous response
  });
}

