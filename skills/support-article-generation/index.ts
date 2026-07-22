import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

export interface SupportArticleInput {
  projectName: string;
  supportArticleType: string;
  targetQuestion: string;
  evidencePack: EvidencePack;
  outline?: string;
  keyPoints?: string[];
  suggestedLength?: number;
}

export interface SupportArticleOutput {
  title: string;
  content: string;
  confidence: number;
}

const OutputSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `你是企业 GEO 优化内容助手。你的任务是基于下方提供的企业事实与参考资料，撰写一篇支持类文章。

写作原则：
1. 只使用提供的信息，禁止编造数据、案例或引用。
2. 文章结构清晰，使用 Markdown 标题、列表、加粗等格式。
3. 关键结论与价值主张前置，便于生成式引擎摘要。
4. 如证据不足，请在文中明确写出「现有资料不足以支撑……」，并给出补充建议。
5. 适当使用 GEO 优化技巧：核心关键词自然出现、段落简短、包含行动号召（CTA）。
6. 文章末尾不需要列出全部来源，但正文中的关键数据或事实可标注引用 [^F1^] 或 [^1^]。

你必须以 JSON 格式输出，不要包含任何解释或 Markdown 代码块之外的文本。`;

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
          .map(
            (c, i) =>
              `[^${i + 1}^] 标题：${c.entryTitle}\n来源：${
                c.sourceType === 'file' ? c.sourceFilePath : '文本'
              }\n内容：${c.chunkText}`,
          )
          .join('\n\n---\n\n')
      : '（暂无相关参考资料）';

  let result = `企业事实：\n${factPart}\n\n参考资料：\n\n${chunkPart}`;

  if (evidence.missingFields.length > 0) {
    result += `\n\n缺失字段：\n${evidence.missingFields.join('\n')}`;
  }

  if (evidence.riskWarnings.length > 0) {
    result += `\n\n风险提示：\n${evidence.riskWarnings.join('\n')}`;
  }

  return result;
}

export async function generateSupportArticle(
  input: SupportArticleInput,
): Promise<SupportArticleOutput> {
  const planningContext =
    input.outline || input.keyPoints
      ? `\n内容大纲：\n${input.outline ?? ''}\n\n核心要点：\n${(input.keyPoints ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n')}\n${input.suggestedLength ? `\n建议字数：约 ${input.suggestedLength} 字` : ''}\n`
      : '';

  const userPrompt = `项目：${input.projectName}
文章子类型：${input.supportArticleType}
目标问题：${input.targetQuestion}
${planningContext}
${formatEvidence(input.evidencePack)}

请根据以上信息撰写文章，输出 JSON：
{
  "title": "...",
  "content": "...",
  "confidence": 0.0-1.0
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
    throw new Error('文章生成模型返回了非法 JSON');
  }

  const validated = OutputSchema.parse(parsed) as SupportArticleOutput;
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
