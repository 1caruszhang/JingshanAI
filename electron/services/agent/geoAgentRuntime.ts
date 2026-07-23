/**
 * geoAgentRuntime.ts
 *
 * Agent-first Task Runtime — the top-level orchestrator that assembles every
 * Phase 9 sub-module into a complete loop.
 *
 *   user message
 *     → builtin intent match (MVP service-backed capabilities)
 *     → intentRouter.route()                  (skill-dir routing + policy gate)
 *       → 'skill'   → loopGuard → toolGuard → execute skill → confirmation card
 *       → 'blocked' → push policy reason message (no error)
 *       → 'fallback'→ read live project state → decision tree → suggestion
 *
 * Two routing layers run in order:
 *
 *   1. `matchBuiltinIntent` — keyword rules over the MVP service-backed
 *      capabilities (question.generate, article.generate, fact.extract, …,
 *      publish.plan). These capabilities are not represented as SKILL.md
 *      directories yet, so the skill-dir router cannot reach them. The
 *      builtin table carries its own precondition expressions so the same
 *      `allowedActionPolicy` gate that governs skill dirs governs these too.
 *
 *   2. `intentRouter.route()` — the skill-directory router (rule → semantic →
 *      fallback). Handles the GEO/ranking/support skill dirs that *do* have
 *      SKILL.md definitions.
 *
 * `createGeoAgent` is no longer called for Q&A — it stays in
 * `geoAgentFactory.ts` as the tool-registration entry point, and the runtime
 * invokes skill executors directly via `SKILL_EXECUTORS` so the toolGuard
 * risk gating, ledger audit, and approval cards fire exactly once per skill.
 *
 * Every state transition writes to `execution_ledger` (via `executionLedger`
 * for task-level events and via `toolGuard` for per-skill tool events), and
 * every agent task step is persisted to `agent_task_steps`.
 */

import {getDb} from '../../db/connection.ts';
import type {AgentTask, AgentTaskStep, StepStatus, StepType} from '@/types/domain';
import {routeLegacy as route, type RouteContext} from './intentRouter.ts';
import {checkLoopGuard} from './loopGuard.ts';
import * as executionLedger from './executionLedger.ts';
import {executeWithGuard, type GuardedToolCallResult} from './toolGuard.ts';
import {
  SKILL_EXECUTORS,
  getProjectRow,
  type AgentToolContext,
  type SkillExecutorArgs,
} from './geoAgentFactory.ts';
import {type PolicyContext, type ProjectStateSnapshot} from './allowedActionPolicy.ts';

export interface RunMinimalAgentOptions {
  projectId?: number;
  sessionId?: number;
  title?: string;
}

// ── Builtin intent table (MVP service-backed capabilities) ───────────────────
//
// These capabilities have backing services but no SKILL.md directory yet, so
// `intentRouter.route()` cannot resolve them. The runtime matches them with
// keyword rules BEFORE delegating to the skill-dir router, and runs the same
// `allowedActionPolicy` precondition gate so the policy reason (e.g.
// "缺少已确认事实") surfaces as a `blocked` result just like skill dirs do.
//
// `publish.plan` is the high-risk capability: it has no executor body, so the
// runtime writes the approval row itself, pauses the task, and pushes a
// blocking approval card — it never reaches `executeWithGuard`.

interface BuiltinIntent {
  /** Dotted executor id in SKILL_EXECUTORS, or 'publish.plan' for the pause path. */
  executorId: string;
  /** Keyword substrings (lowercased); any match wins. */
  keywords: string[];
  /** Precondition expressions, same vocabulary as SKILL.md frontmatter. */
  preconditions: string[];
  /** Risk level drives the approval-card behaviour. */
  riskLevel: 'low' | 'medium' | 'high';
}

