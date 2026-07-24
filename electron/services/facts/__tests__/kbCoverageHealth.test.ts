/**
 * #103: Unit tests for buildKbCoverageHealth and getCoverageColor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKbCoverageHealth,
  getCoverageColor,
  KB_COVERAGE_MAX_SCORE,
  FACT_TIER_GROUPS,
} from '../kbCoverageHealth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal confirmed-fact entry with the given fact_type. */
function fact(type: string, status = 'confirmed') {
  return { fact_type: type, status };
}

/** All 14 fact types as confirmed facts. */
function allConfirmed() {
  return FACT_TIER_GROUPS.flatMap((g) => g.fields.map((ft) => fact(ft, 'confirmed')));
}

// ---------------------------------------------------------------------------
// buildKbCoverageHealth
// ---------------------------------------------------------------------------

describe('buildKbCoverageHealth', () => {
  it('returns N/A sentinel (-1) when totalEntries is 0', () => {
    const result = buildKbCoverageHealth([], 0);
    assert.equal(result.coverage, -1);
    assert.equal(result.totalEntries, 0);
    assert.equal(result.confirmedFields.size, 0);
    assert.equal(result.coverageMatrix.length, 14);
    // All fields should be uncovered
    for (const f of result.coverageMatrix) {
      assert.equal(f.covered, false);
    }
  });

  it('returns 0% when totalEntries > 0 but no confirmed facts', () => {
    const result = buildKbCoverageHealth([], 5);
    assert.equal(result.coverage, 0);
    assert.equal(result.totalEntries, 5);
    assert.equal(result.confirmedFields.size, 0);
  });

  it('returns 0% when all facts are non-confirmed status', () => {
    const facts = FACT_TIER_GROUPS.flatMap((g) =>
      g.fields.map((ft) => fact(ft, 'candidate')),
    );
    const result = buildKbCoverageHealth(facts, 3);
    assert.equal(result.coverage, 0);
    assert.equal(result.confirmedFields.size, 0);
  });

  it('returns 0% when facts are rejected/deprecated', () => {
    const facts = [
      fact('full_name', 'rejected'),
      fact('industry', 'deprecated'),
    ];
    const result = buildKbCoverageHealth(facts, 2);
    assert.equal(result.coverage, 0);
    assert.equal(result.confirmedFields.size, 0);
  });

  it('returns 100% when all 14 fields are confirmed', () => {
    const result = buildKbCoverageHealth(allConfirmed(), 10);
    assert.equal(result.coverage, 100);
    assert.equal(result.confirmedFields.size, 14);
    for (const f of result.coverageMatrix) {
      assert.equal(f.covered, true);
    }
  });

  it('scores a single high-risk field correctly (~9.3%)', () => {
    // 1 × 2.0 / 21.5 = 0.0930 → 9%
    const result = buildKbCoverageHealth([fact('contact')], 1);
    const expectedRaw = (2.0 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 9
  });

  it('scores a single recommended field correctly (~7.0%)', () => {
    // 1 × 1.5 / 21.5 = 0.06976 → 7%
    const result = buildKbCoverageHealth([fact('full_name')], 1);
    const expectedRaw = (1.5 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 7
  });

  it('scores a single basic field correctly (~4.7%)', () => {
    // 1 × 1.0 / 21.5 = 0.0465 → 5%
    const result = buildKbCoverageHealth([fact('short_name')], 1);
    const expectedRaw = (1.0 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 5
  });

  it('scores all high-risk fields confirmed only', () => {
    // 5 × 2.0 / 21.5 = 10/21.5 = 0.4651 → 47%
    const highRiskFacts = FACT_TIER_GROUPS[0].fields.map((ft) => fact(ft));
    const result = buildKbCoverageHealth(highRiskFacts, 5);
    const expectedRaw = (10 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 47
    assert.equal(result.confirmedFields.size, 5);
    // Verify matrix: only high-risk fields covered
    for (const f of result.coverageMatrix) {
      if (f.tier === 'high_risk') {
        assert.equal(f.covered, true, `Expected ${f.factType} to be covered`);
      } else {
        assert.equal(f.covered, false, `Expected ${f.factType} to be uncovered`);
      }
    }
  });

  it('scores all recommended fields confirmed only', () => {
    // 5 × 1.5 / 21.5 = 7.5/21.5
    const recFacts = FACT_TIER_GROUPS[1].fields.map((ft) => fact(ft));
    const result = buildKbCoverageHealth(recFacts, 3);
    const expectedRaw = (7.5 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 35
    assert.equal(result.confirmedFields.size, 5);
  });

  it('scores all basic fields confirmed only (~18.6%)', () => {
    // 4 × 1.0 / 21.5 = 4/21.5 = 0.1860 → 19%
    const basicFacts = FACT_TIER_GROUPS[2].fields.map((ft) => fact(ft));
    const result = buildKbCoverageHealth(basicFacts, 2);
    const expectedRaw = (4 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 19
    assert.equal(result.confirmedFields.size, 4);
  });

  it('scores high-risk + recommended fields (~81.4%)', () => {
    // 10 + 7.5 = 17.5 / 21.5 = 0.8139 → 81%
    const facts = [
      ...FACT_TIER_GROUPS[0].fields.map((ft) => fact(ft)),
      ...FACT_TIER_GROUPS[1].fields.map((ft) => fact(ft)),
    ];
    const result = buildKbCoverageHealth(facts, 10);
    const expectedRaw = (17.5 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 81
    assert.equal(result.confirmedFields.size, 10);
  });

  it('deduplicates multiple confirmed facts for the same field', () => {
    // Two confirmed full_name facts should only count once
    const facts = [fact('full_name'), fact('full_name'), fact('industry')];
    // 1×1.5 + 1×1.5 = 3/21.5 = 0.1395 → 14%
    const result = buildKbCoverageHealth(facts, 3);
    const expectedRaw = (3 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 14
    assert.equal(result.confirmedFields.size, 2);
  });

  it('handles mixed confirmed + non-confirmed facts', () => {
    const facts = [
      fact('full_name', 'confirmed'),
      fact('short_name', 'confirmed'),
      fact('industry', 'candidate'),  // not confirmed
      fact('contact', 'rejected'),     // not confirmed
      fact('service_area', 'confirmed'),
    ];
    // full_name(1.5) + short_name(1.0) + service_area(2.0) = 4.5/21.5 = 20.93 → 21%
    const result = buildKbCoverageHealth(facts, 5);
    const expectedRaw = (4.5 / KB_COVERAGE_MAX_SCORE) * 100;
    assert.equal(result.coverage, Math.round(expectedRaw)); // 21
    assert.equal(result.confirmedFields.size, 3);
  });

  it('includes maxScore in result', () => {
    const result = buildKbCoverageHealth([fact('full_name')], 1);
    assert.equal(result.maxScore, KB_COVERAGE_MAX_SCORE);
    assert.equal(result.maxScore, 21.5);
  });

  it('coverageMatrix has exactly 14 entries in tier order', () => {
    const result = buildKbCoverageHealth(allConfirmed(), 14);
    assert.equal(result.coverageMatrix.length, 14);

    // Verify tier grouping order: high_risk (5), recommended (5), basic (4)
    const tiers = result.coverageMatrix.map((f) => f.tier);
    assert.deepEqual(tiers.slice(0, 5), Array(5).fill('high_risk'));
    assert.deepEqual(tiers.slice(5, 10), Array(5).fill('recommended'));
    assert.deepEqual(tiers.slice(10, 14), Array(4).fill('basic'));

    // Verify every field has a non-empty label
    for (const f of result.coverageMatrix) {
      assert.ok(f.label.length > 0, `Expected label for ${f.factType} to be non-empty`);
      assert.ok(f.weight > 0, `Expected weight for ${f.factType} to be > 0`);
    }
  });
});

// ---------------------------------------------------------------------------
// getCoverageColor
// ---------------------------------------------------------------------------

describe('getCoverageColor', () => {
  it('returns gray for N/A sentinel (-1)', () => {
    const c = getCoverageColor(-1);
    assert.ok(c.text.includes('gray'));
  });

  it('returns rose/red for coverage < 50', () => {
    const c = getCoverageColor(0);
    assert.ok(c.text.includes('rose'));
    const c2 = getCoverageColor(49);
    assert.ok(c2.text.includes('rose'));
  });

  it('returns amber for 50 <= coverage < 80', () => {
    const c = getCoverageColor(50);
    assert.ok(c.text.includes('amber'));
    const c2 = getCoverageColor(79);
    assert.ok(c2.text.includes('amber'));
  });

  it('returns emerald/green for coverage >= 80', () => {
    const c = getCoverageColor(80);
    assert.ok(c.text.includes('emerald'));
    const c2 = getCoverageColor(100);
    assert.ok(c2.text.includes('emerald'));
  });
});
