'use strict';

/**
 * tests/crawler-dom.test.js
 *
 * Unit tests for crawler DOM helpers (findNextButton, isClickable).
 * Runs with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../src/shared/messages');
require('../src/lib/posted-time-parser');
require('../src/lib/search-context');
require('../src/lib/deduplicate-jobs');
require('../src/lib/card-extractor');
require('../src/content/crawler');

const { findNextButton, isClickable, isLoadingStateActive } = globalThis.LJS;

describe('crawler findNextButton', () => {

  it('detects user-provided Next button structure with data-testid="pagination-controls-next-button-visible"', () => {
    const html = `
      <div class="jobs-search-results-list">
        <button class="hv4lac hv4lab hv4su hv4am1 hv4f6r hv4kzl hv4k0f hv4laf hv4lae hv4lad hv4aof hv4gxe hv4ijm hv4jka" type="button" data-testid="pagination-controls-next-button-visible">
          <span class="hv4laz hv4lau hv4g9m hv4gxe hv4su hv4am1 hv4aof hv4hc6 hv4h86 hv4kzl hv4k0f hv4jom hv4jox hv4la4 hv4lbd hv4lbe hv4lay hv4g86 hv4la9 hv4law hv4ggy hv4lbl">
            <svg xmlns="http://www.w3.org/2000/svg" id="chevron-right-small" fill="currentColor" aria-hidden="true" data-rtl="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="126" width="16" height="16" class="hv4lkb hv4am3" style="width: 16px; min-width: 16px; height: 16px; min-height: 16px;">
              <path d="m5 15 4.61-7L5 1h2.39L12 8l-4.61 7z"></path>
            </svg>
            <span class="hv4k0m hv4k5r hv4llh hv4kzi hv4f6r hv4k0k hv4lbu">Next</span>
          </span>
        </button>
      </div>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.ok(btn !== null, 'Next button should be found');
    assert.equal(btn.getAttribute('data-testid'), 'pagination-controls-next-button-visible');
  });

  it('returns null when button is disabled', () => {
    const html = `
      <button type="button" disabled data-testid="pagination-controls-next-button-visible">
        <span>Next</span>
      </button>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.equal(btn, null, 'Disabled button should return null');
  });

  it('returns null when button has aria-disabled="true"', () => {
    const html = `
      <button type="button" aria-disabled="true" data-testid="pagination-controls-next-button-visible">
        <span>Next</span>
      </button>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.equal(btn, null, 'aria-disabled button should return null');
  });

  it('returns null on last page when no next button exists', () => {
    const html = `
      <div class="jobs-search-results-list">
        <button type="button" data-testid="pagination-controls-previous-button-visible">
          <span>Previous</span>
        </button>
        <ul><li>Page 1</li><li>Page 2</li></ul>
      </div>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.equal(btn, null, 'Should return null when Next button is not in DOM');
  });

  it('detects fallback button with aria-label="View next page"', () => {
    const html = `
      <div>
        <button type="button" aria-label="View next page">
          <svg><path d="..."></path></svg>
        </button>
      </div>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.ok(btn !== null);
    assert.equal(btn.getAttribute('aria-label'), 'View next page');
  });

  it('detects pagination container button with "Next" text', () => {
    const html = `
      <div class="jobs-search-results-list__pagination">
        <button class="artdeco-button">Prev</button>
        <button class="artdeco-button">Next</button>
      </div>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.ok(btn !== null);
    assert.equal(btn.textContent.trim(), 'Next');
  });

  it('returns null when button has data-testid="pagination-controls-next-button" without -visible (last page)', () => {
    const html = `
      <div class="jobs-search-results-list">
        <button type="button" data-testid="pagination-controls-next-button">
          <span>Next</span>
        </button>
      </div>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.equal(btn, null, 'Non-visible next button should return null');
  });

  it('returns null when button has data-testid="pagination-controls-next-button-disabled"', () => {
    const html = `
      <button type="button" data-testid="pagination-controls-next-button-disabled">
        <span>Next</span>
      </button>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.equal(btn, null, 'Disabled testid button should return null');
  });

  it('returns null when button has class artdeco-button--disabled', () => {
    const html = `
      <button type="button" class="artdeco-button--disabled" data-testid="pagination-controls-next-button-visible">
        <span>Next</span>
      </button>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.equal(btn, null, 'artdeco-button--disabled should return null');
  });

  it('returns null when button has style="display:none"', () => {
    const html = `
      <button type="button" style="display:none" data-testid="pagination-controls-next-button-visible">
        <span>Next</span>
      </button>
    `;
    const dom = new JSDOM(html);
    const btn = findNextButton(dom.window.document);
    assert.equal(btn, null, 'Hidden display:none button should return null');
  });

  it('isClickable returns false for null or disabled elements', () => {
    assert.equal(isClickable(null), false);
    const dom = new JSDOM('<button disabled></button>');
    assert.equal(isClickable(dom.window.document.querySelector('button')), false);
  });
});

describe('crawler isLoadingStateActive', () => {
  it('returns false for null doc or empty doc', () => {
    assert.equal(isLoadingStateActive(null), false);
    const dom = new JSDOM('<div><p>Hello</p></div>');
    assert.equal(isLoadingStateActive(dom.window.document), false);
  });

  it('detects .artdeco-loader', () => {
    const dom = new JSDOM('<div class="artdeco-loader"><span class="artdeco-loader__bars"></span></div>');
    assert.equal(isLoadingStateActive(dom.window.document), true);
  });

  it('detects .jobs-search-results-list--loading', () => {
    const dom = new JSDOM('<div class="jobs-search-results-list jobs-search-results-list--loading"></div>');
    assert.equal(isLoadingStateActive(dom.window.document), true);
  });

  it('detects [data-view-name*="loading"]', () => {
    const dom = new JSDOM('<div data-view-name="job-search-loading-state"></div>');
    assert.equal(isLoadingStateActive(dom.window.document), true);
  });

  it('detects .ghost-job-card', () => {
    const dom = new JSDOM('<div class="ghost-job-card"></div>');
    assert.equal(isLoadingStateActive(dom.window.document), true);
  });

  it('returns false when loader element has hidden attribute', () => {
    const dom = new JSDOM('<div class="artdeco-loader" hidden></div>');
    assert.equal(isLoadingStateActive(dom.window.document), false);
  });

  it('returns false when loader element has aria-hidden="true"', () => {
    const dom = new JSDOM('<div class="artdeco-loader" aria-hidden="true"></div>');
    assert.equal(isLoadingStateActive(dom.window.document), false);
  });

  it('returns false when loader element has style="display:none"', () => {
    const dom = new JSDOM('<div class="artdeco-loader" style="display:none"></div>');
    assert.equal(isLoadingStateActive(dom.window.document), false);
  });
});


