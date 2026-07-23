/**
 * cutoverDispatch.test.ts
 *
 * Tests for issue #62 — the big-bang cutover. Verifies the dispatch-wiring
 * invariants that the runtime relies on, without standing up SQLite/Electron:
 *
 *   - `question.generate` (the MVP service-backed capability that #56's table
 *     omitted) now routes as kind='service'.
 *   - Every service-kind route resolves to an executor in `SERVICE_EXECUTORS`
 *     (so the runtime's service branch never hits the「暂未接入执行后端」
 *     graceful-skip path for a wired service intent).
 *   - md-driven skills with `migrated:false` carry the flag through so the
 *     runtime surfaces the「能力升级中」placeholder instead of executing.
 *   - The pause intent `publish.plan` routes as kind='pause' (NOT in
 *     SERVICE_EXECUTORS — its pause path lives in the runtime).
 *   - `SKILL_EXECUTORS` is gone from the factory (the old dual registry is
 *     deleted); only `SERVICE_EXECUTORS` remains.
 *
 * The chat call is stubbed via `opts.chatFn`; the blockHook is allow-all so
 * tests focus on routing + dispatch wiring, not policy.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {route, type ChatFn, type RouteContext} from '../intentRouter.ts';
import {SKILL_ROUTES} from '../skillRoutes.ts';
import {SERVICE_EXECUTORS} from '../geoAgentFactory.ts';
import * as geoAgentFactory from '../geoAgentFactory.ts';

const allowAll = () => null;
const ctx: RouteContext = {};

function mockChatFn(response: {intent: string | null; confidence: number}): ChatFn {
  return async () => ({content: JSON.stringify(response)});
}

describe('#62 cutover — question.generate service route', () => {
  it('routes "生成问题" to question.generate as kind=service', async () => {
    const result = await route('请帮我生成问题池', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'question.generate');
    assert.equal(result.kind, 'service');
  });
});

describe('#62 cutover — service dispatch wiring', () => {
  const serviceRoutes = SKILL_ROUTES.filter((r) => r.kind === 'service');

  it('every service-kind route has a registered executor in SERVICE_EXECUTORS', () => {
    // claim.parsing is the one service intent without a backing service yet;
    // it is allowed to be absent. Every OTHER service intent must be wired.
    const unwired = serviceRoutes
      .filter((r) => r.intent !== 'claim.parsing')
      .filter((r) => !(r.intent in SERVICE_EXECUTORS))
      .map((r) => r.intent);
    assert.deepEqual(unwired, [], `unwired service intents: ${unwired.join(', ')}`);
  });

  it('claim.parsing intentionally has no executor (graceful skip at runtime)', () => {
    assert.equal('claim.parsing' in SERVICE_EXECUTORS, false);
  });

  it('publish.plan (pause) is NOT in SERVICE_EXECUTORS — pause path lives in runtime', () => {
    assert.equal('publish.plan' in SERVICE_EXECUTORS, false);
  });

  it('the old SKILL_EXECUTORS registry is deleted from the factory module', () => {
    assert.equal('SKILL_EXECUTORS' in geoAgentFactory, false);
  });
});

describe('#62 cutover — migrated:false md-driven skills', () => {
  it('an unmigrated md-driven skill carries migrated:false through route()', async () => {
    // support-article-planning is an md-driven skill with migrated:false.
    const result = await route('请做支持类文章大纲', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.kind, 'md-driven');
    assert.equal(result.migrated, false);
  });

  it('a migrated md-driven skill carries migrated:true through route()', async () => {
    const result = await route('请生成标题候选', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.kind, 'md-driven');
    assert.equal(result.migrated, true);
  });

  it('exactly 2 md-driven skills are migrated:true', () => {
    const migrated = SKILL_ROUTES.filter((r) => r.kind === 'md-driven' && r.migrated);
    assert.equal(migrated.length, 2);
  });
});

describe('#62 cutover — pause intent routing', () => {
  it('routes "准备发布计划" to publish.plan as kind=pause', async () => {
    const result = await route('准备发布计划', ctx, {blockHook: allowAll});
    assert.equal(result.type, 'skill');
    if (result.type !== 'skill') return;
    assert.equal(result.skillName, 'publish.plan');
    assert.equal(result.kind, 'pause');
  });

  it('pause route is blocked by policy when preconditions fail', async () => {
    const block = () => '当前项目缺少已审核通过的文章草稿';
    const result = await route('准备发布计划', ctx, {blockHook: block});
    assert.equal(result.type, 'blocked');
  });
});

describe('#62 cutover — clarify path', () => {
  it('low-confidence semantic match returns clarify candidates', async () => {
    const result = await route('帮我把企业资料整理成结构化事实', ctx, {
      blockHook: allowAll,
      chatFn: mockChatFn({intent: 'fact.extract', confidence: 0.4}),
    });
    assert.equal(result.type, 'clarify');
    if (result.type === 'clarify') {
      assert.ok(result.candidates.length >= 1);
    }
  });
});
