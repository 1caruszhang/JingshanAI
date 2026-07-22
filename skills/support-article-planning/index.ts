import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

// prompt-contract version: support-article-planning.prompt-contract.v1

export interface SupportArticlePlanningInput {
  projectName: string;
  supportArticleType: string;
  targetQuestion: string;
  evidencePack: EvidencePack;
}

export interface SupportArticlePlanningOutput {
  outline: string;
  keyPoints: string[];
  suggestedLength: number;
}

const OutputSchema = z.object({
  outline: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1),
  suggestedLength: z.number().int().positive(),
});

const SYSTEM_PROMPT = `你是企业 GEO 内容规划师。你的任务是在撰写支持类文章前，先制定一份清晰的内容规划方案。

规划要求：
1. 根据目标问题和企业事实，生成结构化的文章大纲（Markdown 格式，含标题层级）。
2. 提炼 3-6 个核心要点（keyPoints），每个要点是一个简洁的陈述。
3. 根据内容丰富程度，给出建议的文章字数（suggestedLength，中文字数，范围 500-3000）。
4. 以 JSON 格式输出，不要包含任何解释文字。`;

function formatEvidence(evidence: EvidencePack): string {
  const factPart =
    evidence.facts.length > 0
      ? evidence.facts
          .map(
            (f, i) =>
              `[^F${i + 1}^] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`,
          )
          .join('\n')
      : '（暂无相关企业事实）';

  const chunkPart =
    evidence.chunks.length > 0
      ? evidence.chunks
          .slice(0, 5)
          .map(
            (c, i) =>
              `[^${i + 1}^] 标题：${c.entryTitle}\n内容摘要：${c.chunkText.slice(0, 200)}`,
          )
          .join('\n\n---\n\n')
      : '（暂无相关参考资料）';

  return `企业事实：\n${factPart}\n\n参考资料摘要：\n\n${chunkPart}`;
}

export async function planSupportArticle(
  input: SupportArticlePlanningInput,
): Promise<SupportArticlePlanningOutput> {
  const userPrompt = `项目：${input.projectName}
文章子类型：${input.supportArticleType}
目标问题：${input.targetQuestion}

${formatEvidence(input.evidencePack)}

请制定文章规划，输出 JSON：
{
  "outline": "# 标题\\n## 一级章节\\n### 二级章节...",
  "keyPoints": ["核心要点1", "核心要点2", "..."],
  "suggestedLength": 1200
}`;

  const response = await chat(
    'article_generation',
    [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    {responseFormat: 'json_object'},
  );

  const parsed = safeParseJson(response.content);
  if (!parsed) {
    throw new Error('文章规划模型返回了非法 JSON');
  }

  const validated = OutputSchema.parse(parsed) as SupportArticlePlanningOutput;
  return validated;
}

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
