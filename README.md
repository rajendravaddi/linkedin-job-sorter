# LinkedIn Job Sorter

A Chrome Extension (Manifest V3) that re-sorts LinkedIn job search results by **estimated posting age** — so the freshest opportunities surface to the top instead of being buried by LinkedIn's opaque ranking algorithm.

## What It Does

- **Extracts** every visible job card from the LinkedIn Jobs search page
- **Parses** the posting-time label ("Posted 3 hours ago", "Reposted 2 days ago", etc.) into a numeric age in minutes
- **Sorts** jobs by that estimated age (newest first by default), with configurable oldest-first and original-order modes
- **Filters** by free-text (title or company), known posting time, viewed status, and Easy Apply flag
- **Deduplicates** cards that appear more than once in the DOM
- Displays a compact, scrollable popup **and** a full-browser-tab view

---

## How to Load the Extension

1. Open **chrome://extensions** in your Chrome browser
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the project root folder (`linkedin-job-sorter/`)
5. The extension icon will appear in your toolbar

---

## Architecture

```
linkedin-job-sorter/
├── manifest.json                  # MV3 manifest
├── package.json                   # npm scripts + devDependencies
├── src/
│   ├── shared/
│   │   └── messages.js            # Shared message type and error constants (UMD)
│   ├── lib/
│   │   ├── posted-time-parser.js  # Parses "Posted X ago" → minutes (UMD)
│   │   ├── search-context.js      # Extracts keywords/location/dateFilter from URL (UMD)
│   │   ├── card-extractor.js      # Extracts job data from DOM (UMD)
│   │   ├── deduplicate-jobs.js    # Deduplicates job records (UMD)
│   │   ├── job-sorter.js          # Sorts job records (UMD)
│   │   └── job-filter.js          # Filters job records (UMD)
│   ├── content/
│   │   └── content-script.js      # Injected into LinkedIn, handles MSG_EXTRACT
│   ├── background/
│   │   └── service-worker.js      # Logs install events
│   └── popup/
│       ├── popup.html             # Popup / full-tab UI shell
│       ├── popup.css              # Styles (dark-mode, badges, etc.)
│       └── popup.js               # All popup interaction logic
└── tests/
    ├── posted-time-parser.test.js
    ├── card-extractor.test.js
    ├── deduplicate-jobs.test.js
    ├── job-sorter.test.js
    ├── job-filter.test.js
    ├── search-context.test.js
    └── fixtures/
        ├── card-a.html
        ├── card-b.html
        └── multi-cards.html
```

Every library file uses a **UMD wrapper** so the same source works both in the browser (on the global `LJS` namespace) and in Node.js tests (as a CommonJS `require()`).

---

## How to Run Tests

```bash
npm install
npm test
```

Tests use Node's **built-in test runner** (`node:test`, available in Node 18+) and **jsdom** for DOM simulation. No extra test framework is needed.

---

## Known Limitations

| Limitation | Detail |
|---|---|
| **Rounded estimates** | LinkedIn rounds ages ("19 hours ago", "1 week ago") — actual posting time may differ by up to the rounding interval |
| **Only loaded cards** | Only job cards currently rendered in the DOM are extracted; scroll down to load more before refreshing |
| **Viewed jobs hide time** | LinkedIn removes the posting-time label from jobs you've already viewed |
| **Month/year/non-English not parsed** | Labels like "Posted 1 month ago" or non-English locales are left as `ageMinutes: null` |
| **componentkey dependency** | Uses LinkedIn's `componentkey='job-card-component-ref-*'` attribute for card detection; LinkedIn can change this |
| **URL built from ID** | When no `<a href="/jobs/view/…">` anchor is in the card, the URL is reconstructed from the job ID |

---

## Manual Test Checklist

Run these manual checks after loading the extension in Chrome:

1. **Jobs search page** — Navigate to `linkedin.com/jobs/search-results/?keywords=engineer`. Click the extension icon. Jobs should appear sorted newest-first.
2. **Newest sort** — Verify that jobs with smaller ageMinutes appear before those with larger ageMinutes.
3. **Oldest sort** — Switch to "Estimated oldest first". Verify order reverses for known ages.
4. **Original sort** — Switch to "Original LinkedIn order". Verify DOM order is restored.
5. **Title filter** — Type "python" in the filter box. Only matching titles/companies should remain.
6. **Known time filter** — Check "Known posting time only". Jobs without a parsed age should disappear.
7. **Hide viewed filter** — Check "Hide viewed". Previously-visited jobs (Viewed badge) should disappear.
8. **Easy Apply filter** — On a page with Easy Apply jobs, check "Easy Apply only". Only those jobs should remain.
9. **Clear filters** — With active filters producing no results, click "Clear filters". All jobs should re-appear.
10. **Full tab view** — Click "Full tab". A wider layout should open in a new tab showing the same jobs.
11. **Refresh** — Scroll down on LinkedIn to load more cards, then click Refresh. New cards should appear.
12. **Non-jobs page** — Navigate to `linkedin.com/feed/`. Open the extension. The "unsupported page" message should appear.