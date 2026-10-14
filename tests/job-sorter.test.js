'use strict';

/**
 * tests/job-sorter.test.js
 *
 * Unit tests for sortJobs().
 * Runs with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sortJobs } = require('../src/lib/job-sorter');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(id, ageMinutes, originalIndex) {
  return {
    id: String(id),
    title: `Job ${id}`,
    ageMinutes: ageMinutes !== undefined ? ageMinutes : null,
    originalIndex,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sortJobs — newest mode (default)', () => {

  it('sorts known ages ascending (smaller = newer)', () => {
    const jobs = [
      makeJob('A', 180, 0),
      makeJob('B', 60, 1),
      makeJob('C', 1440, 2),
    ];
    const sorted = sortJobs(jobs, 'newest');
    assert.deepEqual(sorted.map(j => j.id), ['B', 'A', 'C']);
  });

  it('equal ages: stable by originalIndex', () => {
    const jobs = [
      makeJob('X', 60, 2),
      makeJob('Y', 60, 0),
      makeJob('Z', 60, 1),
    ];
    const sorted = sortJobs(jobs, 'newest');
    assert.deepEqual(sorted.map(j => j.id), ['Y', 'Z', 'X']);
  });

  it('unknown ages (null) go last', () => {
    const jobs = [
      makeJob('A', null, 0),
      makeJob('B', 60, 1),
      makeJob('C', null, 2),
      makeJob('D', 120, 3),
    ];
    const sorted = sortJobs(jobs, 'newest');
    // Known first: B (60), D (120); then unknown by originalIndex: A, C
    assert.deepEqual(sorted.map(j => j.id), ['B', 'D', 'A', 'C']);
  });

  it('all unknown → sorted by originalIndex', () => {
    const jobs = [
      makeJob('A', null, 2),
      makeJob('B', null, 0),
      makeJob('C', null, 1),
    ];
    const sorted = sortJobs(jobs, 'newest');
    assert.deepEqual(sorted.map(j => j.id), ['B', 'C', 'A']);
  });

  it('default mode (no second argument) behaves like newest', () => {
    const jobs = [
      makeJob('A', 300, 0),
      makeJob('B', 100, 1),
    ];
    const sorted = sortJobs(jobs);
    assert.deepEqual(sorted.map(j => j.id), ['B', 'A']);
  });

  it('does not mutate the input array', () => {
    const jobs = [
      makeJob('A', 500, 0),
      makeJob('B', 100, 1),
    ];
    const original = jobs.slice();
    sortJobs(jobs, 'newest');
    assert.equal(jobs[0].id, original[0].id);
    assert.equal(jobs[1].id, original[1].id);
  });
});

describe('sortJobs — oldest mode', () => {

  it('sorts known ages descending (larger = older first)', () => {
    const jobs = [
      makeJob('A', 60, 0),
      makeJob('B', 1440, 1),
      makeJob('C', 180, 2),
    ];
    const sorted = sortJobs(jobs, 'oldest');
    assert.deepEqual(sorted.map(j => j.id), ['B', 'C', 'A']);
  });

  it('unknown ages go last even in oldest mode', () => {
    const jobs = [
      makeJob('A', null, 0),
      makeJob('B', 1440, 1),
    ];
    const sorted = sortJobs(jobs, 'oldest');
    assert.deepEqual(sorted.map(j => j.id), ['B', 'A']);
  });

  it('equal ages tie-broken by originalIndex', () => {
    const jobs = [
      makeJob('X', 300, 3),
      makeJob('Y', 300, 1),
      makeJob('Z', 300, 2),
    ];
    const sorted = sortJobs(jobs, 'oldest');
    assert.deepEqual(sorted.map(j => j.id), ['Y', 'Z', 'X']);
  });
});

describe('sortJobs — original mode', () => {

  it('sorts by originalIndex ascending', () => {
    const jobs = [
      makeJob('A', 60, 3),
      makeJob('B', 60, 1),
      makeJob('C', 60, 2),
      makeJob('D', null, 0),
    ];
    const sorted = sortJobs(jobs, 'original');
    assert.deepEqual(sorted.map(j => j.id), ['D', 'B', 'C', 'A']);
  });

  it('does not mutate input', () => {
    const jobs = [makeJob('A', 60, 1), makeJob('B', 30, 0)];
    const beforeIds = jobs.map(j => j.id);
    sortJobs(jobs, 'original');
    assert.deepEqual(jobs.map(j => j.id), beforeIds);
  });
});

describe('sortJobs — mixed known/unknown', () => {

  it('known ages all come before unknown in newest mode', () => {
    const jobs = [
      makeJob('A', null, 0),
      makeJob('B', 1440, 1),
      makeJob('C', null, 2),
      makeJob('D', 60, 3),
      makeJob('E', null, 4),
    ];
    const sorted = sortJobs(jobs, 'newest');
    const knownIds = sorted.filter(j => j.ageMinutes != null).map(j => j.id);
    const unknownIds = sorted.filter(j => j.ageMinutes == null).map(j => j.id);
    // All known before all unknown
    const lastKnownIdx = sorted.findIndex(j => j.ageMinutes == null);
    for (let i = 0; i < sorted.length; i++) {
      if (i < lastKnownIdx) {
        assert.ok(sorted[i].ageMinutes != null, `Position ${i} should be known`);
      }
    }
    assert.deepEqual(knownIds, ['D', 'B']); // 60, 1440 ascending
    assert.deepEqual(unknownIds, ['A', 'C', 'E']); // by originalIndex
  });
});

