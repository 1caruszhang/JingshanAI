import {z} from 'zod';
import {chat} from '../../electron/services/llmService.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

// prompt-contract version: claim-source-mapping.prompt-contract.v1

export interface ClaimSourceMappingInput {
  claimText: string;
  evidencePack: EvidencePack;
}

export interface MappedSource {
  sourceType: 'fact' | 'chunk';
  sourceId: number;
  sourceQuote: string;
  confidence: number;
}

const MappedSourceSchema = z.object({
  sourceType: z.enum(['fact', 'chunk']),
  sourceId: z.number().int().positive(),
  sourceQuote: z.string(),
  confidence: z.number().min(0).max(1),
});

const OutputSchema = z.array(MappedSourceSchema);

const SYSTEM_PROMPT = `你是企业内容溯源助手。你的任务是为文章中的某个 Claim（断言），从提供的证据库中找到最相关的来源，并精确引用原文片段。

要求：
1. 从给出的「企业事实」和「参考资料」中找出与 Claim 最直接相关的条目（最多 3 条）。
2. 对每条来源，截取最能支撑该 Claim 的原文片段（sourceQuote，不超过 200 字）。
3. 给出置信度评分（confidence，0-1），表示该来源对 Claim 的支撑程度。
4. 若没有任何相关来源，返回空数组。
5. 以 JSON 数组格式输出，不要包含其他文字。`;

function formatEvidenceForMapping(evidence: EvidencePack): string {
  const factEntries =
    evidence.facts.length > 0
      ? evidence.facts
          .map(
            (f) =>
              `[FACT id=${f.factId}] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`,
          )
          .join('\n')
      : '（无企业事实）';

  const chunkEntries =
    evidence.chunks.length > 0
      ? evidence.chunks
          .map(
            (c) =>
              `[CHUNK id=${c.chunkId}] 标题：${c.entryTitle}\n内容：${c.chunkText.slice(0, 300)}`,
          )
          .join('\n\n---\n\n')
      : '（无参考资料）';

  return `企业事实：\n${factEntries}\n\n参考资料：\n${chunkEntries}`;
}

export async function mapClaimSources(
  input: ClaimSourceMappingInput,
): Promise<MappedSource[]> {
  const evidenceText = formatEvidenceForMapping(input.evidencePack);

  if (input.evidencePack.facts.length === 0 && input.evidencePack.chunks.length === 0) {
    return [];
  }

  const userPrompt = `需要溯源的 Claim：
"${input.claimText}"

证据库：
${evidenceText}

请找出支撑该 Claim 的来源，输出 JSON 数组：
[
  {"sourceType": "fact|chunk", "sourceId": <id>, "sourceQuote": "原文片段", "confidence": 0.0-1.0}
]`;

  const response = await chat(
    'claim_parsing',
    [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    {responseFormat: 'json_object'},
  );

  const parsed = safeParseJson(response.content);
  if (!Array.isArray(parsed)) {
    // LLM 可能返回 {"sources": [...]} 格式
    const obj = parsed as Record<string, unknown> | null;
    if (obj && Array.isArray(obj['sources'])) {
      return validateSources(obj['sources']);
    }
    return [];
  }

  return validateSources(parsed);
}

function validateSources(raw: unknown[]): MappedSource[] {
  try {
    return OutputSchema.parse(raw) as MappedSource[];
  } catch {
    // 过滤掉结构不合规的条目
    return raw
      .map((item) => {
        try {
          return MappedSourceSchema.parse(item) as MappedSource;
        } catch {
          return null;
        }
      })
      .filter((s): s is MappedSource => s !== null);
  }
}

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
