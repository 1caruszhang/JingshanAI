/**
 * allowedActionPolicy.ts
 *
 * Skill-level precondition gate, evaluated between the moment `intentRouter`
 * resolves a Skill and the moment that Skill actually executes. If any
 * declared precondition is not satisfied against the live project state, the
 * policy blocks the Skill and returns a human-readable reason so the caller
 * can surface `{type:'blocked', skillName, reason}` to the user instead of
 * entering Skill execution.
 *
 * Precondition expressions are read from each Skill's `SKILL.md` frontmatter
 * `preconditions` array (see `skillRegistry.ts`). The initial version supports
 * four expression shapes by literal match:
 *
 *   - `confirmed_facts_count > 0`   — project has ≥1 confirmed fact
 *   - `selected_question_exists`     — question_pools has a `selected` row
 *   - `has_knowledge_entries`        — project has ≥1 knowledge entry
 *   - `has_approved_draft`           — project has an `approved` article artifact
 *
 * Any unrecognised expression (e.g. `evidence_pack_available`,
 * `ranking_entries_count >= 2`) is **fail-open**: the policy returns `null`
 * (satisfied) rather than risk blocking the MVP flow on an unimplemented
 * evaluator. Subsequent tickets can plug in more evaluators without touching
 * callers.
 *
 * The project state snapshot is read from SQLite on every call — no caching.
 * `projectId` is optional; when absent the snapshot is all-zero / all-false so
 * every project-scoped precondition fails (the global chat path has no
 * project state to satisfy).
 */

import {getDb} from '../../db/connection.ts';
import {getSkill, loadAllSkills} from './skillRegistry.ts';
import type {BlockPolicyHook, RouteContext} from './intentRouter.ts';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Live project-state snapshot. Every field is read straight from SQLite at
 * call time; callers must not cache this between requests.
 */
export interface ProjectStateSnapshot {
  confirmedFactsCount: number;
  hasSelectedQuestion: boolean;
  hasKnowledgeEntries: boolean;
  hasApprovedDraft: boolean;
}

export interface PolicyContext {
  projectId?: number | null;
  projectDomain?: string | null;
}

export interface ActionAllowedResult {
  allowed: boolean;
  reason?: string;
}

// ── Snapshot provider (injectable for tests) ─────────────────────────────────

/**
 * Reads the live project state from SQLite. Overridable via
 * `setSnapshotProviderForTests` so smoke tests can inject a fake snapshot
 * without standing up a real database.
 */
let _snapshotProvider: (projectId: number | null) => ProjectStateSnapshot = defaultSnapshotProvider;

/**
 * Default implementation: queries SQLite directly. No caching — every call
 * re-reads from the DB so the policy always reflects current state.
 */
function defaultSnapshotProvider(projectId: number | null): ProjectStateSnapshot {
  if (projectId === null) {
    // No project context → every project-scoped precondition fails.
    return {
      confirmedFactsCount: 0,
      hasSelectedQuestion: false,
      hasKnowledgeEntries: false,
      hasApprovedDraft: false,
    };
  }

  const db = getDb();

  const confirmedFactsRow = db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'",
    )
    .get(projectId) as {cnt: number} | undefined;
  const confirmedFactsCount = confirmedFactsRow?.cnt ?? 0;

  const selectedQuestionRow = db
    .prepare(
      "SELECT 1 AS hit FROM question_pools WHERE project_id = ? AND status = 'selected' LIMIT 1",
    )
    .get(projectId) as {hit: number} | undefined;
  const hasSelectedQuestion = selectedQuestionRow !== undefined;

  const knowledgeEntryRow = db
    .prepare('SELECT 1 AS hit FROM knowledge_entries WHERE project_id = ? LIMIT 1')
    .get(projectId) as {hit: number} | undefined;
  const hasKnowledgeEntries = knowledgeEntryRow !== undefined;

  const approvedDraftRow = db
    .prepare(
      "SELECT 1 AS hit FROM agent_artifacts WHERE project_id = ? AND status = 'approved' LIMIT 1",
    )
    .get(projectId) as {hit: number} | undefined;
  const hasApprovedDraft = approvedDraftRow !== undefined;

  return {
    confirmedFactsCount,
    hasSelectedQuestion,
    hasKnowledgeEntries,
    hasApprovedDraft,
  };
}

/**
 * Test-only: replace the snapshot provider. Pass a function that returns a
 * fixed `ProjectStateSnapshot` regardless of `projectId` to exercise the
 * evaluators without a database. Restore with `resetSnapshotProviderForTests`.
 */
export function setSnapshotProviderForTests(
  provider: (projectId: number | null) => ProjectStateSnapshot,
): void {
  _snapshotProvider = provider;
}

