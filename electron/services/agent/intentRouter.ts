/**
 * intentRouter.ts
 *
 * Routes a user message to a specific Skill via a three-tier fallback chain:
 *
 *   1. **Rule match** — match user message keywords against each Skill's
 *      `capabilities` identifiers and `description`. The candidates are first
 *      filtered by the current project's `domain` (Skills whose `domains`
 *      array is empty or contains the project domain are eligible).
 *
 *   2. **Semantic match** — if no rule hits, send a compact summary of each
 *      candidate Skill (`name + description`) plus the user message to the
 *      DeepSeek model (`chat` role) and ask it to pick the best Skill.
 *
 *   3. **Fallback** — if neither rule nor semantic routing produces a result,
 *      return `{type: 'fallback', mode: 'status_diagnosis'}` so the caller can
 *      render a status/diagnostic response instead of failing.
 *
 * The router builds an in-memory routing table at startup by scanning
 * `skills/<name>/SKILL.md` files. Skills that fail to parse are skipped with
 * a warning so that one broken skill doesn't take down the entire router.
 */

import {chat} from '../llmService';
import {loadAllSkills, type LoadedSkill} from './skillRegistry';
import type {SkillDomain} from './skillRegistry';
import {blockHookForRoute} from './allowedActionPolicy';

// ── Public types ─────────────────────────────────────────────────────────────

export type RouteResult =
  | {type: 'skill'; skillName: string; params: Record<string, unknown>; confidence: number}
  | {type: 'blocked'; skillName: string; reason: string}
  | {type: 'fallback'; mode: 'status_diagnosis'};

export interface RouteContext {
  projectDomain?: string | null;
  projectId?: number;
}

/**
 * Optional policy hook evaluated after rule/semantic match but before the
 * router returns `{type:'skill'}`. If the hook returns a non-null string the
 * router emits `{type:'blocked', skillName, reason: <that string>}` instead.
 *
 * When `route()` is called without an explicit hook, the router automatically
 * uses `allowedActionPolicy.blockHookForRoute(context)` (T5), so every route
 * is gated by the Skill-level precondition policy. Pass your own hook to
 * override (e.g. a future runtime layer that composes additional rules).
 */
export type BlockPolicyHook = (skillName: string, context: RouteContext) => string | null;

// ── Routing table ────────────────────────────────────────────────────────────

interface RouteEntry {
  skill: LoadedSkill;
  /** Lowercased token set built from capabilities + description, for cheap keyword match. */
  tokens: Set<string>;
}

let _routeTable: RouteEntry[] | null = null;

/**
 * Tokenise a string into lowercase alphanumeric/CJK segments.
 * Chinese characters are kept as 1- or 2-char shingles to allow keyword hits
 * on phrases like "生成问题".
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // Latin/digit runs
  const latinMatches = lower.match(/[a-z0-9_]+/g);
  if (latinMatches) tokens.push(...latinMatches);

  // CJK runs — emit both the full run and 2-char shingles so partial matches hit
  const cjkMatches = lower.match(/[一-鿿]+/g);
  if (cjkMatches) {
    for (const run of cjkMatches) {
      if (run.length >= 2) {
        tokens.push(run);
        for (let i = 0; i < run.length - 1; i++) {
          tokens.push(run.slice(i, i + 2));
        }
      } else {
        tokens.push(run);
      }
    }
  }

  return tokens;
}

function buildRouteEntry(skill: LoadedSkill): RouteEntry {
  const tokenSet = new Set<string>();
  for (const capability of skill.frontmatter.capabilities) {
    for (const token of tokenize(capability)) tokenSet.add(token);
    // Also add the raw capability identifier (e.g. "generate_questions") as-is
    tokenSet.add(capability.toLowerCase());
  }
  for (const token of tokenize(skill.frontmatter.description)) {
    tokenSet.add(token);
  }
  return {skill, tokens: tokenSet};
}

/**
 * Loads the route table. Skills that fail to parse are skipped with a warning.
 */
function getRouteTable(): RouteEntry[] {
  if (_routeTable) return _routeTable;

  let skills: LoadedSkill[] = [];
  try {
    skills = loadAllSkills();
  } catch (err) {
    // loadAllSkills throws on first validation error; log and try to continue
    // with whatever was loaded before the throw (best-effort). Since the
    // registry caches successful loads, we can fall back to a partial table.
    console.error('[intentRouter] failed to load skills, routing table may be incomplete:', err);
    skills = [];
  }

  _routeTable = skills.map(buildRouteEntry);
  return _routeTable;
}

/** Test-only: reset the cached route table. */
export function _resetRouteTable(): void {
  _routeTable = null;
}

// ── Domain filtering ─────────────────────────────────────────────────────────

function filterByDomain(entries: RouteEntry[], projectDomain?: string | null): RouteEntry[] {
  if (!projectDomain) return entries;
  return entries.filter((e) => {
    const domains = e.skill.frontmatter.domains;
    if (!domains || domains.length === 0) return true;
    return domains.includes(projectDomain as SkillDomain);
  });
}

// ── Tier 1: rule match ───────────────────────────────────────────────────────

/**
 * Computes a simple overlap score between user message tokens and a route
 * entry's token set. Higher is better.
 */
