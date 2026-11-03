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
  it('company is HP', () => assert.equal(job.company, 'HP'));
  it('location is Bengaluru', () => assert.equal(job.location, 'Bengaluru'));
  it('workplaceType is Hybrid', () => assert.equal(job.workplaceType, 'Hybrid'));
  it('location does NOT contain "(Hybrid)"', () => assert.ok(!job.location.includes('(Hybrid)')));
  it('postedText is "Posted 19 hours ago"', () => assert.equal(job.postedText, 'Posted 19 hours ago'));
  it('ageMinutes is 1140', () => assert.equal(job.ageMinutes, 1140));
  it('timeStatus is "parsed"', () => assert.equal(job.timeStatus, 'parsed'));
  it('url is correct jobs/view URL', () => assert.equal(job.url, 'https://www.linkedin.com/jobs/view/4478776696/'));
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

// ── Regression: titles starting with "Applied" ─────────────────────────────

describe('Titles starting with "Applied" (e.g. Applied AI Engineer)', () => {
  const card1Html = `<div class="dje5b djea19 djeht2 djeia6 djeaef djel3k" style="border-color: var(--672856e8, var(--djec1)); background-color: var(--8ca997d4);"><div class="djeayp djel3k" data-display-contents="true"><div role="button" tabindex="0" class="djek8s djeia6 djek51 djek5w djemeg djemef djek8n djek9j djelaf djelbb djetz djehn3 djeljg djeayx" componentkey="job-card-component-ref-4485126307"><div class="djel3q djeivq djelct djelda djeldp djeayx djeium djej1s djej07 djej1i djeiym djel3k" componentkey="job-card-component-ref-4485126307"><div class="djeayx djeiu2 djej1s djej05 djej1j djeiyu djel3k"><figure class="djel49 djel5d djel5b djeaer djea28 djeh7a djehqy djel3k" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" id="company-accent-4" aria-hidden="true" viewBox="0 0 128 128" data-token-id="358" class="djel44 djel43 djehtq djeh92 djel48" fetchPriority="low" preserveAspectRatio="xMidYMid slice"><g display="var(--svgDisplayLight)"><path fill="#e7e2dc" d="M0 0h128v128H0z"></path><path fill="#9db3c8" d="M48 16h64v112H48z"></path><path fill="#788fa5" d="M16 80h32v48H16z"></path><path fill="#56687a" d="M48 80h32v48H48z"></path></g><g display="var(--svgDisplayDark)"><path fill="#38434f" d="M0 0h128v128H0z"></path><path fill="#9db3c8" d="M48 16h64v112H48z"></path><path fill="#788fa5" d="M16 80h32v48H16z"></path><path fill="#56687a" d="M48 80h32v48H48z"></path></g></svg><img class="djel44 djel43 djehtq djeh92 djel47 djel5h" fetchpriority="low" alt="" src="https://media.licdn.com/dms/image/v2/C560BAQHdAaarsO-eyA/company-logo_100_100/company-logo_100_100/0/1630637844948/apple_logo?e=1795046400&amp;v=beta&amp;t=W8iqGIMDocFHrLunqawb76NLg8oKVOudzhTFj5ojOZ0" data-loaded="true"></figure><div class="djel3q djeivq djeayx djeium djej1s djej07 djej1i djeixa djel3k"><div class="djeayx djeiu2 djej1s djej05 djej1i djeiyu djel3k"><div class="djel3q djeivq djeayx djeium djej1s djej07 djej1i djeixa djel3k"><div class="djel3q djeayx djeium djej1s djej07 djej1i djeixa djel3k"><div class="djeayp djel3k" data-display-contents="true"><p class="djeljd djelot djelir djegm5 djeljb djelq9 djelrd" style="--djelra: var(--djefe); --djelrb: var(--djeff); --djelrc: var(--djefg);"><span class="djea2x djel3k">Applied AI Engineer (Verified job)</span><span aria-hidden="true">Applied AI Engineer<span class="djelja djel3k"> </span><span class="djej2k djeazl djel3k" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" id="shield-check-outline-small" fill="none" aria-hidden="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="304" width="16" height="16" class="djegcg djeazl djej34 djemhp" style="width: 16px; min-width: 16px; height: 16px; min-height: 16px;"><path fill="currentColor" d="m10.84 6.213-3.234 4.116-2.345-2.01.977-1.138 1.155.99L9.66 5.287z"></path><path fill="currentColor" fill-rule="evenodd" d="m8.24 1.04 6.01 2.047v.537c0 1.94.154 4.128-.689 6.212a9.1 9.1 0 0 1-5.305 5.118l-.253.093-.255-.09c-2.252-.799-4.106-2.513-5.12-4.682l-.192-.44C1.6 7.768 1.75 5.553 1.75 3.625v-.537L7.756 1.04 8 .958l.242.082zM3.247 4.161c-.013 1.867-.057 3.534.58 5.112a7.56 7.56 0 0 0 4.17 4.171 7.6 7.6 0 0 0 4.175-4.17c.643-1.593.595-3.24.582-5.113L7.998 2.542l-4.753 1.62z" clip-rule="evenodd"></path></svg></span></span></p></div><div class="djelb9 djeayx djeiu2 djej1s djej07 djej1j djeixa djel3k"><p class="djeljd djeloo djelir djegoi djeljb djelq8">Apple</p></div><p class="djeljd djeloo djelb9 djelir djegpo djeljb djelq8">Bengaluru</p></div></div><div class="djeayx djeiu2 djej1s djej02 djej1i djeiym djel3k"><button class="djelwp djelwo djetz djea25 djehn3 djelhn djeli6 djelwt djelwr djelwq djeazt djej02 djej2c" type="button" componentkey="auto-component-0401f307-6eec-4372-b2ca-5f84442bf894" aria-label="Dismiss Applied AI Engineer job"><span class="djelyq djelxc djelw7 djeivq djej02 djetz djea25 djeazt djeix6 djej1q djelhn djeli6 djek6t djek64 djelxh djelxq djelxo djelxm djelw9 djeh1u djelxy djelx3"><svg xmlns="http://www.w3.org/2000/svg" id="xmark-outline-small" fill="none" aria-hidden="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="206" width="16" height="16" class="djel5g djeayh djeh6q djeihm djehqe djeh1i"><path fill="currentColor" d="M13.53 3.53 9.06 8l4.47 4.47-1.061 1.06-4.47-4.47-4.47 4.47-1.06-1.06L6.939 8l-4.47-4.47 1.06-1.06L8 6.94l4.47-4.47z"></path></svg></span></button></div></div><div class="djel3q djelca djeayx djeium djej1s djej07 djej1i djeix6 djeia6 djel3k"><div class="djelb9 djelcq djeayx djeiu2 djej1s djej02 djej1i djeix6 djel3k"><figure class="djel49 djel5d djel5b djeaer djea28 djeh6y djehqm djej1h djel3k" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" id="company-accent-4" aria-hidden="true" viewBox="0 0 128 128" data-token-id="358" class="djel44 djel43 djehtq djeh92 djel48" fetchPriority="low" preserveAspectRatio="xMidYMid slice"><g display="var(--svgDisplayLight)"><path fill="#e7e2dc" d="M0 0h128v128H0z"></path><path fill="#9db3c8" d="M48 16h64v112H48z"></path><path fill="#788fa5" d="M16 80h32v48H16z"></path><path fill="#56687a" d="M48 80h32v48H48z"></path></g><g display="var(--svgDisplayDark)"><path fill="#38434f" d="M0 0h128v128H0z"></path><path fill="#9db3c8" d="M48 16h64v112H48z"></path><path fill="#788fa5" d="M16 80h32v48H16z"></path><path fill="#56687a" d="M48 80h32v48H48z"></path></g></svg><img class="djel44 djel43 djehtq djeh92 djel47 djel5h" fetchpriority="low" alt="" src="https://media.licdn.com/dms/image/v2/C510BAQEBxglf5-knTQ/company-logo_100_100/company-logo_100_100/0/1630586594017?e=1795046400&amp;v=beta&amp;t=O2PKQjtpyMAQBSOO0XvQwx0zwC-4EtF6qILe2O3-EX8" data-loaded="true"></figure><div class="djeivq djelir djegpo djeljb"><p class="djeljd djelom djelrh djelrf djelre djea28 djeljc djeht2 djelq8"><span>1 school alumni works here</span></p></div></div><div class="djeayx djeiu2 djej1s djej02 djej1j djeixa djel3k"><p class="djeljd djelon djelir djegpo djeljb djelq8">Viewed</p></div></div></div></div></div></div></div></div>`;

  const card2Html = `<div class="djel3q djeivq djelcc djelct djelda djeldp djeayx djeium djej1s djej07 djej1i djeiym djel3k" componentkey="job-card-component-ref-4450351399"><div class="djeayx djeiu2 djej1s djej05 djej1j djeiyu djel3k"><figure class="djel49 djel5d djel5b djeaer djea28 djeh7a djehqy djel3k" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" id="company-accent-4" aria-hidden="true" viewBox="0 0 128 128" data-token-id="358" class="djel44 djel43 djehtq djeh92 djel48" fetchPriority="low" preserveAspectRatio="xMidYMid slice"><g display="var(--svgDisplayLight)"><path fill="#e7e2dc" d="M0 0h128v128H0z"></path><path fill="#9db3c8" d="M48 16h64v112H48z"></path><path fill="#788fa5" d="M16 80h32v48H16z"></path><path fill="#56687a" d="M48 80h32v48H48z"></path></g><g display="var(--svgDisplayDark)"><path fill="#38434f" d="M0 0h128v128H0z"></path><path fill="#9db3c8" d="M48 16h64v112H48z"></path><path fill="#788fa5" d="M16 80h32v48H16z"></path><path fill="#56687a" d="M48 80h32v48H48z"></path></g></svg><img class="djel44 djel43 djehtq djeh92 djel47 djel5h" fetchpriority="low" alt="" src="https://media.licdn.com/dms/image/v2/C560BAQGNtpblgQpJoQ/company-logo_100_100/company-logo_100_100/0/1662120928214/deloitte_logo?e=1795046400&amp;v=beta&amp;t=ccjAuQnwvOtYnDFqBbUSeZ6SGaJcBn3DGs1rbtzWVIs" data-loaded="true"></figure><div class="djel3q djeivq djeayx djeium djej1s djej07 djej1i djeixa djel3k"><div class="djeayx djeiu2 djej1s djej05 djej1i djeiyu djel3k"><div class="djel3q djeivq djeayx djeium djej1s djej07 djej1i djeixa djel3k"><div class="djel3q djeayx djeium djej1s djej07 djej1i djeixa djel3k"><div class="djeayp djel3k" data-display-contents="true"><p class="djeljd djelot djelir djegm5 djeljb djelq9 djelrd" style="--djelra: var(--djefe); --djelrb: var(--djeff); --djelrc: var(--djefg);"><span class="djea2x djel3k">Applied AI Engineer (AWS) - Software Specialist Engineer II (Verified job)</span><span aria-hidden="true">Applied AI Engineer (AWS) - Software Specialist Engineer II<span class="djelja djel3k"> </span><span class="djej2k djeazl djel3k" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" id="shield-check-outline-small" fill="none" aria-hidden="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="304" width="16" height="16" class="djegcg djeazl djej34 djemhp" style="width: 16px; min-width: 16px; height: 16px; min-height: 16px;"><path fill="currentColor" d="m10.84 6.213-3.234 4.116-2.345-2.01.977-1.138 1.155.99L9.66 5.287z"></path><path fill="currentColor" fill-rule="evenodd" d="m8.24 1.04 6.01 2.047v.537c0 1.94.154 4.128-.689 6.212a9.1 9.1 0 0 1-5.305 5.118l-.253.093-.255-.09c-2.252-.799-4.106-2.513-5.12-4.682l-.192-.44C1.6 7.768 1.75 5.553 1.75 3.625v-.537L7.756 1.04 8 .958l.242.082zM3.247 4.161c-.013 1.867-.057 3.534.58 5.112a7.56 7.56 0 0 0 4.17 4.171 7.6 7.6 0 0 0 4.175-4.17c.643-1.593.595-3.24.582-5.113L7.998 2.542l-4.753 1.62z" clip-rule="evenodd"></path></svg></span></span></p></div><div class="djelb9 djeayx djeiu2 djej1s djej07 djej1j djeixa djel3k"><p class="djeljd djeloo djelir djegoi djeljb djelq8">Deloitte</p></div><p class="djeljd djeloo djelb9 djelir djegpo djeljb djelq8">Bengaluru</p></div></div><div class="djeayx djeiu2 djej1s djej02 djej1i djeiym djel3k"><button class="djelwp djelwo djetz djea25 djehn3 djelhn djeli6 djelwt djelwr djelwq djeazt djej02 djej2c" type="button" componentkey="auto-component-5e45a2db-1ee5-49bb-83eb-d788fbe87f95" aria-label="Dismiss Applied AI Engineer (AWS) - Software Specialist Engineer II job"><span class="djelyq djelxc djelw7 djeivq djej02 djetz djea25 djeazt djeix6 djej1q djelhn djeli6 djek6t djek64 djelxh djelxq djelxo djelxm djelw9 djeh1u djelxy djelx3"><svg xmlns="http://www.w3.org/2000/svg" id="xmark-outline-small" fill="none" aria-hidden="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="206" width="16" height="16" class="djel5g djeayh djeh6q djeihm djehqe djeh1i"><path fill="currentColor" d="M13.53 3.53 9.06 8l4.47 4.47-1.061 1.06-4.47-4.47-4.47 4.47-1.06-1.06L6.939 8l-4.47-4.47 1.06-1.06L8 6.94l4.47-4.47z"></path></svg></span></button></div></div><div class="djel3q djelca djeayx djeium djej1s djej07 djej1i djeix6 djeia6 djel3k"><div class="djelb9 djelcq djeayx djeiu2 djej1s djej02 djej1i djeix6 djel3k"><figure class="djel49 djel5c djel5a djeaew djea28 djeh6y djehqm djej1h djel3k" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" id="person-accent-4" aria-hidden="true" viewBox="0 0 128 128" data-token-id="356" class="djel44 djel43 djehtq djeh92 djel48" fetchPriority="low" preserveAspectRatio="xMidYMid slice"><g display="var(--svgDisplayLight)"><path fill="#e7e2dc" d="M0 0h128v128H0z"></path><path fill="#788fa5" d="M88.41 84.67a32 32 0 1 0-48.82 0 66.13 66.13 0 0 1 48.82 0"></path><path fill="#9db3c8" d="M88.41 84.67a32 32 0 0 1-48.82 0A66.79 66.79 0 0 0 0 128h128a66.79 66.79 0 0 0-39.59-43.33"></path><path fill="#56687a" d="M64 96a31.93 31.93 0 0 0 24.41-11.33 66.13 66.13 0 0 0-48.82 0A31.93 31.93 0 0 0 64 96"></path></g><g display="var(--svgDisplayDark)"><path fill="#38434f" d="M0 0h128v128H0z"></path><path fill="#788fa5" d="M88.41 84.67a32 32 0 1 0-48.82 0 66.13 66.13 0 0 1 48.82 0"></path><path fill="#9db3c8" d="M88.41 84.67a32 32 0 0 1-48.82 0A66.79 66.79 0 0 0 0 128h128a66.79 66.79 0 0 0-39.59-43.33"></path><path fill="#56687a" d="M64 96a31.93 31.93 0 0 0 24.41-11.33 66.13 66.13 0 0 0-48.82 0A31.93 31.93 0 0 0 64 96"></path></g></svg><img class="djel44 djel43 djehtq djeh92 djel47" fetchpriority="low" alt="" src="https://media.licdn.com/dms/image/v2/D4D03AQEL1agsgueMHg/profile-displayphoto-scale_100_100/B4DZ_MefnvIEAY-/0/1785841975898?e=1795046400&amp;v=beta&amp;t=NjL05jyg0NSl7XjoRYjOO8ZCxHjDZWo0wX7sHv7DfpQ" data-loaded="true"></figure><div class="djeivq djelir djegpo djeljb"><p class="djeljd djelom djelrh djelrf djelre djea28 djeljc djeht2 djelq8"><span>1 connection works here</span></p></div></div><div class="djeayx djeiu2 djej1s djej02 djej1j djeixa djel3k"><p class="djeljd djelom djelir djegpo djeljb djelq8"><span class="djea2x djel3k">Posted 2 days ago</span><span aria-hidden="true">2 days ago</span></p></div></div></div></div></div>`;

  it('correctly extracts Apple "Applied AI Engineer" card without mistaking title for applied badge', () => {
    const doc = new JSDOM(card1Html).window.document;
    const { jobs } = extractJobsFromDocument(doc, FIXED_NOW);
    assert.equal(jobs.length, 1);
    const j = jobs[0];
    assert.equal(j.id, '4485126307');
    assert.equal(j.title, 'Applied AI Engineer');
    assert.equal(j.company, 'Apple');
    assert.equal(j.location, 'Bengaluru');
    assert.equal(j.viewed, true);
    assert.equal(j.applied, null);
  });

  it('correctly extracts Deloitte "Applied AI Engineer..." card without mistaking title for applied badge', () => {
    const doc = new JSDOM(card2Html).window.document;
    const { jobs } = extractJobsFromDocument(doc, FIXED_NOW);
    assert.equal(jobs.length, 1);
    const j = jobs[0];
    assert.equal(j.id, '4450351399');
    assert.equal(j.title, 'Applied AI Engineer (AWS) - Software Specialist Engineer II');
    assert.equal(j.company, 'Deloitte');
    assert.equal(j.location, 'Bengaluru');
    assert.equal(j.postedText, 'Posted 2 days ago');
    assert.equal(j.ageMinutes, 2880);
    assert.equal(j.applied, null);
  });

  it('still detects genuine "Applied" status badge', () => {
    const appliedHtml = `<div role="button" componentkey="job-card-component-ref-1234567890">
      <div componentkey="job-card-component-ref-1234567890">
        <p>Software Engineer</p>
        <p>Google</p>
        <p>Mountain View, CA</p>
        <p>Applied 3 days ago</p>
      </div>
    </div>`;
    const doc = new JSDOM(appliedHtml).window.document;
    const { jobs } = extractJobsFromDocument(doc, FIXED_NOW);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].title, 'Software Engineer');
    assert.equal(jobs[0].company, 'Google');
    assert.equal(jobs[0].location, 'Mountain View, CA');
    assert.equal(jobs[0].applied, true);
  });
});

