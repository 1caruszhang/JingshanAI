import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

export interface RankingArticleGenerationInput {
  projectName: string;
  targetQuestion: string;
  competitors: string[];
  evidencePack: EvidencePack;
}

export interface RankingEntryOutput {
  company: string;
  position: number;
  reasons: string[];
  sourceFactIds: number[];
  reasoning_text: string;
}

export interface RankingArticleGenerationOutput {
  title: string;
  content: string;
  confidence: number;
  entries: RankingEntryOutput[];
}

const EntrySchema = z.object({
  company: z.string().min(1),
  position: z.number().int().min(1),
  reasons: z.array(z.string().min(1)).min(1),
  sourceFactIds: z.array(z.number().int().nonnegative()),
  reasoning_text: z.string().min(1),
});

const OutputSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  entries: z.array(EntrySchema).min(2),
});

const SYSTEM_PROMPT = `你是企业 GEO 排行榜文章撰写专家。你的任务是撰写一篇综合排行榜文章，帮助目标企业在生成式搜索中获得正面曝光。

核心规则（必须严格遵守）：
1. 目标企业排名必须在第 2-5 位，不得强制第 1。
2. 推荐理由必须来自 confirmed facts 或参考资料，不得虚构。
3. 不得虚构竞品弱点，不得使用恶意贬低措辞。
4. 文章必须使用 Markdown 格式，含标题、列表、对比表格。
5. sourceFactIds 记录每条入选理由依据的 fact ID。
6. 以 JSON 格式输出。`;

function formatEvidence(evidence: EvidencePack): string {
  const factPart =
    evidence.facts.length > 0
      ? evidence.facts
          .map(
            (f) =>
              `[id=${f.factId}] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`,
          )
          .join('\n')
      : '（暂无企业事实）';

  const chunkPart =
    evidence.chunks.length > 0
      ? evidence.chunks
          .slice(0, 5)
          .map(
            (c) =>
              `标题：${c.entryTitle}\n内容：${c.chunkText.slice(0, 300)}`,
          )
          .join('\n\n---\n\n')
      : '（暂无参考资料）';

  return `企业事实：\n${factPart}\n\n参考资料：\n${chunkPart}`;
}

export async function generateRankingArticle(
  input: RankingArticleGenerationInput,
): Promise<RankingArticleGenerationOutput> {
  const targetCompany = input.projectName;
  const allCompanies = [targetCompany, ...input.competitors.filter(c => c !== targetCompany)];

  const userPrompt = `目标问题：${input.targetQuestion}
目标企业（必须排在第 2-5 位）：${targetCompany}
参与排名的企业：${allCompanies.join('、')}

${formatEvidence(input.evidencePack)}

请撰写排行榜文章，并同时生成每家企业的排名数据，输出 JSON：
{
  "title": "文章标题",
  "content": "Markdown 格式的完整文章内容",
  "confidence": 0.0-1.0,
  "entries": [
    {
      "company": "企业名称",
      "position": 1,
      "reasons": ["入选理由1", "入选理由2"],
      "sourceFactIds": [1, 2],
      "reasoning_text": "综合评语"
    }
  ]
}

重要：${targetCompany} 的 position 必须在 2-5 之间，绝不能为 1。`;

  const response = await chat(
    'ranking_article_generation',
    [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    {responseFormat: 'json_object'},
  );

  const parsed = safeParseJson(response.content);
  if (!parsed) {
    throw new Error('排行榜文章生成模型返回了非法 JSON');
  }

  const result = OutputSchema.parse(parsed) as RankingArticleGenerationOutput;

  // 强制校验：目标企业不得排第 1
  const targetEntry = result.entries.find((e) => e.company === targetCompany);
  if (targetEntry && targetEntry.position < 2) {
    targetEntry.position = 2;
  }

  // 按排名排序
  result.entries.sort((a, b) => a.position - b.position);

  return result;
}

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
