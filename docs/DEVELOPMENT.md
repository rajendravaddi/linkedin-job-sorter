# Developer Guide: LinkedIn Job Sorter

This guide covers setup, testing, debugging, manual verification, and release packaging for contributors and maintainers of the **LinkedIn Job Sorter** Chrome extension.

---

## 1. Prerequisites and Environment

- **Node.js**: Version `18.0.0` or higher (Node's built-in test runner `node:test` is required).
- **npm**: Version `8.0.0` or higher (bundled with Node.js).
- **Browser**: Google Chrome version `114+` (required for Chrome Manifest V3 `chrome.sidePanel` support).
- **Git**: For version control.

Verify your environment:
```bash
node -v   # Should output v18.0.0 or higher
npm -v    # Should output v8.0.0 or higher
```

---

## 2. Setup and Installation

Clone the repository and install development dependencies:

```bash
git clone https://github.com/rajendravaddi/linkedin-job-sorter.git
cd linkedin-job-sorter
npm install
```

> [!NOTE]
> `package.json` contains only one development dependency: [`jsdom`](https://github.com/jsdom/jsdom) (`^24.1.3`), which simulates the browser DOM in unit tests. The runtime extension has **zero** third-party dependencies and requires no build or compilation step.

---

## 3. Development Commands

### Run the Test Suite
The repository uses Node's native test runner (`node:test`). Tests run directly against source files using the UMD wrapper.

Run all tests:
```bash
npm test
```

Run a specific test file:
```bash
node --test tests/posted-time-parser.test.js
node --test tests/crawler-dom.test.js
node --test tests/card-extractor.test.js
node --test tests/deduplicate-jobs.test.js
node --test tests/job-sorter.test.js
node --test tests/job-filter.test.js
node --test tests/search-context.test.js
```

### Validate JavaScript Syntax
Verify that all source and test files pass V8 syntax analysis without execution:
```bash
node -c src/**/*.js tests/**/*.js
```

---

## 4. Loading the Extension in Google Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in the address bar.
3. Toggle **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left toolbar.
5. In the file picker, select the root folder of the project (`linkedin-job-sorter/`, where `manifest.json` is located).
6. The **LinkedIn Job Sorter** card will appear with its version number and icon.

---

## 5. Reloading Changes During Development

Chrome caches extension components differently depending on their execution context:

| File Types Modified | Context | How to Reload |
|---|---|---|
| `manifest.json`, `src/background/*` | Manifest & Service Worker | Go to `chrome://extensions/` and click the **Reload** (circular arrow) button on the extension card. |
| `src/popup/*` (`popup.html`, `popup.css`, `popup.js`) | Side Panel | Right-click inside the side panel and select **Reload Frame**, or close and reopen the side panel. |
| `src/content/*`, `src/lib/*`, `src/shared/*` | Content Scripts & Libraries | 1. Click **Reload** on `chrome://extensions/`.<br>2. Refresh the active LinkedIn tab (`Ctrl+R` / `Cmd+R`). |

---

## 6. Debugging Guide

The extension runs across three distinct browser processes. Inspect each using Chrome DevTools:

### 1. Side Panel (`popup.js`, `popup.html`, `popup.css`)
- **How to inspect**: Right-click anywhere inside the side panel UI and select **Inspect**.
- **What to look for**:
  - Console logs under the `[LJS]` tag.
  - Storage inspection: Open DevTools **Application** tab -> **Storage** -> **Session Storage** or run in Console:
    ```javascript
    chrome.storage.session.get(null, console.log);
    ```
  - Network requests triggered by the side panel (should be zero).

### 2. Content Scripts and Crawler (`crawler.js`, `content-script.js`, `card-extractor.js`)
- **How to inspect**: Open DevTools on the **LinkedIn tab itself** (`F12` or right-click on the webpage -> **Inspect**).
- **What to look for**:
  - Filter console output by typing `[LJS Crawler]` or `[LJS]`.
  - Under DevTools **Sources** tab, expand the **Content scripts** accordion in the left pane to set breakpoints in `crawler.js` or `card-extractor.js`.
  - DOM inspection: Test selectors directly in the Console (e.g., `document.querySelector('button[data-testid="pagination-controls-next-button-visible"]')`).

### 3. Background Service Worker (`service-worker.js`)
- **How to inspect**: Go to `chrome://extensions/`, find **LinkedIn Job Sorter**, and click the blue **service worker** link next to *"Inspect views"*.
- **What to look for**:
  - Side panel initialization errors from `chrome.sidePanel.setOptions` or `chrome.sidePanel.open`.
  - Extension install and update lifecycle events.

---

## 7. Manual Testing Checklist on LinkedIn

Before submitting changes, perform this end-to-end verification on a live LinkedIn session:

### Pre-requisites
- [ ] Log in to LinkedIn on Chrome.
- [ ] Navigate to a job search results URL, for example:  
  `https://www.linkedin.com/jobs/search-results/?keywords=software%20engineer&f_TPR=r86400`

### Test Scenarios
1. **Side Panel Activation**:
   - [ ] Click the extension icon in the Chrome toolbar.
   - [ ] Verify the side panel opens docked beside the active LinkedIn tab.
2. **Search Results Page & Filter Validation**:
   - [ ] Navigate to `linkedin.com/feed/` and open the extension. Confirm status shows:  
     `"Please navigate to a LinkedIn job search page (linkedin.com/jobs/search-results) to fetch jobs."`
   - [ ] Navigate to `linkedin.com/jobs/search-results/?keywords=engineer` (without date filter). Confirm status shows:  
     `"Please apply the "Past 24 hours" date posted filter on LinkedIn before fetching jobs."`
3. **Multi-Page Crawling**:
   - [ ] Apply the "Past 24 hours" filter and click **Refresh**.
   - [ ] Confirm LinkedIn tab navigates to `start=0`.
   - [ ] Confirm progress bar updates with page numbers and collected job count.
   - [ ] Confirm crawl finishes up to 10 pages (~250 jobs) or earlier if the last page is reached.
4. **"Fetch More" Continuation**:
   - [ ] If more pages exist after page 10, confirm the **Fetch More** button appears.
   - [ ] Click **Fetch More**. Confirm the crawl resumes from page 11 up to page 20 without resetting existing jobs.
   - [ ] Confirm the **Fetch More** button hides if no more pages exist.
5. **Sorting & Filtering**:
   - [ ] Verify jobs are ordered newest first by default.
   - [ ] Type a keyword into the title/company filter box. Verify non-matching cards disappear instantly.
   - [ ] Check "Hide viewed" and "Hide applied". Verify corresponding cards are hidden.
   - [ ] Check "Easy Apply only". Verify only Easy Apply cards remain.
6. **Job Link Handling**:
   - [ ] Click "Open" on a job card. Confirm the job opens within LinkedIn's split-view pane on the search page (`currentJobId` query parameter update).
   - [ ] Click the job title link. Confirm the listing opens in a new browser tab (`target="_blank"`).
7. **Storage Persistence**:
   - [ ] Close the side panel and reopen it. Confirm all previously crawled jobs reload immediately from storage without re-crawling.
   - [ ] Click **Refresh**. Confirm storage clears and a fresh crawl begins from page 1.

---

## 8. Release Packaging Guide

To produce a production zip file ready for deployment or manual distribution:

### Packaging Command
From the project root directory, run:

```bash
zip -r linkedin-job-sorter-v1.0.0.zip \
  manifest.json \
  assets/ \
  src/ \
  -x "*.DS_Store*" "*Thumbs.db*"
```

### Release Package Verification Checklist

Before publishing or distributing the zip package, verify its contents:

- [ ] **Archive Structure**: `unzip -l linkedin-job-sorter-v1.0.0.zip`
- [ ] **Required Runtime Files Present**:
  - [ ] `manifest.json`
  - [ ] `assets/icons/icon16.png`
  - [ ] `assets/icons/icon32.png`
  - [ ] `assets/icons/icon48.png`
  - [ ] `assets/icons/icon128.png`
  - [ ] `src/background/service-worker.js`
  - [ ] `src/content/content-script.js`
  - [ ] `src/content/crawler.js`
  - [ ] `src/popup/popup.html`
  - [ ] `src/popup/popup.css`
  - [ ] `src/popup/popup.js`
  - [ ] `src/shared/messages.js`
  - [ ] `src/lib/card-extractor.js`
  - [ ] `src/lib/posted-time-parser.js`
  - [ ] `src/lib/search-context.js`
  - [ ] `src/lib/deduplicate-jobs.js`
  - [ ] `src/lib/job-sorter.js`
  - [ ] `src/lib/job-filter.js`
- [ ] **Development Files Excluded**:
  - [ ] No `node_modules/`
  - [ ] No `tests/`
  - [ ] No `docs/`
  - [ ] No `.git/` or `.gitignore`
  - [ ] No `package.json` or `package-lock.json`
- [ ] **Smoke Test**: Load the extracted zip folder via Chrome's **Load unpacked** to confirm it starts without errors.