const BUILTIN_INTENTS: BuiltinIntent[] = [
  {
    executorId: 'question.generate',
    keywords: ['生成问题', '问题池', '问题列表', '目标问题', 'generate question', 'question pool'],
    preconditions: ['confirmed_facts_count > 0'],
    riskLevel: 'low',
  },
  {
    executorId: 'article.generate',
    keywords: ['生成文章', '写文章', '文章生成', 'generate article', 'write article', '排行榜文章', '支持类文章'],
    preconditions: ['confirmed_facts_count > 0', 'selected_question_exists'],
    riskLevel: 'low',
  },
  {
    executorId: 'fact.extract',
    keywords: ['抽取事实', '事实抽取', 'extract fact', '抽取企业事实'],
    preconditions: ['has_knowledge_entries'],
    riskLevel: 'low',
  },
  {
    executorId: 'source.discover',
    keywords: ['信源', '参考信源', '发现信源', 'source discover', '推荐信源'],
    preconditions: ['selected_question_exists'],
    riskLevel: 'low',
  },
  {
    executorId: 'claim.review',
    keywords: ['claim 审核', '断言审核', '审核断言', 'claim review'],
    preconditions: [],
    riskLevel: 'low',
  },
  {
    executorId: 'geo.review',
    keywords: ['geo 审核', 'geo review', 'geo 优化审核', 'geo 质量审核'],
    preconditions: [],
    riskLevel: 'low',
  },
  {
    executorId: 'publish.plan',
    keywords: ['发布计划', '准备发布', 'publish plan', 'publish.plan', '发布审批'],
    preconditions: ['has_approved_draft'],
    riskLevel: 'high',
  },
];

interface BuiltinMatch {
  intent: BuiltinIntent;
  blockedReason: string | null;
}

/**
 * Keyword-matches the user message against the builtin intent table. Returns
 * the first matching intent (precedence = table order), or null.
 *
 * `blockedReason` is non-null when the intent's preconditions are not
 * satisfied against the live project state — the caller surfaces it exactly
 * like a skill-dir `blocked` route.
 */
function matchBuiltinIntent(
  userMessage: string,
  policyContext: PolicyContext,
): BuiltinMatch | null {
  const lower = userMessage.toLowerCase();
  for (const intent of BUILTIN_INTENTS) {
    if (!intent.keywords.some((kw) => lower.includes(kw.toLowerCase()))) continue;

    // Evaluate preconditions using the same policy as skill dirs.
    let blockedReason: string | null = null;
    for (const expr of intent.preconditions) {
      blockedReason = evaluatePreconditionAgainstProject(expr, policyContext);
      if (blockedReason !== null) break;
    }
    return {intent, blockedReason};
  }
  return null;
}

// Reads a ProjectStateSnapshot for builtin-intent precondition gating.
// Mirrors allowedActionPolicy's default snapshot provider; the evaluator
// itself is re-implemented inline below because allowedActionPolicy does not
// export evaluatePrecondition. Both must stay in sync with the policy's four
// supported expression shapes (fail-open for anything else).
function readProjectSnapshotForPolicy(projectId: number | null): ProjectStateSnapshot {
  if (projectId === null) {
    return {
      confirmedFactsCount: 0,
      hasSelectedQuestion: false,
      hasKnowledgeEntries: false,
      hasApprovedDraft: false,
    };
  }
  const db = getDb();
  const hit = (sql: string): boolean =>
    db.prepare(sql).get(projectId) !== undefined;

  const confirmedFactsRow = db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'",
    )
    .get(projectId) as {cnt: number} | undefined;

  return {
    confirmedFactsCount: confirmedFactsRow?.cnt ?? 0,
    hasSelectedQuestion: hit(
      "SELECT 1 AS hit FROM question_pools WHERE project_id = ? AND status = 'selected' LIMIT 1",
    ),
    hasKnowledgeEntries: hit('SELECT 1 AS hit FROM knowledge_entries WHERE project_id = ? LIMIT 1'),
    hasApprovedDraft: hit(
      "SELECT 1 AS hit FROM agent_artifacts WHERE project_id = ? AND status = 'approved' LIMIT 1",
    ),
  };
}

/**
 * Evaluates a single precondition expression against the live project state.
 * Mirrors allowedActionPolicy.evaluatePrecondition's four supported shapes
 * (fail-open for anything else) so builtin intents are gated identically to
 * skill dirs without reaching into the policy module's private evaluator.
 */
