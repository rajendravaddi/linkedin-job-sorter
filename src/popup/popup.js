/**
 * src/popup/popup.js
 *
 * Side-panel logic for the LinkedIn Job Sorter extension.
 * The panel persists across focus changes, unlike a popup.
 *
 * Refresh behaviour: reloads the LinkedIn tab completely so newly posted
 * jobs scroll into the feed, then re-extracts once the page settles.
 *
 * NEVER uses innerHTML — all DOM construction uses createElement + textContent.
 */

/* global LJS, chrome */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const VALID_URL_RE = /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/;
  const LINKEDIN_HOST = 'www.linkedin.com';

  /**
   * How long (ms) to wait after a tab's status becomes 'complete' before
   * attempting extraction, to give JS frameworks time to render job cards.
   */
  const POST_LOAD_DELAY_MS = 1500;

  // ── State ──────────────────────────────────────────────────────────────────

  let allJobs = [];          // Full extracted job list (deduped)
  let searchContext = null;  // { keywords, location, dateFilterLabel }
  let linkedInTabId = null;  // ID of the LinkedIn tab we're watching
  let isRefreshing = false;  // Guard against concurrent refresh calls

  // ── DOM References ─────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  const elJobCount     = $('job-count');
  const elSearchCtx    = $('search-context');
  const elNotice       = $('notice');
  const elStatus       = $('status');
  const elJobList      = $('job-list');
  const elSortSelect   = $('sort-select');
  const elFilterQuery  = $('filter-query');
  const elKnownTime    = $('filter-known-time');
  const elHideViewed   = $('filter-hide-viewed');
  const elHideApplied  = $('filter-hide-applied');
  const elEasyApply    = $('filter-easy-apply');
  const elEasyLabel    = $('easy-apply-label');
  const elBtnRefresh   = $('btn-refresh');

  // ── UI helpers ─────────────────────────────────────────────────────────────

  function setStatus(text) {
    elStatus.textContent = text;
  }

  function clearStatus() {
    elStatus.textContent = '';
  }

  function setNotice(text) {
    elNotice.textContent = text;
  }

  function setJobCount(shown, total) {
    if (total === 0) { elJobCount.textContent = ''; return; }
    elJobCount.textContent = shown === total
      ? `${total} job${total === 1 ? '' : 's'}`
      : `${shown} of ${total} job${total === 1 ? '' : 's'}`;
  }

  function renderSearchContext(ctx) {
    if (!ctx) { elSearchCtx.textContent = ''; return; }
    const parts = [];
    if (ctx.keywords)        parts.push(`"${ctx.keywords}"`);
    if (ctx.location)        parts.push(ctx.location);
    if (ctx.dateFilterLabel) parts.push(ctx.dateFilterLabel);
    elSearchCtx.textContent = parts.join(' · ');
  }

  function setBtnRefreshBusy(busy) {
    elBtnRefresh.disabled = busy;
    elBtnRefresh.textContent = busy ? 'Refreshing…' : 'Refresh';
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
    if (validUrl) {
      titleEl = document.createElement('a');
      titleEl.className = 'job-title';
      titleEl.textContent = job.title;
      titleEl.href = '#';
      titleEl.addEventListener('click', function (e) {
        e.preventDefault();
        chrome.tabs.create({ url: validUrl });
      });
    } else {
      titleEl = document.createElement('span');
      titleEl.className = 'job-title';
      titleEl.textContent = job.title;
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
    if (job.verified       === true) { badges.appendChild(makeBadge('Verified',         'badge-verified')); hasBadges = true; }

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
      openBtn.textContent = 'Open on LinkedIn';
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
    const mode         = elSortSelect.value;
    const query        = elFilterQuery.value;
    const knownTimeOnly = elKnownTime.checked;
    const hideViewed   = elHideViewed.checked;
    const hideApplied  = elHideApplied.checked;
    const easyApplyOnly = elEasyApply.checked;

    const sorted   = LJS.sortJobs(allJobs, mode);
    const filtered = LJS.filterJobs(sorted, { query, knownTimeOnly, easyApplyOnly, hideViewed, hideApplied });

    const total = allJobs.length;
    const shown = filtered.length;

    setJobCount(shown, total);
    renderSearchContext(searchContext);

    // Show Easy Apply checkbox only when relevant
    const hasEasyApply = allJobs.some(j => j.easyApply === true);
    elEasyLabel.style.display = hasEasyApply ? '' : 'none';

    // Clear list
    while (elJobList.firstChild) elJobList.removeChild(elJobList.firstChild);

    if (total > 0 && shown === 0) {
      setStatus('No jobs match the current filters.');
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn-clear-filters';
      clearBtn.textContent = 'Clear filters';
      clearBtn.addEventListener('click', function () {
        elFilterQuery.value   = '';
        elKnownTime.checked   = false;
        elHideViewed.checked  = false;
        elHideApplied.checked = false;
        elEasyApply.checked   = false;
        renderJobs();
      });
      elStatus.appendChild(clearBtn);
      return;
    }

    clearStatus();

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
    elJobList.appendChild(fragment);
  }

  // ── Tab resolution ─────────────────────────────────────────────────────────

  /**
   * Find the active LinkedIn tab in the current window.
   * Returns the tab object, or null if none found.
   */
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

  function getTab(tabId) {
    return new Promise(resolve => {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(tab || null);
      });
    });
  }

  // ── Script injection + retry ───────────────────────────────────────────────

  const CONTENT_SCRIPTS = [
    'src/shared/messages.js',
    'src/lib/posted-time-parser.js',
    'src/lib/search-context.js',
    'src/lib/deduplicate-jobs.js',
    'src/lib/card-extractor.js',
    'src/content/content-script.js',
  ];

  async function injectScripts(tabId) {
    for (const file of CONTENT_SCRIPTS) {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    }
  }

  async function sendExtractMessage(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: LJS.MSG_EXTRACT }, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ── Extract flow ───────────────────────────────────────────────────────────

  /**
   * Extract jobs from the given tab, injecting scripts if needed.
   * @param {number} tabId
   * @param {boolean} isRetry
   */
  async function extractFromTab(tabId, isRetry) {
    let response;
    try {
      response = await sendExtractMessage(tabId);
    } catch (err) {
      if (!isRetry && err.message && err.message.toLowerCase().includes('receiving end')) {
        try {
          await injectScripts(tabId);
          return extractFromTab(tabId, true);
        } catch (injErr) {
          showState('unreachable', injErr.message);
          return;
        }
      }
      showState('unreachable', err.message);
      return;
    }

    if (!response) { showState('unreachable'); return; }

    if (!response.ok) {
      const code = response.error && response.error.code;
      if (code === LJS.NO_CARDS)        showState('no-cards');
      else if (code === LJS.UNSUPPORTED_PAGE) showState('unsupported');
      else setStatus(`Error: ${response.error && response.error.message || 'Unknown error'}`);
      return;
    }

    // Success
    allJobs       = response.jobs || [];
    searchContext = response.searchContext || null;
    clearStatus();
    renderJobs();
  }

  /**
   * Initial extraction on panel open.
   */
  async function extractJobs() {
    setStatus('Extracting jobs…');
    clearJobList();
    setJobCount(0, 0);
    setNotice('');

    const tab = await findLinkedInTab();
    if (!tab) { showState('unsupported'); return; }

    linkedInTabId = tab.id;
    await extractFromTab(tab.id, false);
  }

  // ── Refresh: reload the LinkedIn tab, then re-extract ─────────────────────

  /**
   * Reload the active LinkedIn tab and re-extract jobs once it's loaded.
   * Uses chrome.tabs.onUpdated to detect when the reload finishes.
   */
  async function refreshTab() {
    if (isRefreshing) return;
    isRefreshing = true;
    setBtnRefreshBusy(true);

    // Resolve tab to refresh
    let tabId = linkedInTabId;
    if (!tabId) {
      const tab = await findLinkedInTab();
      if (!tab) {
        showState('unsupported');
        isRefreshing = false;
        setBtnRefreshBusy(false);
        return;
      }
      tabId = tab.id;
      linkedInTabId = tabId;
    }

    // Verify the tab still exists and is a LinkedIn tab
    const currentTab = await getTab(tabId);
    if (!currentTab || !currentTab.url || !currentTab.url.includes(LINKEDIN_HOST)) {
      showState('unsupported');
      isRefreshing = false;
      setBtnRefreshBusy(false);
      return;
    }

    // Show that we're reloading
    setStatus('Reloading LinkedIn page…');
    clearJobList();
    setJobCount(0, 0);
    setNotice('');

    // Listen for the tab to finish loading
    const onUpdated = function (updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status !== 'complete') return;

      // Tab finished loading — unregister listener, wait a bit, then extract
      chrome.tabs.onUpdated.removeListener(onUpdated);

      setTimeout(async function () {
        setStatus('Extracting jobs…');
        await extractFromTab(tabId, false);
        isRefreshing = false;
        setBtnRefreshBusy(false);
      }, POST_LOAD_DELAY_MS);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    // Reload the tab (bypass cache so LinkedIn fetches fresh job feed)
    chrome.tabs.reload(tabId, { bypassCache: true }, function () {
      if (chrome.runtime.lastError) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        setStatus(`Reload failed: ${chrome.runtime.lastError.message}`);
        isRefreshing = false;
        setBtnRefreshBusy(false);
      }
    });
  }

  function clearJobList() {
    while (elJobList.firstChild) elJobList.removeChild(elJobList.firstChild);
  }

  function showState(state, detail) {
    clearJobList();
    elJobCount.textContent   = '';
    elSearchCtx.textContent  = '';
    elNotice.textContent     = '';

    switch (state) {
      case 'no-cards':
        setStatus('No job cards found on this page. Open a LinkedIn job search results page and try again.');
        break;
      case 'unsupported':
        setStatus('Open a LinkedIn jobs search results page (linkedin.com/jobs) to use this extension.');
        break;
      case 'unreachable':
        setStatus(`Unable to read the current tab. Reload the LinkedIn page and try again.${detail ? ' (' + detail + ')' : ''}`);
        break;
    }
  }

  // ── Event listeners ────────────────────────────────────────────────────────

  elBtnRefresh.addEventListener('click', function () {
    refreshTab().catch(err => {
      setStatus(`Refresh failed: ${err.message}`);
      isRefreshing = false;
      setBtnRefreshBusy(false);
    });
  });

  elSortSelect.addEventListener('change', renderJobs);
  elFilterQuery.addEventListener('input', renderJobs);
  elKnownTime.addEventListener('change', renderJobs);
  elHideViewed.addEventListener('change', renderJobs);
  elHideApplied.addEventListener('change', renderJobs);
  elEasyApply.addEventListener('change', renderJobs);

  // ── Init ───────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    extractJobs();
  });

})();
