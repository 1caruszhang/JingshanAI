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
 * `route()` is the single intent→skill decision entry point, wired into the
 * runtime by the #62 cutover. Precondition gating is folded into
 * `resolveWithPolicy`, which reuses `allowedActionPolicy.blockHookForRoute`
 * so every route is gated by the Skill-level precondition policy.
 */

import {chat} from '../llmService.ts';
import {blockHookForRoute} from './allowedActionPolicy.ts';
import {loadPrompt} from '../../prompts/loader.ts';
import {SKILL_ROUTES, type SkillRoute, type RouteKind, getRouteBySkillDir} from './skillRoutes.ts';

// ── Public types ─────────────────────────────────────────────────────────────

// RouteKind 的唯一定义在 skillRoutes.ts；这里 re-export 供 intentRouter 的调用方
// 从任一模块导入均得到同一类型。
export type {RouteKind};

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

