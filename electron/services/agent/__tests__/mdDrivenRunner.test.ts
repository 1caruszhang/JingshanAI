import {test, describe, mock} from 'node:test';
import assert from 'node:assert/strict';
import {runMdDrivenSkill, type MdDrivenRunOptions} from '../mdDrivenRunner.ts';

// 合法 title 输出（needsKb:false，无 KB 注入）
const TITLE_VALID = JSON.stringify({
  titles: [
    {titleText: '2024 企业云服务怎么选？', score: 0.9, intent: '推荐', notes: '决策意图'},
    {titleText: '云服务排行榜推荐', score: 0.8, intent: '排行榜'},
  ],
});

// 合法 ranking 输出（needsKb:true，entries>=2）
const RANKING_VALID = JSON.stringify({
  title: '企业云服务排行榜',
  content: '## 排行榜\n...',
  confidence: 0.85,
  entries: [
    {company: '竞品A', position: 1, reasons: ['r1'], sourceFactIds: [1], reasoning_text: '评语A'},
    {company: '目标企业', position: 3, reasons: ['r2'], sourceFactIds: [2], reasoning_text: '评语B'},
  ],
});

// position<2 的输出（修正型：应被钳到 2）
const RANKING_POSITION_FIX = JSON.stringify({
  title: '排行榜',
  content: '内容',
  confidence: 0.7,
  entries: [
    {company: '目标企业', position: 1, reasons: ['r'], sourceFactIds: [1], reasoning_text: '评语'},
    {company: '竞品B', position: 2, reasons: ['r'], sourceFactIds: [2], reasoning_text: '评语'},
  ],
});

// 非法 JSON
const INVALID_JSON = '这不是 JSON {{{';

// entries 不足（拒绝型）
const RANKING_ENTRIES_TOO_FEW = JSON.stringify({
  title: '排行榜',
  content: '内容',
  confidence: 0.5,
  entries: [
    {company: '目标企业', position: 2, reasons: ['r'], sourceFactIds: [1], reasoning_text: '评语'},
  ],
});

// 从 mock chatFn 的第 n 次调用中提取 messages / opts。
// node:test 的 mock.calls[].arguments 被推断为空元组，这里用 any 取值。
function callMessages(mockFn: any, n: number): any[] {
  return mockFn.mock.calls[n].arguments[0] as any[];
}
function callOpts(mockFn: any, n: number): any {
  return mockFn.mock.calls[n].arguments[1];
}
function callArg(mockFn: any, n: number, idx: number): any {
  return mockFn.mock.calls[n].arguments[idx];
}
function userContentOf(mockFn: any, n: number): string {
  return callMessages(mockFn, n).find((m) => m.role === 'user').content;
}
function systemContentOf(mockFn: any, n: number): string {
  return callMessages(mockFn, n).find((m) => m.role === 'system').content;
}

