import {z} from 'zod';
import {safeParseJson} from '../../electron/prompts/jsonUtils.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

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

/**
 * md-driven 校验层（#57）的输出类型。
 */
export type TitleGenerationOutput = z.infer<typeof OutputSchema>;

/**
 * validate 的返回类型：成功返回结构化数据，失败返回错误信息列表。
 */
export type ValidationResult =
  | {ok: true; data: TitleGenerationOutput}
  | {ok: false; errors: string[]};

/**
 * md-driven 校验层（#57）：接收 LLM 原始输出文本（或已解析对象），
 * 经 JSON parse → Zod safeParse 后返回 ok/data 或 ok:false/errors。
 *
 * IPC 路径已在 #64 迁移到 runMdDrivenSkill('title-generation', ...)，
 * 旧的 generateTitles 已删除。
 */
export async function validate(
  rawOutput: string | unknown,
  _ctx?: unknown,
): Promise<ValidationResult> {
  let parsed: unknown = rawOutput;
  if (typeof rawOutput === 'string') {
    parsed = safeParseJson(rawOutput);
    if (parsed === null) {
      return {
        ok: false,
        errors: ['JSON parse failed: invalid JSON'],
      };
    }
  }

  const result = OutputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
    };
  }

  return {ok: true, data: result.data};
}
