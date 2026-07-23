/**
 * mdDrivenRunnerTools.test.ts (#63)
 *
 * 集成测试：runMdDrivenSkill 接入 tool_call 循环后的全链路。
 *
 * - ranking-article-generation（有工具）：mock chatFn 按序列返回 tool_calls
 *   （create_placeholder → finalize → save_entries → parse_claims）后返回最终
 *   JSON，mock executorContext（DB 替身）记录调用，验证 4 个工具全部触发 +
 *   最终输出经 validate + ok:true。
 * - title-generation（无工具）：走原单次路径，验证不触发任何工具 + ok:true。
 *
 * 测试注入 executeTool 直调（跳过 executeWithGuard，避免依赖 getDb/SQLite）。
 */
import {test, describe, mock} from 'node:test';
import assert from 'node:assert/strict';
import {runMdDrivenSkill} from '../mdDrivenRunner.ts';
import type {ToolExecContext, ToolResult} from '../toolExecutors.ts';

// 合法 ranking 最终输出（validate 通过：entries>=2，position 钳制）
const RANKING_FINAL = JSON.stringify({
  title: '企业云服务排行榜',
  content: '## 排行榜\n...',
  confidence: 0.85,
  entries: [
    {company: '竞品A', position: 1, reasons: ['r1'], sourceFactIds: [1], reasoning_text: '评语A'},
    {company: '目标企业', position: 3, reasons: ['r2'], sourceFactIds: [2], reasoning_text: '评语B'},
  ],
});

// 合法 title 输出（无工具路径）
const TITLE_VALID = JSON.stringify({
  titles: [
    {titleText: '2024 企业云服务怎么选？', score: 0.9, intent: '推荐', notes: '决策意图'},
    {titleText: '云服务排行榜推荐', score: 0.8, intent: '排行榜'},
  ],
});

/** 构造 DeepSeek 风格的 tool_call 响应（OpenAI function-calling 格式）。 */
function toolCallResponse(id: string, name: string, args: Record<string, unknown>): {content: string; model: string; toolCalls: unknown[]} {
  return {
    content: '',
    model: 'mock',
    toolCalls: [
      {
        id,
        type: 'function',
        function: {name, arguments: JSON.stringify(args)},
      },
    ],
  };
}

/** 构造 mock executorContext，记录调用顺序与 artifactId。 */
function makeMockCtx() {
  const calls: string[] = [];
  const ctx: ToolExecContext = {
    createArticle: (input) => {
      calls.push('create_article_placeholder');
      return {artifact: {id: 100}, meta: {}} as any;
    },
    finalizeArticle: (artifactId, title, content) => {
      calls.push('finalize_article');
    },
    createRankingArticleItems: (artifactId, projectId, entries) => {
      calls.push('save_ranking_entries');
    },
    parseClaims: async (artifactId) => {
      calls.push('parse_claims');
      return [];
    },
  };
  return {ctx, calls};
}