describe('runMdDrivenSkill (#59)', () => {
  test('title-generation（needsKb:false）：无 KB 注入，合法输出全链路通过', async () => {
    const chatFn = mock.fn(async () => ({content: TITLE_VALID, model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => {
      throw new Error('不应为 needsKb:false 调 buildEvidencePack');
    });

    const result = await runMdDrivenSkill('title-generation', {
      projectId: undefined,
      taskArgs: {projectName: '测试企业', targetQuestion: '云服务怎么选？'},
      chatFn,
      buildEvidencePack,
    });

    assert.equal(result.ok, true);
    assert.equal(buildEvidencePack.mock.calls.length, 0, 'needsKb:false 不应调 buildEvidencePack');
    assert.equal(chatFn.mock.calls.length, 1, '合法输出应只调一次 chat');
    // 验证 user 段不含 evidence（仅 taskText）
    const userContent = userContentOf(chatFn, 0);
    assert.ok(!userContent.includes('企业事实'), 'needsKb:false user 段不应含 evidence');
    assert.ok(userContent.includes('云服务怎么选？'), 'user 段应含 taskText');
    // 验证 system 段含 SKILL.md 正文（title-generation）+ soul 身份
    const systemContent = systemContentOf(chatFn, 0);
    assert.ok(systemContent.length > 0, 'system 段非空');
    // 验证 responseFormat 为 json_object
    const opts = callOpts(chatFn, 0);
    assert.equal(opts?.responseFormat, 'json_object');
  });

  test('ranking-article-generation（needsKb:true）：注入 evidence + taskText，合法输出通过', async () => {
    const chatFn = mock.fn(async () => ({content: RANKING_VALID, model: 'mock'}));
    const fakeEvidence = {
      projectId: 1,
      query: '问题',
      facts: [{factId: 1, factType: '产品', factKey: '产品A', factValue: '云服务', confidence: 0.9}],
      chunks: [],
      missingFields: [],
      riskWarnings: [],
    };
    const buildEvidencePack = mock.fn(async () => fakeEvidence);

    const result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: 1,
      taskArgs: {projectName: '目标企业', targetQuestion: '云服务排行榜', competitors: ['竞品A']},
      chatFn,
      buildEvidencePack,
    });

    assert.equal(result.ok, true);
    assert.equal(buildEvidencePack.mock.calls.length, 1, 'needsKb:true 应调 buildEvidencePack');
    assert.equal(callArg(buildEvidencePack, 0, 0), 1, 'buildEvidencePack 传 projectId');
    assert.equal(chatFn.mock.calls.length, 1);
    // user 段含 evidenceText + taskText，用 --- 分隔
    const userContent = userContentOf(chatFn, 0);
    assert.ok(userContent.includes('企业事实'), 'user 段应含 evidenceText');
    assert.ok(userContent.includes('云服务排行榜'), 'user 段应含 taskText');
    assert.ok(userContent.includes('\n\n---\n\n'), 'evidence 与 taskText 应以 --- 分隔');
  });

  test('ranking（needsKb:true）但 projectId 为空：跳过 KB，仅 taskText', async () => {
    const chatFn = mock.fn(async () => ({content: RANKING_VALID, model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => {
      throw new Error('projectId 为空不应调 buildEvidencePack');
    });

    const result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: undefined,
      taskArgs: {projectName: '目标企业', targetQuestion: '问题', competitors: []},
      chatFn,
      buildEvidencePack,
    });

    assert.equal(result.ok, true);
    assert.equal(buildEvidencePack.mock.calls.length, 0, '无 projectId 不应调 buildEvidencePack');
    const userContent = userContentOf(chatFn, 0);
    assert.ok(!userContent.includes('企业事实'), '无 projectId user 段不应含 evidence');
  });

  test('非法 JSON → validate 拦截 → 重试 → 第 2 次合法通过', async () => {
    const responses = [INVALID_JSON, TITLE_VALID];
    let callIdx = 0;
    const chatFn = mock.fn(async () => ({content: responses[callIdx++], model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => {
      throw new Error('不应调');
    });

    const result = await runMdDrivenSkill('title-generation', {
      projectId: undefined,
      taskArgs: {projectName: '企业', targetQuestion: '问题'},
      chatFn,
      buildEvidencePack,
    });

    assert.equal(result.ok, true);
    assert.equal(chatFn.mock.calls.length, 2, '应重试一次共 2 次 chat');
    // 第 2 次 user 段应含 errors 回灌
    const secondUser = userContentOf(chatFn, 1);
    assert.ok(
      secondUser.toLowerCase().includes('error') || secondUser.includes('错误') || secondUser.includes('JSON'),
      '重试时 user 段应回灌 errors',
    );
  });

  test('连续 3 次失败 → 上限 2 次重试后报错（ok:false）', async () => {
    const chatFn = mock.fn(async () => ({content: INVALID_JSON, model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => {
      throw new Error('不应调');
    });

    const result = await runMdDrivenSkill('title-generation', {
      projectId: undefined,
      taskArgs: {projectName: '企业', targetQuestion: '问题'},
      chatFn,
      buildEvidencePack,
    });

    assert.equal(result.ok, false);
    assert.equal(chatFn.mock.calls.length, 3, '共 3 次（1 初始 + 2 重试）');
    assert.ok(result.errors.length > 0, '应返回 errors');
  });

  test('ranking position<2 修正型：validate 静默钳到 2，ok:true', async () => {
    const chatFn = mock.fn(async () => ({content: RANKING_POSITION_FIX, model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => ({
      projectId: 1, query: '', facts: [], chunks: [], missingFields: [], riskWarnings: [],
    }));

    const result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: 1,
      taskArgs: {projectName: '目标企业', targetQuestion: '问题', competitors: ['竞品B']},
      chatFn,
      buildEvidencePack,
    });

    assert.equal(result.ok, true);
    const data = (result as any).data;
    const target = data.entries.find((e: any) => e.company === '目标企业');
    assert.equal(target.position, 2, 'position 应被钳到 2');
  });

  test('ranking entries<2 拒绝型：重试上限后 ok:false', async () => {
    const chatFn = mock.fn(async () => ({content: RANKING_ENTRIES_TOO_FEW, model: 'mock'}));
    const buildEvidencePack = mock.fn(async () => ({
      projectId: 1, query: '', facts: [], chunks: [], missingFields: [], riskWarnings: [],
    }));

    const result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: 1,
      taskArgs: {projectName: '企业', targetQuestion: '问题', competitors: []},
      chatFn,
      buildEvidencePack,
    });

    assert.equal(result.ok, false);
    assert.equal(chatFn.mock.calls.length, 3);
  });
});
