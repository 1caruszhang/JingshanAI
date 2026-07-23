/**
 * intentRouter.ts
 *
 * Routes a user message to a specific intent via a three-tier fallback chain
 * backed by the declarative `SKILL_ROUTES` table (#56):
 *
 *   1. **Phrase match** — substring `includes` of each route's `keywords`
 *      (complete phrases, lowercased) against the lowercased user message.
 *      Tokenise/shingle scoring is retired. On multiple hits the longest
 *      phrase wins; ties break by table order. At least one phrase must hit
 *      to settle on Tier 1.
 *
 *   2. **Semantic match** — if no phrase hits, send the user message plus each
 *      candidate route's `trigger` to the chat model with the
 *      `intent_router.md` system prompt and ask it to pick the best intent +
 *      confidence. A confidence below 0.6 is treated as no route. The chat
 *      call is injectable via `opts.chatFn` so tests can stub it.
 *
 *   3. **Clarify / Fallback** — if Tier 2 produced low-confidence candidates
 *      (≥ 0.3 but < 0.6) the router returns `{type:'clarify', candidates}`;
 *      otherwise it returns `{type:'fallback', mode:'status_diagnosis'}`.
 *
 * `route()` is the single intent→skill decision entry point. It is NOT yet
 * wired into the runtime — the runtime still calls `routeLegacy` (the old
 * shingle-based router) until the cutover ticket (#62) flips the switch.
 *
 * Precondition gating is folded into `resolveWithPolicy`, which reuses
 * `allowedActionPolicy.blockHookForRoute` so every route is gated by the
 * Skill-level precondition policy.
 */

import {chat} from '../llmService.ts';
import {loadAllSkills, type LoadedSkill} from './skillRegistry.ts';
import type {SkillDomain} from './skillRegistry.ts';
import {blockHookForRoute} from './allowedActionPolicy.ts';
import {loadPrompt} from '../../prompts/loader.ts';
import {SKILL_ROUTES, type SkillRoute, getRouteBySkillDir} from './skillRoutes.ts';

// ── Public types ─────────────────────────────────────────────────────────────

export type RouteKind = 'md-driven' | 'service' | 'pause';

export interface RouteCandidate {
  intent: string;
  confidence: number;
}

export type RouteResult =
  | {
      type: 'skill';
      /** skillDir for md-driven intents, intent id for service/pause. */
      skillName: string;
      params: Record<string, unknown>;
      confidence: number;
      kind: RouteKind;
      migrated: boolean;
    }
  | {type: 'blocked'; skillName: string; reason: string}
  | {type: 'clarify'; candidates: RouteCandidate[]}
  | {type: 'fallback'; mode: 'status_diagnosis'};

export interface RouteContext {
  projectDomain?: string | null;
  projectId?: number;
}

/**
 * Optional policy hook evaluated after phrase/semantic match but before the
 * router returns `{type:'skill'}`. If the hook returns a non-null string the
 * router emits `{type:'blocked', skillName, reason}` instead.
 *
 * When `route()` is called without an explicit hook, the router automatically
 * uses `allowedActionPolicy.blockHookForRoute(context)` so every route is
 * gated by the Skill-level precondition policy.
 */
export type BlockPolicyHook = (skillName: string, context: RouteContext) => string | null;

/**
 * Chat function shape used by Tier 2 semantic matching. Inject a mock via
 * `route(..., {chatFn})` for tests; defaults to the real `chat` call.
 */
export type ChatFn = (
  role: 'chat',
  messages: {role: 'system' | 'user'; content: string}[],
  options?: {responseFormat?: 'json_object'},
) => Promise<{content: string}>;

export interface RouteOptions {
  /** Override the Tier 2 chat call (tests inject a mock here). */
  chatFn?: ChatFn;
  /** Override the block policy hook (defaults to blockHookForRoute(context)). */
  blockHook?: BlockPolicyHook;
}

// ── Tier 1: phrase match ─────────────────────────────────────────────────────

