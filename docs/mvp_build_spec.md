# LinkedIn Job Sorter — Chrome Extension

## Phase 1 Build Specification

**Audience:** coding agent. **Goal:** build a Manifest V3 Chrome extension that reads the LinkedIn job cards currently rendered on the page, converts relative posting times into approximate ages, sorts newest to oldest, and shows the result in the extension's own UI. No backend, no build step, no persistence.

This document is self-contained. It is grounded in real card markup captured from LinkedIn (Section 2).

---

## 0. Key design decisions

| # | Decision | Reason |
| --- | --- | --- |
| 1 | **The job URL is built from the job ID**: `https://www.linkedin.com/jobs/view/<id>/` | The real cards contain no `<a>` link. The card is a `div role='button'` handled by JavaScript. Still use a real `<a href='/jobs/view/...'>` if one is found inside the card. |
| 2 | **All CSS class names are hashed and forbidden as selectors** (`hcb...`) | They are build-generated and will change. Use attributes, tag structure, ARIA and text instead. |
| 3 | **The job ID comes from the `componentkey` attribute** | Each card has `componentkey='job-card-component-ref-<id>'`. |
| 4 | **Viewed cards have no posting time** | LinkedIn replaces the posting label with `Viewed`. Unknown ages will be common, so the data model has a `viewed` field and the UI shows a notice. |
| 5 | **Phase 1 includes deduplication, tests, empty and error states, and three sort options.** MutationObserver and pagination are out of scope. | The goal is a small, reliable working product before any enhancement. |
| 6 | **The content script matches all of `https://www.linkedin.com/*` but stays inert** until messaged | LinkedIn is a single-page app. If the user lands on `/feed/` and clicks into Jobs, a script limited to `/jobs/*` would never be injected. |
| 7 | **No bundler. Plain scripts with a namespace and a `module.exports` shim** | MV3 content scripts cannot use static ES imports, and the same code must be testable in Node. |

---

## 1. Product principles

1. Use only what LinkedIn has rendered in the page the user is already viewing.
2. Relative times are approximate. Never present them as exact timestamps or invent ISO dates.
3. Sort in the extension's own UI. Never reorder LinkedIn's feed.
4. Always keep the original label (`postedText`) for display.
5. Deduplicate by job ID.
6. Degrade gracefully: one bad card must never break the others.
7. Local only: nothing leaves the browser, nothing is stored.

---

## 2. Verified findings from real LinkedIn markup

Two real cards were inspected. Structure (details of icons and images omitted):

| Finding | Detail |
| --- | --- |
| Card root | `div[role='button'][componentkey^='job-card-component-ref-']`. The same `componentkey` is repeated on a nested child `div`, so select only the **outermost** element for each card. |
| Job ID | The digits at the end of `componentkey` (example: `job-card-component-ref-4478776696` gives `4478776696`). |
| No anchor | No `<a>` element exists in the card. Build the URL from the ID. |
| Text lives in `<p>` elements | In order: title, company, location, then a metadata row. |
| Screen-reader twin pattern | The title and the posting time each appear as `<span>sr text</span><span aria-hidden='true'>visible text</span>`. Reading `p.textContent` returns both and duplicates the text. **Never use `textContent` on those paragraphs directly.** |
| Title twin | sr span: `Software Applications (Verified job)`. Visible span: `Software Applications` plus a nested verified-icon span. The `(Verified job)` suffix marks a verified listing. |
| Posting twin | sr span: `Posted 19 hours ago`. Visible span: `19 hours ago` (no word `Posted`). |
| Company | A plain `<p>` inside a `div`, for example `HP`. |
| Location | A plain `<p>` that may end in a workplace type in parentheses: `Bengaluru (Hybrid)`, `India (Remote)`. |
| Metadata row | `<p>` elements separated by `<p> · </p>`. Observed values: posting label, `Viewed`, `Be an early applicant`, `Easy Apply`. |
| Viewed cards | The posting label is **replaced** by `Viewed`. Card B below has no posting time at all. |
| Dismiss button | `button[aria-label='Dismiss <title> job']` is UI chrome. Ignore it, but its label is a valid fallback source for the title. |
| Easy Apply | `<p>Easy Apply</p>` next to a LinkedIn logo svg. |
| Images | Company logo `<img alt=''>` and decorative svgs. Ignore them. Do not collect image URLs. |

