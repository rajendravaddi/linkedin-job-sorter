# Privacy Policy and Data Handling: LinkedIn Job Sorter

This document details the exact data-handling behavior of the **LinkedIn Job Sorter** Chrome extension based on an exhaustive audit of the extension codebase.

---

## 1. Information Read and Processed

LinkedIn Job Sorter operates exclusively as a client-side parser. It reads and processes only the publicly rendered job listing elements and search parameters present on the active LinkedIn job search page.

### 1.1 Job Card Data Extracted
When crawling or extracting from the LinkedIn search feed, the extension extracts:
- **Job Identifiers**: The numeric job ID found in the card's `componentkey` attribute or anchor link (e.g., `4478776696`).
- **Listing Metadata**: Job title, company name, location string, and workplace type (`On-site`, `Remote`, `Hybrid`).
- **Posting Time**: The text label indicating when the listing was published (e.g., *"Posted 19 hours ago"*, *"just now"*).
- **Status Flags**: Boolean indicators rendered on the card, including:
  - `viewed`: Indicates whether the user has previously opened the job card.
  - `applied`: Indicates whether the user has already applied.
  - `easyApply`: Indicates whether the job supports LinkedIn Easy Apply.
  - `earlyApplicant`: Indicates whether the listing displays *"Be an early applicant"*.
  - `reposted`: Indicates whether the listing is a re-posted role.
  - `promoted`: Indicates whether the listing is marked as promoted.
- **Job URLs**: The canonical listing URL (`https://www.linkedin.com/jobs/view/<id>/`).

### 1.2 Search Context Data Extracted
The extension reads URL query parameters from the active tab:
- `keywords`: The search terms entered by the user.
- `location`: The location filter entered by the user.
- `f_TPR`: The date-posted filter parameter (must be `r86400` / "Past 24 hours").

### 1.3 Data Specifically NOT Collected
The extension does **not** read, process, or store:
- User profile data, contact details, work history, or connections.
- LinkedIn credentials, account passwords, authentication cookies, or session tokens.
- User resume content, cover letters, or job application responses.
- Private messages, notifications, or feed posts.
- Any browsing activity outside of `https://www.linkedin.com/jobs/*`.

---

## 2. Data Storage and Retention

### 2.1 Where Data is Stored
Extracted job listings and pagination states are stored exclusively in **`chrome.storage.session`** using two storage keys:
1. `ljs_jobs`: An array containing the extracted job records for the current crawl.
2. `ljs_crawl_state`: An object tracking pagination progress (`pagesCompleted`, `moreAvailable`, `lastCrawledAt`, and `searchContext`).

### 2.2 Storage Lifecycle
- **In-Memory Retention**: `chrome.storage.session` keeps data in memory for the duration of the browser session. Data persists across side-panel open/close events or background tab switching.
- **Session Expiration**: All stored records are automatically purged when the browser is closed.
- **No Persistent Disk Storage**: The extension does **not** write job listings to persistent disk storage (`chrome.storage.local`, `chrome.storage.sync`, `localStorage`, or `IndexedDB`).

---

## 3. Remote Transmission and Third-Party Services

An inspection of all source code under `src/` confirms:
- **Zero External Network Requests**: The extension contains no calls to `fetch()`, `XMLHttpRequest`, `WebSocket`, or `navigator.sendBeacon`.
- **No External Servers or APIs**: The extension does not communicate with any developer server, third-party backend, cloud database, or AI service.
- **No Analytics or Telemetry**: There are no tracking scripts, telemetry collectors, crash-reporting tools, or advertising trackers (e.g., Google Analytics, Mixpanel, Sentry).

All sorting, filtering, deduplication, and parsing happen entirely on the user's local CPU.

---

## 4. Chrome Permissions Rationale

The extension requests only permissions necessary for its documented functionality (Principle of Least Privilege):

| Permission | Technical Need | Privacy Impact |
|---|---|---|
| `sidePanel` | Displays the extension UI in Chrome's native side panel alongside the active webpage. | Local UI container; does not grant access to web contents or browsing data. |
| `scripting` | Programmatically injects content scripts (`crawler.js`, `card-extractor.js`) into active LinkedIn tabs if the extension is reloaded while a tab is open. | Constrained strictly to matching host patterns (`https://www.linkedin.com/*`). |
| `tabs` | Reads the active tab's URL to extract search parameters, navigates to `start=0` on refresh, and updates `currentJobId` when the user clicks "Open". | Access is restricted to tab coordination; the extension does not track history or monitor unrelated tabs. |
| `storage` | Saves extracted job lists and crawl state to `chrome.storage.session`. | Restricted to session memory; purged upon closing the browser. |
| Host: `https://www.linkedin.com/*` | Injects content scripts and executes crawling only on LinkedIn web pages. | Strictly scoped to LinkedIn; the extension cannot run on or read any other domain. |

---

## 5. User Control and Data Deletion

Users have full control over their extracted session data:

1. **Clear Data via Extension UI**: Clicking the **"Refresh"** button in the extension header explicitly clears all cached listings and crawl state from `chrome.storage.session` before starting a new search.
2. **Clear Data via Browser Action**: Closing the browser window or terminating Chrome immediately purges all in-memory data stored in `chrome.storage.session`.
3. **Uninstalling the Extension**: Removing the extension via `chrome://extensions/` immediately removes all extension assets and associated browser storage.

---

## 6. Disclaimer

This document reflects the verified behavior of the codebase as of extension version `1.0.0`. It serves as technical documentation of data handling practices and a starting point for public privacy disclosures. It does not constitute formal legal advice or an automated certification of compliance with specific regional privacy regulations or Chrome Web Store developer program policies.

