/**
 * src/popup/popup.js
 *
 * Side-panel logic for the LinkedIn Job Sorter extension.
 * The panel persists across focus changes and supports multi-page crawling
 * with local storage persistence across accidental refreshes.
 *
 * Refresh behaviour:
 * - Clears storage and resets to page 1 (start=0).
 * - Enforces the "Past 24 hours" filter (f_TPR=r86400) on a search results page.
 * - Crawls up to 10 pages, showing jobs live as each page completes.
 * - Displays a "Fetch More" button if more pages exist.
 *
 * Accidental panel reload / reopen:
 * - Restores crawled jobs and state from chrome.storage.session without re-crawling.
 *
 * NEVER uses innerHTML — all DOM construction uses createElement + textContent.
 */

/* global LJS, chrome */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const VALID_URL_RE = /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/;
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

  let allJobs = [];          // Full extracted job list (deduped across pages)
  let searchContext = null;  // { keywords, location, dateFilterLabel }
  let linkedInTabId = null;  // ID of the LinkedIn tab we're watching
  let isCrawling = false;    // Guard against concurrent crawl actions
  let crawlState = {
    pagesCompleted: 0,
    moreAvailable: false,
  };

  // ── DOM References ─────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  const elJobCount             = $('job-count');
  const elNotice               = $('notice');
  const elStatus               = $('status');
  const elJobList              = $('job-list');
  const elFilterQuery          = $('filter-query');
  const elHideViewed           = $('filter-hide-viewed');
  const elHideApplied          = $('filter-hide-applied');
  const elEasyApply            = $('filter-easy-apply');
  const elEasyLabel            = $('easy-apply-label');
  const elBtnRefresh           = $('btn-refresh');
  const elBtnFetchMore         = $('btn-fetch-more');
  const elCrawlProgress        = $('crawl-progress-container');
  const elCrawlProgressFill    = $('crawl-progress-fill');
  const elCrawlProgressLabel   = $('crawl-progress-label');

  // ── UI helpers ─────────────────────────────────────────────────────────────

  function setStatus(text) {
    if (!elStatus) return;
    elStatus.textContent = text;
  }

  function setNotice(text) {
    if (!elNotice) return;
    elNotice.textContent = text;
  }

  function setJobCount(shown, total) {
    if (!elJobCount) return;
    if (total === 0) { elJobCount.textContent = ''; return; }
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
    if (elBtnFetchMore) {
      elBtnFetchMore.disabled = busy;
      elBtnFetchMore.textContent = busy ? 'Fetching…' : 'Fetch More';
    }
  }

  function updateFetchMoreVisibility(visible) {
    if (elBtnFetchMore) {
      elBtnFetchMore.style.display = (visible && !isCrawling) ? '' : 'none';
    }
  }

  function updateProgressUI(pageNumber, hasNextPage, customText) {
    if (!elCrawlProgress) return;
    elCrawlProgress.style.display = '';

    const displayPage = pageNumber > 0 ? pageNumber : 1;
    // Calculate progress percentage based on 10-page chunk
    const pageInBatch = ((displayPage - 1) % PAGE_LIMIT) + 1;
    const pct = Math.min(100, Math.round((pageInBatch / PAGE_LIMIT) * 100));

    if (elCrawlProgressFill) elCrawlProgressFill.style.width = `${pct}%`;
    if (elCrawlProgressLabel) {
      elCrawlProgressLabel.textContent = customText ||
        `Page ${displayPage} (crawling batch: page ${pageInBatch} of ${PAGE_LIMIT}) · ${allJobs.length} jobs found`;
    }
  }

  function hideProgressUI() {
    if (!elCrawlProgress) return;
    elCrawlProgress.style.display = 'none';
    if (elCrawlProgressFill) elCrawlProgressFill.style.width = '0%';
  }

  function clearJobList() {
    if (!elJobList) return;
    while (elJobList.firstChild) elJobList.removeChild(elJobList.firstChild);
  }

  function showInitialState() {
    elBtnRefresh.textContent = "Start";
    clearJobList();
    setJobCount(0, 0);
    setNotice('');
    updateFetchMoreVisibility(false);
    hideProgressUI();
    setStatus('Click "Start" on a LinkedIn job search page with the "Past 24 hours" filter applied to start fetching jobs.');
  }

  function showState(state, detail) {
    clearJobList();
    setJobCount(0, 0);
    setNotice('');
    updateFetchMoreVisibility(false);
    hideProgressUI();

    switch (state) {
      case 'no-cards':
        setStatus('No job cards found on this page. Open a LinkedIn job search results page and try again.');
        break;
      case 'unsupported':
        setStatus('Open a LinkedIn jobs search results page (linkedin.com/jobs/search-results) with the "Past 24 hours" filter to use this extension.');
        break;
      case 'unreachable':
        setStatus(`Unable to read the current tab. Reload the LinkedIn page and try again.${detail ? ' (' + detail + ')' : ''}`);
        break;
      default:
        setStatus(detail || 'Unknown state.');
    }
  }

  // ── Storage Persistence ────────────────────────────────────────────────────

  async function persistJobsAndState() {
    return new Promise(resolve => {
      chrome.storage.session.set({
        [STORAGE_KEY_JOBS]: allJobs,
        [STORAGE_KEY_STATE]: {
          pagesCompleted: crawlState.pagesCompleted,
          moreAvailable: crawlState.moreAvailable,
          lastCrawledAt: new Date().toISOString(),
          searchContext,
        },
      }, resolve);
    });
  }

  // ── Job card DOM builder (no innerHTML) ────────────────────────────────────

  function buildSubtitle(job) {
    const parts = [];
    if (job.company)       parts.push(job.company);
    if (job.location)      parts.push(job.location);
    if (job.workplaceType) parts.push(job.workplaceType);
    return parts.join(' · ');
  }

  function makeBadge(text, cls) {
    const span = document.createElement('span');
    span.className = `badge ${cls}`;
    span.textContent = text;
    return span;
  }

  function buildJobCard(job) {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.setAttribute('role', 'listitem');

    // ── Title ───────────────────────────────────────────────────────────────
    const validUrl = job.url && VALID_URL_RE.test(job.url) ? job.url : null;

    let titleEl;
    
    titleEl = document.createElement('span');
    titleEl.className = 'job-title';
    titleEl.textContent = job.title;
  
    card.appendChild(titleEl);

    // ── Subtitle ─────────────────────────────────────────────────────────────
    const subtitle = buildSubtitle(job);
    if (subtitle) {
      const subEl = document.createElement('div');
      subEl.className = 'job-subtitle';
      subEl.textContent = subtitle;
      card.appendChild(subEl);
    }

    // ── Posting time ─────────────────────────────────────────────────────────
    const postedEl = document.createElement('div');
    if (job.ageMinutes != null) {
      postedEl.className = 'job-posted';
      const label = job.postedText || `${job.ageMinutes} min ago`;
      postedEl.textContent = `${label} (approx.)`;
    } else if (job.applied === true) {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent = 'Applied — LinkedIn hides the posting time';
    } else if (job.viewed === true) {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent = 'Viewed — LinkedIn hides the posting time';
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

    // ── Badges ────────────────────────────────────────────────────────────────
    const badges = document.createElement('div');
    badges.className = 'badges';
    let hasBadges = false;

    if (job.earlyApplicant === true) { badges.appendChild(makeBadge('Early applicant', 'badge-early'));   hasBadges = true; }
    if (job.easyApply      === true) { badges.appendChild(makeBadge('Easy Apply',       'badge-easy'));    hasBadges = true; }
    if (job.applied        === true) { badges.appendChild(makeBadge('Applied',          'badge-applied')); hasBadges = true; }
    if (job.viewed         === true) { badges.appendChild(makeBadge('Viewed',           'badge-viewed'));  hasBadges = true; }

    if (hasBadges) card.appendChild(badges);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'job-footer';

    if (job.id) {
      const idEl = document.createElement('span');
      idEl.className = 'job-id';
      idEl.textContent = `#${job.id}`;
      footer.appendChild(idEl);
    } else {
      footer.appendChild(document.createElement('span')); // spacer
    }

    if (validUrl) {
      const openBtn = document.createElement('button');
      openBtn.className = 'btn-open';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', function () {
        chrome.tabs.create({ url: validUrl });
      });
      footer.appendChild(openBtn);
    }

    if (footer.children.length > 0) card.appendChild(footer);

    return card;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderJobs() {
    const mode          = 'newest';
    const query         = elFilterQuery ? elFilterQuery.value : '';
    const hideViewed    = elHideViewed ? elHideViewed.checked : false;
    const hideApplied   = elHideApplied ? elHideApplied.checked : false;
    const easyApplyOnly = elEasyApply ? elEasyApply.checked : false;

    const sorted   = LJS.sortJobs(allJobs, mode);
    const filtered = LJS.filterJobs(sorted, { query, easyApplyOnly, hideViewed, hideApplied });

    const total = allJobs.length;
    const shown = filtered.length;

    setJobCount(shown, total);

    // Show Easy Apply checkbox only when relevant
    const hasEasyApply = allJobs.some(j => j.easyApply === true);
    if (elEasyLabel) elEasyLabel.style.display = hasEasyApply ? '' : 'none';

    // Clear list
    clearJobList();

    if (total > 0 && shown === 0) {
      setStatus('No jobs match the current filters.');
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn-clear-filters';
      clearBtn.textContent = 'Clear filters';
      clearBtn.addEventListener('click', function () {
        if (elFilterQuery) elFilterQuery.value = '';
        if (elHideViewed) elHideViewed.checked = false;
        if (elHideApplied) elHideApplied.checked = false;
        if (elEasyApply) elEasyApply.checked = false;
        renderJobs();
      });
      if (elStatus) elStatus.appendChild(clearBtn);
      return;
    }

    // Partial times notice
    const unknownCount = filtered.filter(j => j.ageMinutes === null).length;
    const knownCount   = filtered.filter(j => j.ageMinutes !== null).length;
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
    for (const job of filtered) fragment.appendChild(buildJobCard(job));
    if (elJobList) elJobList.appendChild(fragment);
  }

  // ── Tab Resolution & Navigation ────────────────────────────────────────────

  async function findLinkedInTab() {
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs.length) { resolve(null); return; }
        const tab = tabs[0];
        if (tab.url && tab.url.includes(LINKEDIN_HOST)) {
          resolve(tab);
        } else {
          resolve(null);
        }
      });
    });
  }

  async function ensureScriptsInjected(tabId) {
    for (const file of CONTENT_SCRIPTS) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
      } catch (_) {}
    }
  }

  async function navigateAndSettle(tabId, targetUrl) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      }, 15000);

      const onUpdated = function (updatedTabId, changeInfo) {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status !== 'complete') return;

        if (!settled) {
          settled = true;
          cleanup();
          clearTimeout(timer);
          setTimeout(resolve, POST_LOAD_DELAY_MS);
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);

      chrome.tabs.get(tabId, currentTab => {
        if (chrome.runtime.lastError || !currentTab) {
          cleanup();
          clearTimeout(timer);
          reject(new Error('LinkedIn tab not found'));
          return;
        }

        if (currentTab.url === targetUrl) {
          chrome.tabs.reload(tabId, { bypassCache: true }, () => {
            if (chrome.runtime.lastError) {
              cleanup();
              clearTimeout(timer);
              reject(new Error(chrome.runtime.lastError.message));
            }
          });
        } else {
          chrome.tabs.update(tabId, { url: targetUrl }, () => {
            if (chrome.runtime.lastError) {
              cleanup();
              clearTimeout(timer);
              reject(new Error(chrome.runtime.lastError.message));
            }
          });
        }
      });
    });
  }

  // ── Runtime Message Handler (Crawler → Side Panel) ─────────────────────────

  function handleRuntimeMessage(message, sender) {
    if (linkedInTabId && sender && sender.tab && sender.tab.id !== linkedInTabId) {
      return;
    }

    if (message.type === LJS.MSG_CRAWL_PROGRESS) {
      const pageJobs = message.jobs || [];
      allJobs = allJobs.concat(pageJobs);
      const deduped = LJS.deduplicateJobs(allJobs);
      allJobs = deduped.jobs;

      if (message.searchContext) {
        searchContext = message.searchContext;
      }

      crawlState.pagesCompleted = message.pageNumber;
      crawlState.moreAvailable = message.hasNextPage;

      persistJobsAndState();
      renderJobs();

      setStatus(`Fetching page ${message.pageNumber}… (${allJobs.length} jobs collected)`);
      updateProgressUI(message.pageNumber, message.hasNextPage);
    }

    if (message.type === LJS.MSG_CRAWL_COMPLETE) {
      isCrawling = false;
      setBtnRefreshBusy(false);
      setBtnFetchMoreBusy(false);
      hideProgressUI();

      crawlState.moreAvailable = !!message.moreAvailable;
      updateFetchMoreVisibility(crawlState.moreAvailable);

      if (message.reason === 'NETWORK_TIMEOUT') {
        const nextPage = (crawlState.pagesCompleted || 0) + 1;
        setStatus(`Network delay while loading page ${nextPage}. ${allJobs.length} jobs saved so far. Click "Fetch More" to resume.`);
      } else if (crawlState.moreAvailable) {
        setStatus(`Reached page ${crawlState.pagesCompleted} (${allJobs.length} jobs). Click "Fetch More" for next 10 pages.`);
      } else {
        setStatus(`Fetch complete! Fetched ${allJobs.length} jobs across ${crawlState.pagesCompleted} page${crawlState.pagesCompleted === 1 ? '' : 's'}.`);
      }

      persistJobsAndState();
    }

    if (message.type === LJS.MSG_CRAWL_ERROR) {
      isCrawling = false;
      setBtnRefreshBusy(false);
      setBtnFetchMoreBusy(false);
      hideProgressUI();

      const errMsg = message.error && message.error.message ? message.error.message : 'Error encountered during fetch';
      if (allJobs.length > 0) {
        crawlState.moreAvailable = true;
        updateFetchMoreVisibility(true);
        setStatus(`Fetch stopped: ${errMsg}. Click "Fetch More" to retry.`);
        persistJobsAndState();
      } else {
        setStatus(`Fetch stopped: ${errMsg}`);
      }
    }
  }

  // ── Refresh & Crawl Flow ───────────────────────────────────────────────────

  async function handleRefresh() {
    // If a crawl is currently in progress, stop it first
    if (isCrawling && linkedInTabId) {
      chrome.tabs.sendMessage(linkedInTabId, { type: LJS.MSG_CRAWL_STOP }, () => {});
    }

    // 1. Clear storage & in-memory jobs
    await chrome.storage.session.remove([STORAGE_KEY_JOBS, STORAGE_KEY_STATE]);
    allJobs = [];
    searchContext = null;
    crawlState = { pagesCompleted: 0, moreAvailable: false };
    clearJobList();
    setJobCount(0, 0);
    setNotice('');
    updateFetchMoreVisibility(false);

    // 2. Resolve active LinkedIn tab
    const tab = await findLinkedInTab();
    if (!tab) {
      showState('unsupported');
      return;
    }
    linkedInTabId = tab.id;

    // 3. Enforce valid search URL and "Past 24 hours" filter
    const validation = LJS.validateSearchUrl(tab.url);
    if (!validation.valid) {
      setStatus(validation.reason);
      setNotice(validation.reason);
      return;
    }

    // 4. Reset to page 1 (start=0)
    const page1Url = LJS.getPage1Url(tab.url);
    isCrawling = true;
    setBtnRefreshBusy(true);
    setStatus('Resetting LinkedIn page to page 1…');
    updateProgressUI(0, true, 'Resetting to page 1…');

    try {
      await navigateAndSettle(tab.id, page1Url);
      await ensureScriptsInjected(tab.id);

      // 5. Kick off crawler from page 1
      setStatus('Started fetching from page 1…');
      chrome.tabs.sendMessage(tab.id, {
        type: LJS.MSG_CRAWL_START,
        maxPages: PAGE_LIMIT,
      }, function (response) {
        if (chrome.runtime.lastError) {
          setStatus(`Could not start job fetch: ${chrome.runtime.lastError.message}`);
          isCrawling = false;
          setBtnRefreshBusy(false);
          hideProgressUI();
        }
      });
    } catch (err) {
      setStatus(`Refresh failed: ${err.message}`);
      isCrawling = false;
      setBtnRefreshBusy(false);
      hideProgressUI();
    }
  }

  // ── Fetch More Flow ────────────────────────────────────────────────────────

  async function handleFetchMore() {
    if (isCrawling) return;

    const tab = await findLinkedInTab();
    if (!tab) {
      setStatus('LinkedIn tab not found. Please open LinkedIn in the active tab.');
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

    const nextPageNumber = (crawlState.pagesCompleted || 0) + 1;
    setStatus(`Continuing jobs fetch from page ${nextPageNumber}…`);
    updateProgressUI(crawlState.pagesCompleted, true, `Advancing to page ${nextPageNumber}…`);

    try {
      await ensureScriptsInjected(tab.id);

      chrome.tabs.sendMessage(tab.id, {
        type: LJS.MSG_CRAWL_CONTINUE,
        maxPages: PAGE_LIMIT,
        startPageNumber: nextPageNumber,
      }, function (response) {
        if (chrome.runtime.lastError) {
          setStatus(`Could not continue job fetch: ${chrome.runtime.lastError.message}`);
          isCrawling = false;
          setBtnRefreshBusy(false);
          setBtnFetchMoreBusy(false);
          hideProgressUI();
        }
      });
    } catch (err) {
      setStatus(`Fetch more failed: ${err.message}`);
      isCrawling = false;
      setBtnRefreshBusy(false);
      setBtnFetchMoreBusy(false);
      hideProgressUI();
    }
  }

  // ── Event Listeners ────────────────────────────────────────────────────────

  if (elBtnRefresh) {
    elBtnRefresh.addEventListener('click', handleRefresh);
  }

  if (elBtnFetchMore) {
    elBtnFetchMore.addEventListener('click', handleFetchMore);
  }

  if (elFilterQuery) elFilterQuery.addEventListener('input', renderJobs);
  if (elHideViewed) elHideViewed.addEventListener('change', renderJobs);
  if (elHideApplied) elHideApplied.addEventListener('change', renderJobs);
  if (elEasyApply) elEasyApply.addEventListener('change', renderJobs);

  // ── Init & Storage Restoration ─────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    // Listen for crawl progress messages from content script
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    // Restore from storage on initial open or accidental refresh
    chrome.storage.session.get([STORAGE_KEY_JOBS, STORAGE_KEY_STATE], function (result) {
      const savedJobs = result[STORAGE_KEY_JOBS];
      const savedState = result[STORAGE_KEY_STATE];

      if (Array.isArray(savedJobs) && savedJobs.length > 0) {
        elBtnRefresh.textContent = "Refresh";

        allJobs = savedJobs;
        crawlState = savedState || { pagesCompleted: 1, moreAvailable: false };
        searchContext = crawlState.searchContext || null;

        renderJobs();
        updateFetchMoreVisibility(crawlState.moreAvailable);

        if (crawlState.moreAvailable) {
          setStatus(`Fetched ${crawlState.pagesCompleted} pages (${allJobs.length} jobs). Click "Fetch More" to get next 10 pages.`);
        } else {
          setStatus(`Loaded ${allJobs.length} jobs from storage.`);
        }
      } else {
        // Storage empty — do NOT automatically start crawling
        showInitialState();
      }
    });
  });

})();