### Fixture A (card with posting time) — save as `tests/fixtures/card-a.html`

Condensed but structurally faithful. Also save the raw captured HTML as `tests/fixtures/real-cards-raw.html` if the project owner supplies it.

```html
<div class='wrapper'>
  <div role='button' tabindex='0' componentkey='job-card-component-ref-4478776696'>
    <div componentkey='job-card-component-ref-4478776696'>
      <figure aria-hidden='true'><svg></svg><img alt='' src='logo.png'></figure>
      <div>
        <p><span class='sr'>Software Applications (Verified job)</span><span aria-hidden='true'>Software Applications<span> </span><span aria-hidden='true'><svg id='verified-small'></svg></span></span></p>
        <div><p>HP</p></div>
        <p>Bengaluru (Hybrid)</p>
        <button type='button' aria-label='Dismiss Software Applications job'><span><svg id='close-small'></svg></span></button>
        <div>
          <p><span class='sr'>Posted 19 hours ago</span><span aria-hidden='true'>19 hours ago</span></p>
          <p> · </p>
          <p>Be an early applicant</p>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Fixture B (viewed card, no posting time, Easy Apply) — save as `tests/fixtures/card-b.html`

```html
<div class='wrapper'>
  <div role='button' tabindex='0' componentkey='job-card-component-ref-4479033986'>
    <div componentkey='job-card-component-ref-4479033986'>
      <figure aria-hidden='true'><svg></svg><img alt='' src='logo.png'></figure>
      <div>
        <p><span class='sr'>Python Developer</span><span aria-hidden='true'>Python Developer</span></p>
        <div><p>HRM Counsel</p></div>
        <p>India (Remote)</p>
        <button type='button' aria-label='Dismiss Python Developer job'><span><svg></svg></span></button>
        <div>
          <p>Viewed</p>
          <p> · </p>
          <p>Be an early applicant</p>
          <p> · </p>
          <div><svg id='linkedin-bug-small'></svg><p>Easy Apply</p></div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Expected extraction results (use as test assertions)

| Field | Card A | Card B |
| --- | --- | --- |
| `id` | `4478776696` | `4479033986` |
| `title` | `Software Applications` | `Python Developer` |
| `company` | `HP` | `HRM Counsel` |
| `location` | `Bengaluru` | `India` |
| `workplaceType` | `Hybrid` | `Remote` |
| `postedText` | `Posted 19 hours ago` | `null` |
| `ageMinutes` | `1140` | `null` |
| `timeStatus` | `parsed` | `missing` |
| `url` | `https://www.linkedin.com/jobs/view/4478776696/` | `https://www.linkedin.com/jobs/view/4479033986/` |
| `verified` | `true` | `null` |
| `viewed` | `null` | `true` |
| `earlyApplicant` | `true` | `true` |
| `easyApply` | `null` | `true` |

---

## 3. Scope

**Phase 1 includes:** page detection; extraction of rendered cards; relative-time parsing; deduplication; three sort modes; filters; popup UI with an **Open in full tab** button; empty, error and unsupported states; unit and DOM tests; README.

**Phase 1 excludes:** MutationObserver, pagination or auto-scroll, persistence, backend, analytics, any LinkedIn network requests, the SDUI/undocumented endpoints, applying to jobs, profile data collection.

LinkedIn lazy-loads and may virtualize result cards, so the DOM may hold fewer cards than the full page of results. The UI must state this honestly (Section 10).

---

## 4. Architecture

```text
linkedin-job-sorter/
├── manifest.json
├── package.json
├── README.md
├── src/
│   ├── lib/                       # pure logic, shared by content script, popup and tests
│   │   ├── posted-time-parser.js
│   │   ├── card-extractor.js      # DOM → job records (takes a Document, so jsdom can test it)
│   │   ├── search-context.js      # URL → keywords / location / date filter
│   │   ├── deduplicate-jobs.js
│   │   ├── job-sorter.js
│   │   └── job-filter.js
│   ├── shared/messages.js         # message type and error code constants
│   ├── content/content-script.js  # message listener only; calls lib
│   ├── background/service-worker.js  # minimal; may only log install
│   └── popup/{popup.html, popup.css, popup.js}
└── tests/
    ├── posted-time-parser.test.js
    ├── job-sorter.test.js
    ├── deduplicate-jobs.test.js
    ├── card-extractor.test.js
    ├── job-filter.test.js
    └── fixtures/{card-a.html, card-b.html, multi-cards.html}
```

