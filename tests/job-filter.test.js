'use strict';

/**
 * tests/job-filter.test.js
 *
 * Unit tests for filterJobs().
 * Runs with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filterJobs } = require('../src/lib/job-filter');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return Object.assign({
    id: null,
    title: 'Generic Engineer',
    company: 'ACME Corp',
    ageMinutes: null,
    easyApply: null,
    viewed: null,
    originalIndex: 0,
  }, overrides);
}

const SAMPLE_JOBS = [
  makeJob({ id: '1', title: 'Frontend Developer', company: 'WebStudio', ageMinutes: 60, easyApply: true, viewed: null, originalIndex: 0 }),
  makeJob({ id: '2', title: 'Backend Engineer', company: 'DataCorp', ageMinutes: null, easyApply: null, viewed: true, originalIndex: 1 }),
  makeJob({ id: '3', title: 'Full Stack Developer', company: 'TechCo', ageMinutes: 1440, easyApply: null, viewed: null, originalIndex: 2 }),
  makeJob({ id: '4', title: 'Data Scientist', company: 'ACME Corp', ageMinutes: null, easyApply: true, viewed: true, originalIndex: 3 }),
  makeJob({ id: '5', title: 'UX Designer', company: 'WebStudio', ageMinutes: 720, easyApply: null, viewed: null, originalIndex: 4 }),
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('filterJobs', () => {

  it('empty options → returns all jobs', () => {
    const result = filterJobs(SAMPLE_JOBS, {});
    assert.equal(result.length, SAMPLE_JOBS.length);
  });

  it('no options argument → returns all jobs', () => {
    const result = filterJobs(SAMPLE_JOBS);
    assert.equal(result.length, SAMPLE_JOBS.length);
  });

  it('empty string query → returns all jobs', () => {
    const result = filterJobs(SAMPLE_JOBS, { query: '' });
    assert.equal(result.length, SAMPLE_JOBS.length);
  });

  it('query matches title (case-insensitive)', () => {
    const result = filterJobs(SAMPLE_JOBS, { query: 'developer' });
    const ids = result.map(j => j.id);
    assert.ok(ids.includes('1'), 'Frontend Developer should match');
    assert.ok(ids.includes('3'), 'Full Stack Developer should match');
    assert.ok(!ids.includes('2'), 'Backend Engineer should NOT match');
  });

  it('query matches company (case-insensitive)', () => {
    const result = filterJobs(SAMPLE_JOBS, { query: 'acme' });
    const ids = result.map(j => j.id);
    assert.ok(ids.includes('4'), 'ACME Corp should match');
    assert.ok(!ids.includes('1'), 'WebStudio should NOT match');
  });

  it('query matches both title and company', () => {
    const result = filterJobs(SAMPLE_JOBS, { query: 'webstudio' });
    // Job 1 (company=WebStudio) and job 5 (company=WebStudio)
    assert.equal(result.length, 2);
  });

  it('query with no matches → empty array', () => {
    const result = filterJobs(SAMPLE_JOBS, { query: 'zzznomatch' });
    assert.equal(result.length, 0);
  });

  it('easyApplyOnly → keeps only jobs where easyApply === true', () => {
    const result = filterJobs(SAMPLE_JOBS, { easyApplyOnly: true });
    for (const job of result) {
      assert.equal(job.easyApply, true);
    }
    assert.equal(result.length, 2); // jobs 1 and 4
  });

  it('hideViewed → keeps only jobs where viewed !== true', () => {
    const result = filterJobs(SAMPLE_JOBS, { hideViewed: true });
    for (const job of result) {
      assert.notEqual(job.viewed, true);
    }
    // Jobs 2 and 4 are viewed
    assert.equal(result.length, 3);
  });

  it('combined filters: easyApplyOnly + hideViewed', () => {
    const result = filterJobs(SAMPLE_JOBS, { easyApplyOnly: true, hideViewed: true });
    // Job 1 (easyApply=true, viewed=null) → included
    // Job 4 (easyApply=true, viewed=true) → excluded
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  it('job with null company still matches title query', () => {
    const jobs = [makeJob({ id: '99', title: 'DevOps Engineer', company: null })];
    const result = filterJobs(jobs, { query: 'devops' });
    assert.equal(result.length, 1);
  });

  describe('Apply process filter (easyApply and externalSite)', () => {
    it('only easyApply checked → keeps only easyApply jobs', () => {
      const result = filterJobs(SAMPLE_JOBS, { easyApply: true, externalSite: false });
      assert.equal(result.length, 2);
      assert.deepEqual(result.map(j => j.id), ['1', '4']);
    });

    it('only externalSite checked → keeps only non-easyApply jobs', () => {
      const result = filterJobs(SAMPLE_JOBS, { easyApply: false, externalSite: true });
      assert.equal(result.length, 3);
      assert.deepEqual(result.map(j => j.id), ['2', '3', '5']);
    });

    it('both easyApply and externalSite checked → keeps all jobs', () => {
      const result = filterJobs(SAMPLE_JOBS, { easyApply: true, externalSite: true });
      assert.equal(result.length, 5);
    });

    it('neither easyApply nor externalSite checked → keeps all jobs', () => {
      const result = filterJobs(SAMPLE_JOBS, { easyApply: false, externalSite: false });
      assert.equal(result.length, 5);
    });
  });

  describe('Company filtering', () => {
    it('deselectedCompanies as Set excludes specified companies', () => {
      const deselected = new Set(['WebStudio']);
      const result = filterJobs(SAMPLE_JOBS, { deselectedCompanies: deselected });
      assert.equal(result.length, 3);
      assert.ok(!result.some(j => j.company === 'WebStudio'));
    });

    it('deselectedCompanies as Array excludes specified companies', () => {
      const result = filterJobs(SAMPLE_JOBS, { deselectedCompanies: ['ACME Corp', 'DataCorp'] });
      assert.equal(result.length, 3);
      assert.ok(!result.some(j => j.company === 'ACME Corp' || j.company === 'DataCorp'));
    });

    it('selectedCompanies as Set keeps only specified companies', () => {
      const selected = new Set(['WebStudio']);
      const result = filterJobs(SAMPLE_JOBS, { selectedCompanies: selected });
      assert.equal(result.length, 2);
      assert.ok(result.every(j => j.company === 'WebStudio'));
    });

    it('handles job with null company as "Unknown Company"', () => {
      const jobs = [
        makeJob({ id: '10', title: 'Mystery Job', company: null }),
        makeJob({ id: '11', title: 'Tech Job', company: 'TechCo' }),
      ];
      const resultExcluded = filterJobs(jobs, { deselectedCompanies: new Set(['Unknown Company']) });
      assert.equal(resultExcluded.length, 1);
      assert.equal(resultExcluded[0].id, '11');

      const resultIncluded = filterJobs(jobs, { selectedCompanies: new Set(['Unknown Company']) });
      assert.equal(resultIncluded.length, 1);
      assert.equal(resultIncluded[0].id, '10');
    });
  });
});

