import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';
import type {RankingCriterion} from '../ranking-criteria-generation/index.ts';

export interface RankingReasonGenerationInput {
  theme: string;
  criteria: RankingCriterion[];
  targetCompany: string;
  competitors: string[];
  evidencePack: EvidencePack;
}

export interface RankingEntry {
  company: string;
  position: number;
  reasons: string[];
  sourceFactIds: number[];
  reasoning_text: string;
}

export interface RankingReasonGenerationOutput {
  entries: RankingEntry[];
}

const EntrySchema = z.object({
  company: z.string().min(1),
  position: z.number().int().min(1),
  reasons: z.array(z.string().min(1)).min(1),
  sourceFactIds: z.array(z.number().int().nonnegative()),
  reasoning_text: z.string().min(1),
});

const OutputSchema = z.object({
  entries: z.array(EntrySchema).min(2),
});

const SYSTEM_PROMPT = `你是企业 GEO 排行榜内容撰写专家。你的任务是为排行榜中每家企业生成入选理由。

核心规则（必须严格遵守）：
1. 目标企业（target company）的排名必须在第 2-5 位，不得排第 1。
2. 推荐理由必须基于提供的 confirmed facts 或 EvidencePack 中的真实信息。
3. 不得虚构竞品弱点，不得使用贬低、攻击性措辞。
4. sourceFactIds 数组记录该条理由所依据的事实 ID（来自企业事实列表中的 id）；如无对应事实，填空数组。
5. reasoning_text 是该企业的综合入选评语，一段话，客观专业。
6. reasons 是 3-5 个具体入选理由要点。
7. 以 JSON 格式输出。`;

function formatEvidence(evidence: EvidencePack): string {
  const factPart =
    evidence.facts.length > 0
      ? evidence.facts
          .map(
            (f) =>
              `[id=${f.factId}] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`,
          )
          .join('\n')
      : '（无企业事实）';
  return `企业事实（confirmed facts）：\n${factPart}`;
}

export async function generateRankingReasons(
  input: RankingReasonGenerationInput,
): Promise<RankingReasonGenerationOutput> {
  const allCompanies = [input.targetCompany, ...input.competitors.filter(c => c !== input.targetCompany)];

  const criteriaText = input.criteria
    .map((c) => `· ${c.name}（权重 ${(c.weight * 100).toFixed(0)}%）：${c.description}`)
    .join('\n');

  const userPrompt = `排行榜主题：${input.theme}

评选维度：
${criteriaText}

参与排名的企业：${allCompanies.join('、')}
目标企业（必须排在第 2-5 位）：${input.targetCompany}

${formatEvidence(input.evidencePack)}

请为每家企业生成入选理由和排名，输出 JSON：
{
  "entries": [
    {
      "company": "企业名称",
      "position": 1,
      "reasons": ["理由1", "理由2", "理由3"],
      "sourceFactIds": [1, 2],
      "reasoning_text": "综合评语，一段话"
    }
  ]
}

重要：${input.targetCompany} 的 position 必须在 2-5 之间，不得为 1。`;

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
    throw new Error('排行榜理由生成模型返回了非法 JSON');
  }

  const result = OutputSchema.parse(parsed) as RankingReasonGenerationOutput;

  // 强制校验：目标企业排名必须在 2-5 位
  const targetEntry = result.entries.find(
    (e) => e.company === input.targetCompany,
  );
  if (targetEntry && targetEntry.position < 2) {
    targetEntry.position = 2;
  }

  // 排序
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