/** 直调 executeTool（跳过 executeWithGuard，测试用）。 */
const directExecuteTool = async (
  _name: string,
  executor: (args: Record<string, unknown>, ctx: ToolExecContext) => Promise<ToolResult>,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<ToolResult> => executor(args, ctx);

const fakeEvidence = {
  projectId: 1,
  query: '云服务排行榜',
  facts: [{factId: 1, factType: '产品', factKey: '产品A', factValue: '云服务', confidence: 0.9}],
  chunks: [],
  missingFields: [],
  riskWarnings: [],
};

describe('runMdDrivenSkill tool_call 循环接线 (#63)', () => {
  test('ranking-article-generation：mock tool_call 序列触发全部 4 工具 + 最终输出经 validate ok:true', async () => {
    // chatFn 按序列返回：4 次 tool_call + 1 次最终 content
    const responses = [
      toolCallResponse('call_1', 'create_article_placeholder', {
        projectId: 1,
        strategy: 'ranking_article',
        targetQuestion: '云服务排行榜',
        title: '生成中...',
      }),
      toolCallResponse('call_2', 'finalize_article', {
        artifactId: 100,
        title: '企业云服务排行榜',
        content: '## 排行榜',
      }),
      toolCallResponse('call_3', 'save_ranking_entries', {
        artifactId: 100,
        projectId: 1,
        entries: [
          {company: '竞品A', position: 1, reasons: ['r'], sourceFactIds: [1], reasoning_text: '评语'},
          {company: '目标企业', position: 3, reasons: ['r2'], sourceFactIds: [2], reasoning_text: '评语B'},
        ],
      }),
      toolCallResponse('call_4', 'parse_claims', {artifactId: 100}),
      {content: RANKING_FINAL, model: 'mock'},
    ];
    let respIdx = 0;
    const chatFn = mock.fn(async () => responses[respIdx++]);
    const buildEvidencePack = mock.fn(async () => fakeEvidence);
    const {ctx, calls} = makeMockCtx();

    const result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: 1,
      taskArgs: {projectName: '目标企业', targetQuestion: '云服务排行榜', competitors: ['竞品A']},
      chatFn,
      buildEvidencePack,
      executorContext: ctx,
      executeTool: directExecuteTool,
    });

    assert.equal(result.ok, true, '应 ok:true');
    assert.deepEqual(calls, [
      'create_article_placeholder',
      'finalize_article',
      'save_ranking_entries',
      'parse_claims',
    ], '4 个工具应按序触发');
    // chatFn 被调 5 次（4 次 tool_call + 1 次最终 content）
    assert.equal(chatFn.mock.calls.length, 5, '应 5 轮 modelFn/chatFn 调用');
    // KB 注入仍生效
    assert.equal(buildEvidencePack.mock.calls.length, 1, 'needsKb 应调 buildEvidencePack');
    // 最终数据经 validate（entries>=2，position 钳制）
    const data = (result as any).data;
    assert.ok(Array.isArray(data.entries) && data.entries.length >= 2, 'validate 应保留 entries');
  });

  test('ranking：chatFn 传 tools 参数（modelFn 把 tools 透传给 chat）', async () => {
    // 第一轮直接返回最终 content（无 tool_call），验证 tools 仍被传入
    const chatFn = mock.fn(async () => ({content: RANKING_FINAL, model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => fakeEvidence);
    const {ctx} = makeMockCtx();

    const result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: 1,
      taskArgs: {projectName: '目标企业', targetQuestion: '云服务排行榜'},
      chatFn,
      buildEvidencePack,
      executorContext: ctx,
      executeTool: directExecuteTool,
    });

    assert.equal(result.ok, true);
    const opts = (chatFn as any).mock.calls[0].arguments[1];
    assert.ok(Array.isArray(opts.tools) && opts.tools.length > 0, 'ranking 路径应传 tools schema');
    assert.equal(opts.responseFormat, 'json_object');
  });

  test('ranking：tool_call 循环失败（未知工具）→ ok:false', async () => {
    const chatFn = mock.fn(async () => ({
      content: '',
      model: 'mock',
      toolCalls: [
        {id: 'c1', type: 'function', function: {name: '不存在的工具', arguments: '{}'}},
      ],
    }));
    const buildEvidencePack = mock.fn(async () => fakeEvidence);
    const {ctx} = makeMockCtx();

    const result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: 1,
      taskArgs: {projectName: '目标企业', targetQuestion: '云服务排行榜'},
      chatFn,
      buildEvidencePack,
      executorContext: ctx,
      executeTool: directExecuteTool,
    });

    assert.equal(result.ok, false, '未知工具应导致循环失败 → validate 走重试');
  });

  test('title-generation（无工具）：走原单次路径，不触发任何工具 + ok:true', async () => {
    const chatFn = mock.fn(async () => ({content: TITLE_VALID, model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => {
      throw new Error('needsKb:false 不应调 buildEvidencePack');
    });
    const {ctx, calls} = makeMockCtx();

    const result = await runMdDrivenSkill('title-generation', {
      projectId: undefined,
      taskArgs: {projectName: '测试企业', targetQuestion: '云服务怎么选？'},
      chatFn,
      buildEvidencePack,
      executorContext: ctx,
      executeTool: directExecuteTool,
    });

    assert.equal(result.ok, true, 'title 无工具路径应通过');
    assert.equal(chatFn.mock.calls.length, 1, '单次路径应只调一次 chat');
    assert.deepEqual(calls, [], '不应触发任何工具');
    // 无工具路径不传 tools
    const opts = (chatFn as any).mock.calls[0].arguments[1];
    assert.equal(opts.tools, undefined, 'title 路径不应传 tools');
  });
});
