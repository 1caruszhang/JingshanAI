/**
 * reviewAgent.test.ts
 *
 * Tests for issue #85 — ReviewAgent 质量护栏 Zod schemas.
 *
 * 验证审核链输出 schema 的校验逻辑（不依赖 SQLite / Electron / model）：
 *   - claim_source_mapping 输出（MappedSource[]）
 *   - geo_fact_check 输出（结构化事实核查报告）
 *   - ReviewReportEnvelope（审核链最终汇总报告，含 issue #85 AC 的 5 个必备字段）
 *
 * 这些 schema 是 ReviewAgent 工具的 Zod 质量护栏：工具执行后用 safeParse 校验
 * LLM/服务返回值，校验失败时返回 validation_failed envelope。本测试确保护栏
 * 行为正确（合法输出通过、非法输出拒绝）。
 *
 * 注：审核链执行体（claim_parsing / claim_review / geo_review 的 executor-wrap）
 * 依赖 SQLite 与 LLM，不在单测覆盖范围；其行为由 IPC seam ① 的集成测试覆盖。
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
  ClaimSourceMappingOutputSchema,
  GeoFactCheckReportSchema,
  ReviewReportEnvelopeSchema,
} from '../reviewAgent.ts';

// ── claim_source_mapping output ──────────────────────────────────────────────

describe('#85 ReviewAgent — claim_source_mapping output schema', () => {
  it('passes for a valid MappedSource[] (≤3 items)', () => {
    const valid = [
      {
        sourceType: 'fact',
        sourceId: 3,
        sourceQuote: '原文片段（≤200 字）',
        confidence: 0.92,
      },
      {
        sourceType: 'chunk',
        sourceId: 7,
        sourceQuote: '另一段原文',
        confidence: 0.61,
      },
    ];
    const res = ClaimSourceMappingOutputSchema.safeParse(valid);
    assert.equal(res.success, true);
    if (res.success) assert.equal(res.data.length, 2);
  });

  it('passes for an empty array (no matching sources)', () => {
    const res = ClaimSourceMappingOutputSchema.safeParse([]);
    assert.equal(res.success, true);
  });

  it('rejects an invalid sourceType enum', () => {
    const bad = [
      {sourceType: 'webpage', sourceId: 1, sourceQuote: 'x', confidence: 0.5},
    ];
    const res = ClaimSourceMappingOutputSchema.safeParse(bad);
    assert.equal(res.success, false);
  });

  it('rejects confidence out of [0,1]', () => {
    const bad = [
      {sourceType: 'fact', sourceId: 1, sourceQuote: 'x', confidence: 1.5},
    ];
    const res = ClaimSourceMappingOutputSchema.safeParse(bad);
    assert.equal(res.success, false);
  });

  it('rejects more than 3 sources', () => {
    const tooMany = Array.from({length: 4}, (_, i) => ({
      sourceType: 'fact',
      sourceId: i + 1,
      sourceQuote: 'x',
      confidence: 0.5,
    }));
    const res = ClaimSourceMappingOutputSchema.safeParse(tooMany);
    assert.equal(res.success, false);
  });

  it('rejects a non-positive sourceId', () => {
    const bad = [
      {sourceType: 'fact', sourceId: 0, sourceQuote: 'x', confidence: 0.5},
    ];
    const res = ClaimSourceMappingOutputSchema.safeParse(bad);
    assert.equal(res.success, false);
  });
});

// ── geo_fact_check report ────────────────────────────────────────────────────

describe('#85 ReviewAgent — geo_fact_check report schema', () => {
  const validReport = {
    scope: '截至 2026 年，全球范围',
    claims: [
      {
        id: 'C1',
        originalClaim: '平台 2020 年服务超过 500 万用户',
        claimType: 'numeric-statistic',
        status: 'verified',
        evidenceSummary: '官网 2020 年报披露 510 万用户',
        primarySource: 'example.com 2020',
      },
      {
        id: 'C2',
        originalClaim: '全球 #1 AI 内容工具',
        claimType: 'ranking',
        status: 'uncertain',
        evidenceSummary: '多个工具用不同口径自称领先，无一致独立排名',
      },
    ],
    suggestedFixes: ['C2 建议软化为「领先的 AI 内容工具之一」'],
    risks: ['C2 排名口径不明'],
  };

  it('passes for a valid structured report', () => {
    const res = GeoFactCheckReportSchema.safeParse(validReport);
    assert.equal(res.success, true);
    if (res.success) assert.equal(res.data.claims.length, 2);
  });

  it('rejects an invalid claim status enum', () => {
    const bad = {
      ...validReport,
      claims: [{...validReport.claims[0], status: 'definitely_true'}],
    };
    const res = GeoFactCheckReportSchema.safeParse(bad);
    assert.equal(res.success, false);
  });

  it('rejects an invalid claimType enum', () => {
    const bad = {
      ...validReport,
      claims: [{...validReport.claims[0], claimType: 'hearsay'}],
    };
    const res = GeoFactCheckReportSchema.safeParse(bad);
    assert.equal(res.success, false);
  });

  it('rejects a missing scope', () => {
    const {scope: _omit, ...bad} = validReport;
    const res = GeoFactCheckReportSchema.safeParse(bad);
    assert.equal(res.success, false);
  });

  it('passes with empty claims/fixes/risks arrays', () => {
    const minimal = {
      scope: '常青概念，按当前日期核查',
      claims: [],
      suggestedFixes: [],
      risks: [],
    };
    const res = GeoFactCheckReportSchema.safeParse(minimal);
    assert.equal(res.success, true);
  });
});

// ── ReviewReportEnvelope (aggregate 审核报告) ─────────────────────────────────
//
// issue #85 AC：审核报告含 Claim 真伪/置信度/来源匹配/修正建议/GEO 就绪度评分。

describe('#85 ReviewAgent — ReviewReportEnvelope schema (5 required fields)', () => {
  const validEnvelope = {
    claimVerdict: 'needs_source',
    confidence: 0.72,
    sourceMatches: [
      {
        claimText: '平台服务超过 500 万用户',
        sourceType: 'fact',
        sourceId: 3,
        confidence: 0.91,
      },
    ],
    fixSuggestions: ['Claim #3 建议补充信源或改为谨慎措辞'],
    geoReadinessScore: 68,
  };

  it('passes for a valid envelope with all 5 fields', () => {
    const res = ReviewReportEnvelopeSchema.safeParse(validEnvelope);
    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.data.claimVerdict, 'needs_source');
      assert.equal(res.data.geoReadinessScore, 68);
    }
  });

  it('rejects a missing claimVerdict', () => {
    const {claimVerdict: _omit, ...bad} = validEnvelope;
    const res = ReviewReportEnvelopeSchema.safeParse(bad);
    assert.equal(res.success, false);
  });

  it('rejects an invalid claimVerdict enum', () => {
    const res = ReviewReportEnvelopeSchema.safeParse({
      ...validEnvelope,
      claimVerdict: 'maybe',
    });
    assert.equal(res.success, false);
  });

  it('rejects confidence out of [0,1]', () => {
    const res = ReviewReportEnvelopeSchema.safeParse({
      ...validEnvelope,
      confidence: 1.2,
    });
    assert.equal(res.success, false);
  });

  it('rejects geoReadinessScore out of [0,100]', () => {
    const res = ReviewReportEnvelopeSchema.safeParse({
      ...validEnvelope,
      geoReadinessScore: 120,
    });
    assert.equal(res.success, false);
  });

  it('rejects a missing fixSuggestions field', () => {
    const {fixSuggestions: _omit, ...bad} = validEnvelope;
    const res = ReviewReportEnvelopeSchema.safeParse(bad);
    assert.equal(res.success, false);
  });

  it('passes with empty sourceMatches / fixSuggestions arrays', () => {
    const minimal = {
      claimVerdict: 'unsupported',
      confidence: 0,
      sourceMatches: [],
      fixSuggestions: [],
      geoReadinessScore: 0,
    };
    const res = ReviewReportEnvelopeSchema.safeParse(minimal);
    assert.equal(res.success, true);
  });
});
