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
    if (btn.disabled || btn.hasAttribute('disabled')) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    if (btn.getAttribute('aria-hidden') === 'true') return false;
    if (btn.hidden) return false;
    if (btn.classList.contains('disabled') || btn.classList.contains('artdeco-button--disabled')) return false;

    // Check data-testid attribute for disabled or hidden
    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('disabled') || testId.includes('hidden')) return false;

    // Check styles
    if (btn.style && (btn.style.display === 'none' || btn.style.visibility === 'hidden')) return false;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const style = window.getComputedStyle(btn);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      } catch (_) {}
    }

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
    // When next page exists, LinkedIn explicitly renders data-testid="pagination-controls-next-button-visible"
    const visibleBtn = doc.querySelector('button[data-testid="pagination-controls-next-button-visible"]');
    if (visibleBtn) {
      return isClickable(visibleBtn) ? visibleBtn : null;
    }

    // If LinkedIn renders any pagination next button that is NOT the visible one (e.g. disabled, hidden, or without -visible),
    // it indicates we are on the last page and no next button is available.
    const nonVisibleNextBtn = doc.querySelector(
      'button[data-testid*="pagination-controls-next"], button[data-testid*="pagination-next"]'
    );
    if (nonVisibleNextBtn) {
      return null;
    }

    // 2. Fallbacks for pages where data-testid is absent (older or alternate LinkedIn layouts)
    const ariaSelectors = [
      'button[aria-label="View next page"]',
      'button[aria-label="Next"]',
    ];
    for (const sel of ariaSelectors) {
      const btn = doc.querySelector(sel);
      if (btn && isClickable(btn)) return btn;
    }

    // 3. Fallback within pagination containers
    const paginationContainers = doc.querySelectorAll(
      '.jobs-search-results-list__pagination, [class*="pagination"]'
    );
    for (const container of paginationContainers) {
      const buttons = container.querySelectorAll('button');
      for (const b of buttons) {
        if (!isClickable(b)) continue;
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (text === 'next' || aria === 'next' || aria === 'view next page') {
          return b;
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
   * Check whether LinkedIn is currently showing a loading skeleton, spinner, or loader.
   *
   * @param {Document|Element} doc
   * @returns {boolean}
   */
  function isLoadingStateActive(doc) {
    if (!doc) return false;
    const loader = doc.querySelector(
      '.artdeco-loader, .jobs-search-results-list--loading, [data-view-name*="loading"], .ghost-job-card, [class*="skeleton"], [class*="artdeco-loader"]'
    );
    if (!loader) return false;
    if (loader.hidden) return false;
    if (loader.getAttribute && loader.getAttribute('aria-hidden') === 'true') return false;
    if (loader.style && (loader.style.display === 'none' || loader.style.visibility === 'hidden')) return false;
    return true;
  }

  /**
   * Wait until job cards are rendered in the document.
   *
   * @param {Document} doc
   * @param {number} [timeoutMs=15000]
   * @returns {Promise<boolean>}
   */
  async function waitForCards(doc, timeoutMs = 15000) {
    const start = Date.now();
    let maxWait = timeoutMs;
    while (Date.now() - start < maxWait) {
      if (abortRequested) return false;
      const cards = root.LJS && root.LJS.findCards
        ? root.LJS.findCards(doc)
        : Array.from(doc.querySelectorAll("[componentkey^='job-card-component-ref-']"));
      if (cards && cards.length > 0) return true;

      // Extend wait time if LinkedIn is actively loading content
      if (isLoadingStateActive(doc) && maxWait < 25000) {
        maxWait = 25000;
      }

      await sleep(200);
    }
    return false;
  }

  /**
   * Click the Next button and wait for the page DOM to update.
   *
   * @param {Document} doc
   * @param {Element} nextBtn
   * @param {number} [timeoutMs=16000]
   * @returns {Promise<boolean>}
   */
  async function clickNextAndWait(doc, nextBtn, timeoutMs = 16000) {
    const prevSig = getCardsSignature(doc);
    const prevUrl = window.location.href;

    try {
      nextBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    } catch (_) {}
    nextBtn.click();

    const start = Date.now();
    let maxWait = timeoutMs;
    while (Date.now() - start < maxWait) {
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

      // Extend wait time if LinkedIn is actively showing a spinner or skeleton
      if (isLoadingStateActive(doc) && maxWait < 25000) {
        maxWait = 25000;
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
          const stillHasNext = !!findNextButton(document);
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_COMPLETE || 'LJS_CRAWL_COMPLETE',
            pagesCrawled: 0,
            moreAvailable: stillHasNext,
            reason: stillHasNext ? 'NETWORK_TIMEOUT' : 'NO_MORE_PAGES',
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
          const nextBtn = findNextButton(document);
          const stillHasMore = !!nextBtn || pagesCrawledThisRun > 0;
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_COMPLETE || 'LJS_CRAWL_COMPLETE',
            pagesCrawled: pagesCrawledThisRun,
            moreAvailable: stillHasMore,
            reason: 'NETWORK_TIMEOUT',
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
          const nextBtnStillThere = !!findNextButton(document);
          chrome.runtime.sendMessage({
            type: messages.MSG_CRAWL_COMPLETE || 'LJS_CRAWL_COMPLETE',
            pagesCrawled: pagesCrawledThisRun,
            moreAvailable: nextBtnStillThere,
            reason: nextBtnStillThere ? 'NETWORK_TIMEOUT' : 'NO_MORE_PAGES',
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
          message: err.message || 'Fetching jobs failed unexpectedly.',
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
    isLoadingStateActive,
    getCardsSignature,
    runCrawl,
    initCrawlerListener,
  };
});