### Module pattern (no bundler)

Every file in `src/lib` and `src/shared` uses this wrapper so it works as a browser script, in the popup, and via `require` in Node tests:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // ...implementation...
  return { parsePostedAge };
});
```

If a lib file needs another, access it through `root.LJS` at call time, or accept it as a parameter. Do not use `import` or `export`.

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "LinkedIn Job Sorter",
  "version": "0.1.0",
  "description": "Sorts the LinkedIn job results you are viewing by estimated posting age.",
  "permissions": ["scripting"],
  "host_permissions": ["https://www.linkedin.com/*"],
  "action": { "default_popup": "src/popup/popup.html", "default_title": "LinkedIn Job Sorter" },
  "background": { "service_worker": "src/background/service-worker.js" },
  "content_scripts": [{
    "matches": ["https://www.linkedin.com/*"],
    "js": [
      "src/shared/messages.js",
      "src/lib/posted-time-parser.js",
      "src/lib/search-context.js",
      "src/lib/deduplicate-jobs.js",
      "src/lib/card-extractor.js",
      "src/content/content-script.js"
    ],
    "run_at": "document_idle"
  }]
}
```

No `storage`, no `tabs`, no `activeTab`. Opening a link uses `chrome.tabs.create`, which needs no permission. Icons are optional; generate simple PNG icons if convenient, otherwise omit.

The content script must start with `if (globalThis.__LJS_LOADED__) return;` style protection against double injection, and must do **nothing** on load except register `chrome.runtime.onMessage`.

---

## 5. Job data model

Optional fields that are not found are `null`. Optional booleans are `true` when detected and `null` otherwise. Never fabricate values.

```js
{
  id: '4478776696',             // string of digits, or null
  title: 'Software Applications',
  company: 'HP',                // or null
  location: 'Bengaluru',        // without the (Hybrid) suffix, or null
  workplaceType: 'Hybrid',      // 'On-site' | 'Remote' | 'Hybrid' | null; never inferred

  postedText: 'Posted 19 hours ago',  // original LinkedIn label, or null
  ageMinutes: 1140,                   // number or null
  timePrecision: 'approximate',
  timeStatus: 'parsed',               // 'parsed' | 'missing' | 'unrecognized'
  reposted: null,                     // true when label starts with Reposted

  url: 'https://www.linkedin.com/jobs/view/4478776696/',
  urlSource: 'built-from-id',         // 'anchor' | 'built-from-id' | null

  easyApply: null, promoted: null, viewed: null, verified: true, earlyApplicant: true,

  originalIndex: 0,                   // order of appearance in the DOM, 0-based
  source: 'linkedin-rendered-card',
  extractedAt: '2026-10-14T06:00:00.000Z'   // extraction time, NOT posting time
}
```

`timeStatus`: `parsed` = label recognized; `missing` = no posting label on the card (for example Viewed cards); `unrecognized` = a label looked like a posting label but the parser returned null (for example months, years, or non-English text).

---

## 6. Extraction algorithm (`card-extractor.js`)

Export `extractJobsFromDocument(doc, now = new Date())` returning `{ jobs, stats }`, where `stats = { cardsFound, jobsExtracted, malformedSkipped }`. It must not touch `chrome.*` or `window` globals other than `doc`. Wrap each card in `try/catch`; on failure increment `malformedSkipped` and continue.

### 6.1 Find cards

1. `nodes = doc.querySelectorAll("[componentkey^='job-card-component-ref-']")`.
2. Keep only outermost nodes: drop any node whose `parentElement.closest(selector)` is non-null.
3. **Fallbacks** when step 1 finds nothing: elements with `data-occludable-job-id`, `data-job-id`, or `data-entity-urn` containing `urn:li:jobPosting:`, then the closest container of each `a[href*='/jobs/view/']`. These cover older layouts. They are best-effort and need only light test coverage.
4. Preserve DOM order as `originalIndex`.

### 6.2 Job ID

