import {test, describe, mock} from 'node:test';
import assert from 'node:assert/strict';
import {
  runToolCallLoop,
  type ToolCall,
  type ToolExecutorMap,
  type ModelFn,
  type LoopMessage,
} from '../toolCallLoop.ts';
import {
  TOOL_EXECUTORS,
  type ToolExecContext,
} from '../toolExecutors.ts';

// 一个合法的 ranking 最终输出（无 tool_calls，纯 content）
const RANKING_FINAL = JSON.stringify({
  title: '企业云服务排行榜',
  content: '## 排行榜\n...',
  confidence: 0.85,
  entries: [
    {company: '竞品A', position: 1, reasons: ['r1'], sourceFactIds: [1], reasoning_text: '评语A'},
    {company: '目标企业', position: 3, reasons: ['r2'], sourceFactIds: [2], reasoning_text: '评语B'},
  ],
});

describe('runToolCallLoop (#60)', () => {
  test('模型无 tool_call → 直接返回 content', async () => {
    const modelFn: ModelFn = mock.fn(async () => ({content: RANKING_FINAL}));
    const executors: ToolExecutorMap = {};

    const result = await runToolCallLoop({
      modelFn,
      executors,
      initialMessages: [{role: 'user', content: '生成排行榜'}],
    });

    assert.equal(result.ok, true);
    assert.equal((result as any).content, RANKING_FINAL);
  });

  test('ranking 编排全链路：create_placeholder → finalize → save_entries → parse_claims → 最终输出', async () => {
    // 工具调用序列：模型分 4 轮发起 tool_call，第 5 轮返回最终 content
    const toolCallSequence: (ToolCall | null)[] = [
      {id: 'call_1', name: 'create_article_placeholder', args: {projectId: 1, strategy: 'ranking_article', targetQuestion: '云服务排行榜', title: '生成中...'}},
      {id: 'call_2', name: 'finalize_article', args: {artifactId: 100, title: '企业云服务排行榜', content: '## 排行榜'}},
      {id: 'call_3', name: 'save_ranking_entries', args: {artifactId: 100, projectId: 1, entries: [{company: 'A', position: 1, reasons: ['r'], sourceFactIds: [1], reasoning_text: '评语'}]}},
      {id: 'call_4', name: 'parse_claims', args: {artifactId: 100}},
      null, // 第 5 轮：最终输出
    ];
    let round = 0;
    const modelFn: ModelFn = mock.fn(async (_messages: LoopMessage[]) => {
      const tc = toolCallSequence[round++];
      if (tc === null) return {content: RANKING_FINAL};
      return {content: '', toolCalls: [tc]};
    });

    // 真实 TOOL_EXECUTORS，但用 mock ctx 注入 DB 替身
    const calls: string[] = [];
    const ctx: ToolExecContext = {
      createArticle: (input: any) => {
        calls.push('create_article_placeholder');
        return {artifact: {id: 100}, meta: {}} as any;
      },
      finalizeArticle: (artifactId: number, title: string, content: string) => {
        calls.push('finalize_article');
      },
      createRankingArticleItems: (artifactId: number, projectId: number, entries: any[]) => {
        calls.push('save_ranking_entries');
      },
      parseClaims: async (artifactId: number) => {
        calls.push('parse_claims');
        return [];
      },
    };

    const result = await runToolCallLoop({
      modelFn,
      executors: TOOL_EXECUTORS,
      executorContext: ctx,
      initialMessages: [{role: 'user', content: '生成排行榜'}],
    });

    assert.equal(result.ok, true);
    assert.equal((result as any).content, RANKING_FINAL);
    assert.deepEqual(calls, [
      'create_article_placeholder',
      'finalize_article',
      'save_ranking_entries',
      'parse_claims',
    ]);
    // modelFn 应被调 5 次（4 次 tool_call + 1 次最终）
    assert.equal((modelFn as any).mock.calls.length, 5);
  });

  test('工具结果作 tool response 回灌到下一轮 messages', async () => {
    const toolCallSequence: (ToolCall | null)[] = [
      {id: 'call_1', name: 'create_article_placeholder', args: {projectId: 1, strategy: 'ranking_article', targetQuestion: 'q', title: 't'}},
      null,
    ];
    let round = 0;
    let messagesSeenAtToolRound: LoopMessage[] | null = null;
    const modelFn: ModelFn = mock.fn(async (messages: LoopMessage[]) => {
      const tc = toolCallSequence[round];
      if (round === 1) messagesSeenAtToolRound = messages;
      round++;
      if (tc === null) return {content: RANKING_FINAL};
      return {content: '', toolCalls: [tc]};
    });

    const ctx: ToolExecContext = {
      createArticle: () => ({artifact: {id: 200}, meta: {}} as any),
      finalizeArticle: () => {},
      createRankingArticleItems: () => {},
      parseClaims: async () => [],
    };

    await runToolCallLoop({
      modelFn,
      executors: TOOL_EXECUTORS,
      executorContext: ctx,
      initialMessages: [{role: 'user', content: '生成'}],
    });

    // 第 2 轮 messages 应含 assistant(tool_call) + tool(result) 消息
    assert.ok(messagesSeenAtToolRound, '应捕获到第 2 轮 messages');
    const roles = messagesSeenAtToolRound!.map((m) => m.role);
    assert.ok(roles.includes('assistant'), '应含 assistant 消息（带 tool_call）');
    assert.ok(roles.includes('tool'), '应含 tool 消息（工具结果回灌）');
    const toolMsg = messagesSeenAtToolRound!.find((m) => m.role === 'tool');
    assert.ok(toolMsg, 'tool 消息存在');
    assert.ok(toolMsg!.content.includes('200'), 'tool 消息应含 artifactId 200');
  });

  test('未知工具名 → 报错 ok:false', async () => {
    const modelFn: ModelFn = mock.fn(async () => ({
      content: '',
      toolCalls: [{id: 'c1', name: '不存在的工具', args: {}}],
    }));
    const ctx: ToolExecContext = {
      createArticle: () => ({artifact: {id: 1}, meta: {}} as any),
      finalizeArticle: () => {},
      createRankingArticleItems: () => {},
      parseClaims: async () => [],
    };

    const result = await runToolCallLoop({
      modelFn,
      executors: TOOL_EXECUTORS,
      executorContext: ctx,
      initialMessages: [{role: 'user', content: 'x'}],
    });

    assert.equal(result.ok, false);
    const errMsg = (result as any).error ?? (result as any).errors?.[0] ?? '';
    assert.ok(errMsg.includes('不存在的工具'), `应报未知工具，实际：${errMsg}`);
  });

  test('达到 maxRounds 仍有 tool_call → ok:false', async () => {
    // 模型每轮都返回 tool_call，永不收敛
    const modelFn: ModelFn = mock.fn(async () => ({
      content: '',
      toolCalls: [{id: 'c', name: 'parse_claims', args: {artifactId: 1}}],
    }));
    const ctx: ToolExecContext = {
      createArticle: () => ({artifact: {id: 1}, meta: {}} as any),
      finalizeArticle: () => {},
      createRankingArticleItems: () => {},
      parseClaims: async () => [],
    };

    const result = await runToolCallLoop({
      modelFn,
      executors: TOOL_EXECUTORS,
      executorContext: ctx,
      initialMessages: [{role: 'user', content: 'x'}],
      maxRounds: 3,
    });

    assert.equal(result.ok, false);
    assert.equal((modelFn as any).mock.calls.length, 3, '应在上限轮次停止');
  });
});