interface PhraseHit {
  route: SkillRoute;
  phrase: string;
  /** Index of the route in SKILL_ROUTES — used to break ties by table order. */
  routeIndex: number;
}

/**
 * Substring-matches every route's keyword phrases against the lowercased
 * message. Returns all hits; the caller picks the winner (longest phrase,
 * ties broken by table order).
 */
function phraseHits(userMessage: string): PhraseHit[] {
  const lower = userMessage.toLowerCase();
  const hits: PhraseHit[] = [];
  SKILL_ROUTES.forEach((route, routeIndex) => {
    for (const phrase of route.keywords) {
      if (phrase.length > 0 && lower.includes(phrase.toLowerCase())) {
        hits.push({route, phrase, routeIndex});
      }
    }
  });
  return hits;
}

/**
 * Picks the winning phrase hit: longest phrase wins; ties break by table
 * order (lowest routeIndex, then first keyword declared).
 */
function pickPhraseWinner(hits: PhraseHit[]): PhraseHit | null {
  if (hits.length === 0) return null;
  let best: PhraseHit = hits[0];
  for (const hit of hits) {
    if (hit.phrase.length > best.phrase.length) {
      best = hit;
    } else if (hit.phrase.length === best.phrase.length && hit.routeIndex < best.routeIndex) {
      best = hit;
    }
  }
  return best;
}

// ── Tier 2: semantic match ───────────────────────────────────────────────────

interface SemanticPickResponse {
  intent?: string | null;
  confidence?: number;
}

/**
 * Calls the chat model with the `intent_router.md` system prompt and asks it
 * to pick the best-matching intent from the candidate triggers. Returns the
 * pick plus any low-confidence candidates (≥ 0.3, < 0.6) for the clarify tier.
 *
 * `chatFn` defaults to the real `chat` call; tests inject a mock.
 */
async function semanticMatch(
  userMessage: string,
  candidates: SkillRoute[],
  chatFn: ChatFn,
): Promise<{
  pick: {intent: string; confidence: number} | null;
  lowConfidence: RouteCandidate[];
}> {
  if (candidates.length === 0) {
    return {pick: null, lowConfidence: []};
  }

  const systemPrompt = loadPrompt('intent_router');
  const summary = candidates
    .map((c, idx) => `${idx + 1}. intent=${c.intent} trigger=${c.trigger}`)
    .join('\n');

  const messages = [
    {role: 'system' as const, content: systemPrompt},
    {
      role: 'user' as const,
      content: `用户消息：${userMessage}\n\n候选意图：\n${summary}`,
    },
  ];

  let parsed: SemanticPickResponse;
  try {
    const response = await chatFn('chat', messages, {responseFormat: 'json_object'});
    parsed = JSON.parse(response.content) as SemanticPickResponse;
  } catch (err) {
    console.warn('[intentRouter] semantic match failed, falling back:', err);
    return {pick: null, lowConfidence: []};
  }

  if (!parsed || typeof parsed.intent !== 'string' || parsed.intent.length === 0) {
    return {pick: null, lowConfidence: []};
  }

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const found = candidates.find((c) => c.intent === parsed.intent);
  if (!found) {
    return {pick: null, lowConfidence: []};
  }

  // A pick below the 0.6 route threshold but ≥ 0.3 is kept as a low-confidence
  // candidate so Tier 3 can surface a clarify result instead of a hard fallback.
  const lowConfidence: RouteCandidate[] =
    confidence >= 0.3 && confidence < 0.6 ? [{intent: found.intent, confidence}] : [];

  return {pick: {intent: found.intent, confidence}, lowConfidence};
}

// ── Policy resolution ────────────────────────────────────────────────────────

/**
 * After a phrase or semantic match, evaluate the block policy hook against the
 * resolved route. If the hook returns a reason string the router emits
 * `blocked`; otherwise the skill route is emitted with `kind` + `migrated`
 * carried through from the route row.
 *
 * When the caller does not supply an explicit `blockHook`, the router falls
 * back to `allowedActionPolicy.blockHookForRoute(context)` so every `route()`
 * call is automatically gated by the Skill-level precondition policy.
 *
 * Precondition expressions on the route row are evaluated by the policy's
 * snapshot — service/pause intents declare their own preconditions here so
 * they are gated identically to md-driven skills.
 */
