/**
 * title-generation.test.ts
 *
 * Tests for issue #57 — title-generation md-driven validate layer.
 * Verifies:
 *  - valid output passes (ok:true)
 *  - Zod-failing payload rejected (ok:false with errors)
 *  - non-JSON string rejected (ok:false with parse error)
 *  - skillRegistry.getSkill('title-generation') loads with needsKb:false
 */

import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';

import {validate} from '../../../../skills/title-generation/index.ts';
import {getSkill, _resetCache} from '../skillRegistry.ts';

const VALID_OUTPUT = {
  titles: [
    {
      titleText: '2024 国内最值得推荐的 SaaS CRM：TOP 5 深度评测',
      score: 0.88,
      intent: '排行榜',
      notes: '搜索量高，包含决策意图词',
    },
    {
      titleText: 'SaaS CRM 怎么选？三款主流产品横向对比',
      score: 0.72,
      intent: '怎么选',
    },
  ],
};

describe('title-generation validate (#57)', () => {
  it('passes for a valid JSON output', async () => {
    const res = await validate(JSON.stringify(VALID_OUTPUT));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.data.titles.length, 2);
      assert.equal(res.data.titles[0].titleText, VALID_OUTPUT.titles[0].titleText);
    }
  });

  it('rejects a Zod-failing payload (ok:false)', async () => {
    const bad = {
      ...VALID_OUTPUT,
      titles: [
        {...VALID_OUTPUT.titles[0], score: 5}, // >1 violates z.number().max(1)
      ],
    };
    const res = await validate(JSON.stringify(bad));
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

  it('strips ```json fences before parsing', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_OUTPUT) + '\n```';
    const res = await validate(fenced);
    assert.equal(res.ok, true);
  });
});

describe('title-generation skillRegistry (#57)', () => {
  beforeEach(() => {
    _resetCache();
  });

  it("getSkill('title-generation') loads with needsKb:false", () => {
    const skill = getSkill('title-generation');
    assert.ok(skill, 'title-generation skill should exist');
    assert.equal(skill!.frontmatter.needsKb, false);
  });

  it('SKILL.md body contains required sections and no brand identity', () => {
    const skill = getSkill('title-generation');
    assert.ok(skill);
    const body = skill!.body;
    assert.match(body, /## 角色/);
    assert.match(body, /## 工作流/);
    assert.match(body, /## 硬约束/);
    assert.match(body, /## 输入/);
    assert.match(body, /## 输出格式/);
    assert.match(body, /## 工具/);
    assert.match(body, /## 样例/);
    // No brand identity phrase from the old SYSTEM_PROMPT.
    assert.doesNotMatch(body, /你是企业 GEO 优化标题专家/);
  });

  it('SKILL.md frontmatter has no legacy domains/capabilities/preconditions', () => {
    const skill = getSkill('title-generation');
    assert.ok(skill);
    const fm = skill!.frontmatter;
    assert.equal(fm.domains, undefined);
    assert.equal(fm.capabilities, undefined);
    assert.equal(fm.preconditions, undefined);
    assert.equal(fm.requires_confirmation, undefined);
  });
});
