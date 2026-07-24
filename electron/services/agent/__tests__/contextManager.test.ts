/**
 * contextManager.test.ts
 *
 * #94: ContextManager 模块单元测试。
 *
 * 测试 assembleConversationContext 的 SlidingWindowStrategy 行为。
 * 通过 mock db（{prepare().all()} 返回预定义数据）实现无 SQLite 依赖的纯函数测试。
 *
 * #96: 新增 SummaryWindowStrategy 测试 — getMemoryPreamble / maybeTriggerSummary。
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleConversationContext,
  getMemoryPreamble,
  maybeTriggerSummary,
  type ConversationMessage,
} from '../contextManager.ts';

/** 构造 mock db：prepare(…) 返回给定 rows 的 {all(), get(), run()}。 */
function mockDb(
  rows: Array<{role: string; content: string; created_at: string}> = [],
  getReturn: unknown = undefined,
) {
  return {
    prepare: (_sql: string) => ({
      all: (..._args: unknown[]) => rows,
      get: (..._args: unknown[]) => getReturn,
      run: (..._args: unknown[]) => ({lastInsertRowid: 1, changes: 1}),
    }),
  } as ReturnType<typeof import('../../../db/connection').getDb>;
}

/** 生成 N 条交替的 user/assistant 消息。 */
function makeMessages(count: number, baseTime = '2026-07-24T10:00:00Z'): ConversationMessage[] {
  const msgs: ConversationMessage[] = [];
  const base = new Date(baseTime).getTime();
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `这是第 ${i + 1} 条消息，包含一些中文内容用于测试 token 估算。`,
      createdAt: new Date(base + i * 60_000).toISOString(),
    });
  }
  return msgs;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ContextManager — assembleConversationContext', () => {
  it('sessionId 为 null 时返回空数组', () => {
    const db = mockDb([]);
    const result = assembleConversationContext(null, '当前用户消息', db);
    assert.deepEqual(result, []);
  });

  it('sessionId 为 undefined 时返回空数组', () => {
    const db = mockDb([]);
    const result = assembleConversationContext(undefined, '当前用户消息', db);
    assert.deepEqual(result, []);
  });

  it('chat_messages 表为空时不报错，返回空数组', () => {
    const db = mockDb([]);
    const result = assembleConversationContext(1, '当前用户消息', db);
    assert.deepEqual(result, []);
  });

  it('返回的消息按 created_at 正序排列', () => {
    const rows = [
      {role: 'user', content: '第一条', created_at: '2026-07-24T10:00:00Z'},
      {role: 'assistant', content: '第二条', created_at: '2026-07-24T10:01:00Z'},
      {role: 'user', content: '第三条', created_at: '2026-07-24T10:02:00Z'},
    ];
    const db = mockDb(rows);
    const result = assembleConversationContext(1, '第四条', db);

    assert.equal(result.length, 3);
    assert.equal(result[0].content, '第一条');
    assert.equal(result[1].content, '第二条');
    assert.equal(result[2].content, '第三条');
  });

  it('消息数量不超过 maxRecent（mock 提供精确行数模拟 SQL LIMIT 行为）', () => {
    // mockDb 不执行 SQL LIMIT，直接返回传入的 rows。
    // 因此提供恰好 5 条行来模拟 DB 层已按 maxRecent=5 截断的结果。
    const rows = makeMessages(5).map((m) => ({
      role: m.role,
      content: m.content,
      created_at: m.createdAt,
    }));
    const db = mockDb(rows);
    const result = assembleConversationContext(1, '当前消息', db, {maxRecent: 5});

    assert.equal(result.length, 5);
    // 确保按时间正序：第一行最早
    assert.equal(result[0].createdAt < result[4].createdAt, true);
  });

  it('token 超预算时从最旧的消息开始裁剪', () => {
    // 构造大量消息确保超预算
    const rows: Array<{role: string; content: string; created_at: string}> = [];
    for (let i = 0; i < 20; i++) {
      rows.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: '这是一条很长的测试消息用于验证 token 预算裁剪行为'.repeat(5),
        created_at: new Date(Date.now() + i * 60_000).toISOString(),
      });
    }

    const db = mockDb(rows);
    // 设置非常小的 token 预算，确保触发裁剪
    const result = assembleConversationContext(1, '当前用户消息', db, {
      maxTokens: 200,
      maxRecent: 20,
    });

    // 应该触发裁剪，结果少于原始 20 条
    assert.ok(result.length < 20, `expected <20, got ${result.length}`);
    // 至少有结果（或空数组都算合理）
    assert.ok(Array.isArray(result));
  });

  it('默认 maxRecent=20，不传 config 时使用默认值', () => {
    // mockDb 不执行 SQL LIMIT，提供 20 条（默认 maxRecent 上限）模拟 DB 截断
    const rows = makeMessages(20).map((m) => ({
      role: m.role,
      content: m.content,
      created_at: m.createdAt,
    }));
    const db = mockDb(rows);
    const result = assembleConversationContext(1, '当前消息', db);

    assert.equal(result.length, 20);
    // 短消息不触发 token 裁剪
  });

  // ── #96: SummaryWindowStrategy ──────────────────────────────────────────────────

  describe('getMemoryPreamble', () => {
    it('sessionId 为 null 时返回空字符串', () => {
      const db = mockDb();
      const result = getMemoryPreamble(null, db);
      assert.equal(result, '');
    });

    it('sessionId 为 undefined 时返回空字符串', () => {
      const db = mockDb();
      const result = getMemoryPreamble(undefined, db);
      assert.equal(result, '');
    });

    it('无摘要记录时返回空字符串', () => {
      const db = mockDb([], undefined); // get() returns undefined
      const result = getMemoryPreamble(1, db);
      assert.equal(result, '');
    });

    it('有完整摘要时返回格式化的 preamble', () => {
      const summary = {
        topic: 'GEO 内容营销策略',
        progress: '已确认目标行业为 SaaS，完成竞品分析',
        pending: '需生成第一篇 ranking 文章',
        preferences: '用户偏好幽默风格，注重数据支撑',
      };
      const db = mockDb([], {summary_json: JSON.stringify(summary)});
      const result = getMemoryPreamble(1, db);

      assert.ok(result.startsWith('<memory>'));
      assert.ok(result.includes('GEO 内容营销策略'));
      assert.ok(result.includes('SaaS'));
      assert.ok(result.includes('用户偏好幽默风格'));
      assert.ok(result.endsWith('</memory>\n\n'));
    });

    it('部分字段为空时仍返回有效 preamble', () => {
      const summary = {topic: '仅主题'};
      const db = mockDb([], {summary_json: JSON.stringify(summary)});
      const result = getMemoryPreamble(1, db);

      assert.ok(result.includes('仅主题'));
      assert.ok(!result.includes('undefined'));
    });

    it('summary_json 为无效 JSON 时返回空字符串（不抛异常）', () => {
      const db = mockDb([], {summary_json: 'not valid json'});
      const result = getMemoryPreamble(1, db);
      assert.equal(result, '');
    });

    it('summary_json 为空对象时返回空字符串', () => {
      const db = mockDb([], {summary_json: '{}'});
      const result = getMemoryPreamble(1, db);
      assert.equal(result, '');
    });
  });

  describe('maybeTriggerSummary', () => {
    it('sessionId 为 null 时不抛异常', () => {
      const db = mockDb();
      assert.doesNotThrow(() => {
        maybeTriggerSummary(null, db);
      });
    });

    it('sessionId 为 undefined 时不抛异常', () => {
      const db = mockDb();
      assert.doesNotThrow(() => {
        maybeTriggerSummary(undefined, db);
      });
    });

    it('调用后不立即抛异常（异步执行在 setImmediate 中）', () => {
      // 即使 mock db 缺少完整表结构，maybeTriggerSummary 本身是同步 fire，
      // 不应在主线程抛异常
      const db = mockDb();
      assert.doesNotThrow(() => {
        maybeTriggerSummary(1, db);
      });
    });
  });
});