function evaluatePreconditionAgainstProject(
  expr: string,
  context: PolicyContext,
): string | null {
  const trimmed = expr.trim();
  const projectId =
    typeof context.projectId === 'number' && Number.isFinite(context.projectId)
      ? context.projectId
      : null;
  const s = readProjectSnapshotForPolicy(projectId);

  if (trimmed === 'confirmed_facts_count > 0' || trimmed === 'confirmed_facts_count >= 1') {
    return s.confirmedFactsCount === 0 ? '当前项目缺少已确认事实，请先完成事实抽取和确认' : null;
  }
  if (trimmed === 'selected_question_exists') {
    return !s.hasSelectedQuestion ? '当前项目缺少已选定的目标问题，请先在问题池中选定至少一个问题' : null;
  }
  if (trimmed === 'has_knowledge_entries') {
    return !s.hasKnowledgeEntries ? '当前项目缺少知识库条目，请先录入企业资料' : null;
  }
  if (trimmed === 'has_approved_draft') {
    return !s.hasApprovedDraft ? '当前项目缺少已审核通过的文章草稿' : null;
  }
  // Unknown expression — fail-open (matches allowedActionPolicy behaviour).
  return null;
}

// ── Skill directory → dotted executor id ────────────────────────────────────
//
// intentRouter resolves user messages to Skill **directory names** (the
// `name` field in SKILL.md frontmatter, e.g. `ranking-article-generation`).
// The executors registered in `SKILL_EXECUTORS` are keyed by the dotted
// capability identifiers used throughout the codebase. This map bridges the
// two vocabularies for the skill dirs that have a backing service.
//
// Skill dirs without an entry here have no executor yet; the runtime falls
// back to a graceful "能力暂未接入" message instead of throwing.
const SKILL_DIR_TO_EXECUTOR: Record<string, string> = {
  'ranking-article-generation': 'article.generate',
  'support-article-generation': 'article.generate',
  'support-article-planning': 'article.generate',
};

// ── Project state snapshot for status diagnosis ─────────────────────────────

interface DiagnosisSnapshot {
  hasKnowledgeEntries: boolean;
  confirmedFactsCount: number;
  hasSelectedQuestion: boolean;
  hasDraft: boolean;
  draftPendingReview: boolean;
  hasApprovedDraft: boolean;
}

function readDiagnosisSnapshot(projectId: number | null): DiagnosisSnapshot {
  if (projectId === null) {
    return {
      hasKnowledgeEntries: false,
      confirmedFactsCount: 0,
      hasSelectedQuestion: false,
      hasDraft: false,
      draftPendingReview: false,
      hasApprovedDraft: false,
    };
  }

  const db = getDb();
  const exists = (sql: string): boolean => db.prepare(sql).get(projectId) !== undefined;

  const factsRow = db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'",
    )
    .get(projectId) as {cnt: number} | undefined;

  return {
    hasKnowledgeEntries: exists('SELECT 1 AS hit FROM knowledge_entries WHERE project_id = ? LIMIT 1'),
    confirmedFactsCount: factsRow?.cnt ?? 0,
    hasSelectedQuestion: exists(
      "SELECT 1 AS hit FROM question_pools WHERE project_id = ? AND status = 'selected' LIMIT 1",
    ),
    hasDraft: exists(
      `SELECT 1 AS hit FROM agent_artifacts
       WHERE project_id = ? AND artifact_type = 'article_draft' LIMIT 1`,
    ),
    draftPendingReview: exists(
      `SELECT 1 AS hit FROM agent_artifacts
       WHERE project_id = ? AND artifact_type = 'article_draft'
         AND status IN ('draft', 'claim_reviewed', 'geo_reviewed')
       LIMIT 1`,
    ),
    hasApprovedDraft: exists(
      `SELECT 1 AS hit FROM agent_artifacts
       WHERE project_id = ? AND artifact_type = 'article_draft' AND status = 'approved'
       LIMIT 1`,
    ),
  };
}

/**
 * Project-status diagnosis decision tree (ticket #32).
 * Returns the first matching suggestion; the ordering is significant.
 */
function diagnoseNextStep(s: DiagnosisSnapshot, hasProject: boolean): string {
  if (!hasProject) {
    return '你还没有选择项目。建议先在左侧选择或创建一个企业项目，再继续 GEO 任务。';
  }
  if (!s.hasKnowledgeEntries) {
    return '当前项目还没有录入企业资料。建议先上传企业知识库内容（官网、产品介绍、案例等），再进行下一步。';
  }
  if (s.confirmedFactsCount === 0) {
    return '当前项目还没有已确认的企业事实。建议先执行事实抽取并在事实审核页确认事实，这是后续生成问题与文章的基础。';
  }
  if (!s.hasSelectedQuestion) {
    return '当前项目已确认事实，但还没有选定的目标问题。建议生成问题池，并选定一个用户最可能提问的问题作为目标。';
  }
  if (!s.hasDraft) {
    return '当前项目已有选定的目标问题，建议进行信源发现并生成文章草稿。';
  }
  if (s.draftPendingReview) {
    return '当前项目已有文章草稿待审核。建议先到草稿审核页完成 Claim 审核与 GEO 审核，再继续。';
  }
  if (s.hasApprovedDraft) {
    return '当前项目已有审核通过的文章草稿，建议准备发布计划并提交发布审批。';
  }
  return '当前项目状态良好，暂无明确的下一步建议。可以继续与 Agent 对话。';
}

