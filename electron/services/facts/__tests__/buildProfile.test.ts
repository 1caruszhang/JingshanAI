/**
 * #106: Unit tests for buildProfileFromFacts.
 *
 * Builds the enterprise profile (Record<fact_type, value>) from confirmed
 * facts, picking the most recently reviewed value per fact_type.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileFromFacts } from '../buildProfile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal confirmed-fact shape accepted by buildProfileFromFacts. */
function fact(
  type: string,
  value: string | null,
  reviewedAt: string | null = '2024-01-01T00:00:00.000Z',
  status: string = 'confirmed',
) {
  return { fact_type: type, status, fact_value: value, reviewed_at: reviewedAt };
}

// ---------------------------------------------------------------------------
// buildProfileFromFacts
// ---------------------------------------------------------------------------

describe('buildProfileFromFacts', () => {
  it('returns empty object for empty input', () => {
    assert.deepEqual(buildProfileFromFacts([]), {});
  });

  it('returns a single fact value keyed by fact_type', () => {
    const result = buildProfileFromFacts([
      fact('full_name', '阿里巴巴集团'),
    ]);
    assert.deepEqual(result, { full_name: '阿里巴巴集团' });
  });

  it('groups multiple types and keeps one value per type', () => {
    const result = buildProfileFromFacts([
      fact('full_name', '阿里巴巴集团'),
      fact('industry', '互联网科技'),
      fact('short_name', '阿里'),
    ]);
    assert.deepEqual(result, {
      full_name: '阿里巴巴集团',
      industry: '互联网科技',
      short_name: '阿里',
    });
  });

  it('picks the most recently reviewed value when same type has multiple versions', () => {
    const result = buildProfileFromFacts([
      fact('full_name', '阿里巴巴集团', '2024-01-01T00:00:00.000Z'),
      fact('full_name', '阿里巴巴（中国）有限公司', '2024-06-15T12:00:00.000Z'),
      fact('full_name', '旧名字', '2023-12-31T23:59:59.000Z'),
    ]);
    assert.deepEqual(result, { full_name: '阿里巴巴（中国）有限公司' });
  });

  it('does NOT let older values overwrite a newer value (unsorted input)', () => {
    // Newest first — must still resolve to the latest reviewed_at value.
    const result = buildProfileFromFacts([
      fact('full_name', '最新值', '2024-09-01T00:00:00.000Z'),
      fact('full_name', '最旧值', '2024-01-01T00:00:00.000Z'),
      fact('full_name', '中间值', '2024-05-01T00:00:00.000Z'),
    ]);
    assert.deepEqual(result, { full_name: '最新值' });
  });

  it('ignores non-confirmed facts (candidate/rejected/deprecated)', () => {
    const result = buildProfileFromFacts([
      fact('full_name', '已确认', '2024-01-01T00:00:00.000Z', 'confirmed'),
      fact('full_name', '候选', '2024-02-01T00:00:00.000Z', 'candidate'),
      fact('industry', '被拒', '2024-03-01T00:00:00.000Z', 'rejected'),
      fact('short_name', '弃用', '2024-04-01T00:00:00.000Z', 'deprecated'),
    ]);
    assert.deepEqual(result, { full_name: '已确认' });
  });

  it('skips confirmed facts whose fact_value is null', () => {
    const result = buildProfileFromFacts([
      fact('full_name', null, '2024-06-01T00:00:00.000Z'),
      fact('industry', '互联网科技', '2024-01-01T00:00:00.000Z'),
    ]);
    assert.deepEqual(result, { industry: '互联网科技' });
  });

  it('skips confirmed facts whose fact_value is empty string', () => {
    const result = buildProfileFromFacts([
      fact('full_name', '', '2024-06-01T00:00:00.000Z'),
      fact('full_name', '有效值', '2024-01-01T00:00:00.000Z'),
    ]);
    assert.deepEqual(result, { full_name: '有效值' });
  });

  it('skips a type entirely when all its confirmed values are null/empty', () => {
    const result = buildProfileFromFacts([
      fact('full_name', null, '2024-06-01T00:00:00.000Z'),
      fact('full_name', '', '2024-07-01T00:00:00.000Z'),
      fact('industry', '互联网科技'),
    ]);
    assert.deepEqual(result, { industry: '互联网科技' });
  });

  it('treats null reviewed_at as the earliest (older than any timestamp)', () => {
    // A null reviewed_at should lose to any concrete timestamp.
    const result = buildProfileFromFacts([
      fact('full_name', '无审核时间', null),
      fact('full_name', '有时间戳', '2024-01-01T00:00:00.000Z'),
    ]);
    assert.deepEqual(result, { full_name: '有时间戳' });
  });

  it('falls back to the null-reviewed_at value when it is the only confirmed one', () => {
    const result = buildProfileFromFacts([
      fact('full_name', '只有这一个', null),
    ]);
    assert.deepEqual(result, { full_name: '只有这一个' });
  });

  it('handles a realistic mixed scenario (multiple types, versions, gaps)', () => {
    const result = buildProfileFromFacts([
      // full_name: two versions, newer wins
      fact('full_name', '旧全称', '2024-01-10T00:00:00.000Z'),
      fact('full_name', '新全称', '2024-08-20T00:00:00.000Z'),
      // industry: single
      fact('industry', '人工智能'),
      // contact: only null-value confirmed → skipped
      fact('contact', null, '2024-05-01T00:00:00.000Z'),
      // short_name: candidate (ignored)
      fact('short_name', '阿里', '2024-06-01T00:00:00.000Z', 'candidate'),
      // products_services: rejected (ignored)
      fact('products_services', '云服务', '2024-07-01T00:00:00.000Z', 'rejected'),
      // core_advantages: latest of three
      fact('core_advantages', '技术领先', '2024-02-01T00:00:00.000Z'),
      fact('core_advantages', '生态完整', '2024-09-01T00:00:00.000Z'),
      fact('core_advantages', '价格优势', '2024-03-01T00:00:00.000Z'),
    ]);
    assert.deepEqual(result, {
      full_name: '新全称',
      industry: '人工智能',
      core_advantages: '生态完整',
    });
  });

  it('does not mutate the input array', () => {
    const input = [
      fact('full_name', '阿里巴巴集团', '2024-01-01T00:00:00.000Z'),
      fact('full_name', '更新值', '2024-06-01T00:00:00.000Z'),
    ];
    const snapshot = input.map((f) => ({ ...f }));
    buildProfileFromFacts(input);
    assert.deepEqual(input, snapshot);
  });
});
