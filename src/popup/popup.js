/**
 * src/popup/popup.js
 *
 * Side-panel logic for the LinkedIn Job Sorter extension.
 * Supports multi-page crawling and session storage persistence.
 *
 * Refresh behaviour:
 * - Clears storage and resets to page 1 (start=0).
 * - Enforces the "Past 24 hours" filter.
 * - Crawls up to 10 pages.
 * - Displays a "Fetch More" button when more pages exist.
 *
 * Panel reopen:
 * - Restores crawled jobs and state from chrome.storage.session.
 *
 * Security:
 * - Never uses innerHTML.
 * - Builds DOM elements using createElement and textContent.
 */

/* global LJS, chrome */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const VALID_URL_RE =
    /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/;

  const LINKEDIN_HOST = 'www.linkedin.com';
  const POST_LOAD_DELAY_MS = 1500;
  const PAGE_LIMIT = 10;

  const STORAGE_KEY_JOBS = 'ljs_jobs';
  const STORAGE_KEY_STATE = 'ljs_crawl_state';

  const CONTENT_SCRIPTS = [
    'src/shared/messages.js',
    'src/lib/posted-time-parser.js',
    'src/lib/search-context.js',
    'src/lib/deduplicate-jobs.js',
    'src/lib/card-extractor.js',
    'src/content/content-script.js',
    'src/content/crawler.js',
  ];

  // ── State ──────────────────────────────────────────────────────────────────

  let allJobs = [];
  let searchContext = null;
  let linkedInTabId = null;
  let isCrawling = false;

  let crawlState = {
    pagesCompleted: 0,
    moreAvailable: false,
  };

  // ── DOM References ─────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  const elJobCount = $('job-count');
  const elNotice = $('notice');
  const elStatus = $('status');
  const elJobList = $('job-list');

  const elFilterQuery = $('filter-query');
  const elHideViewed = $('filter-hide-viewed');
  const elHideApplied = $('filter-hide-applied');
  const elEasyApply = $('filter-easy-apply');
  const elEasyLabel = $('easy-apply-label');

  const elBtnRefresh = $('btn-refresh');
  const elBtnFetchMore = $('btn-fetch-more');

  const elCrawlProgress = $('crawl-progress-container');
  const elCrawlProgressFill = $('crawl-progress-fill');
  const elCrawlProgressLabel = $('crawl-progress-label');

  const controls = $('controls');

  // ── UI Helpers ─────────────────────────────────────────────────────────────

  function setStatus(text) {
    if (elStatus) {
      elStatus.textContent = text;
    }
  }

  function setNotice(text) {
    if (elNotice) {
      elNotice.textContent = text;
    }
  }

  function setJobCount(shown, total) {
    if (!elJobCount) return;

    if (total === 0) {
      elJobCount.textContent = '';
      return;
    }

    elJobCount.textContent = shown === total
      ? `${total} job${total === 1 ? '' : 's'}`
      : `${shown} of ${total} job${total === 1 ? '' : 's'}`;
  }

  function setBtnRefreshBusy(busy) {
    if (!elBtnRefresh) return;

    elBtnRefresh.disabled = busy;
    elBtnRefresh.textContent = busy ? 'Fetching…' : 'Refresh';
  }

  function setBtnFetchMoreBusy(busy) {
    if (!elBtnFetchMore) return;

    elBtnFetchMore.disabled = busy;
    elBtnFetchMore.textContent = busy ? 'Fetching…' : 'Fetch More';
  }

  function resetBusyUI() {
    isCrawling = false;

    setBtnRefreshBusy(false);
    setBtnFetchMoreBusy(false);

    hideProgressUI();
    updateFetchMoreVisibility(crawlState.moreAvailable);
  }

  function updateFetchMoreVisibility(visible) {
    if (!elBtnFetchMore) return;

    elBtnFetchMore.style.display =
      visible && !isCrawling ? '' : 'none';
  }

  function updateProgressUI(pageNumber, customText) {
    if (!elCrawlProgress) return;

    elCrawlProgress.style.display = '';

    const displayPage = pageNumber > 0 ? pageNumber : 1;

    const pageInBatch =
      ((displayPage - 1) % PAGE_LIMIT) + 1;

    const percentage = Math.min(
      100,
      Math.round((pageInBatch / PAGE_LIMIT) * 100)
    );

    if (elCrawlProgressFill) {
      elCrawlProgressFill.style.width = `${percentage}%`;
    }

    if (elCrawlProgressLabel) {
      elCrawlProgressLabel.textContent =
        customText ||
        `Page ${displayPage} (crawling batch: page ${pageInBatch} of ${PAGE_LIMIT}) · ${allJobs.length} jobs found`;
    }
  }

  function hideProgressUI() {
    if (!elCrawlProgress) return;

    elCrawlProgress.style.display = 'none';

    if (elCrawlProgressFill) {
      elCrawlProgressFill.style.width = '0%';
    }
  }

  function clearJobList() {
    if (!elJobList) return;

    while (elJobList.firstChild) {
      elJobList.removeChild(elJobList.firstChild);
    }
  }

  function showInitialState() {
    if (elBtnRefresh) {
      elBtnRefresh.textContent = 'Start';
    }

    if (controls) {
      controls.style.display = 'none';
    }

    clearJobList();
    setJobCount(0, 0);
    setNotice('');
    updateFetchMoreVisibility(false);
    hideProgressUI();

    setStatus(
      'Click "Start" on a LinkedIn job search page with the "Past 24 hours" filter applied to start fetching jobs.'
    );
  }

  // ── Storage Persistence ────────────────────────────────────────────────────

  async function persistJobsAndState() {
    try {
      await chrome.storage.session.set({
        [STORAGE_KEY_JOBS]: allJobs,

        [STORAGE_KEY_STATE]: {
          pagesCompleted: crawlState.pagesCompleted,
          moreAvailable: crawlState.moreAvailable,
          lastCrawledAt: new Date().toISOString(),
          searchContext,
        },
      });
    } catch (error) {
      console.error(
        '[LJS] Failed to persist crawl state:',
        error
      );
    }
  }

  // ── Job Card Helpers ───────────────────────────────────────────────────────

  function buildSubtitle(job) {
    const parts = [];

    if (job.company) parts.push(job.company);
    if (job.location) parts.push(job.location);
    if (job.workplaceType) parts.push(job.workplaceType);

    return parts.join(' · ');
  }

  function makeBadge(text, className) {
    const span = document.createElement('span');

    span.className = `badge ${className}`;
    span.textContent = text;

    return span;
  }

  // ── Open Job in Current Tab ────────────────────────────────────────────────

  async function openJobInCurrentTab(jobUrlString) {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || tab.id == null || !tab.url) {
        setStatus('Unable to find the current browser tab.');
        return;
      }

      const currentUrl = new URL(tab.url);

      const isSearchResultsPage =
        currentUrl.protocol === 'https:' &&
        currentUrl.hostname === LINKEDIN_HOST &&
        currentUrl.pathname.startsWith('/jobs/search-results/');


      const jobUrl = new URL(jobUrlString);

      if (
        jobUrl.protocol !== 'https:' ||
        jobUrl.hostname !== LINKEDIN_HOST
      ) {
        setStatus('Invalid LinkedIn job URL.');
        return;
      }

      const match = jobUrl.pathname.match(
        /\/jobs\/view\/(\d+)/
      );

      if (!match) {
        setStatus('Unable to determine this job ID.');
        return;
      }
      if (isSearchResultsPage) {
        // Preserve the search URL and open the selected job in the current tab.
        currentUrl.searchParams.set('currentJobId', match[1]);

        await chrome.tabs.update(tab.id, {
          url: currentUrl.toString(),
        });
      } else {
        // Not on a job search results page: use the old behavior.
        await chrome.tabs.create({
          url: jobUrlString,
        });
      }
    } catch (error) {
      console.error(
        '[LJS] Failed to open job in the current tab:',
        error
      );

      setStatus(
        'Unable to open this job in the current tab.'
      );
    }
  }

  function buildJobCard(job) {
    const card = document.createElement('div');

    card.className = 'job-card';
    card.setAttribute('role', 'listitem');

    // ── Title ────────────────────────────────────────────────────────────────

    const validUrl =
      typeof job.url === 'string' &&
        VALID_URL_RE.test(job.url)
        ? job.url
        : null;

    const titleEl = document.createElement('a');

    titleEl.className = 'job-title';
    titleEl.textContent = job.title || 'Untitled job';
    if (validUrl) {
      titleEl.href = validUrl;
      titleEl.target = '_blank';
      titleEl.rel = 'noopener noreferrer';
    }

    card.appendChild(titleEl);

    // ── Subtitle ─────────────────────────────────────────────────────────────

    const subtitle = buildSubtitle(job);

    if (subtitle) {
      const subEl = document.createElement('div');

      subEl.className = 'job-subtitle';
      subEl.textContent = subtitle;

      card.appendChild(subEl);
    }

    // ── Posting Time ─────────────────────────────────────────────────────────

    const postedEl = document.createElement('div');

    if (job.ageMinutes != null) {
      postedEl.className = 'job-posted';

      postedEl.textContent =
        job.postedText || `${job.ageMinutes} min ago`;
    } else if (job.applied === true) {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent =
        'Applied — LinkedIn hides the posting time';
    } else if (job.viewed === true) {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent =
        'Viewed — LinkedIn hides the posting time';
    } else if (job.timeStatus === 'missing') {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent = 'Posting time not shown';
    } else {
      postedEl.className = 'job-posted-muted';

      postedEl.textContent = job.postedText
        ? `${job.postedText} (unrecognized format)`
        : 'Posting time not shown';
    }

    card.appendChild(postedEl);

    // ── Badges ───────────────────────────────────────────────────────────────

    const badges = document.createElement('div');

    badges.className = 'badges';

    let hasBadges = false;

    if (job.earlyApplicant === true) {
      badges.appendChild(
        makeBadge('Early applicant', 'badge-early')
      );
      hasBadges = true;
    }

    if (job.easyApply === true) {
      badges.appendChild(
        makeBadge('Easy Apply', 'badge-easy')
      );
      hasBadges = true;
    }

    if (job.applied === true) {
      badges.appendChild(
        makeBadge('Applied', 'badge-applied')
      );
      hasBadges = true;
    }

    if (job.viewed === true) {
      badges.appendChild(
        makeBadge('Viewed', 'badge-viewed')
      );
      hasBadges = true;
    }

    if (hasBadges) {
      card.appendChild(badges);
    }

    // ── Footer ──────────────────────────────────────────────────────────────

    const footer = document.createElement('div');

    footer.className = 'job-footer';

    if (job.id) {
      const idEl = document.createElement('span');

      idEl.className = 'job-id';
      idEl.textContent = `#${job.id}`;

      footer.appendChild(idEl);
    } else {
      footer.appendChild(document.createElement('span'));
    }

    if (validUrl) {
      const openBtn = document.createElement('button');

      openBtn.className = 'btn-open';
      openBtn.textContent = 'Open';

      openBtn.addEventListener('click', function () {
        void openJobInCurrentTab(validUrl);
      });

      footer.appendChild(openBtn);
    }

    if (footer.children.length > 0) {
      card.appendChild(footer);
    }

    return card;
  }

  // ── Render Jobs ────────────────────────────────────────────────────────────

  function renderJobs() {
    const mode = 'newest';

    const query = elFilterQuery
      ? elFilterQuery.value
      : '';

    const hideViewed = elHideViewed
      ? elHideViewed.checked
      : false;

    const hideApplied = elHideApplied
      ? elHideApplied.checked
      : false;

    const easyApplyOnly = elEasyApply
      ? elEasyApply.checked
      : false;

    const sorted = LJS.sortJobs(allJobs, mode);

    const filtered = LJS.filterJobs(sorted, {
      query,
      easyApplyOnly,
      hideViewed,
      hideApplied,
    });

    const total = allJobs.length;
    const shown = filtered.length;

    setJobCount(shown, total);

    // Show Easy Apply filter only when relevant.
    const hasEasyApply = allJobs.some(
      job => job.easyApply === true
    );

    if (elEasyLabel) {
      elEasyLabel.style.display =
        hasEasyApply ? '' : 'none';
    }

    if (controls) {
      controls.style.display = 'flex';
    }

    clearJobList();

    if (total > 0 && shown === 0) {
      setStatus('No jobs match the current filters.');
      setNotice('');
      return;
    }

    if (total === shown) {
      setStatus('');
    } else {
      setStatus(
        `Filtered ${shown} jobs from ${total} jobs.`
      );
    }

    // Explain when some jobs have no recognizable posting time.
    const unknownCount = filtered.filter(
      job => job.ageMinutes == null
    ).length;

    const knownCount = filtered.filter(
      job => job.ageMinutes != null
    ).length;

    if (unknownCount > 0 && knownCount > 0) {
      setNotice(
        `Note: ${unknownCount} job${unknownCount > 1 ? 's' : ''} ` +
        `${unknownCount > 1 ? 'have' : 'has'} no posting time and ` +
        `appear${unknownCount > 1 ? '' : 's'} at the end.`
      );
    } else {
      setNotice('');
    }

    const fragment = document.createDocumentFragment();

    for (const job of filtered) {
      fragment.appendChild(buildJobCard(job));
    }

    if (elJobList) {
      elJobList.appendChild(fragment);
    }
  }

  // ── Tab Resolution ─────────────────────────────────────────────────────────

  async function findLinkedInTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.url) {
        return null;
      }

      const url = new URL(tab.url);

      return (
        url.protocol === 'https:' &&
        url.hostname === LINKEDIN_HOST
      )
        ? tab
        : null;
    } catch (error) {
      console.error(
        '[LJS] Failed to resolve the active tab:',
        error
      );

      return null;
    }
  }

  // ── Content Script Injection ───────────────────────────────────────────────

  async function ensureScriptsInjected(tabId) {
    for (const file of CONTENT_SCRIPTS) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [file],
        });
      } catch (error) {
        // Some scripts may already be loaded. Log failures to help diagnose
        // genuine injection problems.
        console.warn(
          `[LJS] Could not inject ${file}:`,
          error
        );
      }
    }
  }

  // ── Navigation and Page Load ───────────────────────────────────────────────

  async function navigateAndSettle(tabId, targetUrl) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let delayTimer = null;

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };

      const finish = () => {
        if (settled) return;

        settled = true;
        cleanup();

        if (delayTimer !== null) {
          clearTimeout(delayTimer);
        }

        resolve();
      };

      const fail = error => {
        if (settled) return;

        settled = true;
        cleanup();

        if (delayTimer !== null) {
          clearTimeout(delayTimer);
        }

        reject(error);
      };

      const timeoutTimer = setTimeout(() => {
        // Prevent waiting forever if LinkedIn does not emit "complete".
        finish();
      }, 15000);

      const originalFinish = finish;

      const onUpdated = function (
        updatedTabId,
        changeInfo
      ) {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status !== 'complete') return;
        if (settled) return;

        settled = true;
        cleanup();
        clearTimeout(timeoutTimer);

        delayTimer = setTimeout(() => {
          resolve();
        }, POST_LOAD_DELAY_MS);
      };

      // Keep timeout cleanup consistent when the promise settles.
      const originalCleanup = cleanup;

      chrome.tabs.onUpdated.addListener(onUpdated);

      chrome.tabs.get(tabId, currentTab => {
        if (chrome.runtime.lastError || !currentTab) {
          fail(
            new Error(
              chrome.runtime.lastError
                ? chrome.runtime.lastError.message
                : 'LinkedIn tab not found'
            )
          );

          return;
        }

        const callback = () => {
          if (chrome.runtime.lastError) {
            fail(
              new Error(chrome.runtime.lastError.message)
            );
          }
        };

        if (currentTab.url === targetUrl) {
          chrome.tabs.reload(
            tabId,
            { bypassCache: true },
            callback
          );
        } else {
          chrome.tabs.update(
            tabId,
            { url: targetUrl },
            callback
          );
        }
      });
    });
  }

  // ── Runtime Messages: Crawler → Side Panel ─────────────────────────────────

  function handleRuntimeMessage(message, sender) {
    if (!message || !message.type) {
      return;
    }

    if (
      linkedInTabId != null &&
      sender &&
      sender.tab &&
      sender.tab.id !== linkedInTabId
    ) {
      return;
    }

    if (message.type === LJS.MSG_CRAWL_PROGRESS) {
      const pageJobs = Array.isArray(message.jobs)
        ? message.jobs
        : [];

      allJobs = allJobs.concat(pageJobs);

      const deduped = LJS.deduplicateJobs(allJobs);

      allJobs = deduped.jobs;

      if (message.searchContext) {
        searchContext = message.searchContext;
      }

      crawlState.pagesCompleted =
        message.pageNumber || crawlState.pagesCompleted;

      crawlState.moreAvailable =
        !!message.hasNextPage;

      void persistJobsAndState();

      renderJobs();

      setStatus(
        `Fetching page ${message.pageNumber}… (${allJobs.length} jobs collected)`
      );

      updateProgressUI(message.pageNumber);
      return;
    }

    if (message.type === LJS.MSG_CRAWL_COMPLETE) {
      crawlState.moreAvailable =
        !!message.moreAvailable;

      resetBusyUI();

      if (message.reason === 'NETWORK_TIMEOUT') {
        const nextPage =
          (crawlState.pagesCompleted || 0) + 1;

        setStatus(
          `Network delay while loading page ${nextPage}. ` +
          `${allJobs.length} jobs saved so far. Click "Fetch More" to resume.`
        );
      } else if (crawlState.moreAvailable) {
        setStatus(
          `Reached page ${crawlState.pagesCompleted} (${allJobs.length} jobs). ` +
          'Click "Fetch More" for next 10 pages.'
        );
      } else {
        setStatus(
          `Fetch complete! Fetched ${allJobs.length} jobs across ` +
          `${crawlState.pagesCompleted} page${crawlState.pagesCompleted === 1 ? '' : 's'}.`
        );
      }

      void persistJobsAndState();
      return;
    }

    if (message.type === LJS.MSG_CRAWL_ERROR) {
      resetBusyUI();

      const errMsg =
        message.error && message.error.message
          ? message.error.message
          : 'Error encountered during fetch';

      if (allJobs.length > 0) {
        crawlState.moreAvailable = true;

        updateFetchMoreVisibility(true);

        setStatus(
          `Fetch stopped: ${errMsg}. Click "Fetch More" to retry.`
        );

        void persistJobsAndState();
      } else {
        setStatus(`Fetch stopped: ${errMsg}`);
      }
    }
  }

  // ── Refresh & Crawl Flow ───────────────────────────────────────────────────

  async function handleRefresh() {
    if (isCrawling && linkedInTabId != null) {
      try {
        chrome.tabs.sendMessage(
          linkedInTabId,
          { type: LJS.MSG_CRAWL_STOP },
          () => {
            // Read lastError to avoid an unchecked runtime error.
            if (chrome.runtime.lastError) {
              console.debug(
                '[LJS] Previous crawl was not active:',
                chrome.runtime.lastError.message
              );
            }
          }
        );
      } catch (error) {
        console.debug(
          '[LJS] Could not stop the previous crawl:',
          error
        );
      }
    }

    // 1. Clear storage and in-memory state.
    try {
      await chrome.storage.session.remove([
        STORAGE_KEY_JOBS,
        STORAGE_KEY_STATE,
      ]);
    } catch (error) {
      console.error(
        '[LJS] Could not clear saved crawl state:',
        error
      );

      setStatus('Could not clear saved jobs. Please try again.');
      return;
    }

    allJobs = [];
    searchContext = null;

    crawlState = {
      pagesCompleted: 0,
      moreAvailable: false,
    };

    clearJobList();
    setJobCount(0, 0);
    setNotice('');
    updateFetchMoreVisibility(false);

    // 2. Resolve the active LinkedIn tab.
    const tab = await findLinkedInTab();

    if (!tab || tab.id == null) {
      setStatus(
        'Open a LinkedIn jobs search results page to use this extension.'
      );
      return;
    }

    linkedInTabId = tab.id;

    // 3. Validate the search URL and the Past 24 hours filter.
    const validation = LJS.validateSearchUrl(tab.url);

    if (!validation.valid) {
      setStatus(validation.reason);
      return;
    }

    // 4. Reset to page 1.
    const page1Url = LJS.getPage1Url(tab.url);

    isCrawling = true;

    setBtnRefreshBusy(true);
    setBtnFetchMoreBusy(false);

    setStatus('Resetting LinkedIn page to page 1…');

    updateProgressUI(0, 'Resetting to page 1…');

    try {
      await navigateAndSettle(tab.id, page1Url);

      await ensureScriptsInjected(tab.id);

      // 5. Start crawling from page 1.
      setStatus('Started fetching from page 1…');

      chrome.tabs.sendMessage(
        tab.id,
        {
          type: LJS.MSG_CRAWL_START,
          maxPages: PAGE_LIMIT,
        },
        () => {
          if (chrome.runtime.lastError) {
            setStatus(
              `Could not start job fetch: ${chrome.runtime.lastError.message}`
            );

            resetBusyUI();
          }
        }
      );
    } catch (error) {
      console.error('[LJS] Refresh failed:', error);

      setStatus(`Refresh failed: ${error.message}`);

      resetBusyUI();
    }
  }

  // ── Fetch More Flow ────────────────────────────────────────────────────────

  async function handleFetchMore() {
    if (isCrawling) return;

    const tab = await findLinkedInTab();

    if (!tab || tab.id == null) {
      setStatus(
        'LinkedIn tab not found. Please open LinkedIn in the active tab.'
      );

      return;
    }

    linkedInTabId = tab.id;

    const validation = LJS.validateSearchUrl(tab.url);

    if (!validation.valid) {
      setStatus(validation.reason);
      return;
    }

    isCrawling = true;

    setBtnRefreshBusy(true);
    setBtnFetchMoreBusy(true);

    const nextPageNumber =
      (crawlState.pagesCompleted || 0) + 1;

    setStatus(
      `Continuing jobs fetch from page ${nextPageNumber}…`
    );

    updateProgressUI(
      crawlState.pagesCompleted,
      `Advancing to page ${nextPageNumber}…`
    );

    try {
      await ensureScriptsInjected(tab.id);

      chrome.tabs.sendMessage(
        tab.id,
        {
          type: LJS.MSG_CRAWL_CONTINUE,
          maxPages: PAGE_LIMIT,
          startPageNumber: nextPageNumber,
        },
        () => {
          if (chrome.runtime.lastError) {
            setStatus(
              `Could not continue job fetch: ${chrome.runtime.lastError.message}`
            );

            resetBusyUI();
          }
        }
      );
    } catch (error) {
      console.error('[LJS] Fetch More failed:', error);

      setStatus(`Fetch more failed: ${error.message}`);

      resetBusyUI();
    }
  }

  // ── Event Listeners ────────────────────────────────────────────────────────

  if (elBtnRefresh) {
    elBtnRefresh.addEventListener(
      'click',
      handleRefresh
    );
  }

  if (elBtnFetchMore) {
    elBtnFetchMore.addEventListener(
      'click',
      handleFetchMore
    );
  }

  if (elFilterQuery) {
    elFilterQuery.addEventListener('input', renderJobs);
  }

  if (elHideViewed) {
    elHideViewed.addEventListener('change', renderJobs);
  }

  if (elHideApplied) {
    elHideApplied.addEventListener('change', renderJobs);
  }

  if (elEasyApply) {
    elEasyApply.addEventListener('change', renderJobs);
  }

  // ── Initialization & Storage Restoration ───────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    // Listen for crawler messages.
    chrome.runtime.onMessage.addListener(
      handleRuntimeMessage
    );

    // Restore jobs and crawl state from session storage.
    chrome.storage.session.get(
      [STORAGE_KEY_JOBS, STORAGE_KEY_STATE],
      result => {
        if (chrome.runtime.lastError) {
          console.error(
            '[LJS] Could not restore saved state:',
            chrome.runtime.lastError.message
          );

          showInitialState();
          return;
        }

        const savedJobs = result[STORAGE_KEY_JOBS];
        const savedState = result[STORAGE_KEY_STATE];

        if (Array.isArray(savedJobs) && savedJobs.length > 0) {
          if (elBtnRefresh) {
            elBtnRefresh.textContent = 'Refresh';
          }

          allJobs = savedJobs;

          crawlState = savedState || {
            pagesCompleted: 1,
            moreAvailable: false,
          };

          searchContext =
            crawlState.searchContext || null;

          renderJobs();

          updateFetchMoreVisibility(
            crawlState.moreAvailable
          );

          if (crawlState.moreAvailable) {
            setStatus(
              `Fetched ${crawlState.pagesCompleted} pages (${allJobs.length} jobs). ` +
              'Click "Fetch More" to get next 10 pages.'
            );
          } else {
            setStatus(
              `Loaded ${allJobs.length} jobs from storage.`
            );
          }
        } else {
          // Do not automatically start crawling on panel open.
          showInitialState();
        }
      }
    );
  });

})();