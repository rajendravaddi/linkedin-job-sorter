# Contributing to LinkedIn Job Sorter

Thank you for your interest in contributing to **LinkedIn Job Sorter**. This document outlines our code standards, architectural conventions, and pull request workflow.

---

## 1. Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/rajendravaddi/linkedin-job-sorter.git
   cd linkedin-job-sorter
   ```
2. **Install development dependencies**:
   ```bash
   npm install
   ```
   *(Requires Node.js `>=18.0.0`)*.
3. **Verify tests pass**:
   ```bash
   npm test
   ```
4. **Load the unpacked extension in Chrome**:
   - Navigate to `chrome://extensions/`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the `linkedin-job-sorter/` directory.

---

## 2. Code Organization and Conventions

To keep the extension lightweight, secure, and easily testable, adhere to these project conventions:

### 2.1 No Bundlers or Compilers
- The project intentionally avoids Webpack, Rollup, Vite, or Babel.
- All code must run natively in modern Chromium browsers (ECMAScript 2022+).
- Do not add build scripts or npm runtime dependencies without prior discussion.

### 2.2 The UMD Module Pattern
Every module in `src/lib/` and `src/shared/` must be wrapped in a Universal Module Definition (UMD) shim:
```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LJS = Object.assign(root.LJS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Pure logic implementation
  return { myFunction };
});
```
- In Chrome browser contexts, modules merge onto `globalThis.LJS`.
- In Node.js unit tests, modules export cleanly via `require()`.
- Access sibling library functions at runtime via `root.LJS` or pass them as function arguments. Do not use static ES `import`/`export` syntax in library files.

### 2.3 Strict DOM Security (No `innerHTML`)
- **Prohibition**: Never use `innerHTML`, `outerHTML`, or `document.write()`.
- **Requirement**: Build all DOM elements using `document.createElement()`, assign text via `textContent`, and configure classes/attributes explicitly (`classList.add`, `setAttribute`).
- Validate all hyperlinks against strict regular expressions before setting `href` attributes.

### 2.4 Resilient Scrapers
LinkedIn frequently updates class names and markup structure:
- **Never rely on hashed class names** (e.g., `.hv4lac`). Class names are generated at build time and break regularly.
- **Use semantic attributes and ARIA roles** (e.g., `button[data-testid="pagination-controls-next-button-visible"]`, `[componentkey^="job-card-component-ref-"]`, `button[aria-label="View next page"]`).
- **Centralize selectors**: Place all query selectors and regular expressions at the top of the relevant module as uppercase constants.
- **Graceful degradation**: Wrap card parsing in `try/catch`. One unexpected card structure must never crash extraction for the rest of the page.

---

## 3. Testing Requirements

All contributions must maintain our high bar of test coverage and code reliability.

1. **Run Full Test Suite**:
   ```bash
   npm test
   ```
   All tests must pass cleanly.
2. **Add Unit Tests for New Features**:
   - If adding a new time-string format, add cases to `tests/posted-time-parser.test.js`.
   - If updating DOM extraction or selectors, add fixtures or test assertions to `tests/card-extractor.test.js` or `tests/crawler-dom.test.js`.
   - If changing sorting, deduplication, or filtering, add corresponding unit tests in `tests/`.
3. **Run Syntax Checks**:
   ```bash
   node -c src/**/*.js tests/**/*.js
   ```

---

## 4. Documentation Updates

If your changes modify user-facing behavior, architectural contracts, or development workflows, you must update the corresponding documentation:
- Update [`README.md`](file:///home/rajendra-vaddi/Documents/Projects/linkedin-job-sorter/README.md) for changes in user features or setup.
- Update [`docs/ARCHITECTURE.md`](file:///home/rajendra-vaddi/Documents/Projects/linkedin-job-sorter/docs/ARCHITECTURE.md) for changes in message types, data models, or component interactions.
- Update [`docs/DEVELOPMENT.md`](file:///home/rajendra-vaddi/Documents/Projects/linkedin-job-sorter/docs/DEVELOPMENT.md) for new development workflows or test scripts.
- Update [`docs/PRIVACY.md`](file:///home/rajendra-vaddi/Documents/Projects/linkedin-job-sorter/docs/PRIVACY.md) if any changes affect data extraction, permissions, or storage.
- Add an entry under `[Unreleased]` in [`docs/CHANGELOG.md`](file:///home/rajendra-vaddi/Documents/Projects/linkedin-job-sorter/docs/CHANGELOG.md).

---

## 5. Pull Request Guidelines

1. **Focused Changes**: Keep pull requests focused on a single responsibility or bug fix. Avoid mixing refactors with functional changes.
2. **Clean Git History**: Write descriptive commit messages following standard conventions (e.g., `fix: extend crawler timeout during active loader state`).
3. **Manual Verification**: Test your branch manually on a live LinkedIn job search session using the [Manual Testing Checklist](file:///home/rajendra-vaddi/Documents/Projects/linkedin-job-sorter/docs/DEVELOPMENT.md#7-manual-testing-checklist-on-linkedin).
4. **PR Description**: Include a clear explanation of what changed, why the change is necessary, and test results.