// ── Chat message / approval-card helpers ─────────────────────────────────────

interface ApprovalCardPart {
  type: 'approval_request';
  approvalId: number | null;
  skillName: string;
  argsPreview: string;
  autoApproved: boolean;
}

/**
 * Inserts an assistant chat_messages row carrying the runtime's response text
 * and optional MessageParts (e.g. an informational or high-risk approval
 * card). This is how the runtime surfaces blocked-reason, status-diagnosis,
 * and stop-reason messages to the user.
 *
 * Returns the new message id (or null if the insert is skipped).
 */
function pushAgentMessage(
  sessionId: number | null,
  projectId: number | null,
  content: string,
  parts?: unknown[],
): number | null {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO chat_messages (session_id, project_id, role, content, render_json, created_at)
       VALUES (?, ?, 'assistant', ?, ?, datetime('now'))`,
    )
    .run(
      sessionId ?? null,
      projectId ?? null,
      content,
      parts && parts.length > 0 ? JSON.stringify(parts) : null,
    );
  return Number(result.lastInsertRowid);
}

/**
 * Appends an `approval_request` MessagePart to an existing chat message's
 * `render_json`. Mirrors the shape toolGuard uses so the renderer treats both
 * paths identically. `autoApproved: true` marks informational cards (medium /
 * low risk) the agent auto-continues past; `autoApproved: false` marks the
 * blocking card pushed for high-risk skills like `publish.plan`.
 */
function pushApprovalCard(
  messageId: number,
  skillName: string,
  argsPreview: string,
  approvalId: number | null = null,
  autoApproved: boolean = true,
): void {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT render_json FROM chat_messages WHERE id = ?')
      .get(messageId) as {render_json: string | null} | undefined;
    if (!row) return;

    let parts: unknown[] = [];
    if (row.render_json) {
      try {
        const parsed = JSON.parse(row.render_json);
        if (Array.isArray(parsed)) parts = parsed;
        else if (Array.isArray((parsed as {parts?: unknown[]}).parts)) {
          parts = (parsed as {parts: unknown[]}).parts;
        }
      } catch {
        parts = [];
      }
    }

    const card: ApprovalCardPart = {
      type: 'approval_request',
      approvalId,
      skillName,
      argsPreview,
      autoApproved,
    };
    parts.push(card);

    db.prepare(`UPDATE chat_messages SET render_json = ? WHERE id = ?`).run(
      JSON.stringify(parts),
      messageId,
    );
  } catch (err) {
    console.warn('[geoAgentRuntime] failed to push approval card:', err);
  }
}

// ── Task / step persistence helpers ──────────────────────────────────────────

interface StepWrite {
  stepType: StepType;
  actionName: string;
  status: StepStatus;
  inputJson?: string | null;
  outputJson?: string | null;
}

interface TaskContext {
  taskId: number;
  projectId: number | null;
  sessionId: number | null;
  loopCount: number;
  /** Adds a row to agent_task_steps and returns its id. */
  addStep: (step: Partial<Omit<AgentTaskStep, 'id' | 'task_id' | 'created_at'>>) => number;
  /** Convenience wrapper for the common step shape used across handlers. */
  writeStep: (step: StepWrite) => number;
  /** Updates the owning agent_tasks row. */
  updateTask: (fields: Partial<AgentTask>) => void;
}

/**
 * Marks an existing agent_task_steps row completed/failed with an output
 * payload. Centralises the UPDATE so handlers don't repeat the SQL.
 */
function completeStep(
  stepId: number,
  fields: {status: StepStatus; output_json?: string | null},
): void {
  const db = getDb();
  db.prepare(
    `UPDATE agent_task_steps SET status = ?, output_json = ?, completed_at = datetime('now') WHERE id = ?`,
  ).run(fields.status, fields.output_json ?? null, stepId);
}

function makeAddStep(taskId: number) {
  return (
    step: Partial<Omit<AgentTaskStep, 'id' | 'task_id' | 'created_at'>>,
  ): number => {
    const db = getDb();
    const full: Omit<AgentTaskStep, 'id' | 'task_id' | 'created_at'> = {
      parent_step_id: step.parent_step_id ?? null,
      step_type: step.step_type!,
      action_name: step.action_name ?? null,
      status: step.status!,
      input_json: step.input_json ?? null,
      output_json: step.output_json ?? null,
      validation_json: step.validation_json ?? null,
      error_id: step.error_id ?? null,
      attempt_count: step.attempt_count ?? 0,
      max_attempts: step.max_attempts ?? 2,
      started_at: step.started_at ?? null,
      completed_at: step.completed_at ?? null,
    };
    const result = db
      .prepare(
        `INSERT INTO agent_task_steps (
           task_id, parent_step_id, step_type, action_name, status,
           input_json, output_json, validation_json, error_id,
           attempt_count, max_attempts, started_at, completed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        taskId,
        full.parent_step_id,
        full.step_type,
        full.action_name,
        full.status,
        full.input_json,
        full.output_json,
        full.validation_json,
        full.error_id,
        full.attempt_count,
        full.max_attempts,
        full.started_at,
        full.completed_at,
      );
    return Number(result.lastInsertRowid);
  };
}