In priority order: (a) digits at the end of the card's `componentkey`; (b) digits in a `/jobs/view/...` anchor inside the card (slugged URLs end with `-<digits>`, plain ones are `/jobs/view/<digits>/`); (c) the `data-*` attributes listed above; (d) `null`. Accept only `^\d{6,}$`.

### 6.3 Text fields

Implement two helpers:

- `readTwinText(p)` returns `{ sr, visible }`. `sr` is the text of the first child `span` without `aria-hidden='true'`. `visible` is the text of the first `span[aria-hidden='true']` **after cloning it and removing all of its child elements**, trimmed. If there are no spans, both equal `p.textContent` trimmed, collapsed whitespace.
- `cleanText(s)` collapses whitespace and trims.

Then collect `paragraphs = [...card.querySelectorAll('p')]` in order, and classify each by its cleaned text (use `sr` when present, otherwise `visible`):

| Paragraph text | Classification |
| --- | --- |
| only `·` or empty | separator, skip |
| parsed or recognized as a posting label (Section 7), including labels starting `Posted` or `Reposted` | posting |
| `Viewed` (case-insensitive) | `viewed = true` |
| `Be an early applicant` | `earlyApplicant = true` |
| `Easy Apply` | `easyApply = true` |
| `Promoted` (exact) | `promoted = true`. **Not yet observed in real markup; keep strict.** |
| anything else | content candidate |

Content candidates, in order, are: `[0]` title, `[1]` company, `[2]` location. Extra candidates (applicant counts, `Actively reviewing`, and so on) are ignored.

- **Title:** use the title paragraph's twin. `title = visible`, or if empty, `sr` minus a trailing `(Verified job)`. Set `verified = true` if `sr` ends with `(Verified job)`, case-insensitive. If still empty, fall back to the dismiss button `aria-label` matching `Dismiss <title> job`. If no title is found, skip the card (count as malformed).
- **Location:** match `^(.*?)\s*\((On-site|Remote|Hybrid)\)$` case-insensitively. If it matches, `location` is group 1 and `workplaceType` is group 2 with canonical casing (`On-site`, `Remote`, `Hybrid`). Otherwise `location` is the whole text and `workplaceType` is `null`.
- **Company and location may be missing.** Use `null`. Do not shift fields to fill gaps beyond the positional order above.
- **Never** classify a paragraph by CSS class.

### 6.4 Posting time

Prefer the `sr` text of the posting paragraph (`Posted 19 hours ago`). If only the visible text exists (`19 hours ago`), parse that and store `postedText` as the label found. Run `parsePostedLabel` (Section 7). `postedText` stays `null` when no posting paragraph exists.

### 6.5 URL

If the card contains an anchor whose `href` resolves to a LinkedIn `/jobs/view/` URL, use it (`urlSource: 'anchor'`), normalized to `https://www.linkedin.com/jobs/view/<id>/` when the ID can be extracted. Otherwise, if an ID exists, build `https://www.linkedin.com/jobs/view/<id>/` (`urlSource: 'built-from-id'`). Otherwise `url = null`. Strip query parameters. Validate against `^https://www\.linkedin\.com/jobs/view/\d+/?$` before anything is rendered as a link.

### 6.6 Search context (`search-context.js`)

`parseSearchContext(urlString)` reads query parameters `keywords`, `location`, and `f_TPR`, and returns `{ keywords, location, dateFilterLabel }` with `null` for missing values. Map `r3600` to `Past hour`, `r86400` to `Past 24 hours`, `r604800` to `Past week`, `r2592000` to `Past month`. Any other `f_TPR` value is shown raw. Do not assume a date filter exists.

### 6.7 Page support

A page is **supported** if its pathname starts with `/jobs/`. If it is supported but no cards are found, report `NO_CARDS` (results may still be loading or the user is on a non-results jobs page). Otherwise report `UNSUPPORTED_PAGE`. Cards found on any page under `/jobs/` count as supported, including search, collections and recommendations.

---

## 7. Posted-time parsing (`posted-time-parser.js`)

Export two functions:

- `parsePostedLabel(text)` returns `{ ageMinutes: number|null, reposted: boolean, precision: 'approximate'|'low', status: 'parsed'|'unrecognized' }`.
- `parsePostedAge(text)` returns `parsePostedLabel(text).ageMinutes`.