function resolveWithPolicy(
  routeRow: SkillRoute,
  context: RouteContext,
  blockHook: BlockPolicyHook,
  confidence: number,
): RouteResult {
  const skillName = routeRow.skillDir ?? routeRow.intent;
  const reason = blockHook(skillName, context);
  if (reason !== null) {
    return {type: 'blocked', skillName, reason};
  }
  return {
    type: 'skill',
    skillName,
    params: {},
    confidence: Math.min(0.99, confidence),
    kind: routeRow.kind,
    migrated: routeRow.migrated,
  };
}

// ── Public route() ───────────────────────────────────────────────────────────

/**
 * Routes a user message to an intent. See file header for the three-tier chain.
 *
 * @param userMessage 用户输入的原始消息
 * @param context     当前项目上下文（用于 precondition 校验）
 * @param opts        可选 chatFn（注入 mock 用于测试）与 blockHook
 */
export async function route(
  userMessage: string,
  context: RouteContext = {},
  opts: RouteOptions = {},
): Promise<RouteResult> {
  const effectiveHook = opts.blockHook ?? blockHookForRoute(context);
  const effectiveChatFn: ChatFn = opts.chatFn ?? defaultChatFn;

  // Tier 1 — phrase match (complete-phrase substring includes).
  const hits = phraseHits(userMessage);
  const winner = pickPhraseWinner(hits);
  if (winner) {
    return resolveWithPolicy(winner.route, context, effectiveHook, 0.9);
  }

  // Tier 2 — semantic match (chat model over triggers, threshold 0.6).
  const {pick, lowConfidence} = await semanticMatch(userMessage, [...SKILL_ROUTES], effectiveChatFn);
  if (pick && pick.confidence >= 0.6) {
    const routeRow = SKILL_ROUTES.find((r) => r.intent === pick.intent);
    if (routeRow) {
      return resolveWithPolicy(routeRow, context, effectiveHook, pick.confidence);
    }
  }

  // Tier 3 — clarify (low-confidence candidates) or fallback.
  if (lowConfidence.length > 0) {
    return {type: 'clarify', candidates: lowConfidence};
  }
  return {type: 'fallback', mode: 'status_diagnosis'};
}

/** Default chat call used when no `chatFn` is injected. */
const defaultChatFn: ChatFn = async (role, messages, options) => {
  const response = await chat(role, messages, options);
  return {content: response.content};
};

// ── Re-exports ───────────────────────────────────────────────────────────────

export {SKILL_ROUTES, type SkillRoute, getRouteBySkillDir};

// =============================================================================
// Legacy router (pre-#56). Retained verbatim because `geoAgentRuntime` still
// calls it; the cutover ticket (#62) removes it once the runtime switches to
// the new `route()`. Do not add new callers — use `route()` above.
// =============================================================================

// ── Legacy routing table ─────────────────────────────────────────────────────

interface LegacyRouteEntry {
  skill: LoadedSkill;
  tokens: Set<string>;
}

let _routeTable: LegacyRouteEntry[] | null = null;

/**
 * Tokenise a string into lowercase alphanumeric/CJK segments.
 * Chinese characters are kept as 1- or 2-char shingles to allow keyword hits
 * on phrases like "生成问题".
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  const latinMatches = lower.match(/[a-z0-9_]+/g);
  if (latinMatches) tokens.push(...latinMatches);

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

function buildRouteEntry(skill: LoadedSkill): LegacyRouteEntry {
  const tokenSet = new Set<string>();
  for (const capability of skill.frontmatter.capabilities ?? []) {
    for (const token of tokenize(capability)) tokenSet.add(token);
    tokenSet.add(capability.toLowerCase());
  }
  for (const token of tokenize(skill.frontmatter.description)) {
    tokenSet.add(token);
  }
  return {skill, tokens: tokenSet};
}

function getRouteTable(): LegacyRouteEntry[] {
  if (_routeTable) return _routeTable;

  let skills: LoadedSkill[] = [];
  try {
    skills = loadAllSkills();
  } catch (err) {
    console.error('[intentRouter] failed to load skills, routing table may be incomplete:', err);
    skills = [];
  }

  _routeTable = skills.map(buildRouteEntry);
  return _routeTable;
}

/** Test-only: reset the cached legacy route table. */
export function _resetRouteTable(): void {
  _routeTable = null;
}

