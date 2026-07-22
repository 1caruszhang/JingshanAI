import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';
import type {TitleCandidate} from '@/types/domain';

export interface TitleGenerationInput {
  projectName: string;
  targetQuestion: string;
  evidencePack: EvidencePack;
}

const TitleItemSchema = z.object({
  titleText: z.string(),
  score: z.number().min(0).max(1),
  intent: z.string(),
  notes: z.string().optional(),
});

const OutputSchema = z.object({
  titles: z.array(TitleItemSchema),
});

const SYSTEM_PROMPT = `你是企业 GEO 优化标题专家。基于目标问题和企业事实，生成 3-5 个标题候选并评分。
标题原则：
1. 像用户向 AI 提问的方式，包含决策意图（推荐/怎么选/哪家好/排行榜）
2. 与正文内容一致，不虚构排名或数据
3. 简洁有力，适合作为文章标题或问答标题
以 JSON 格式输出：{"titles": [{"titleText": "...", "score": 0.85, "intent": "推荐", "notes": "可选说明"}]}`;

function formatFacts(evidencePack: EvidencePack): string {
  if (evidencePack.facts.length === 0) {
    return '（暂无相关企业事实）';
  }
  return evidencePack.facts
    .slice(0, 5)
    .map((f) => `${f.factType} · ${f.factKey}：${f.factValue ?? ''}`)
    .join('\n');
}

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function generateTitles(
  input: TitleGenerationInput,
): Promise<TitleCandidate[]> {
  const userPrompt = `企业名称：${input.projectName}
目标问题：${input.targetQuestion}
企业事实摘要：
${formatFacts(input.evidencePack)}

请生成标题候选。`;

  let response;
  try {
    response = await chat(
      'title_generation',
      [
        {role: 'system', content: SYSTEM_PROMPT},
        {role: 'user', content: userPrompt},
      ],
      {responseFormat: 'json_object'},
    );
  } catch (err) {
    console.error('[title-generation] LLM call failed:', err);
    return [];
  }

  const parsed = safeParseJson(response.content);
  if (!parsed) {
    console.error('[title-generation] Failed to parse JSON response');
    return [];
  }

  const validated = OutputSchema.safeParse(parsed);
  if (!validated.success) {
    console.error('[title-generation] Schema validation failed:', validated.error.message);
    return [];
  }

  return validated.data.titles as TitleCandidate[];
}
