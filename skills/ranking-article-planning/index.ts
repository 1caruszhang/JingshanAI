import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {RankingEntry} from '../ranking-reason-generation/index.ts';

export interface RankingArticlePlanningInput {
  theme: string;
  entries: RankingEntry[];
  targetQuestion: string;
}

export interface RankingArticlePlanningOutput {
  outline: string;
  structure: string[];
}

const OutputSchema = z.object({
  outline: z.string().min(1),
  structure: z.array(z.string().min(1)).min(2),
});

const SYSTEM_PROMPT = `你是企业 GEO 排行榜文章规划师。基于已生成的排行榜数据，设计一篇适合生成式引擎摘要的排行榜文章结构。

要求：
1. outline：详细的 Markdown 大纲，包含完整标题层级和每节要点。
2. structure：文章各节的标题列表（顶层章节）。
3. 文章结构应符合 GEO 优化原则：开门见山、结论前置、使用列表与表格。
4. 以 JSON 格式输出。`;

export async function planRankingArticle(
  input: RankingArticlePlanningInput,
): Promise<RankingArticlePlanningOutput> {
  const entriesSummary = input.entries
    .map(
      (e) =>
        `第 ${e.position} 名：${e.company}（${e.reasons.slice(0, 2).join('、')}）`,
    )
    .join('\n');

  const userPrompt = `排行榜主题：${input.theme}
目标问题：${input.targetQuestion}

排行榜数据摘要：
${entriesSummary}

请设计文章结构，输出 JSON：
{
  "outline": "# 标题\\n## 引言\\n## TOP N 排行榜\\n### 第 1 名...",
  "structure": ["引言", "排行榜概览", "详细评析", "总结建议"]
}`;

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
    throw new Error('排行榜文章规划模型返回了非法 JSON');
  }

  return OutputSchema.parse(parsed);
}

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
