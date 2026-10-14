/**
 * src/popup/popup.js
 *
 * Full popup logic for the LinkedIn Job Sorter extension.
 * NEVER uses innerHTML — all DOM construction uses createElement + textContent.
 */

/* global LJS, chrome */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const VALID_URL_RE = /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/;
  const LINKEDIN_HOST = 'www.linkedin.com';

  // ── State ──────────────────────────────────────────────────────────────────

  let allJobs = [];          // Full extracted job list (deduped)
  let searchContext = null;  // { keywords, location, dateFilterLabel }
  let extractStats = null;   // Last extraction stats
  let activeTabId = null;    // Tab we extracted from
  let isTabMode = false;     // Whether we're open as a full browser tab
  let sourceTabId = null;    // In tab mode, the original tab we should read from

  // ── DOM References ─────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  const elApp         = $('app');
  const elJobCount    = $('job-count');
  const elSearchCtx   = $('search-context');
  const elNotice      = $('notice');
  const elStatus      = $('status');
  const elJobList     = $('job-list');
  const elSortSelect  = $('sort-select');
  const elFilterQuery = $('filter-query');
  const elKnownTime   = $('filter-known-time');
  const elHideViewed  = $('filter-hide-viewed');
  const elEasyApply   = $('filter-easy-apply');
  const elEasyLabel   = $('easy-apply-label');
  const elBtnRefresh  = $('btn-refresh');
  const elBtnOpenTab  = $('btn-open-tab');

  // ── Mode Detection ─────────────────────────────────────────────────────────

  function detectMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'tab') {
      isTabMode = true;
      const sid = params.get('sourceTabId');
      sourceTabId = sid ? parseInt(sid, 10) : null;

      // Hide the "Open in full tab" button
      elBtnOpenTab.style.display = 'none';

      // Apply wider layout class
      document.body.classList.add('tab-mode');
    }
  }

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
    if (total === 0) {
      elJobCount.textContent = '';
      return;
    }
    if (shown === total) {
      elJobCount.textContent = `${total} job${total === 1 ? '' : 's'}`;
    } else {
      elJobCount.textContent = `${shown} of ${total} job${total === 1 ? '' : 's'}`;
    }
  }

  function renderSearchContext(ctx) {
    if (!ctx) { elSearchCtx.textContent = ''; return; }
    const parts = [];
    if (ctx.keywords)        parts.push(`"${ctx.keywords}"`);
    if (ctx.location)        parts.push(ctx.location);
    if (ctx.dateFilterLabel) parts.push(ctx.dateFilterLabel);
    elSearchCtx.textContent = parts.length ? parts.join(' · ') : '';
  }

  // ── Job card DOM builder (no innerHTML) ────────────────────────────────────

  /**
   * Build a subtitle string from company, location, workplaceType.
   * Omits nulls; never produces a dangling ·.
   */
  function buildSubtitle(job) {
    const parts = [];
    if (job.company)       parts.push(job.company);
    if (job.location)      parts.push(job.location);
    if (job.workplaceType) parts.push(job.workplaceType);
    return parts.join(' · ');
  }

  /**
   * Create a badge <span> element.
   * @param {string} text
   * @param {string} cls  - CSS class for colour variant
   */
  function makeBadge(text, cls) {
    const span = document.createElement('span');
    span.className = `badge ${cls}`;
    span.textContent = text;
    return span;
  }

  /**
   * Build and return a job card <div> element.
   * @param {Object} job
   * @returns {HTMLElement}
   */
  function buildJobCard(job) {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.setAttribute('role', 'listitem');

    // ── Title (link or span) ────────────────────────────────────────────────
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

    // ── Subtitle: Company · Location · WorkplaceType ────────────────────────
    const subtitle = buildSubtitle(job);
    if (subtitle) {
      const subEl = document.createElement('div');
      subEl.className = 'job-subtitle';
      subEl.textContent = subtitle;
      card.appendChild(subEl);
    }

    // ── Posting time ────────────────────────────────────────────────────────
    const postedEl = document.createElement('div');
    if (job.ageMinutes != null) {
      postedEl.className = 'job-posted';
      const label = job.postedText || `${job.ageMinutes} min ago`;
      postedEl.textContent = `${label} (approx.)`;
    } else if (job.viewed === true) {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent = 'Viewed — LinkedIn hides the posting time';
    } else if (job.timeStatus === 'missing') {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent = 'Posting time not shown';
    } else {
      postedEl.className = 'job-posted-muted';
      postedEl.textContent = job.postedText ? `${job.postedText} (unrecognized format)` : 'Posting time not shown';
    }
    card.appendChild(postedEl);

    // ── Badges ───────────────────────────────────────────────────────────────
    const badges = document.createElement('div');
    badges.className = 'badges';
    let hasBadges = false;

    if (job.earlyApplicant === true) { badges.appendChild(makeBadge('Early applicant', 'badge-early')); hasBadges = true; }
    if (job.easyApply      === true) { badges.appendChild(makeBadge('Easy Apply',       'badge-easy'));  hasBadges = true; }
    if (job.viewed         === true) { badges.appendChild(makeBadge('Viewed',           'badge-viewed')); hasBadges = true; }
    if (job.verified       === true) { badges.appendChild(makeBadge('Verified',         'badge-verified')); hasBadges = true; }

    if (hasBadges) card.appendChild(badges);

    // ── Footer: Job ID + Open button ─────────────────────────────────────────
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
    const mode     = elSortSelect.value;
    const query    = elFilterQuery.value;
    const knownTimeOnly = elKnownTime.checked;
    const hideViewed    = elHideViewed.checked;
    const easyApplyOnly = elEasyApply.checked;

    // Apply sort then filter
    const sorted   = LJS.sortJobs(allJobs, mode);
    const filtered = LJS.filterJobs(sorted, { query, knownTimeOnly, easyApplyOnly, hideViewed });

    const total   = allJobs.length;
    const shown   = filtered.length;

    setJobCount(shown, total);
    renderSearchContext(searchContext);

    // Show / hide Easy Apply checkbox based on whether any job has it
    const hasEasyApply = allJobs.some(j => j.easyApply === true);
    elEasyLabel.style.display = hasEasyApply ? '' : 'none';

    // Clear job list
    while (elJobList.firstChild) elJobList.removeChild(elJobList.firstChild);

    if (total > 0 && shown === 0) {
      // Filters produced empty result — show message + clear button
      setStatus('No jobs match the current filters.');
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn-clear-filters';
      clearBtn.textContent = 'Clear filters';
      clearBtn.addEventListener('click', function () {
        elFilterQuery.value = '';
        elKnownTime.checked = false;
        elHideViewed.checked = false;
        elEasyApply.checked = false;
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
      setNotice(`Note: ${unknownCount} job${unknownCount > 1 ? 's' : ''} ${unknownCount > 1 ? 'have' : 'has'} no posting time and appear${unknownCount > 1 ? '' : 's'} at the end.`);
    } else {
      setNotice('');
    }

    // Render job cards
    const fragment = document.createDocumentFragment();
    for (const job of filtered) {
      fragment.appendChild(buildJobCard(job));
    }
    elJobList.appendChild(fragment);
  }

  // ── Tab resolution ─────────────────────────────────────────────────────────

  async function resolveTabId() {
    if (isTabMode && sourceTabId != null) {
      return sourceTabId;
    }
    // Popup mode: get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    activeTabId = tab.id;
    return tab.id;
  }

  function tabUrl(tabId) {
    return new Promise(resolve => {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(tab.url || null);
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

  async function extractJobs(isRetry) {
    if (!isRetry) {
      setStatus('Extracting jobs…');
      clearJobList();
      setJobCount(0, 0);
      setNotice('');
    }

    let tabId;
    try {
      tabId = await resolveTabId();
    } catch (err) {
      showState('unreachable');
      return;
    }

    if (!tabId) {
      showState('unreachable');
      return;
    }

    // Check tab URL is LinkedIn
    const url = await tabUrl(tabId);
    if (!url || !url.includes(LINKEDIN_HOST)) {
      showState('unsupported');
      return;
    }

    let response;
    try {
      response = await sendExtractMessage(tabId);
    } catch (err) {
      // Likely "Receiving end does not exist" — inject and retry once
      if (!isRetry && err.message && err.message.toLowerCase().includes('receiving end')) {
        try {
          await injectScripts(tabId);
          extractJobs(true);
          return;
        } catch (injErr) {
          showState('unreachable', injErr.message);
          return;
        }
      }
      // Second failure or other error
      showState('unreachable', err.message);
      return;
    }

    if (!response) {
      showState('unreachable');
      return;
    }

    if (!response.ok) {
      const code = response.error && response.error.code;
      if (code === LJS.NO_CARDS) {
        showState('no-cards');
      } else if (code === LJS.UNSUPPORTED_PAGE) {
        showState('unsupported');
      } else {
        setStatus(`Error: ${response.error && response.error.message || 'Unknown error'}`);
      }
      return;
    }

    // Success
    allJobs = response.jobs || [];
    searchContext = response.searchContext || null;
    extractStats = response.stats || null;

    clearStatus();
    renderJobs();
  }

  function clearJobList() {
    while (elJobList.firstChild) elJobList.removeChild(elJobList.firstChild);
  }

  function showState(state, detail) {
    clearJobList();
    elJobCount.textContent = '';
    elSearchCtx.textContent = '';
    elNotice.textContent = '';

    switch (state) {
      case 'loading':
        setStatus('Extracting jobs…');
        break;
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
    if (allJobs.length > 0) {
      // Keep old results visible, just set a notice
      setNotice('Refreshing…');
    }
    extractJobs(false).catch(err => {
      if (allJobs.length > 0) {
        setNotice(`Refresh failed. ${err.message}`);
      } else {
        setStatus(`Refresh failed. ${err.message}`);
      }
    });
  });

  elBtnOpenTab.addEventListener('click', function () {
    // Get the active tab id to pass as sourceTabId
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tid = tabs && tabs[0] && tabs[0].id;
      const popupUrl = chrome.runtime.getURL('src/popup/popup.html') +
        `?view=tab${tid ? '&sourceTabId=' + tid : ''}`;
      chrome.tabs.create({ url: popupUrl });
    });
  });

  elSortSelect.addEventListener('change', renderJobs);
  elFilterQuery.addEventListener('input', renderJobs);
  elKnownTime.addEventListener('change', renderJobs);
  elHideViewed.addEventListener('change', renderJobs);
  elEasyApply.addEventListener('change', renderJobs);

  // ── Init ───────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    detectMode();
    extractJobs(false);
  });

})();

