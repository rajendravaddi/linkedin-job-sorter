# LinkedIn Job Sorter

A Chrome Extension (Manifest V3) that extracts, sorts, and filters LinkedIn job search results by **estimated posting age** — surfacing the freshest opportunities to the top instead of leaving them buried by LinkedIn's default ranking algorithms.

---

## Overview

When searching for jobs on LinkedIn, listings are often ordered by LinkedIn's proprietary "relevance" algorithm rather than chronological order. Even when filtered by date, newly posted jobs can be mixed with older postings or scattered across multiple pages.

**LinkedIn Job Sorter** runs directly alongside your search in Chrome's native Side Panel. It crawls multi-page search results, parses relative timestamps into exact minute values, deduplicates repeated listings, and displays them sorted newest first.

---

## Key Features

- **Automated Multi-Page Crawling**: Automatically paginates through search results in controlled batches of up to 10 pages (~250 jobs) per crawl.
- **On-Demand "Fetch More"**: Fetch subsequent 10-page batches with a single click without restarting or losing collected jobs.
- **Estimated Age Parsing**: Converts relative labels (*"Posted 15 minutes ago"*, *"3 hours ago"*, *"just now"*, *"Reposted 2 days ago"*) into numeric minutes for accurate sorting.
- **Chronological Sorting**: Automatically surfaces the newest opportunities first, with unknown ages (viewed or applied jobs) placed at the bottom.
- **In-Memory Session Persistence**: Extracted listings and crawl state persist in `chrome.storage.session` across side panel toggles and tab switches.
- **Live Search Filtering**: Filter visible listings instantly by job title, company name, Easy Apply flag, or hide previously viewed and applied roles.
- **Native Side Panel UI**: Docks beside your active LinkedIn search tab without auto-closing when you click on the page or switch tabs.
- **Smart Job Opening**: Selects jobs directly in LinkedIn's split view on search results pages without reloading or navigating away.
- **Privacy First & Local Only**: Zero external network requests, zero telemetry, no tracking scripts, and no persistent disk storage.

---

## How It Works

1. **Activation**: Clicking the extension icon opens the Side Panel docked alongside your LinkedIn tab.
2. **Search Validation**: The extension checks that you are on a LinkedIn job search page (`/jobs/search`) with the **Past 24 hours** filter applied (`f_TPR=r86400`).
3. **Crawl & Extract**: Clicking **Refresh** resets the page to `start=0` and begins crawling. For each page, content scripts extract job cards from the DOM, handle screen-reader duplicate text, parse relative timestamps, and send progress updates to the panel.
4. **Deduplication & Storage**: Jobs are deduplicated by numeric ID or URL and saved to `chrome.storage.session`.
5. **Sort & Filter**: The UI sorts the aggregated list (newest first) and applies active user filters in real time.

---

## Technology and Dependencies

- **Runtime**: Manifest V3 Chrome Extension (vanilla JavaScript, HTML5, CSS3). No runtime frameworks or bundlers.
- **Architecture**: Universal Module Definition (UMD) pattern across library modules for dual compatibility in browser and Node.js environments.
- **Development Dependencies**: Node.js built-in test runner (`node:test`) and [`jsdom`](https://github.com/jsdom/jsdom) for DOM simulation.

---

## Repository Structure

```text
linkedin-job-sorter/
├── manifest.json              # Manifest V3 extension configuration
├── package.json               # Development scripts and dependencies
├── assets/
│   └── icons/                 # Extension icons (16px, 32px, 48px, 128px)
├── src/
│   ├── background/
│   │   └── service-worker.js  # Background worker configuring side panel
│   ├── content/
│   │   ├── content-script.js  # Single-page extraction handler
│   │   └── crawler.js         # Multi-page crawler and pagination engine
│   ├── lib/                   # Pure logic modules (UMD)
│   │   ├── card-extractor.js  # DOM card scraper
│   │   ├── posted-time-parser.js # Relative time string parser
│   │   ├── search-context.js  # URL validator & parameter parser
│   │   ├── deduplicate-jobs.js# Deduplication and field-merging
│   │   ├── job-sorter.js      # Sorting engine
│   │   └── job-filter.js      # Filter engine
│   ├── popup/
│   │   ├── popup.html         # Side panel HTML shell
│   │   ├── popup.css          # Side panel styles
│   │   └── popup.js           # Side panel UI controller
│   └── shared/
│       └── messages.js        # Shared message types & error codes
├── tests/                     # Automated unit test suite (161 tests)
└── docs/                      # Comprehensive technical documentation
```

---

## Prerequisites and Development Setup

- **Node.js**: Version `18.0.0` or higher
- **Google Chrome**: Version `114+` (required for Chrome Side Panel API)

Install development dependencies:
```bash
npm install
```

---

## Loading the Extension Locally

1. Open Google Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the upper-right corner.
3. Click the **Load unpacked** button in the upper-left corner.
4. Select the project root folder (`linkedin-job-sorter/`).
5. The **LinkedIn Job Sorter** icon will appear in your Chrome toolbar.

---

## Running Tests

Run the automated unit test suite:
```bash
npm test
```

This executes all 161 tests across 16 test suites using Node's native test runner (`node --test tests/*.test.js`).

To verify syntax across all JavaScript files:
```bash
node -c src/**/*.js tests/**/*.js
```

---

## Basic Usage

1. Open Chrome and navigate to LinkedIn Job Search:  
   `https://www.linkedin.com/jobs/search-results/`
2. Enter your desired job title/keyword and location.
3. In LinkedIn's search filters, set the **Date posted** filter to **Past 24 hours**.
4. Click the **LinkedIn Job Sorter** extension icon in your Chrome toolbar to open the Side Panel.
5. Click **Start** to initiate multi-page crawling starting from page 1.
6. As jobs load, watch the progress bar and live job count.
7. If more than 10 pages exist, click **Fetch More** to crawl the next 10 pages.
8. Filter the list by title or company, hide viewed/applied roles, or check "Easy Apply only".
9. Click **Open** on any job card to select it in LinkedIn's split view.

---

## Known Limitations

- **Relative Time Granularity**: LinkedIn rounds timestamps (e.g., *"3 hours ago"*, *"1 day ago"*). Jobs posted within the same rounding window cannot be distinguished beyond LinkedIn's reported precision.
- **Viewed and Applied Jobs**: LinkedIn replaces posting-time labels with *"Viewed"* or *"Applied"* once interacted with. These jobs receive `ageMinutes: null` and appear at the end of the list.
- **Search Page & Date Filter Requirement**: To prevent runaway pagination through thousands of stale results, the crawler strictly requires the "Past 24 hours" filter (`f_TPR=r86400`) on a `/jobs/search` page.
- **DOM Structure Dependency**: The parser relies on semantic attributes (`componentkey`, ARIA roles, `data-testid`). Substantial redesigns to LinkedIn's markup may require selector updates.
- **English Locale**: The timestamp parser currently recognizes English relative time expressions.

---

## Documentation Links

For deeper technical details, development workflows, and project guidelines:

- [Architecture & Design Specification](docs/ARCHITECTURE.md)
- [Developer Guide & Release Packaging](docs/DEVELOPMENT.md)
- [Privacy Policy & Data Handling](docs/PRIVACY.md)
- [Changelog & Release Notes](docs/CHANGELOG.md)
- [Contributing Guidelines](docs/CONTRIBUTING.md)