'use strict';

/**
 * tests/search-context.test.js
 *
 * Unit tests for parseSearchContext().
 * Runs with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSearchContext, validateSearchUrl, getPage1Url } = require('../src/lib/search-context');

describe('parseSearchContext', () => {

  it('parses keywords from URL', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?keywords=python%20developer');
    assert.equal(r.keywords, 'python developer');
  });

  it('parses location from URL', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?location=San%20Francisco%2C%20CA');
    assert.equal(r.location, 'San Francisco, CA');
  });

  it('parses both keywords and location', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?keywords=engineer&location=Remote');
    assert.equal(r.keywords, 'engineer');
    assert.equal(r.location, 'Remote');
  });

  it('f_TPR=r3600 → "Past hour"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?f_TPR=r3600');
    assert.equal(r.dateFilterLabel, 'Past hour');
  });

  it('f_TPR=r86400 → "Past 24 hours"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?f_TPR=r86400');
    assert.equal(r.dateFilterLabel, 'Past 24 hours');
  });

  it('f_TPR=r604800 → "Past week"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?f_TPR=r604800');
    assert.equal(r.dateFilterLabel, 'Past week');
  });

  it('f_TPR=r2592000 → "Past month"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?f_TPR=r2592000');
    assert.equal(r.dateFilterLabel, 'Past month');
  });

  it('unknown f_TPR value is shown raw', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?f_TPR=r99999');
    assert.equal(r.dateFilterLabel, 'r99999');
  });

  it('missing keywords → null', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?location=Remote');
    assert.equal(r.keywords, null);
  });

  it('missing location → null', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?keywords=java');
    assert.equal(r.location, null);
  });

  it('missing f_TPR → dateFilterLabel=null', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search-results/?keywords=java');
    assert.equal(r.dateFilterLabel, null);
  });

  it('completely unrelated URL → all null', () => {
    const r = parseSearchContext('https://www.example.com/page?foo=bar');
    assert.equal(r.keywords, null);
    assert.equal(r.location, null);
    assert.equal(r.dateFilterLabel, null);
  });

  it('invalid URL → all null', () => {
    const r = parseSearchContext('not-a-url');
    assert.equal(r.keywords, null);
    assert.equal(r.location, null);
    assert.equal(r.dateFilterLabel, null);
  });

  it('all three params together', () => {
    const r = parseSearchContext(
      'https://www.linkedin.com/jobs/search-results/?keywords=React&location=Berlin&f_TPR=r86400'
    );
    assert.equal(r.keywords, 'React');
    assert.equal(r.location, 'Berlin');
    assert.equal(r.dateFilterLabel, 'Past 24 hours');
  });
});

describe('validateSearchUrl', () => {
  it('valid search URL with f_TPR=r86400 returns valid: true', () => {
    const res = validateSearchUrl(
      'https://www.linkedin.com/jobs/search-results/?keywords=engineer&location=Remote&f_TPR=r86400'
    );
    assert.equal(res.valid, true);
  });

  it('valid search URL without trailing slash returns valid: true', () => {
    const res = validateSearchUrl(
      'https://www.linkedin.com/jobs/search?keywords=engineer&f_TPR=r86400'
    );
    assert.equal(res.valid, true);
  });

  it('search URL missing f_TPR returns FILTER_REQUIRED', () => {
    const res = validateSearchUrl(
      'https://www.linkedin.com/jobs/search-results/?keywords=engineer'
    );
    assert.equal(res.valid, false);
    assert.equal(res.code, 'FILTER_REQUIRED');
  });

  it('search URL with past week filter (f_TPR=r604800) returns FILTER_REQUIRED', () => {
    const res = validateSearchUrl(
      'https://www.linkedin.com/jobs/search-results/?keywords=engineer&f_TPR=r604800'
    );
    assert.equal(res.valid, false);
    assert.equal(res.code, 'FILTER_REQUIRED');
  });

  it('search URL with past month filter (f_TPR=r2592000) returns FILTER_REQUIRED', () => {
    const res = validateSearchUrl(
      'https://www.linkedin.com/jobs/search-results/?keywords=engineer&f_TPR=r2592000'
    );
    assert.equal(res.valid, false);
    assert.equal(res.code, 'FILTER_REQUIRED');
  });

  it('LinkedIn home /jobs/ page returns NOT_SEARCH_PAGE', () => {
    const res = validateSearchUrl('https://www.linkedin.com/jobs/');
    assert.equal(res.valid, false);
    assert.equal(res.code, 'NOT_SEARCH_PAGE');
  });

  it('LinkedIn view job page returns NOT_SEARCH_PAGE', () => {
    const res = validateSearchUrl('https://www.linkedin.com/jobs/view/4479033986/');
    assert.equal(res.valid, false);
    assert.equal(res.code, 'NOT_SEARCH_PAGE');
  });

  it('LinkedIn feed page returns NOT_SEARCH_PAGE', () => {
    const res = validateSearchUrl('https://www.linkedin.com/feed/');
    assert.equal(res.valid, false);
    assert.equal(res.code, 'NOT_SEARCH_PAGE');
  });

  it('non-LinkedIn URL returns NOT_LINKEDIN', () => {
    const res = validateSearchUrl('https://www.google.com/search?q=jobs');
    assert.equal(res.valid, false);
    assert.equal(res.code, 'NOT_LINKEDIN');
  });

  it('malformed URL string returns INVALID_URL', () => {
    const res = validateSearchUrl('not-a-valid-url');
    assert.equal(res.valid, false);
    assert.equal(res.code, 'INVALID_URL');
  });
});

describe('getPage1Url', () => {
  it('adds start=0 when not present', () => {
    const u = getPage1Url('https://www.linkedin.com/jobs/search-results/?keywords=python&f_TPR=r86400');
    const parsed = new URL(u);
    assert.equal(parsed.searchParams.get('start'), '0');
  });

  it('replaces start=50 with start=0', () => {
    const u = getPage1Url('https://www.linkedin.com/jobs/search-results/?keywords=python&start=50&f_TPR=r86400');
    const parsed = new URL(u);
    assert.equal(parsed.searchParams.get('start'), '0');
  });
});