function scoreEntry(userTokens: string[], entry: RouteEntry): number {
  let score = 0;
  for (const token of userTokens) {
    if (entry.tokens.has(token)) {
      // Weight longer tokens more heavily — "生成问题" is more specific than "问题"
      score += token.length >= 4 ? 3 : token.length >= 2 ? 2 : 1;
    }
  }
  return score;
}

interface RuleMatchCandidate {
  entry: RouteEntry;
  score: number;
}

function ruleMatch(userMessage: string, candidates: RouteEntry[]): RuleMatchCandidate | null {
  const userTokens = tokenize(userMessage);
  if (userTokens.length === 0) return null;

  let best: RuleMatchCandidate | null = null;
  for (const entry of candidates) {
    const score = scoreEntry(userTokens, entry);
    if (score > 0 && (best === null || score > best.score)) {
      best = {entry, score};
    }
  }

  // Require a minimum score to avoid weak one-token hits
  if (best && best.score >= 2) return best;
  return null;
}

// ── Tier 2: semantic match ───────────────────────────────────────────────────

interface SemanticPickResponse {
  skill?: string;
  confidence?: number;
}

/**
 * Calls DeepSeek with a compact summary of candidate Skills and asks it to
 * pick the one that best matches the user message. Returns null on any error.
 */
async function semanticMatch(
  userMessage: string,
  candidates: RouteEntry[],
): Promise<{skillName: string; confidence: number} | null> {
  if (candidates.length === 0) return null;

  const summary = candidates
    .map((c, idx) => `${idx + 1}. name=${c.skill.dirName} description=${c.skill.frontmatter.description}`)
    .join('\n');

  const messages = [
    {
      role: 'system' as const,
      content: `你是一个意图路由助手。用户消息和若干候选 Skill 列表将一并提供，请判断哪个 Skill 最能处理用户消息。
要求：
1. 仅以 JSON 输出：{"skill": "<skill name>", "confidence": 0.0-1.0}
2. 如果没有任何 Skill 合适，输出 {"skill": null, "confidence": 0}
3. 只从给定的 Skill name 中选择，不要编造`,
    },
    {
      role: 'user' as const,
      content: `用户消息：${userMessage}\n\n候选 Skill：\n${summary}`,
    },
  ];

  try {
    const response = await chat('chat', messages, {responseFormat: 'json_object'});
    const parsed = JSON.parse(response.content) as SemanticPickResponse;
    if (parsed && typeof parsed.skill === 'string' && parsed.skill.length > 0) {
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
      // Verify the returned skill name is in our candidate set
      const found = candidates.find((c) => c.skill.dirName === parsed.skill);
      if (found) {
        return {skillName: found.skill.dirName, confidence};
      }
    }
    return null;
  } catch (err) {
    console.warn('[intentRouter] semantic match failed, falling back:', err);
    return null;
  }
}

// ── Public route() ───────────────────────────────────────────────────────────

/**
 * Routes a user message to a Skill. See file header for the three-tier chain.
 *
 * @param userMessage 用户输入的原始消息
 * @param context      当前项目上下文（domain 用于过滤候选集）
 * @param blockHook    optional T5 hook — return a non-null reason string to
 *                     emit `{type:'blocked', skillName, reason}` instead of a
 *                     skill route.
 */
export async function route(
  userMessage: string,
  context: RouteContext = {},
  blockHook?: BlockPolicyHook,
): Promise<RouteResult> {
  const allEntries = getRouteTable();
  const candidates = filterByDomain(allEntries, context.projectDomain ?? null);

  if (candidates.length === 0) {
    return {type: 'fallback', mode: 'status_diagnosis'};
  }

  // Tier 1 — rule match
  const ruleHit = ruleMatch(userMessage, candidates);
  if (ruleHit) {
    return resolveWithPolicy(
      ruleHit.entry.skill.dirName,
      context,
      blockHook,
      0.5 + ruleHit.score * 0.1,
    );
  }

  // Tier 2 — semantic match (DeepSeek). Failure must not throw.
  const semanticHit = await semanticMatch(userMessage, candidates);
  if (semanticHit) {
    return resolveWithPolicy(semanticHit.skillName, context, blockHook, semanticHit.confidence);
  }

  // Tier 3 — fallback
  return {type: 'fallback', mode: 'status_diagnosis'};
}

/**
 * After a rule or semantic match, evaluate the block policy hook. If the hook
 * returns a reason string the router returns `blocked`; otherwise the skill
 * route is emitted.
 *
 * When the caller does not supply an explicit `blockHook`, the router falls
 * back to `allowedActionPolicy.blockHookForRoute(context)` so every `route()`
 * call is automatically gated by the Skill-level precondition policy (T5).
 * Callers that pass their own hook take precedence.
 */
function resolveWithPolicy(
  skillName: string,
  context: RouteContext,
  blockHook?: BlockPolicyHook,
  confidence: number = 0.5,
): RouteResult {
  const effectiveHook = blockHook ?? blockHookForRoute(context);
  const reason = effectiveHook(skillName, context);
  if (reason !== null) {
    return {type: 'blocked', skillName, reason};
  }
  return {type: 'skill', skillName, params: {}, confidence: Math.min(0.99, confidence)};
}