After trimming and collapsing whitespace, case-insensitively match the **whole** string against:

```js
/^(?:(posted|reposted)\s+)?(?:(\d+|an?)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)\s+ago|just now)$/i
```

| Input | Age (minutes) | Notes |
| --- | --: | --- |
| `Posted just now` / `just now` | 0 | `precision: 'low'` |
| `Posted 5 minutes ago` | 5 |  |
| `Posted 1 hour ago` / `1 hr ago` | 60 |  |
| `Posted 19 hours ago` | 1140 |  |
| `Posted 21 hours ago` | 1260 |  |
| `Posted 1 day ago` | 1440 |  |
| `Posted 3 days ago` | 4320 |  |
| `Posted 1 week ago` | 10080 |  |
| `Reposted 2 days ago` | 2880 | `reposted: true` |
| `Posted an hour ago` | 60 | `a` and `an` count as 1 |
| `Posted 1 month ago` | `null` | status `unrecognized` until month behavior is defined |
| `Viewed`, `Be an early applicant`, `25 applicants`, `Over 100 people clicked apply`, empty, `null` | `null` | not posting labels |
| `  POSTED   3  Days   Ago ` | 4320 | whitespace and case tolerant |

Multipliers: minute 1, hour 60, day 1440, week 10080. Anything that does not fully match returns `ageMinutes: null`. The `unrecognized` status applies only when the text begins with `Posted`/`Reposted` or ends with `ago` but fails to parse. Plain unrelated text gets `null` with the caller treating it as not a posting label.

LinkedIn rounds labels, so two jobs labelled `1 hour ago` cannot be truly ordered. Do not add false precision.

---

## 8. Sorting, filtering, deduplication

### 8.1 `sortJobs(jobs, mode)` — returns a new array

| Mode | UI label | Rule |
| --- | --- | --- |
| `newest` (default) | **Estimated newest first** | Known ages ascending, then unknown ages. Ties by `originalIndex`. |
| `oldest` | Estimated oldest first | Known ages **descending**, then unknown ages. Ties by `originalIndex`. |
| `original` | Original LinkedIn order | `originalIndex` ascending. |

Unknown ages always come last in `newest` and `oldest`, ordered by `originalIndex`. Never mutate the input array. Never label any mode as exact chronological order.

### 8.2 `filterJobs(jobs, options)`

`options = { query, easyApplyOnly, hideViewed }`. `query` matches case-insensitively against title and company. `easyApplyOnly` keeps only jobs where `easyApply === true`.

### 8.3 `deduplicateJobs(jobs)` returns `{ jobs, duplicatesRemoved }`

- Key: `id`; if `id` is null, the normalized `url`; if both are null, keep the record (no duplicate guarantee).
- On duplicates, keep the **earlier** record (lowest `originalIndex`) and fill its `null` fields from the later one. Never replace a known `ageMinutes` with `null`. If both ages are known and differ, keep the earlier record's value. Booleans merge with OR.

### 8.4 Pipeline order

`extract → deduplicate → sort → filter` (the popup applies sort and filter locally on the extracted array without re-extracting).

---

## 9. Messaging contract

`src/shared/messages.js` exports constants: `MSG_EXTRACT = 'LJS_EXTRACT'`, and error codes `UNSUPPORTED_PAGE`, `NO_CARDS`, `EXTRACTION_FAILED`, `TAB_UNREACHABLE`.

**Pull model.** The popup asks the content script; the service worker is not involved.

Request: `{ type: 'LJS_EXTRACT' }`. Response:

```js
{ ok: true, url, searchContext, jobs: [...], stats: { cardsFound, jobsExtracted, duplicatesRemoved, malformedSkipped, unknownAge, viewedCount }, extractedAt }
// or
{ ok: false, error: { code: 'NO_CARDS' | 'UNSUPPORTED_PAGE' | 'EXTRACTION_FAILED', message } }
```

The content script handler must `return true` only if it responds asynchronously (extraction is synchronous, so respond immediately).

**Popup flow:**

