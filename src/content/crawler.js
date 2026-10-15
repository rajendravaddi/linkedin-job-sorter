/**
 * src/content/crawler.js
 *
 * Injected into LinkedIn pages to coordinate multi-page crawling of job feeds.
 * Listens for LJS_CRAWL_START, LJS_CRAWL_CONTINUE, and LJS_CRAWL_STOP messages.
 *
 * Uses DOM manipulation to click the Next pagination button, detects page updates,
 * extracts jobs per page, and streams progress back to the extension side panel.
 *
 * Uses UMD pattern so helper functions are unit-testable in Node.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);

  // In Chrome extension content script environment, initialize message listeners
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    if (!globalThis.__LJS_CRAWLER_INITIALIZED__) {
      globalThis.__LJS_CRAWLER_INITIALIZED__ = true;
      api.initCrawlerListener();
    }
  }
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  // ── Crawler State ──────────────────────────────────────────────────────────
  let isRunning = false;
  let abortRequested = false;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check whether a button is currently active and clickable.
   *
   * @param {Element|null} btn
   * @returns {boolean}
   */
  function isClickable(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    if (btn.classList.contains('disabled')) return false;
    return true;
  }

  /**
   * Find the Next pagination button on a LinkedIn jobs search results page.
   * Prioritizes the user-identified data-testid element and falls back to
   * aria-labels, test-ids, or pagination container buttons.
   *
   * @param {Document|Element} doc
   * @returns {Element|null}
   */
  function findNextButton(doc) {
    if (!doc) return null;

    // 1. Primary selector provided by LinkedIn:
    // data-testid="pagination-controls-next-button-visible"
    let btn = doc.querySelector('button[data-testid="pagination-controls-next-button-visible"]');
    if (btn && isClickable(btn)) return btn;

    // 2. Variations of data-testid
    const testIdSelectors = [
      'button[data-testid="pagination-controls-next-button"]',
      'button[data-testid*="pagination-controls-next"]',
    ];
    for (const sel of testIdSelectors) {
      btn = doc.querySelector(sel);
      if (btn && isClickable(btn)) return btn;
    }

    // 3. Aria-label on button
    const ariaSelectors = [
      'button[aria-label="View next page"]',
      'button[aria-label="Next"]',
      'button[aria-label*="next page" i]',
    ];
    for (const sel of ariaSelectors) {
      btn = doc.querySelector(sel);
      if (btn && isClickable(btn)) return btn;
    }

    // 4. Look inside pagination containers for a button with "Next" text or chevron
    const paginationContainers = doc.querySelectorAll(
      '.jobs-search-results-list__pagination, [class*="pagination"]'
    );
    for (const container of paginationContainers) {
      const buttons = container.querySelectorAll('button');
      for (const b of buttons) {
        if (!isClickable(b)) continue;
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (text === 'next' || aria === 'next' || aria.includes('next page')) {
          return b;
        }
        // Check for svg with chevron-right
        const svg = b.querySelector('svg#chevron-right-small, svg[id*="chevron-right"]');
        if (svg) return b;
      }
    }

    // 5. Fallback across whole document for button containing text "Next"
    const allButtons = doc.querySelectorAll('button');
    for (const b of allButtons) {
      if (!isClickable(b)) continue;
      const spans = b.querySelectorAll('span');
      for (const s of spans) {
        if ((s.textContent || '').trim().toLowerCase() === 'next') {
          // Verify it looks like pagination or has next icon
          if (b.querySelector('svg') || b.closest('[class*="pagination"]')) {
            return b;
          }
        }
      }
    }

    return null;
  }

  /**
   * Produce a signature string of the current cards on the page.
   * Used to detect when the DOM changes after clicking Next.
   *
   * @param {Document|Element} doc
   * @returns {string}
   */
  function getCardsSignature(doc) {
    if (!doc) return '';
    const cards = root.LJS && root.LJS.findCards
      ? root.LJS.findCards(doc)
      : Array.from(doc.querySelectorAll("[componentkey^='job-card-component-ref-']"));

    if (!cards || cards.length === 0) return '';

    return cards.slice(0, 3).map(c => {
      const id = (root.LJS && root.LJS.extractJobId) ? root.LJS.extractJobId(c) : null;
      return id ||
        c.getAttribute('componentkey') ||
        c.getAttribute('data-occludable-job-id') ||
        (c.textContent || '').slice(0, 60).replace(/\s+/g, ' ').trim();
    }).join('||');
  }

  /**
   * Wait until job cards are rendered in the document.
   *
   * @param {Document} doc
   * @param {number} [timeoutMs=6000]
   * @returns {Promise<boolean>}
   */
  async function waitForCards(doc, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (abortRequested) return false;
      const cards = root.LJS && root.LJS.findCards
        ? root.LJS.findCards(doc)
        : Array.from(doc.querySelectorAll("[componentkey^='job-card-component-ref-']"));
      if (cards && cards.length > 0) return true;
      await sleep(200);
    }
    return false;
  }

  /**
   * Click the Next button and wait for the page DOM to update.
   *
   * @param {Document} doc
   * @param {Element} nextBtn
   * @param {number} [timeoutMs=8000]
   * @returns {Promise<boolean>}
   */
  async function clickNextAndWait(doc, nextBtn, timeoutMs = 8000) {
    const prevSig = getCardsSignature(doc);
    const prevUrl = window.location.href;

    try {
      nextBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    } catch (_) {}
    nextBtn.click();

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(250);
      if (abortRequested) return false;

      const currentSig = getCardsSignature(doc);
      const currentUrl = window.location.href;

      // If signature changed and cards exist, new page is rendered
      if (currentSig && currentSig !== prevSig) {
        // Small settle delay for sub-elements and badges to load
        await sleep(500);
        return true;
      }

      // If URL changed (e.g. start=25) and signature changed
      if (currentUrl !== prevUrl && currentSig && currentSig !== prevSig) {
        await sleep(500);
        return true;
      }
    }

    // Check if cards are present even if signature match was subtle
    const finalSig = getCardsSignature(doc);
    if (finalSig && finalSig !== prevSig) {
      return true;
    }

    return false;
  }

  /**
   * Run the crawl loop.
   *
   * @param {Object} options
   * @param {number} options.startPage - 1-indexed page number to start labeling from
   * @param {number} options.maxPages - Maximum pages to crawl in this batch
   * @param {boolean} options.advanceFirst - Whether to click Next before extracting first page
   */
  async function runCrawl({ startPage = 1, maxPages = 10, advanceFirst = false }) {
    if (isRunning) {
      console.debug('[LJS Crawler] Crawl already running, ignoring start request');
      return;
    }
    isRunning = true;
    abortRequested = false;

    const messages = (root.LJS || {});

    try {
      // If continuing from previous batch, advance to next page first
      if (advanceFirst) {
        const nextBtn = findNextButton(document);
        if (!nextBtn) {
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_COMPLETE || 'LJS_CRAWL_COMPLETE',
            pagesCrawled: 0,
            moreAvailable: false,
            reason: 'NO_MORE_PAGES',
          });
          isRunning = false;
          return;
        }

        const changed = await clickNextAndWait(document, nextBtn);
        if (!changed) {
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_ERROR || 'LJS_CRAWL_ERROR',
            error: {
              code: messages.PAGE_CHANGE_TIMEOUT || 'PAGE_CHANGE_TIMEOUT',
              message: 'Timed out waiting for next page of jobs to load.',
            },
          });
          isRunning = false;
          return;
        }
      }

      let pagesCrawledThisRun = 0;

      for (let i = 0; i < maxPages; i++) {
        if (abortRequested) {
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_COMPLETE || 'LJS_CRAWL_COMPLETE',
            pagesCrawled: pagesCrawledThisRun,
            moreAvailable: false,
            reason: 'STOPPED',
          });
          break;
        }

        const currentPageNumber = startPage + i;

        // Ensure job cards are loaded
        const hasCards = await waitForCards(document);
        if (!hasCards) {
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_ERROR || 'LJS_CRAWL_ERROR',
            error: {
              code: messages.NO_CARDS || 'NO_CARDS',
              message: `No job cards found on page ${currentPageNumber}.`,
            },
          });
          break;
        }

        // Extract jobs
        const now = new Date();
        const { jobs: rawJobs, stats } = root.LJS.extractJobsFromDocument(document, now);
        const { jobs } = root.LJS.deduplicateJobs(rawJobs);
        const searchContext = root.LJS.parseSearchContext(window.location.href);

        pagesCrawledThisRun++;

        const nextBtn = findNextButton(document);
        const hasNextPage = !!nextBtn;

        // Send progress
        chrome.runtime.sendMessage({
          type: messages.MSG_CRAWL_PROGRESS || 'LJS_CRAWL_PROGRESS',
          pageNumber: currentPageNumber,
          pagesCrawledThisRun,
          jobs,
          stats,
          searchContext,
          hasNextPage,
          url: window.location.href,
        });

        // If this is the last page of this batch (maxPages reached)
        if (i === maxPages - 1) {
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_COMPLETE || 'LJS_CRAWL_COMPLETE',
            pagesCrawled: pagesCrawledThisRun,
            moreAvailable: hasNextPage,
            reason: hasNextPage ? 'PAGE_LIMIT_REACHED' : 'NO_MORE_PAGES',
          });
          break;
        }

        // If no Next button exists on the page, reached the end
        if (!hasNextPage) {
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_COMPLETE || 'LJS_CRAWL_COMPLETE',
            pagesCrawled: pagesCrawledThisRun,
            moreAvailable: false,
            reason: 'NO_MORE_PAGES',
          });
          break;
        }

        // Click Next and wait for new cards
        const changed = await clickNextAndWait(document, nextBtn);
        if (!changed) {
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_ERROR || 'LJS_CRAWL_ERROR',
            error: {
              code: messages.PAGE_CHANGE_TIMEOUT || 'PAGE_CHANGE_TIMEOUT',
              message: `Timed out waiting for page ${currentPageNumber + 1} to load.`,
            },
          });
          break;
        }
      }
    } catch (err) {
      console.debug('[LJS Crawler] error', err);
      chrome.runtime.sendMessage({
        type: messages.MSG_CRAWL_ERROR || 'LJS_CRAWL_ERROR',
        error: {
          code: messages.EXTRACTION_FAILED || 'EXTRACTION_FAILED',
          message: err.message || 'Crawl failed unexpectedly.',
        },
      });
    } finally {
      isRunning = false;
    }
  }

  /**
   * Attach message listener in Chrome extension environment.
   */
  function initCrawlerListener() {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      const messages = (root.LJS || {});

      if (message.type === (messages.MSG_CRAWL_START || 'LJS_CRAWL_START')) {
        abortRequested = false;
        runCrawl({
          startPage: 1,
          maxPages: message.maxPages || 10,
          advanceFirst: false,
        });
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === (messages.MSG_CRAWL_CONTINUE || 'LJS_CRAWL_CONTINUE')) {
        abortRequested = false;
        runCrawl({
          startPage: message.startPageNumber || 2,
          maxPages: message.maxPages || 10,
          advanceFirst: true,
        });
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === (messages.MSG_CRAWL_STOP || 'LJS_CRAWL_STOP')) {
        abortRequested = true;
        isRunning = false;
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });
  }

  return {
    findNextButton,
    isClickable,
    getCardsSignature,
    runCrawl,
    initCrawlerListener,
  };
});

