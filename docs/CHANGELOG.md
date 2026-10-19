# Changelog: LinkedIn Job Sorter

All notable changes to the **LinkedIn Job Sorter** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - Unreleased (Planned Initial Release)

### Added
- **Multi-Page Crawling Engine (`src/content/crawler.js`)**:
  - Automated pagination via LinkedIn's Next button (`button[data-testid="pagination-controls-next-button-visible"]`).
  - Safe 10-page batch limit (~250 jobs) per crawl to prevent memory bloat and rate-limiting.
  - "Fetch More" button in side panel header enabling on-demand fetching of subsequent 10-page batches.
  - Real-time progress bar and status indicator displaying batch progress and cumulative job counts.
- **Adaptive Loading and Network Timeout Recovery**:
  - `isLoadingStateActive` detects LinkedIn spinners, loaders, and skeleton cards (`.artdeco-loader`, `.jobs-search-results-list--loading`, `[data-view-name*="loading"]`, `.ghost-job-card`).
  - Extended wait timeouts: `waitForCards` to 15s and `clickNextAndWait` to 16s (both dynamically extend to 25s when active loaders are detected).
  - Differentiates network timeouts from genuine end-of-results, preserving the "Fetch More" button and informing the user.
- **Search Context & Filter Enforcement (`src/lib/search-context.js`)**:
  - Enforces that crawling only runs on LinkedIn search pages (`/jobs/search`).
  - Enforces the "Past 24 hours" date filter (`f_TPR=r86400`) to guarantee fast, relevant multi-page crawls.
  - Automatic `start=0` URL rewriting on Refresh to guarantee crawling begins from page 1.
- **Session-Bound Storage Persistence (`chrome.storage.session`)**:
  - Stores extracted listings (`ljs_jobs`) and crawl state (`ljs_crawl_state`) in memory for the duration of the browser session.
  - Instant UI reload when reopening the side panel without triggering unnecessary re-crawls.
  - Explicit reset when clicking "Refresh" to purge stored listings and restart from page 1.
- **Smart In-Tab Job Selection**:
  - "Open" button on job cards updates the search URL with `currentJobId=<id>` using `chrome.tabs.update`, selecting the job in LinkedIn's split view without reloading or navigating away.
  - Title link opens the direct job URL in a new browser tab (`target="_blank"`).
- **Extension Branding**:
  - Added dedicated icon set (16px, 32px, 48px, 128px) in `assets/icons/`.
- **Expanded Test Suite**:
  - Added unit test suites for crawler DOM detection, Next button visibility checks, and loading state verification (`tests/crawler-dom.test.js`). Total passing tests increased to 161 across 16 suites.

### Changed
- Replaced browser action popup with native persistent Chrome Side Panel (`chrome.sidePanel`).
- Simplified UI controls by defaulting sort order to *Estimated newest first* and removing redundant dropdown selectors.
- Replaced "Known posting time only" filter with streamlined controls: text query, "Hide viewed", "Hide applied", and "Easy Apply only".

---

## [0.2.0] - 2026-10-15

### Added
- Native Chrome Side Panel integration (`sidePanel` permission) allowing the extension UI to stay docked beside the active tab during navigation.
- Header Refresh button to trigger page reloads and re-extraction.

### Changed
- Converted popup UI layout to a sticky-header side panel container.

---

## [0.1.0] - 2026-10-14

### Added
- **Initial MVP Release**:
  - Single-page DOM scraper (`src/lib/card-extractor.js`) targeting rendered cards using `[componentkey^='job-card-component-ref-']`.
  - Screen-reader twin-text separation (`readTwinText`) avoiding duplicated title and posting time text.
  - Relative posting-time parser (`src/lib/posted-time-parser.js`) handling minutes, hours, days, weeks, and "just now".
  - Canonical job URL synthesis from numeric job IDs (`https://www.linkedin.com/jobs/view/<id>/`).
  - In-memory job deduplication (`src/lib/deduplicate-jobs.js`) merging duplicate cards by ID or URL.
  - In-memory job sorter (`src/lib/job-sorter.js`) with newest-first, oldest-first, and original-order modes.
  - Job filters (`src/lib/job-filter.js`) for text queries, viewed jobs, and Easy Apply flags.
  - Content script listener (`src/content/content-script.js`) responding to `LJS_EXTRACT` messages.
  - Initial unit test suite using Node's built-in test runner (`node:test`) and `jsdom`.