1. Resolve the target tab: in popup mode use the active tab in the current window. In full-tab mode use the `sourceTabId` query parameter.
2. If the tab URL is not on `www.linkedin.com`, show the unsupported state. Do not message it.
3. `chrome.tabs.sendMessage(tabId, { type: 'LJS_EXTRACT' })`.
4. If it throws `Receiving end does not exist` (script not injected, for example after the extension was reloaded), call `chrome.scripting.executeScript({ target: { tabId }, files: [ ...same files as the manifest content script, in order ] })` once, then retry once. On second failure show `TAB_UNREACHABLE`.

---

## 10. UI specification

One page `popup.html` serves both modes. Popup size about 420×600. Full-tab mode is opened from the **Open in full tab** header button using `chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html?view=tab&sourceTabId=' + tabId) })`. In full-tab mode use a wider centered layout (max-width about 900px).

**Render all page text with `textContent`, never `innerHTML`.** Job links use `target='_blank'`, `rel='noopener noreferrer'`, and only if the URL passes the Section 6.5 validation. Prefer `chrome.tabs.create` on click over a raw link if extension-page navigation causes issues.

**Header:** `LinkedIn Job Sorter`; **Refresh jobs** button; **Open in full tab** button (hidden in tab mode); job count.

**Search context line:** `Keywords: …  ·  Location: …  ·  Date filter: …` (omit missing parts). Under it: `Showing N jobs currently loaded on the active LinkedIn tab. Scroll the LinkedIn results list to load more, then press Refresh.`

**Controls:** sort selector (three modes, default `Estimated newest first`); text filter; checkboxes `Known posting time only`, `Hide viewed`, `Easy Apply only`. Show `Easy Apply only` only if at least one job has `easyApply === true`.

**Job card:**

```text
Software Applications                       <- title, bold; opens the job
HP · Bengaluru · Hybrid                     <- omit missing parts, no dangling separators
Posted 19 hours ago   (approx.)             <- original label, accent color, tooltip explains rounding
[Early applicant] [Easy Apply] [Viewed] [Verified]   <- only badges that are true
Job ID: 4478776696                          <- small, secondary
[Open on LinkedIn]
```

When `postedText` is null, show `Posting time not shown` (muted); for viewed jobs show `Viewed — LinkedIn hides the posting time`.

**States (never leave a blank screen):**

| State | Message |
| --- | --- |
| Loading | `Extracting jobs…` |
| Success | job list plus count |
| Partial times | `Some jobs do not have a readable posting time. They appear after jobs with known posting times.` If viewed jobs account for some of them, add: `Jobs you have already viewed show "Viewed" instead of a posting time on LinkedIn.` |
| No cards | `No job cards found on this page. Open a LinkedIn job search results page and try again.` |
| Unsupported page | `Open a LinkedIn jobs search results page (linkedin.com/jobs) to use this extension.` |
| Unreachable tab | `Unable to read the current tab. Reload the LinkedIn page and try again.` |
| Refresh failed | `Refresh failed.` plus the error message. Keep the previously extracted jobs visible. |
| Filters hide everything | `No jobs match the current filters.` plus a **Clear filters** button |

**Design:** neutral background, clear card borders, consistent spacing scale, title larger than metadata, long titles wrap (`overflow-wrap: anywhere`), visible focus outlines, `aria-label` on buttons and controls, `aria-live='polite'` on the status area, `prefers-color-scheme` dark support, no decorative animation. The list scrolls inside its own container with a sticky header.

---

## 11. Permissions, privacy, resilience

- Permissions are exactly those in the manifest. No remote code, no `fetch` to any host, no analytics, no storage.
- Never log page HTML, cookies, or tokens. Development logging is `console.debug('[LJS]', counts)` only.
- Do not collect profile data, images, or applicant information. Do not bypass access controls or automate scrolling or clicking on the page.
- One malformed card never blocks others. Missing optional fields never throw. Handle: empty pages, results still loading, relative links, duplicate cards, popup opened before the content script is ready, navigation away mid-request.

---

## 12. Tests

Use the Node built-in runner and `jsdom`. `package.json`: `"scripts": { "test": "node --test tests/" }`, `"devDependencies": { "jsdom": "^24" }`. Node 18+ is required. Tests must not touch the network or the live site.

