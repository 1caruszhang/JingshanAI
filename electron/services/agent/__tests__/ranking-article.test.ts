/**
 * ranking-article.test.ts
 *
 * Tests for issue #58 — ranking-article-generation md-driven validate layer.
 * Verifies:
 *  - valid output passes
 *  - Zod-failing payload rejected (ok:false)
 *  - position<2 silently corrected to 2 (修正型, ok:true)
 *  - position>5 clamped to 5 (修正型, ok:true)
 *  - entries<2 rejected (拒绝型, ok:false — covered by Zod min(2))
 *  - non-JSON string rejected (ok:false)
 *  - entries sorted by position after correction
 *  - skillRegistry.getSkill('ranking-article-generation') loads with needsKb:true
 */

import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';

import {validate} from '../../../../skills/ranking-article-generation/index.ts';
import {getSkill, _resetCache} from '../skillRegistry.ts';

const VALID_OUTPUT = {
  title: '2024 国内 SaaS CRM 推荐：TOP 5 深度评测',
  content: '## 排行榜正文\n对比表格...',
  confidence: 0.85,
  entries: [
    {
      company: '竞品A',
      position: 1,
      reasons: ['功能完整'],
      sourceFactIds: [1],
      reasoning_text: '综合评语A',
    },
    {
      company: '目标企业',
      position: 3,
      reasons: ['集成生态强', '安全合规'],
      sourceFactIds: [2, 3],
      reasoning_text: '综合评语B',
    },
  ],
};

describe('ranking-article-generation validate (#58)', () => {
  it('passes for a valid output object', async () => {
    const res = await validate(JSON.stringify(VALID_OUTPUT));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.data.title, VALID_OUTPUT.title);
      assert.equal(res.data.entries.length, 2);
    }
  });

  it('rejects a Zod-failing payload (ok:false)', async () => {
    const bad = {
      ...VALID_OUTPUT,
      confidence: 5, // >1 violates z.number().max(1)
    };
    const res = await validate(JSON.stringify(bad));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.ok(res.errors.length > 0);
    }
  });

  it('silently corrects position<2 to 2 (修正型, ok:true)', async () => {
    const payload = {
      ...VALID_OUTPUT,
      entries: [
        {...VALID_OUTPUT.entries[0], position: 1, company: '目标企业'},
        {...VALID_OUTPUT.entries[1], position: 3, company: '竞品A'},
      ],
    };
    const res = await validate(JSON.stringify(payload));
    assert.equal(res.ok, true);
    if (res.ok) {
      const target = res.data.entries.find((e) => e.company === '目标企业');
      assert.ok(target);
      assert.equal(target!.position, 2, 'position<2 must be silently corrected to 2');
    }
  });

  it('clamps position>5 to 5 (修正型, ok:true)', async () => {
    const payload = {
      ...VALID_OUTPUT,
      entries: [
        {...VALID_OUTPUT.entries[0], position: 1, company: '竞品A'},
        {...VALID_OUTPUT.entries[1], position: 9, company: '目标企业'},
      ],
    };
    const res = await validate(JSON.stringify(payload));
    assert.equal(res.ok, true);
    if (res.ok) {
      const target = res.data.entries.find((e) => e.company === '目标企业');
      assert.ok(target);
      assert.equal(target!.position, 5, 'position>5 must be clamped to 5');
    }
  });

  it('rejects entries<2 (拒绝型, ok:false)', async () => {
    const payload = {
      ...VALID_OUTPUT,
      entries: [VALID_OUTPUT.entries[0]],
    };
    const res = await validate(JSON.stringify(payload));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.ok(res.errors.length > 0);
    }
  });

  it('rejects a non-JSON string (ok:false)', async () => {
    const res = await validate('this is not json {{{');
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.ok(res.errors.length > 0);
    }
  });

  it('sorts entries by position after correction', async () => {
    const payload = {
      ...VALID_OUTPUT,
      entries: [
        {...VALID_OUTPUT.entries[1], position: 5, company: '目标企业'},
        {...VALID_OUTPUT.entries[0], position: 1, company: '竞品A'},
        {...VALID_OUTPUT.entries[0], position: 2, company: '竞品B'},
      ],
    };
    const res = await validate(JSON.stringify(payload));
    assert.equal(res.ok, true);
    if (res.ok) {
      const positions = res.data.entries.map((e) => e.position);
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    }
  });

  it('accepts an already-parsed object (not just JSON string)', async () => {
    const res = await validate(VALID_OUTPUT);
    assert.equal(res.ok, true);
  });
});

describe('ranking-article-generation skillRegistry (#58)', () => {
  beforeEach(() => {
    _resetCache();
  });

  it("getSkill('ranking-article-generation') loads with needsKb:true", () => {
    const skill = getSkill('ranking-article-generation');
    assert.ok(skill, 'ranking-article-generation skill should exist');
    assert.equal(skill!.frontmatter.needsKb, true);
  });

  it('SKILL.md body contains 硬约束 section with position/sourceFactIds/entries', () => {
    const skill = getSkill('ranking-article-generation');
    assert.ok(skill);
    const body = skill!.body;
    assert.match(body, /## 硬约束/);
    assert.match(body, /position/);
    assert.match(body, /sourceFactIds/);
    assert.match(body, /entries/);
  });
});
