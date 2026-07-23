import {z} from 'zod';
import {safeParseJson} from '../../electron/prompts/jsonUtils.ts';
import type {EvidencePack} from '../../electron/services/ragService.ts';

export interface RankingEntryOutput {
  company: string;
  position: number;
  reasons: string[];
  sourceFactIds: number[];
  reasoning_text: string;
}

export interface RankingArticleGenerationOutput {
  title: string;
  content: string;
  confidence: number;
  entries: RankingEntryOutput[];
}

const EntrySchema = z.object({
  company: z.string().min(1),
  position: z.number().int().min(1),
  reasons: z.array(z.string().min(1)).min(1),
  sourceFactIds: z.array(z.number().int().nonnegative()),
  reasoning_text: z.string().min(1),
});

const OutputSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  entries: z.array(EntrySchema).min(2),
});

// ── md-driven validate layer (#58) ──────────────────────────────────────────
//
// The skill's hard constraints live in SKILL.md (## 硬约束). This validate
// function is the runtime enforcement layer invoked after the LLM produces a
// raw output string. It performs:
//   1. JSON parse (拒绝型 on failure)
//   2. Zod safeParse — entries<2 is rejected here via .min(2) (拒绝型)
//   3. position clamp to [2,5] — 修正型, silently corrected
//   4. entries.sort by position
//
// Return type:
//   - { ok: true; data }  for valid / correctable output
//   - { ok: false; errors: string[] }  for rejected output

export type ValidationResult =
  | {ok: true; data: RankingArticleGenerationOutput}
  | {ok: false; errors: string[]};

/**
 * Validation context. Reserved for future use (e.g. fact-id existence checks
 * against the Evidence Pack). Currently unused but kept on the signature so
 * callers can pass it through uniformly across skills.
 */
export interface ValidationContext {
  evidencePack?: EvidencePack;
}

/**
 * Validate the raw LLM output of the ranking-article-generation skill.
 *
 * Hard-constraint typing:
 *  - 修正型 (corrective): position outside [2,5] is silently clamped into range.
 *  - 拒绝型 (rejecting): entries count < 2 (via Zod min(2)) or any Zod failure
 *    or JSON parse failure → ok:false.
 *
 * Accepts either a JSON string or an already-parsed object.
 */
export async function validate(
  rawOutput: string | Record<string, unknown>,
  _ctx?: ValidationContext,
): Promise<ValidationResult> {
  // 1. JSON parse (拒绝型 on failure)
  let parsed: unknown;
  if (typeof rawOutput === 'string') {
    parsed = safeParseJson(rawOutput);
    if (parsed === null) {
      return {ok: false, errors: ['排行榜文章输出不是合法 JSON']};
    }
  } else {
    parsed = rawOutput;
  }

  // 2. Zod safeParse — entries<2 rejected here (拒绝型)
  const result = OutputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
    };
  }

  const data = result.data as RankingArticleGenerationOutput;

  // 3. position clamp to [2,5] — 修正型, silent correction
  for (const entry of data.entries) {
    if (entry.position < 2) {
      entry.position = 2;
    } else if (entry.position > 5) {
      entry.position = 5;
    }
  }

  // 4. sort by position ascending
  data.entries.sort((a, b) => a.position - b.position);

  return {ok: true, data};
}
