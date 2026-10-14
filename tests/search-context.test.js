'use strict';

/**
 * tests/search-context.test.js
 *
 * Unit tests for parseSearchContext().
 * Runs with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSearchContext } = require('../src/lib/search-context');

describe('parseSearchContext', () => {

  it('parses keywords from URL', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?keywords=python%20developer');
    assert.equal(r.keywords, 'python developer');
  });

  it('parses location from URL', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?location=San%20Francisco%2C%20CA');
    assert.equal(r.location, 'San Francisco, CA');
  });

  it('parses both keywords and location', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?keywords=engineer&location=Remote');
    assert.equal(r.keywords, 'engineer');
    assert.equal(r.location, 'Remote');
  });

  it('f_TPR=r3600 → "Past hour"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?f_TPR=r3600');
    assert.equal(r.dateFilterLabel, 'Past hour');
  });

  it('f_TPR=r86400 → "Past 24 hours"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?f_TPR=r86400');
    assert.equal(r.dateFilterLabel, 'Past 24 hours');
  });

  it('f_TPR=r604800 → "Past week"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?f_TPR=r604800');
    assert.equal(r.dateFilterLabel, 'Past week');
  });

  it('f_TPR=r2592000 → "Past month"', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?f_TPR=r2592000');
    assert.equal(r.dateFilterLabel, 'Past month');
  });

  it('unknown f_TPR value is shown raw', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?f_TPR=r99999');
    assert.equal(r.dateFilterLabel, 'r99999');
  });

  it('missing keywords → null', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?location=Remote');
    assert.equal(r.keywords, null);
  });

  it('missing location → null', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?keywords=java');
    assert.equal(r.location, null);
  });

  it('missing f_TPR → dateFilterLabel=null', () => {
    const r = parseSearchContext('https://www.linkedin.com/jobs/search/?keywords=java');
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
      'https://www.linkedin.com/jobs/search/?keywords=React&location=Berlin&f_TPR=r86400'
    );
    assert.equal(r.keywords, 'React');
    assert.equal(r.location, 'Berlin');
    assert.equal(r.dateFilterLabel, 'Past 24 hours');
  });
});

