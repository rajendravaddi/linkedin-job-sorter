'use strict';

/**
 * tests/posted-time-parser.test.js
 *
 * Unit tests for parsePostedLabel() and parsePostedAge().
 * Runs with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePostedAge, parsePostedLabel } = require('../src/lib/posted-time-parser');

// ── parsePostedLabel ──────────────────────────────────────────────────────────

describe('parsePostedLabel', () => {

  // ── just now ──────────────────────────────────────────────────────────────

  it('returns ageMinutes=0 for "just now"', () => {
    const r = parsePostedLabel('just now');
    assert.equal(r.ageMinutes, 0);
    assert.equal(r.precision, 'low');
    assert.equal(r.status, 'parsed');
    assert.equal(r.reposted, false);
  });

  it('returns ageMinutes=0 for "Posted just now"', () => {
    const r = parsePostedLabel('Posted just now');
    assert.equal(r.ageMinutes, 0);
    assert.equal(r.precision, 'low');
    assert.equal(r.status, 'parsed');
  });

  // ── minutes ───────────────────────────────────────────────────────────────

  it('"Posted 5 minutes ago" → 5', () => {
    assert.equal(parsePostedLabel('Posted 5 minutes ago').ageMinutes, 5);
  });

  it('"Posted 1 minute ago" → 1', () => {
    assert.equal(parsePostedLabel('Posted 1 minute ago').ageMinutes, 1);
  });

  it('"a minute ago" → 1', () => {
    const r = parsePostedLabel('a minute ago');
    assert.equal(r.ageMinutes, 1);
    assert.equal(r.status, 'parsed');
  });

  it('"1 min ago" → 1', () => {
    assert.equal(parsePostedLabel('1 min ago').ageMinutes, 1);
  });

  it('"5 mins ago" → 5', () => {
    assert.equal(parsePostedLabel('5 mins ago').ageMinutes, 5);
  });

  // ── hours ─────────────────────────────────────────────────────────────────

  it('"Posted 1 hour ago" → 60', () => {
    assert.equal(parsePostedLabel('Posted 1 hour ago').ageMinutes, 60);
  });

  it('"1 hr ago" → 60', () => {
    assert.equal(parsePostedLabel('1 hr ago').ageMinutes, 60);
  });

  it('"2 hrs ago" → 120', () => {
    assert.equal(parsePostedLabel('2 hrs ago').ageMinutes, 120);
  });

  it('"3 hours ago" → 180', () => {
    assert.equal(parsePostedLabel('3 hours ago').ageMinutes, 180);
  });

  it('"Posted an hour ago" → 60', () => {
    assert.equal(parsePostedLabel('Posted an hour ago').ageMinutes, 60);
  });

  it('"Posted 19 hours ago" → 1140', () => {
    assert.equal(parsePostedLabel('Posted 19 hours ago').ageMinutes, 1140);
  });

  it('"Posted 21 hours ago" → 1260', () => {
    assert.equal(parsePostedLabel('Posted 21 hours ago').ageMinutes, 1260);
  });

  // ── days ──────────────────────────────────────────────────────────────────

  it('"Posted 1 day ago" → 1440', () => {
    assert.equal(parsePostedLabel('Posted 1 day ago').ageMinutes, 1440);
  });

  it('"Posted 3 days ago" → 4320', () => {
    assert.equal(parsePostedLabel('Posted 3 days ago').ageMinutes, 4320);
  });

  // ── weeks ─────────────────────────────────────────────────────────────────

  it('"Posted 1 week ago" → 10080', () => {
    assert.equal(parsePostedLabel('Posted 1 week ago').ageMinutes, 10080);
  });

  it('"Posted 2 weeks ago" → 20160', () => {
    assert.equal(parsePostedLabel('Posted 2 weeks ago').ageMinutes, 20160);
  });

  // ── reposted ──────────────────────────────────────────────────────────────

  it('"Reposted 2 days ago" → 2880, reposted=true', () => {
    const r = parsePostedLabel('Reposted 2 days ago');
    assert.equal(r.ageMinutes, 2880);
    assert.equal(r.reposted, true);
    assert.equal(r.status, 'parsed');
  });

  it('"reposted 1 week ago" (lowercase) → 10080, reposted=true', () => {
    const r = parsePostedLabel('reposted 1 week ago');
    assert.equal(r.ageMinutes, 10080);
    assert.equal(r.reposted, true);
  });

  // ── case and whitespace tolerance ─────────────────────────────────────────

  it('trims and collapses whitespace: "  POSTED   3  Days   Ago "', () => {
    assert.equal(parsePostedLabel('  POSTED   3  Days   Ago ').ageMinutes, 4320);
  });

  it('case-insensitive: "POSTED 5 MINUTES AGO"', () => {
    assert.equal(parsePostedLabel('POSTED 5 MINUTES AGO').ageMinutes, 5);
  });

  // ── unrecognized posting labels ───────────────────────────────────────────

  it('"Posted 1 month ago" → null, status=unrecognized', () => {
    const r = parsePostedLabel('Posted 1 month ago');
    assert.equal(r.ageMinutes, null);
    assert.equal(r.status, 'unrecognized');
  });

  it('"Reposted 1 year ago" → null, status=unrecognized', () => {
    const r = parsePostedLabel('Reposted 1 year ago');
    assert.equal(r.ageMinutes, null);
    assert.equal(r.status, 'unrecognized');
  });

  it('"Posted" alone → null, status=unrecognized', () => {
    const r = parsePostedLabel('Posted');
    assert.equal(r.ageMinutes, null);
    assert.equal(r.status, 'unrecognized');
  });

  it('"something ago" → null, status=unrecognized', () => {
    const r = parsePostedLabel('something ago');
    assert.equal(r.ageMinutes, null);
    assert.equal(r.status, 'unrecognized');
  });

  // ── non-posting labels (returned from card paragraphs) ────────────────────

  it('"25 applicants" → null (not a posting label)', () => {
    const r = parsePostedLabel('25 applicants');
    assert.equal(r.ageMinutes, null);
  });

  it('"Be an early applicant" → null', () => {
    assert.equal(parsePostedLabel('Be an early applicant').ageMinutes, null);
  });

  it('"Viewed" → null', () => {
    assert.equal(parsePostedLabel('Viewed').ageMinutes, null);
  });

  it('"Over 100 people clicked apply" → null', () => {
    assert.equal(parsePostedLabel('Over 100 people clicked apply').ageMinutes, null);
  });

  it('"Actively reviewing" → null', () => {
    assert.equal(parsePostedLabel('Actively reviewing').ageMinutes, null);
  });

  it('"Easy Apply" → null', () => {
    assert.equal(parsePostedLabel('Easy Apply').ageMinutes, null);
  });

  it('"Promoted" → null', () => {
    assert.equal(parsePostedLabel('Promoted').ageMinutes, null);
  });

  // ── null / undefined / empty ──────────────────────────────────────────────

  it('null input → null', () => {
    const r = parsePostedLabel(null);
    assert.equal(r.ageMinutes, null);
    assert.equal(r.reposted, false);
    assert.equal(r.precision, 'approximate');
    assert.equal(r.status, 'unrecognized');
  });

  it('undefined input → null', () => {
    const r = parsePostedLabel(undefined);
    assert.equal(r.ageMinutes, null);
    assert.equal(r.status, 'unrecognized');
  });

  it('empty string → null (not a posting label)', () => {
    const r = parsePostedLabel('');
    assert.equal(r.ageMinutes, null);
  });
});

// ── parsePostedAge ────────────────────────────────────────────────────────────

describe('parsePostedAge', () => {
  it('returns ageMinutes number directly', () => {
    assert.equal(parsePostedAge('Posted 5 minutes ago'), 5);
    assert.equal(parsePostedAge('Posted 1 week ago'), 10080);
    assert.equal(parsePostedAge('just now'), 0);
  });

  it('returns null for unrecognized input', () => {
    assert.equal(parsePostedAge('Posted 1 month ago'), null);
    assert.equal(parsePostedAge('Viewed'), null);
    assert.equal(parsePostedAge(null), null);
  });
});

