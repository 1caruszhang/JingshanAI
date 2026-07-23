/**
 * intentRouter.test.ts
 *
 * Tests for issue #56 — the rewritten `route()` backed by the declarative
 * `SKILL_ROUTES` table. Covers the three-tier chain:
 *
 *   - Tier 1: complete-phrase substring `includes` (no shingle scoring)
 *     - single phrase hit
 *     - no phrase hit → falls through to Tier 2
 *     - multi-skill hit → longest phrase wins
 *     - same-length tie → table order wins
 *     - migrated flag carried through
 *     - kind coverage (md-driven / service / pause)
 *   - Tier 2: semantic match with threshold 0.6 (mock chatFn)
 *     - confidence ≥ 0.6 routes
 *     - confidence < 0.6 does not route
 *   - Tier 3: clarify candidates vs fallback
 *   - blockHook → blocked result
 *
 * The chat call is stubbed via `opts.chatFn` so no network/DB is touched.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {route, type ChatFn, type RouteContext} from '../intentRouter.ts';
import {SKILL_ROUTES} from '../skillRoutes.ts';

// A blockHook that always allows — keeps tests focused on routing, not policy.
const allowAll = () => null;

const ctx: RouteContext = {};

/** Builds a mock chatFn that responds with a fixed intent + confidence. */
function mockChatFn(response: {intent: string | null; confidence: number}): ChatFn {
  return async () => ({content: JSON.stringify(response)});
}

describe('SKILL_ROUTES table', () => {
  it('has 24 entries: 17 md-driven + 6 service + 1 pause', () => {
    assert.equal(SKILL_ROUTES.length, 24);
    const mdDriven = SKILL_ROUTES.filter((r) => r.kind === 'md-driven');
    const service = SKILL_ROUTES.filter((r) => r.kind === 'service');
    const pause = SKILL_ROUTES.filter((r) => r.kind === 'pause');
    assert.equal(mdDriven.length, 17);
    assert.equal(service.length, 6);
    assert.equal(pause.length, 1);
  });

  it('marks exactly the 2 slice skills migrated:true', () => {
    const migrated = SKILL_ROUTES.filter((r) => r.migrated).map((r) => r.intent);
    assert.deepEqual(migrated.sort(), ['ranking-article-generation', 'title-generation']);
  });
});

describe('route() Tier 1 — phrase match', () => {
  it('hits on a single complete phrase and returns md-driven + migrated flag', async () => {
    // title-generation is a migrated slice skill.
    const result = await route('请帮我生成标题候选', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'title-generation');
    assert.equal(result.kind, 'md-driven');
    assert.equal(result.migrated, true);
  });

  it('hits a service intent phrase and carries kind=service', async () => {
    const result = await route('请帮我做事实抽取', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'fact.extract');
    assert.equal(result.kind, 'service');
    assert.equal(result.migrated, false);
  });

  it('hits the pause intent phrase and carries kind=pause', async () => {
    const result = await route('准备发布计划', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'publish.plan');
    assert.equal(result.kind, 'pause');
  });

  it('does not route on a non-matching message via Tier 1 (falls to Tier 2)', async () => {
    // No phrase hits; chatFn returns null → fallback. Tier 1 was bypassed.
    const result = await route('今天天气怎么样', ctx, {
      blockHook: allowAll,
      chatFn: mockChatFn({intent: null, confidence: 0}),
    });
    assert.equal(result.type, 'fallback');
  });

  it('multi-skill hit picks the longest phrase', async () => {
    // "生成排行榜文章" (7 chars, ranking-article-generation) is longer than
    // "生成标题" (4 chars, title-generation) — both would hit if we mention
    // both, but the longest phrase should win.
    const result = await route('先生成标题再生成排行榜文章', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'ranking-article-generation');
  });
});

describe('route() Tier 1 — same-length tie breaks by table order', () => {
  it('picks the earlier route when two equal-length phrases hit', async () => {
    // Construct a message containing two same-length phrases from different
    // routes. "生成标题" (title-generation, table index 0) and "信源发现"
    // (source.discover, table index 17) are both 4 chars. The earlier table
    // entry (title-generation) should win.
    const result = await route('生成标题 信源发现', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'title-generation');
  });
});

describe('route() Tier 2 — semantic match with threshold 0.6', () => {
  it('routes when chatFn returns confidence >= 0.6', async () => {
    // A message with no phrase hit; chatFn picks fact.extract at 0.8.
    const result = await route('帮我把企业资料整理成结构化事实', ctx, {
      blockHook: allowAll,
      chatFn: mockChatFn({intent: 'fact.extract', confidence: 0.8}),
    });
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'fact.extract');
    assert.equal(result.kind, 'service');
  });

  it('does not route when chatFn returns confidence < 0.6', async () => {
    const result = await route('帮我把企业资料整理成结构化事实', ctx, {
      blockHook: allowAll,
      chatFn: mockChatFn({intent: 'fact.extract', confidence: 0.4}),
    });
    // Below threshold but ≥ 0.3 → clarify with the candidate.
    assert.equal(result.type, 'clarify');
    if (result.type === 'clarify') {
      assert.ok(result.candidates.length >= 1);
      assert.equal(result.candidates[0].intent, 'fact.extract');
    }
  });

  it('returns fallback when confidence < 0.3 (no clarify candidates)', async () => {
    const result = await route('帮我把企业资料整理成结构化事实', ctx, {
      blockHook: allowAll,
      chatFn: mockChatFn({intent: 'fact.extract', confidence: 0.1}),
    });
    assert.equal(result.type, 'fallback');
  });
});

describe('route() Tier 3 — fallback', () => {
  it('returns fallback when neither Tier 1 nor Tier 2 produces a route', async () => {
    const result = await route('随便说点什么', ctx, {
      blockHook: allowAll,
      chatFn: mockChatFn({intent: null, confidence: 0}),
    });
    assert.equal(result.type, 'fallback');
    if (result.type === 'fallback') {
      assert.equal(result.mode, 'status_diagnosis');
    }
  });
});

describe('route() block policy', () => {
  it('returns blocked when the blockHook returns a reason', async () => {
    const block = () => '当前项目缺少已确认事实，请先完成事实抽取和确认';
    const result = await route('请帮我生成标题候选', ctx, {blockHook: block});
    assert.equal(result.type, 'blocked');
    if (result.type === 'blocked') {
      assert.equal(result.skillName, 'title-generation');
      assert.ok(result.reason.length > 0);
    }
  });
});

describe('route() kind coverage', () => {
  it('returns kind for every route kind (md-driven / service / pause)', async () => {
    const cases: Array<{msg: string; expectedKind: string; expectedName: string}> = [
      {msg: '生成标题候选', expectedKind: 'md-driven', expectedName: 'title-generation'},
      {msg: '请做事实抽取', expectedKind: 'service', expectedName: 'fact.extract'},
      {msg: '准备发布计划', expectedKind: 'pause', expectedName: 'publish.plan'},
    ];
    for (const c of cases) {
      const result = await route(c.msg, ctx, {blockHook: allowAll});
      assert.equal(result.type, 'skill', `expected skill for "${c.msg}"`);
      if (result.type !== 'skill') continue;
      assert.equal(result.kind, c.expectedKind);
      assert.equal(result.skillName, c.expectedName);
    }
  });
});
