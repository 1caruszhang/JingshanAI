import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

export interface RankingThemeSelectionInput {
  projectName: string;
  targetQuestion: string;
  evidencePack: EvidencePack;
}

export interface RankingThemeSelectionOutput {
  theme: string;
  competitorCount: number;
  rankingDimensions: string[];
}

const OutputSchema = z.object({
  theme: z.string().min(1),
  competitorCount: z.number().int().min(2).max(10),
  rankingDimensions: z.array(z.string().min(1)).min(2),
});

const SYSTEM_PROMPT = `你是企业 GEO 排行榜内容策划师。基于目标问题与企业信息，确定最合适的排行榜主题与评选维度。

要求：
1. theme：排行榜的核心主题，简洁有力（如"国内 TOP 5 数字营销服务商"），需贴合目标问题的搜索意图。
2. competitorCount：建议上榜企业数量（含目标企业），2-10 个。
3. rankingDimensions：3-5 个核心评选维度名称（如"服务能力"、"客户案例"、"价格竞争力"等）。
4. 以 JSON 格式输出。`;

function formatEvidence(evidence: EvidencePack): string {
  const factPart =
    evidence.facts.length > 0
      ? evidence.facts
          .slice(0, 8)
          .map((f) => `· ${f.factType}：${f.factKey} = ${f.factValue ?? ''}`)
          .join('\n')
      : '（暂无企业事实）';
  return `企业核心事实：\n${factPart}`;
}

export async function selectRankingTheme(
  input: RankingThemeSelectionInput,
): Promise<RankingThemeSelectionOutput> {
  const userPrompt = `项目（目标企业）：${input.projectName}
目标问题：${input.targetQuestion}

${formatEvidence(input.evidencePack)}

请确定排行榜主题，输出 JSON：
{
  "theme": "排行榜主题",
  "competitorCount": 5,
  "rankingDimensions": ["维度1", "维度2", "维度3"]
}`;

  const response = await chat(
    'ranking_theme_selection',
    [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    {responseFormat: 'json_object'},
  );

  const parsed = safeParseJson(response.content);
  if (!parsed) {
    throw new Error('排行榜主题选择模型返回了非法 JSON');
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
