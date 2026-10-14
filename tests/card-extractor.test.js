'use strict';

/**
 * tests/card-extractor.test.js
 *
 * Unit tests for extractJobsFromDocument().
 * Runs with: node --test tests/
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// ── Setup: populate globalThis.LJS in dependency order ────────────────────
// card-extractor uses root.LJS.parsePostedLabel at call time, so we need
// all dependencies loaded onto globalThis.LJS before calling extractJobsFromDocument.

require('../src/lib/posted-time-parser');   // → globalThis.LJS.parsePostedLabel
require('../src/lib/search-context');        // → globalThis.LJS.parseSearchContext
require('../src/lib/deduplicate-jobs');      // → globalThis.LJS.deduplicateJobs
require('../src/lib/card-extractor');        // → globalThis.LJS.extractJobsFromDocument

const { extractJobsFromDocument } = globalThis.LJS;

// ── Fixture helpers ────────────────────────────────────────────────────────

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  const dom = new JSDOM(html);
  return dom.window.document;
}

const FIXED_NOW = new Date('2024-06-01T12:00:00.000Z');

// ── card-a.html ────────────────────────────────────────────────────────────

describe('card-a.html (HP Software Applications)', () => {
  let job;

  before(() => {
    const doc = loadFixture('card-a.html');
    const { jobs, stats } = extractJobsFromDocument(doc, FIXED_NOW);
    assert.equal(jobs.length, 1, 'Should extract exactly 1 job from card-a');
    assert.equal(stats.cardsFound, 1);
    assert.equal(stats.malformedSkipped, 0);
    job = jobs[0];
  });

  it('id is 4478776696', () => assert.equal(job.id, '4478776696'));
  it('title is "Software Applications"', () => assert.equal(job.title, 'Software Applications'));
  it('title does NOT contain "(Verified job)"', () => assert.ok(!job.title.includes('Verified')));
  it('company is HP', () => assert.equal(job.company, 'HP'));
  it('location is Bengaluru', () => assert.equal(job.location, 'Bengaluru'));
  it('workplaceType is Hybrid', () => assert.equal(job.workplaceType, 'Hybrid'));
  it('location does NOT contain "(Hybrid)"', () => assert.ok(!job.location.includes('(Hybrid)')));
  it('postedText is "Posted 19 hours ago"', () => assert.equal(job.postedText, 'Posted 19 hours ago'));
  it('ageMinutes is 1140', () => assert.equal(job.ageMinutes, 1140));
  it('timeStatus is "parsed"', () => assert.equal(job.timeStatus, 'parsed'));
  it('url is correct jobs/view URL', () => assert.equal(job.url, 'https://www.linkedin.com/jobs/view/4478776696/'));
  it('verified is true', () => assert.equal(job.verified, true));
  it('viewed is null', () => assert.equal(job.viewed, null));
  it('earlyApplicant is true', () => assert.equal(job.earlyApplicant, true));
  it('easyApply is null', () => assert.equal(job.easyApply, null));
  it('reposted is null', () => assert.equal(job.reposted, null));
  it('promoted is null', () => assert.equal(job.promoted, null));
  it('originalIndex is 0', () => assert.equal(job.originalIndex, 0));
  it('source is linkedin-rendered-card', () => assert.equal(job.source, 'linkedin-rendered-card'));
  it('extractedAt is the fixed ISO timestamp', () => assert.equal(job.extractedAt, FIXED_NOW.toISOString()));
});

// ── card-b.html ────────────────────────────────────────────────────────────

describe('card-b.html (HRM Counsel Python Developer)', () => {
  let job;

  before(() => {
    const doc = loadFixture('card-b.html');
    const { jobs, stats } = extractJobsFromDocument(doc, FIXED_NOW);
    assert.equal(jobs.length, 1, 'Should extract exactly 1 job from card-b');
    assert.equal(stats.malformedSkipped, 0);
    job = jobs[0];
  });

  it('id is 4479033986', () => assert.equal(job.id, '4479033986'));
  it('title is "Python Developer"', () => assert.equal(job.title, 'Python Developer'));
  it('company is HRM Counsel', () => assert.equal(job.company, 'HRM Counsel'));
  it('location is India', () => assert.equal(job.location, 'India'));
  it('workplaceType is Remote', () => assert.equal(job.workplaceType, 'Remote'));
  it('postedText is null (no posting paragraph)', () => assert.equal(job.postedText, null));
  it('ageMinutes is null', () => assert.equal(job.ageMinutes, null));
  it('timeStatus is "missing"', () => assert.equal(job.timeStatus, 'missing'));
  it('url is correct jobs/view URL', () => assert.equal(job.url, 'https://www.linkedin.com/jobs/view/4479033986/'));
  it('urlSource is built-from-id', () => assert.equal(job.urlSource, 'built-from-id'));
  it('verified is null', () => assert.equal(job.verified, null));
  it('viewed is true', () => assert.equal(job.viewed, true));
  it('earlyApplicant is true', () => assert.equal(job.earlyApplicant, true));
  it('easyApply is true', () => assert.equal(job.easyApply, true));
  it('reposted is null', () => assert.equal(job.reposted, null));
  it('promoted is null', () => assert.equal(job.promoted, null));
});

// ── multi-cards.html ──────────────────────────────────────────────────────

describe('multi-cards.html', () => {
  let jobs, stats;

  before(() => {
    const doc = loadFixture('multi-cards.html');
    const result = extractJobsFromDocument(doc, FIXED_NOW);
    jobs = result.jobs;
    stats = result.stats;
  });

  it('extracts at least 4 jobs (two cards with same componentkey = two outermost cards)', () => {
    // card1, card2(dup of 1), card3(no company/loc), card4(no title→skip), card5(EasyApply)
    // Stats: cardsFound=5, jobsExtracted=4 (4 with title), malformedSkipped=1
    assert.ok(jobs.length >= 3, `Expected >= 3 jobs, got ${jobs.length}`);
  });

  it('card with no title (card 4) is skipped — malformedSkipped >= 1', () => {
    assert.ok(stats.malformedSkipped >= 1);
  });

  it('card 5 (Frontend Engineer) has easyApply=true and promoted=true', () => {
    const fe = jobs.find(j => j.title === 'Frontend Engineer');
    assert.ok(fe, 'Frontend Engineer card not found');
    assert.equal(fe.easyApply, true);
    assert.equal(fe.promoted, true);
  });

  it('card 1 (Senior Data Engineer) has reposted=true', () => {
    const sde = jobs.find(j => j.title === 'Senior Data Engineer');
    assert.ok(sde, 'Senior Data Engineer card not found');
    assert.equal(sde.reposted, true);
    assert.equal(sde.ageMinutes, 2880); // 2 days * 1440
  });

  it('card 3 (UX Researcher) has null company and null location', () => {
    const ux = jobs.find(j => j.title === 'UX Researcher');
    assert.ok(ux, 'UX Researcher card not found');
    assert.equal(ux.company, null);
    assert.equal(ux.location, null);
  });

  it('no job title contains "(Hybrid)" or "(Remote)" etc.', () => {
    for (const job of jobs) {
      assert.ok(!job.title.includes('(Hybrid)'), `Title "${job.title}" should not contain (Hybrid)`);
      assert.ok(!job.title.includes('(Remote)'), `Title "${job.title}" should not contain (Remote)`);
      assert.ok(!job.title.includes('(On-site)'), `Title "${job.title}" should not contain (On-site)`);
    }
  });

  it('no job title contains "Verified job"', () => {
    for (const job of jobs) {
      assert.ok(!job.title.includes('Verified job'), `Title "${job.title}" should not contain "Verified job"`);
    }
  });

  it('nav and footer elements do NOT produce job cards', () => {
    const navJob = jobs.find(j => j.title === 'Home' || j.title === 'Jobs' || j.title === 'Messaging');
    assert.equal(navJob, undefined, 'Nav items should not be extracted as jobs');
  });

  it('extractedAt is a valid ISO timestamp for every job', () => {
    for (const job of jobs) {
      assert.ok(!isNaN(Date.parse(job.extractedAt)), `extractedAt "${job.extractedAt}" is not a valid ISO timestamp`);
    }
  });

  it('all jobs have source=linkedin-rendered-card', () => {
    for (const job of jobs) {
      assert.equal(job.source, 'linkedin-rendered-card');
    }
  });

  it('originalIndex is a non-negative integer for every job', () => {
    for (const job of jobs) {
      assert.ok(Number.isInteger(job.originalIndex) && job.originalIndex >= 0);
    }
  });
});

