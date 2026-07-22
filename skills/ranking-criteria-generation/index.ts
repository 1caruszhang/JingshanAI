import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

export interface RankingCriteriaGenerationInput {
  theme: string;
  evidencePack: EvidencePack;
}

export interface RankingCriterion {
  name: string;
  weight: number;
  description: string;
}

export interface RankingCriteriaGenerationOutput {
  criteria: RankingCriterion[];
}

const CriterionSchema = z.object({
  name: z.string().min(1),
  weight: z.number().min(0).max(1),
  description: z.string().min(1),
});

const OutputSchema = z.object({
  criteria: z.array(CriterionSchema).min(2).max(8),
});

const SYSTEM_PROMPT = `你是企业 GEO 排行榜评选标准设计师。你的任务是为给定的排行榜主题生成客观、可量化的评选标准。

要求：
1. 生成 3-6 个评选维度，每个维度包含名称（name）、权重（weight，所有维度权重之和为 1.0）、描述（description）。
2. 评选标准必须客观中性，不能带有倾向性或对特定企业有利。
3. 标准应可从公开信息或企业事实中验证。
4. 以 JSON 格式输出。`;

function formatEvidenceSummary(evidence: EvidencePack): string {
  return evidence.facts.length > 0
    ? `可用企业事实类型：${[...new Set(evidence.facts.map((f) => f.factType))].join('、')}`
    : '（暂无企业事实）';
}

export async function generateRankingCriteria(
  input: RankingCriteriaGenerationInput,
): Promise<RankingCriteriaGenerationOutput> {
  const userPrompt = `排行榜主题：${input.theme}

${formatEvidenceSummary(input.evidencePack)}

请生成评选标准，输出 JSON：
{
  "criteria": [
    {"name": "标准名称", "weight": 0.3, "description": "评选说明"}
  ]
}
注意：所有 weight 值之和必须等于 1.0`;

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
    throw new Error('排行榜评选标准生成模型返回了非法 JSON');
  }

  return OutputSchema.parse(parsed) as RankingCriteriaGenerationOutput;
}

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