function makeUpdateTask(taskId: number) {
  return (fields: Partial<AgentTask>): void => {
    const db = getDb();
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const setters = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    db.prepare(
      `UPDATE agent_tasks SET ${setters}, updated_at = datetime('now') WHERE id = ?`,
    ).run(...values, taskId);
  };
}

function writeResponseArtifact(
  taskId: number,
  projectId: number | null,
  title: string,
  content: string,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO agent_artifacts (
       task_id, project_id, artifact_type, title, content, status, created_at, updated_at
     ) VALUES (?, ?, 'agent_response', ?, ?, 'completed', datetime('now'), datetime('now'))`,
  ).run(taskId, projectId ?? null, title, content);
}

// ── Route-result handlers ────────────────────────────────────────────────────

/**
 * Executes a routed skill under the toolGuard policy and finalizes the task.
 *
 *   - loopGuard must pass before any execution.
 *   - high-risk skills (publish.plan) leave the task in `waiting_approval`
 *     with a blocking approval card; the runtime returns without continuing.
 *   - medium/low skills execute, push an informational confirmation card, and
 *     the task completes with the skill result as the response artifact.
 *   - failure / rejection finalizes the task as `failed`.
 */
async function handleSkillRoute(
  ctx: TaskContext,
  skillName: string,
  params: Record<string, unknown>,
): Promise<void> {
  // 1. Loop guard — checked before any skill execution.
  const guard = checkLoopGuard(ctx.taskId, ctx.loopCount);
  if (!guard.allowed) {
    const reason = guard.reason ?? '循环保护已触发，Agent 已停止';
    await executionLedger.append(ctx.taskId, 'task_stopped_loop_guard', {
      skillName,
      loopCount: ctx.loopCount,
      reason,
    });
    pushAgentMessage(ctx.sessionId, ctx.projectId, reason);
    ctx.updateTask({status: 'failed', current_objective: `已停止：${reason}`, last_action: 'loop_guard'});
    return;
  }

  // 2. Resolve the executor for this skill. The router returns a skill
  //    directory name; map it to a dotted executor id. If no executor is
  //    registered, surface a graceful message instead of throwing.
  const executorId = SKILL_DIR_TO_EXECUTOR[skillName] ?? skillName;
  const executor = SKILL_EXECUTORS[executorId];
  if (!executor) {
    const msg = `已识别到「${skillName}」能力，但该能力暂未接入执行后端。你可以稍后再试，或换一种方式描述需求。`;
    await executionLedger.append(ctx.taskId, 'skill_not_wired', {skillName, executorId});
    pushAgentMessage(ctx.sessionId, ctx.projectId, msg);
    ctx.writeStep({
      stepType: 'skill_call',
      actionName: skillName,
      status: 'completed',
      inputJson: JSON.stringify({skillName}),
      outputJson: JSON.stringify({skipped: true, reason: 'no_executor'}),
    });
    writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', msg);
    ctx.updateTask({status: 'completed', current_objective: '已完成（能力暂未接入）', last_action: skillName, completed_at: new Date().toISOString()});
    return;
  }

  await runExecutor(ctx, executorId, executor, params);
}

/**
 * Executes a builtin intent's executor (or the publish.plan pause path) under
 * the toolGuard policy. Shared by the builtin-intent match and the skill-dir
 * route so both paths get identical guard + ledger + card behaviour.
 */
async function runExecutor(
  ctx: TaskContext,
  executorId: string,
  executor: (args: SkillExecutorArgs, toolCtx: AgentToolContext) => Promise<string>,
  params: Record<string, unknown>,
): Promise<void> {
  // High-risk capabilities pause for user approval before any executor runs.
  // publish.plan has no executor body — the pause IS the behaviour.
  if (executorId === 'publish.plan') {
    await handlePublishPlanPause(ctx, params);
    return;
  }

  const nowIso = new Date().toISOString();

  // Record the skill_call step.
  const skillStepId = ctx.addStep({
    step_type: 'skill_call',
    action_name: executorId,
    status: 'running',
    input_json: JSON.stringify({skillName: executorId, params}),
    attempt_count: 1,
    max_attempts: 1,
    started_at: nowIso,
  });

  ctx.updateTask({current_objective: `执行技能 ${executorId}`, last_action: executorId});

  const executorArgs: SkillExecutorArgs = {
    projectId: ctx.projectId ?? undefined,
    targetQuestion: typeof params.targetQuestion === 'string' ? params.targetQuestion : undefined,
    strategy:
      params.strategy === 'support_article' || params.strategy === 'ranking_article'
        ? params.strategy
        : undefined,
    supportArticleType:
      typeof params.supportArticleType === 'string'
        ? (params.supportArticleType as SkillExecutorArgs['supportArticleType'])
        : undefined,
    title: typeof params.title === 'string' ? params.title : undefined,
    artifactId: typeof params.artifactId === 'number' ? params.artifactId : undefined,
    entryId: typeof params.entryId === 'number' ? params.entryId : undefined,
    chunkIds: Array.isArray(params.chunkIds) ? (params.chunkIds as number[]) : undefined,
  };

  const toolCtx: AgentToolContext = {taskId: ctx.taskId};

  const guarded: GuardedToolCallResult<string> = await executeWithGuard<string>(
    {
      skillName: executorId,
      args: params,
      taskId: ctx.taskId,
      stepId: skillStepId,
      projectId: ctx.projectId ?? null,
      waitForApproval: toolCtx.waitForApproval,
    },
    () => executor(executorArgs, toolCtx),
  );

  if (guarded.status === 'rejected') {
    finalizeSkillFailure(ctx, executorId, params, 'rejected', '用户拒绝审批');
    return;
  }
  if (guarded.status === 'failed') {
    finalizeSkillFailure(ctx, executorId, params, 'failed', guarded.error ?? '未知错误');
    return;
  }

  // guarded.status === 'completed' (medium/low risk auto-continues; high-risk
  // pause is handled separately in handlePublishPlanPause).
  const resultText = guarded.result ?? '技能执行完成';
  const completedIso = new Date().toISOString();
  completeStep(skillStepId, {
    status: 'completed',
    output_json: JSON.stringify({result: resultText}),
  });

  // Informational confirmation card (medium/low risk auto-continues).
  const messageId = pushAgentMessage(ctx.sessionId, ctx.projectId, `「${executorId}」执行完成。`);
  if (messageId != null) {
    pushApprovalCard(messageId, executorId, JSON.stringify(params), null, true);
  }

  ctx.writeStep({
    stepType: 'final_response',
    actionName: 'answer_user',
    status: 'completed',
    inputJson: JSON.stringify({skillName: executorId}),
    outputJson: JSON.stringify({answer: resultText}),
  });

  writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', resultText);
  ctx.updateTask({
    status: 'completed',
    current_objective: '已完成技能执行',
    last_action: executorId,
    completed_at: completedIso,
  });
}

/**
 * Marks a skill_call step failed, pushes a user-facing message, and finalizes
 * the task as failed. Used for both `rejected` and `failed` guard outcomes.
 */
function finalizeSkillFailure(
  ctx: TaskContext,
  executorId: string,
  params: Record<string, unknown>,
  status: 'rejected' | 'failed',
  detail: string,
): void {
  const msg =
    status === 'rejected'
      ? `「${executorId}」被拒绝，Agent 已停止当前流程。`
      : `「${executorId}」执行失败：${detail}`;
  ctx.writeStep({
    stepType: 'skill_call',
    actionName: executorId,
    status: 'failed',
    inputJson: JSON.stringify({skillName: executorId, params}),
    outputJson: JSON.stringify({status, error: status === 'failed' ? detail : undefined}),
  });
  pushAgentMessage(ctx.sessionId, ctx.projectId, msg);
  writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', msg);
  ctx.updateTask({
    status: 'failed',
    current_objective: status === 'rejected' ? '用户拒绝审批' : `失败：${detail}`,
    last_action: executorId,
  });
}

/**
 * publish.plan is the contractually high-risk capability (T8). There is no
 * backing service, so the runtime writes the approval row itself, transitions
 * the task to `waiting_approval`, and pushes a blocking approval card. The
 * task stays paused — the user must approve via the UI before anything else
 * runs. This never reaches `executeWithGuard`'s executor path.
 */
async function handlePublishPlanPause(
  ctx: TaskContext,
  params: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  let approvalId: number | null = null;
  try {
    const insertResult = db
      .prepare(
        `INSERT INTO tool_approvals (tool_call_id, requested_by, approval_type, status, requested_at)
         VALUES (?, 'agent', ?, 'requested', datetime('now'))`,
      )
      .run(0, 'publish.plan');
    approvalId = Number(insertResult.lastInsertRowid);
  } catch (err) {
    console.error('[geoAgentRuntime] failed to insert publish.plan approval:', err);
  }

  ctx.updateTask({status: 'waiting_approval', current_objective: '等待审批：publish.plan', last_action: 'publish.plan'});

  await executionLedger.append(ctx.taskId, 'tool_approval_requested', {
    skillName: 'publish.plan',
    approvalId,
  });

  ctx.writeStep({
    stepType: 'approval_request',
    actionName: 'publish.plan',
    status: 'completed',
    inputJson: JSON.stringify({approvalId}),
    outputJson: JSON.stringify({status: 'waiting_approval'}),
  });

  const messageId = pushAgentMessage(
    ctx.sessionId,
    ctx.projectId,
    '「publish.plan」需要你的审批才能继续。',
  );
  if (messageId != null) {
    pushApprovalCard(messageId, 'publish.plan', JSON.stringify(params), approvalId, false);
  }
}

/**
 * A routed skill was blocked by the allowedActionPolicy (missing
 * preconditions). Surface the human-readable reason as a normal message —
 * not an error — and finalize the task as completed.
 */
async function handleBlockedRoute(
  ctx: TaskContext,
  skillName: string,
  reason: string,
): Promise<void> {
  await executionLedger.append(ctx.taskId, 'route_blocked', {skillName, reason});
  pushAgentMessage(ctx.sessionId, ctx.projectId, reason);

  ctx.writeStep({
    stepType: 'validation',
    actionName: 'policy_block',
    status: 'completed',
    inputJson: JSON.stringify({skillName}),
    outputJson: JSON.stringify({blocked: true, reason}),
  });

  writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', reason);
  ctx.updateTask({
    status: 'completed',
    current_objective: '已拦截（前置条件未满足）',
    last_action: 'policy_block',
    completed_at: new Date().toISOString(),
  });
}

/**
 * Three-tier routing fell through to status diagnosis. Read the live project
 * state and produce a concrete next-step suggestion per the decision tree.
 */
async function handleFallbackRoute(ctx: TaskContext): Promise<void> {
  const snapshot = readDiagnosisSnapshot(ctx.projectId);
  const suggestion = diagnoseNextStep(snapshot, ctx.projectId !== null);

  await executionLedger.append(ctx.taskId, 'status_diagnosis', {
    projectId: ctx.projectId,
    snapshot,
    suggestion,
  });
  pushAgentMessage(ctx.sessionId, ctx.projectId, suggestion);

  ctx.writeStep({
    stepType: 'final_response',
    actionName: 'status_diagnosis',
    status: 'completed',
    inputJson: JSON.stringify({projectId: ctx.projectId}),
    outputJson: JSON.stringify({snapshot, suggestion}),
  });

  writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', suggestion);
  ctx.updateTask({
    status: 'completed',
    current_objective: '已完成状态诊断',
    last_action: 'status_diagnosis',
    completed_at: new Date().toISOString(),
  });
}

// ── Public entry point ───────────────────────────────────────────────────────

export async function runMinimalAgentTask(
  userGoal: string,
  options: RunMinimalAgentOptions = {},
): Promise<AgentTask> {
  const db = getDb();
  const insertTask = db.prepare(
    `INSERT INTO agent_tasks (
       session_id, project_id, title, user_goal, status,
       current_objective, last_action, risk_level,
       failure_count, loop_count, max_loop_count,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'running', ?, ?, 'low', 0, 0, 12, datetime('now'), datetime('now'))`,
  );

  const taskResult = insertTask.run(
    options.sessionId ?? null,
    options.projectId ?? null,
    options.title ?? userGoal.slice(0, 80),
    userGoal,
    '分析用户意图',
    null,
  );
  const taskId = Number(taskResult.lastInsertRowid);

  const addStep = makeAddStep(taskId);
  const updateTask = makeUpdateTask(taskId);
  const ctx: TaskContext = {
    taskId,
    projectId: options.projectId ?? null,
    sessionId: options.sessionId ?? null,
    loopCount: 0,
    addStep,
    writeStep: (step) =>
      addStep({
        step_type: step.stepType,
        action_name: step.actionName,
        status: step.status,
        input_json: step.inputJson ?? null,
        output_json: step.outputJson ?? null,
        attempt_count: 1,
        max_attempts: 1,
        started_at: new Date().toISOString(),
        completed_at: step.status === 'completed' || step.status === 'failed' ? new Date().toISOString() : null,
      }),
    updateTask,
  };

  const planStepId = addStep({
    step_type: 'plan',
    action_name: 'analyze_user_goal',
    status: 'running',
    input_json: JSON.stringify({userGoal}),
    attempt_count: 1,
    max_attempts: 1,
    started_at: new Date().toISOString(),
  });

  try {
    await executionLedger.append(taskId, 'task_started', {
      userGoal,
      projectId: options.projectId ?? null,
    });

    const project = options.projectId ? getProjectRow(options.projectId) : null;
    const policyContext: PolicyContext = {
      projectId: options.projectId ?? null,
      projectDomain: project?.domain ?? null,
    };

    updateTask({current_objective: '路由用户意图'});

    // 1. Builtin intent match (service-backed capabilities without SKILL.md).
    const builtin = matchBuiltinIntent(userGoal, policyContext);
    if (builtin) {
      if (builtin.blockedReason !== null) {
        completeStep(planStepId, {
          status: 'completed',
          output_json: JSON.stringify({route: {type: 'blocked', skillName: builtin.intent.executorId}}),
        });
        await executionLedger.append(taskId, 'route_blocked', {
          skillName: builtin.intent.executorId,
          reason: builtin.blockedReason,
        });
        await handleBlockedRoute(ctx, builtin.intent.executorId, builtin.blockedReason);
      } else {
        completeStep(planStepId, {
          status: 'completed',
          output_json: JSON.stringify({route: {type: 'skill', skillName: builtin.intent.executorId}}),
        });
        await executionLedger.append(taskId, 'route_resolved', {
          route: {type: 'builtin_skill', skillName: builtin.intent.executorId},
        });
        await runExecutor(ctx, builtin.intent.executorId, SKILL_EXECUTORS[builtin.intent.executorId], {});
      }
      return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as AgentTask;
    }

    // 2. Skill-directory router (rule → semantic → fallback).
    const routeContext: RouteContext = {
      projectId: options.projectId,
      projectDomain: project?.domain ?? null,
    };
    const routeResult = await route(userGoal, routeContext);

    completeStep(planStepId, {
      status: 'completed',
      output_json: JSON.stringify({route: routeResult}),
    });
    await executionLedger.append(taskId, 'route_resolved', {route: routeResult});

    if (routeResult.type === 'skill') {
      await handleSkillRoute(ctx, routeResult.skillName, routeResult.params);
    } else if (routeResult.type === 'blocked') {
      await handleBlockedRoute(ctx, routeResult.skillName, routeResult.reason);
    } else {
      await handleFallbackRoute(ctx);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[geoAgentRuntime] task ${taskId} failed:`, error);

    await executionLedger.append(taskId, 'task_failed', {error: message});

    completeStep(planStepId, {
      status: 'failed',
      output_json: JSON.stringify({error: message}),
    });

    updateTask({status: 'failed', current_objective: `失败：${message}`});
  }

  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as AgentTask;
}
