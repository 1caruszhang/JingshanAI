import {FACT_TYPES, FACT_TYPE_LABELS, isFactType, type FactType} from './factTypes.ts';

export const FACT_EXTRACTION_PROMPT_VERSION = 'fact-extraction.prompt-contract.v1';
export const FACT_ONTOLOGY_PROMPT_VERSION = 'fact-ontology.prompt-contract.v1';

export interface FactChunkContext {
  chunkId: number;
  entryId: number;
  entryTitle: string;
  chunkText: string;
}

/**
 * Builds the `fact_type` reference list shown to the LLM. When `factTypes` is
 * provided (domain-narrowed), only those types are listed; otherwise the full
 * ontology is used.
 */
function buildFactTypeList(factTypes?: readonly string[]): string {
  const types = (factTypes && factTypes.length > 0 ? factTypes : FACT_TYPES).filter((t) =>
    isFactType(t as string),
  ) as readonly string[];
  return types.map((t) => `- ${t}: ${FACT_TYPE_LABELS[t as FactType]}`).join('\n');
}

export function buildFactExtractionMessages(context: {
  chunks: FactChunkContext[];
  projectName?: string;
  /** Optional domain-narrowed set; when omitted the full FACT_TYPES is used. */
  factTypes?: readonly string[];
}): {system: string; user: string} {
  const factTypeList = buildFactTypeList(context.factTypes);

  const chunkBlocks = context.chunks
    .map(
      (c, idx) =>
        `【片段 ${idx + 1}】\nchunk_id: ${c.chunkId}\n来源条目: ${c.entryTitle}\n内容:\n${c.chunkText}`,
    )
    .join('\n\n---\n\n');

  const system = `你是一位企业信息结构化提取专家。请严格根据用户提供的文本片段，抽取企业的关键经营事实。

可抽取的事实类型（fact_type）必须是以下枚举之一，不能自由创造：
${factTypeList}

输出要求：
1. 输出必须是合法的 JSON 对象，不要包含任何 Markdown 代码块或解释性文字。
2. JSON 结构为：{"facts": [...], "missing_fields": [...], "risk_warnings": [...]}
3. 每条事实必须包含以下字段：
   - fact_type: 事实类型（必须是上面枚举之一）
   - fact_value: 提取的事实值，保持原文语义，可适当精简但不得编造
   - source_chunk_id: 来源片段的 chunk_id（整数）
   - source_quote: 从对应片段中直接复制的原文短语或句子，必须能在原文中精确找到
   - confidence: 置信度（0.0 - 1.0）
   - reasoning_note: 简要说明抽取理由
4. 如果同一条信息在多个片段出现，只保留最完整、置信度最高的一条。
5. 不要输出 project_id、source_entry_id 等字段。
6. missing_fields: 从上述枚举中列出文本中明显缺失的关键类型。
7. risk_warnings: 如果信息存在矛盾、联系方式不完整、地址模糊等情况，请给出简短警告。

注意：source_quote 必须真实存在于输入片段中，否则该事实无效。`;

  const user = `请从以下企业资料片段中抽取事实：${context.projectName ? `\n企业/项目：${context.projectName}` : ''}

${chunkBlocks}`;

  return {system, user};
}

export function buildOntologyFillMessages(context: {
  chunks: FactChunkContext[];
  projectName?: string;
  alreadyFilledTypes: readonly string[];
}): {system: string; user: string} {
  const {chunks, projectName, alreadyFilledTypes} = context;

  const alreadyFilledSet = new Set(alreadyFilledTypes);
  const missingTypes = FACT_TYPES.filter((t) => !alreadyFilledSet.has(t));

  const missingFieldList =
    missingTypes.length > 0
      ? missingTypes.map((t) => `- ${t}: ${FACT_TYPE_LABELS[t as FactType]}`).join('\n')
      : '（全部已填写）';

  const filledFieldList =
    alreadyFilledTypes.length > 0
      ? alreadyFilledTypes.map((t) => `- ${t}: ${FACT_TYPE_LABELS[t as FactType] ?? t}`).join('\n')
      : '（无）';

  const chunkBlocks = chunks
    .map(
      (c, idx) =>
        `【片段 ${idx + 1}】\nchunk_id: ${c.chunkId}\n来源条目: ${c.entryTitle}\n内容:\n${c.chunkText}`,
    )
    .join('\n\n---\n\n');

  const system = `你是一位企业信息结构化提取专家。用户已通过表单手动填写了部分企业事实字段，请你仅从提供的文档片段中补全尚未填写的缺失字段。

已有手填字段（不需要再提取，跳过即可）：
${filledFieldList}

需要从文档中提取的缺失字段（fact_type 必须是以下之一）：
${missingFieldList}

完整可用的事实类型参考：
${buildFactTypeList()}

输出要求：
1. 输出必须是合法的 JSON 对象，不要包含任何 Markdown 代码块或解释性文字。
2. JSON 结构为：{"facts": [...], "missing_fields": [...], "risk_warnings": [...]}
3. 每条事实必须包含以下字段：
   - fact_type: 事实类型（必须是"需要从文档中提取的缺失字段"列表中的某一个）
   - fact_value: 提取的事实值，保持原文语义，可适当精简但不得编造
   - source_chunk_id: 来源片段的 chunk_id（整数）
   - source_quote: 从对应片段中直接复制的原文短语或句子，必须能在原文中精确找到
   - confidence: 置信度（0.0 - 1.0）
   - reasoning_note: 简要说明抽取理由
4. 仅抽取以上"缺失字段"列表中的字段，不要抽取已有手填字段。
5. 如果文档中找不到某个缺失字段的信息，在 missing_fields 中列出该字段。
6. risk_warnings: 如果信息存在矛盾、联系方式不完整、地址模糊等情况，请给出简短警告。
7. source_quote 必须真实存在于输入片段中，否则该事实无效。`;

  const user = `请从以下企业资料片段中补全缺失字段：${projectName ? `\n企业/项目：${projectName}` : ''}

${chunkBlocks}`;

  return {system, user};
}