| File | Must cover |
| --- | --- |
| `posted-time-parser.test.js` | Every row in the Section 7 table, singular and plural, whitespace and case, null, undefined, empty, unrelated numbers (`25 applicants`), months returning null, `Reposted` flag. |
| `job-sorter.test.js` | Different known ages, equal ages with stable tie order, unknown ages last, mixed, `oldest` mode, `original` mode, input not mutated. |
| `deduplicate-jobs.test.js` | Repeated IDs, repeated normalized URLs, null IDs retained, merge of fields, known age never replaced by null. |
| `card-extractor.test.js` | Fixture A and B match the expected-results table exactly. A multi-card fixture (build one with 5 or more cards, including a duplicate, a card missing company and location, a card with a `Reposted` label, a card with no title that must be skipped, and unrelated page content) proves cards do not leak data into each other. Nested duplicate `componentkey` yields one job per card. Twin text is never duplicated (no `Software ApplicationsSoftware Applications`). |
| `job-filter.test.js` | Query on title and company, known-time-only, hide-viewed, easy-apply-only. |
| `search-context` tests | `keywords`, `location`, `f_TPR` mapping, missing parameters. |

Popup UI testing is manual.

---

## 13. Acceptance criteria

- [ ] Loads as an unpacked MV3 extension with no manifest errors or console errors.
- [ ] On a LinkedIn jobs results page, extracts all rendered cards without a backend.
- [ ] Fixture A and Fixture B produce exactly the expected values in Section 2.
- [ ] Titles are never duplicated and never include `(Verified job)`; locations never include `(Hybrid)` or similar.
- [ ] `postedText` preserved; supported labels converted to approximate ages; Viewed cards get `timeStatus: 'missing'`.
- [ ] Default sort is estimated newest first; unknown ages last; ties keep LinkedIn order.
- [ ] Oldest-first and original-order sorts work.
- [ ] Duplicates removed by job ID.
- [ ] Each job opens its real LinkedIn listing in a new tab.
- [ ] Every state in Section 10 is reachable and has a clear message.
- [ ] UI never claims exact posting times and states that results cover only currently loaded cards.
- [ ] `npm test` passes.
- [ ] No permissions beyond the manifest; nothing stored or transmitted.

---

## 14. Deliverables and priorities

Before coding, read Section 2 and implement `posted-time-parser.js` and its tests first, then `card-extractor.js` against the fixtures, then sorting, dedupe, filter, then the content script, then the popup.

**Priority order:** correct extraction → correct parsing → correct sorting → usable UI → everything else. Keep selectors and regexes centralized at the top of each lib file so they are easy to adjust if LinkedIn changes its markup.

When finished, provide:

1. The complete source tree.
2. README with load instructions: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select the project folder.
3. A short architecture explanation.
4. How to run the tests.
5. Known limitations (Section 15).
6. The manual checklist below.

### Manual test checklist

1. Load the unpacked extension, open a LinkedIn job search, open the popup. Cards appear.
2. Titles, companies, locations and posting labels match the page card by card.
3. Jobs with known times are newest first; viewed or timeless jobs are at the end.
4. Switch between the three sort modes.
5. Scroll the LinkedIn list to load more cards, press **Refresh jobs**, and confirm the count grows.
6. Click a title and **Open on LinkedIn**; the correct job opens in a new tab.
7. Check that no job appears twice.
8. Open `linkedin.com/feed/` and then the popup: unsupported message.
9. Navigate from `/feed/` to Jobs without reloading the page, press Refresh: still works.
10. Reload the extension while a LinkedIn tab is open, press Refresh: the fallback injection works.
11. Use a search with a very narrow date filter or an empty result: helpful message.
12. Try **Open in full tab** and confirm it reads the same LinkedIn tab.

---

## 15. Known limitations and later phases

**Limitations to document in the README:** posting times are rounded relative estimates, not timestamps; only currently loaded cards are processed and LinkedIn may virtualize the list; viewed jobs show no posting time; months and years and non-English UIs are not parsed; extraction depends on LinkedIn's current markup (`componentkey` attribute and the `<p>` structure), which may change; the card has no anchor, so links are built from the job ID.

**Later phases (not in Phase 1):** MutationObserver for dynamically loaded cards (debounced); load-more or pagination with global re-sort and dedupe; a session-only cache so a job's age seen before it was viewed can still be shown; CSV export; saved or viewed marks; remembered preferences.