/** Test-only: restore the default SQLite snapshot provider. */
export function resetSnapshotProviderForTests(): void {
  _snapshotProvider = defaultSnapshotProvider;
}

// ── Precondition evaluators ──────────────────────────────────────────────────

/**
 * Evaluates a single precondition expression against a snapshot.
 *
 * @returns `null` when satisfied, or a human-readable Chinese reason string
 *          describing the missing precondition when not satisfied.
 *
 * Unknown expressions are fail-open (return `null`).
 */
export function evaluatePrecondition(expr: string, snapshot: ProjectStateSnapshot): string | null {
  const trimmed = expr.trim();

  // `confirmed_facts_count > 0` (and `>= 1`, `> N` for N>=0 — we only support
  // the "at least one" semantic in the initial version; numeric comparisons
  // beyond 0 fall through to fail-open).
  if (trimmed === 'confirmed_facts_count > 0' || trimmed === 'confirmed_facts_count >= 1') {
    if (snapshot.confirmedFactsCount === 0) {
      return '当前项目缺少已确认事实，请先完成事实抽取和确认';
    }
    return null;
  }

  if (trimmed === 'selected_question_exists') {
    if (!snapshot.hasSelectedQuestion) {
      return '当前项目缺少已选定的目标问题，请先在问题池中选定至少一个问题';
    }
    return null;
  }

  if (trimmed === 'has_knowledge_entries') {
    if (!snapshot.hasKnowledgeEntries) {
      return '当前项目缺少知识库条目，请先录入企业资料';
    }
    return null;
  }

  if (trimmed === 'has_approved_draft') {
    if (!snapshot.hasApprovedDraft) {
      return '当前项目缺少已审核通过的文章草稿';
    }
    return null;
  }

  // Unknown expression — fail-open so unimplemented evaluators don't block
  // the MVP flow. Logged at debug level via console for visibility.
  console.debug(`[allowedActionPolicy] unknown precondition, fail-open: ${trimmed}`);
  return null;
}

// ── Skill-level checks ───────────────────────────────────────────────────────

/**
 * Resolves the live snapshot for a given context. Centralised so all entry
 * points share the same projectId handling.
 */
function snapshotForContext(context: PolicyContext): ProjectStateSnapshot {
  const projectId =
    typeof context.projectId === 'number' && Number.isFinite(context.projectId)
      ? context.projectId
      : null;
  return _snapshotProvider(projectId);
}

/**
 * Evaluates every precondition declared on a Skill's frontmatter and returns
 * the first unsatisfied one's reason, or `null` if all are satisfied.
 *
 * Skill lookup is fail-open: an unknown skill name returns `null` (the router
 * decides what to do with unknown skills; the policy doesn't second-guess it).
 *
 * @param skillName  Skill directory name (== frontmatter `name`)
 * @param context    Current project context
 */
export function checkSkillPreconditions(skillName: string, context: PolicyContext): string | null {
  const skill = getSkill(skillName);
  if (!skill) {
    return null;
  }

  const preconditions = skill.frontmatter.preconditions;
  if (!preconditions || preconditions.length === 0) {
    return null;
  }

  const snapshot = snapshotForContext(context);
  for (const expr of preconditions) {
    const reason = evaluatePrecondition(expr, snapshot);
    if (reason !== null) {
      return reason;
    }
  }
  return null;
}

/**
 * Convenience wrapper returning a structured `{allowed, reason?}` result.
 */
export function isActionAllowed(
  skillName: string,
  context: PolicyContext,
): ActionAllowedResult {
  const reason = checkSkillPreconditions(skillName, context);
  if (reason !== null) {
    return {allowed: false, reason};
  }
  return {allowed: true};
}

/**
 * Returns the list of Skills currently allowed under the given context — i.e.
 * every loaded Skill whose declared preconditions all pass. Non-empty stub
 * replacement: iterates `loadAllSkills()` rather than returning `[]`.
 */
export function getAllowedActions(context: PolicyContext): string[] {
  return loadAllSkills()
    .filter((s) => isActionAllowed(s.dirName, context).allowed)
    .map((s) => s.dirName);
}

// ── intentRouter bridge ──────────────────────────────────────────────────────

/**
 * Builds a `BlockPolicyHook` for `intentRouter.route()`. The hook runs the
 * full precondition check for the resolved Skill and returns the blocking
 * reason (or `null` to allow).
 *
 * Callers that already pass their own `blockHook` to `route()` take
 * precedence — `intentRouter` falls back to this hook only when no explicit
 * hook is supplied.
 */
export function blockHookForRoute(context: RouteContext): BlockPolicyHook {
  const policyContext: PolicyContext = {
    projectId: context.projectId ?? null,
    projectDomain: context.projectDomain ?? null,
  };
  return (skillName: string) => checkSkillPreconditions(skillName, policyContext);
}
