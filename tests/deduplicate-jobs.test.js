'use strict';

/**
 * tests/deduplicate-jobs.test.js
 *
 * Unit tests for deduplicateJobs().
 * Runs with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deduplicateJobs } = require('../src/lib/deduplicate-jobs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return Object.assign({
    id: null,
    title: 'Test Job',
    company: null,
    location: null,
    workplaceType: null,
    postedText: null,
    ageMinutes: null,
    timePrecision: 'approximate',
    timeStatus: 'missing',
    reposted: null,
    url: null,
    urlSource: null,
    easyApply: null,
    promoted: null,
    viewed: null,
    verified: null,
    earlyApplicant: null,
    originalIndex: 0,
    source: 'linkedin-rendered-card',
    extractedAt: new Date().toISOString(),
  }, overrides);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('deduplicateJobs', () => {

  it('no duplicates → returns same jobs unchanged, duplicatesRemoved=0', () => {
    const jobs = [
      makeJob({ id: '100000', originalIndex: 0 }),
      makeJob({ id: '200000', originalIndex: 1 }),
    ];
    const { jobs: result, duplicatesRemoved } = deduplicateJobs(jobs);
    assert.equal(result.length, 2);
    assert.equal(duplicatesRemoved, 0);
  });

  it('repeated IDs → keeps earliest (lowest originalIndex)', () => {
    const jobs = [
      makeJob({ id: '100000', originalIndex: 0, title: 'First' }),
      makeJob({ id: '100000', originalIndex: 1, title: 'Second' }),
    ];
    const { jobs: result, duplicatesRemoved } = deduplicateJobs(jobs);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'First');
    assert.equal(duplicatesRemoved, 1);
  });

  it('fills null fields from duplicate', () => {
    const jobs = [
      makeJob({ id: '100000', company: null, originalIndex: 0 }),
      makeJob({ id: '100000', company: 'Acme Corp', originalIndex: 1 }),
    ];
    const { jobs: result } = deduplicateJobs(jobs);
    assert.equal(result[0].company, 'Acme Corp');
  });

  it('known ageMinutes in earlier record is never replaced by null from duplicate', () => {
    const jobs = [
      makeJob({ id: '100000', ageMinutes: 60, originalIndex: 0 }),
      makeJob({ id: '100000', ageMinutes: null, originalIndex: 1 }),
    ];
    const { jobs: result } = deduplicateJobs(jobs);
    assert.equal(result[0].ageMinutes, 60);
  });

  it('null ageMinutes in earlier record is filled from duplicate', () => {
    const jobs = [
      makeJob({ id: '100000', ageMinutes: null, originalIndex: 0 }),
      makeJob({ id: '100000', ageMinutes: 120, originalIndex: 1 }),
    ];
    const { jobs: result } = deduplicateJobs(jobs);
    assert.equal(result[0].ageMinutes, 120);
  });

  it('if both ages are known and differ → keeps earlier record value', () => {
    const jobs = [
      makeJob({ id: '100000', ageMinutes: 60, originalIndex: 0 }),
      makeJob({ id: '100000', ageMinutes: 180, originalIndex: 1 }),
    ];
    const { jobs: result } = deduplicateJobs(jobs);
    assert.equal(result[0].ageMinutes, 60);
  });

  it('boolean fields merge with OR — true wins over null', () => {
    const jobs = [
      makeJob({ id: '100000', easyApply: null, viewed: null, earlyApplicant: null, originalIndex: 0 }),
      makeJob({ id: '100000', easyApply: true, viewed: true, earlyApplicant: true, originalIndex: 1 }),
    ];
    const { jobs: result } = deduplicateJobs(jobs);
    assert.equal(result[0].easyApply, true);
    assert.equal(result[0].viewed, true);
    assert.equal(result[0].earlyApplicant, true);
  });

  it('repeated URLs (no id) → deduped by normalised URL', () => {
    const jobs = [
      makeJob({ id: null, url: 'https://www.linkedin.com/jobs/view/100001/', originalIndex: 0, title: 'First' }),
      makeJob({ id: null, url: 'https://www.linkedin.com/jobs/view/100001', originalIndex: 1, title: 'Second' }),
    ];
    const { jobs: result, duplicatesRemoved } = deduplicateJobs(jobs);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'First');
    assert.equal(duplicatesRemoved, 1);
  });

  it('null id AND null url → both kept (no dedup guarantee)', () => {
    const jobs = [
      makeJob({ id: null, url: null, title: 'A', originalIndex: 0 }),
      makeJob({ id: null, url: null, title: 'B', originalIndex: 1 }),
    ];
    const { jobs: result, duplicatesRemoved } = deduplicateJobs(jobs);
    assert.equal(result.length, 2);
    assert.equal(duplicatesRemoved, 0);
  });

  it('does not mutate input array', () => {
    const original = [
      makeJob({ id: '100000', ageMinutes: 30, originalIndex: 0 }),
      makeJob({ id: '100000', company: 'Filled', originalIndex: 1 }),
    ];
    const copy = JSON.stringify(original);
    deduplicateJobs(original);
    assert.equal(JSON.stringify(original), copy);
  });

  it('multiple distinct IDs all kept', () => {
    const jobs = [
      makeJob({ id: '111111', originalIndex: 0 }),
      makeJob({ id: '222222', originalIndex: 1 }),
      makeJob({ id: '333333', originalIndex: 2 }),
    ];
    const { jobs: result } = deduplicateJobs(jobs);
    assert.equal(result.length, 3);
  });

  it('mixed id and url dedup — same id takes priority', () => {
    const jobs = [
      makeJob({ id: '100000', url: 'https://www.linkedin.com/jobs/view/100000/', originalIndex: 0, company: null }),
      makeJob({ id: '100000', url: 'https://www.linkedin.com/jobs/view/100000/', originalIndex: 1, company: 'Corp' }),
    ];
    const { jobs: result, duplicatesRemoved } = deduplicateJobs(jobs);
    assert.equal(result.length, 1);
    assert.equal(duplicatesRemoved, 1);
    assert.equal(result[0].company, 'Corp');
  });
});