function filterByDomain(entries: LegacyRouteEntry[], projectDomain?: string | null): LegacyRouteEntry[] {
  if (!projectDomain) return entries;
  return entries.filter((e) => {
    const domains = e.skill.frontmatter.domains;
    if (!domains || domains.length === 0) return true;
    return domains.includes(projectDomain as SkillDomain);
  });
}

function scoreEntry(userTokens: string[], entry: LegacyRouteEntry): number {
  let score = 0;
  for (const token of userTokens) {
    if (entry.tokens.has(token)) {
      score += token.length >= 4 ? 3 : token.length >= 2 ? 2 : 1;
    }
  }
  return score;
}

interface LegacyRuleCandidate {
  entry: LegacyRouteEntry;
  score: number;
}

function ruleMatch(userMessage: string, candidates: LegacyRouteEntry[]): LegacyRuleCandidate | null {
  const userTokens = tokenize(userMessage);
  if (userTokens.length === 0) return null;

  let best: LegacyRuleCandidate | null = null;
  for (const entry of candidates) {
    const score = scoreEntry(userTokens, entry);
    if (score > 0 && (best === null || score > best.score)) {
      best = {entry, score};
    }
  }

  if (best && best.score >= 2) return best;
  return null;
}

/**
 * Legacy route() — shingle-based router retained for the runtime until #62.
 * New code and tests should use `route()` (the #56 rewrite) instead.
 */
export async function routeLegacy(
  userMessage: string,
  context: RouteContext = {},
  blockHook?: BlockPolicyHook,
): Promise<
  | {type: 'skill'; skillName: string; params: Record<string, unknown>; confidence: number}
  | {type: 'blocked'; skillName: string; reason: string}
  | {type: 'fallback'; mode: 'status_diagnosis'}
> {
  const allEntries = getRouteTable();
  const candidates = filterByDomain(allEntries, context.projectDomain ?? null);

  if (candidates.length === 0) {
    return {type: 'fallback', mode: 'status_diagnosis'};
  }

  const ruleHit = ruleMatch(userMessage, candidates);
  if (ruleHit) {
    const effectiveHook = blockHook ?? blockHookForRoute(context);
    const reason = effectiveHook(ruleHit.entry.skill.dirName, context);
    if (reason !== null) {
      return {type: 'blocked', skillName: ruleHit.entry.skill.dirName, reason};
    }
    return {
      type: 'skill',
      skillName: ruleHit.entry.skill.dirName,
      params: {},
      confidence: Math.min(0.99, 0.5 + ruleHit.score * 0.1),
    };
  }

  // Legacy semantic match kept inline to preserve runtime behaviour exactly.
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
    const parsed = JSON.parse(response.content) as {skill?: string; confidence?: number};
    if (parsed && typeof parsed.skill === 'string' && parsed.skill.length > 0) {
      const found = candidates.find((c) => c.skill.dirName === parsed.skill);
      if (found) {
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
        const effectiveHook = blockHook ?? blockHookForRoute(context);
        const reason = effectiveHook(found.skill.dirName, context);
        if (reason !== null) {
          return {type: 'blocked', skillName: found.skill.dirName, reason};
        }
        return {
          type: 'skill',
          skillName: found.skill.dirName,
          params: {},
          confidence: Math.min(0.99, confidence),
        };
      }
    }
  } catch (err) {
    console.warn('[intentRouter] semantic match failed, falling back:', err);
  }

  return {type: 'fallback', mode: 'status_diagnosis'};
}
