/**
 * geoAgentRuntime.ts
 *
 * Agent-first Task Runtime — the top-level orchestrator that assembles every
 * Phase 9 sub-module into a complete loop.
 *
 * After the #62 big-bang cutover the runtime uses a single routing layer:
 *
 *   user message
 *     → intentRouter.route()                       (declarative route table + policy gate)
 *       → 'skill' kind='md-driven' migrated:true  → runMdDrivenSkill
 *       → 'skill' kind='md-driven' migrated:false → 「能力升级中」placeholder
 *       → 'skill' kind='service'                  → SERVICE_EXECUTORS[intent] under toolGuard
 *       → 'skill' kind='pause'                    → handlePublishPlanPause (approval card)
 *       → 'blocked'                               → push policy reason message (no error)
 *       → 'clarify'                               → push a clarify message
 *       → 'fallback'                              → read live project state → decision tree → suggestion
 *
 * The old dual-path (`matchBuiltinIntent` + skill-dir fallback) is gone; every
 * intent — service, pause, md-driven — lives in the single `SKILL_ROUTES`
 * table and is gated by the same `allowedActionPolicy` hook folded into
 * `route()`.
 *
 * Every state transition writes to `execution_ledger` (via `executionLedger`
 * for task-level events and via `toolGuard` for per-skill tool events), and
 * every agent task step is persisted to `agent_task_steps`.
 */

import {getDb} from '../../db/connection.ts';
import type {AgentTask, AgentTaskStep, StepStatus, StepType} from '@/types/domain';
import {route, type RouteResult, type RouteContext} from './intentRouter.ts';
import {checkLoopGuard} from './loopGuard.ts';
import * as executionLedger from './executionLedger.ts';
import {executeWithGuard, type GuardedToolCallResult} from './toolGuard.ts';
import {
  SERVICE_EXECUTORS,
  getProjectRow,
  type AgentToolContext,
  type SkillExecutorArgs,
} from './geoAgentFactory.ts';
import {runMdDrivenSkill} from './mdDrivenRunner.ts';

export interface RunMinimalAgentOptions {
  projectId?: number;
  sessionId?: number;
  title?: string;
}

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
 * Dispatches a `{type:'skill'}` RouteResult by its `kind`, after the loop
 * guard passes:
 *
 *   - `md-driven` + `migrated:true`  → runMdDrivenSkill
 *   - `md-driven` + `migrated:false` → 「能力升级中，暂未接入新框架」placeholder
 *   - `service`                       → SERVICE_EXECUTORS[intent] under toolGuard
 *   - `pause`                         → handlePublishPlanPause (approval card)
 *
 * For service intents without a registered executor (e.g. `claim.parsing`,
 * which has no backing service yet), a graceful「暂未接入执行后端」message is
 * surfaced — same behaviour the old skill-dir fallback used for unwired dirs.
 */
async function handleSkillRoute(
  ctx: TaskContext,
  routeResult: Extract<RouteResult, {type: 'skill'}>,
  userGoal: string,
): Promise<void> {
  const {kind, skillName, params} = routeResult;

  // 1. Loop guard — checked before any execution.
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

  // 2. Dispatch by kind.
  if (kind === 'pause') {
    // publish.plan — high-risk pause path (no executor body).
    await handlePublishPlanPause(ctx, params);
    return;
  }

  if (kind === 'service') {
    const executor = SERVICE_EXECUTORS[skillName];
    if (!executor) {
      const msg = `已识别到「${skillName}」能力，但该能力暂未接入执行后端。你可以稍后再试，或换一种方式描述需求。`;
      await executionLedger.append(ctx.taskId, 'skill_not_wired', {skillName});
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
    await runServiceExecutor(ctx, skillName, executor, params);
    return;
  }

  // kind === 'md-driven'
  if (routeResult.migrated) {
    await runMigratedSkill(ctx, skillName, userGoal, params);
  } else {
    await handleUnmigratedSkill(ctx, skillName);
  }
}

/**
 * Runs a migrated md-driven skill via the md-driven runtime (#59). Maps the
 * runtime's task context (projectId + user goal + route params) into
 * `runMdDrivenSkill` options, then adopts the validated output as the task
 * response artifact. On validation failure the task is finalized as failed
 * with the validator errors surfaced to the user.
 */
async function runMigratedSkill(
  ctx: TaskContext,
  skillDir: string,
  userGoal: string,
  params: Record<string, unknown>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const skillStepId = ctx.addStep({
    step_type: 'skill_call',
    action_name: skillDir,
    status: 'running',
    input_json: JSON.stringify({skillName: skillDir, params}),
    attempt_count: 1,
    max_attempts: 1,
    started_at: nowIso,
  });

  ctx.updateTask({current_objective: `执行技能 ${skillDir}`, last_action: skillDir});

  const taskArgs: Record<string, unknown> = {
    projectId: ctx.projectId ?? undefined,
    targetQuestion: typeof params.targetQuestion === 'string' ? params.targetQuestion : undefined,
    title: typeof params.title === 'string' ? params.title : undefined,
    strategy:
      params.strategy === 'support_article' || params.strategy === 'ranking_article'
        ? params.strategy
        : undefined,
    ...params,
  };

  let result;
  try {
    result = await runMdDrivenSkill(skillDir, {
      projectId: ctx.projectId ?? undefined,
      taskArgs,
      userMessage: userGoal,
      // #63：tool_call 循环经 executeWithGuard 写 ledger（taskId/stepId）。
      taskId: ctx.taskId,
      stepId: skillStepId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finalizeSkillFailure(ctx, skillDir, params, 'failed', message);
    return;
  }

  if (!result.ok) {
    const detail = result.errors.join('; ');
    completeStep(skillStepId, {
      status: 'failed',
      output_json: JSON.stringify({errors: result.errors}),
    });
    const msg = `「${skillDir}」执行失败：${detail}`;
    pushAgentMessage(ctx.sessionId, ctx.projectId, msg);
    writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', msg);
    ctx.writeStep({
      stepType: 'final_response',
      actionName: 'answer_user',
      status: 'failed',
      inputJson: JSON.stringify({skillName: skillDir}),
      outputJson: JSON.stringify({errors: result.errors}),
    });
    ctx.updateTask({status: 'failed', current_objective: `失败：${detail}`, last_action: skillDir});
    return;
  }

  const resultText = JSON.stringify(result.data, null, 2);
  const completedIso = new Date().toISOString();
  completeStep(skillStepId, {
    status: 'completed',
    output_json: JSON.stringify({result: resultText}),
  });

  const messageId = pushAgentMessage(ctx.sessionId, ctx.projectId, `「${skillDir}」执行完成。`);
  if (messageId != null) {
    pushApprovalCard(messageId, skillDir, JSON.stringify(params), null, true);
  }

  ctx.writeStep({
    stepType: 'final_response',
    actionName: 'answer_user',
    status: 'completed',
    inputJson: JSON.stringify({skillName: skillDir}),
    outputJson: JSON.stringify({answer: resultText}),
  });

  writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', resultText);
  ctx.updateTask({
    status: 'completed',
    current_objective: '已完成技能执行',
    last_action: skillDir,
    completed_at: completedIso,
  });
}

/**
 * Surfaces the「能力升级中，暂未接入新框架」placeholder for an md-driven skill
 * that has not been sliced onto the md-driven runtime yet. The skill is
 * recognised but not executed; the task completes gracefully.
 */
async function handleUnmigratedSkill(
  ctx: TaskContext,
  skillDir: string,
): Promise<void> {
  const msg = `已识别到「${skillDir}」能力，该能力正在升级中，暂未接入新框架。你可以稍后再试，或换一种方式描述需求。`;
  await executionLedger.append(ctx.taskId, 'skill_not_migrated', {skillName: skillDir});
  pushAgentMessage(ctx.sessionId, ctx.projectId, msg);
  ctx.writeStep({
    stepType: 'skill_call',
    actionName: skillDir,
    status: 'completed',
    inputJson: JSON.stringify({skillName: skillDir}),
    outputJson: JSON.stringify({skipped: true, reason: 'not_migrated'}),
  });
  writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', msg);
  ctx.updateTask({
    status: 'completed',
    current_objective: '已完成（能力升级中）',
    last_action: skillDir,
    completed_at: new Date().toISOString(),
  });
}

/**
 * Executes a service-kind intent's executor under the toolGuard policy.
 * Identical guard + ledger + card behaviour to the pre-cutover path.
 */
async function runServiceExecutor(
  ctx: TaskContext,
  executorId: string,
  executor: (args: SkillExecutorArgs, toolCtx: AgentToolContext) => Promise<string>,
  params: Record<string, unknown>,
): Promise<void> {
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

/**
 * Tier 2 semantic match produced low-confidence candidates (≥ 0.3, < 0.6).
 * Surface them as a clarify message so the user can pick or rephrase.
 */
async function handleClarifyRoute(
  ctx: TaskContext,
  candidates: {intent: string; confidence: number}[],
): Promise<void> {
  const list = candidates.map((c) => `「${c.intent}」（置信度 ${c.confidence.toFixed(2)}）`).join('、');
  const msg = `我不太确定你的具体意图，候选能力包括：${list}。请补充说明或换一种方式描述需求。`;

  await executionLedger.append(ctx.taskId, 'route_clarify', {candidates});
  pushAgentMessage(ctx.sessionId, ctx.projectId, msg);

  ctx.writeStep({
    stepType: 'final_response',
    actionName: 'clarify',
    status: 'completed',
    inputJson: JSON.stringify({candidates}),
    outputJson: JSON.stringify({msg}),
  });

  writeResponseArtifact(ctx.taskId, ctx.projectId, 'Agent 回答', msg);
  ctx.updateTask({
    status: 'completed',
    current_objective: '已完成（需澄清）',
    last_action: 'clarify',
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

    updateTask({current_objective: '路由用户意图'});

    // Single routing layer (post-#62 cutover): the declarative SKILL_ROUTES
    // table covers every intent — service, pause, md-driven — and the policy
    // gate is folded into route() via blockHookForRoute.
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
      await handleSkillRoute(ctx, routeResult, userGoal);
    } else if (routeResult.type === 'blocked') {
      await handleBlockedRoute(ctx, routeResult.skillName, routeResult.reason);
    } else if (routeResult.type === 'clarify') {
      await handleClarifyRoute(ctx, routeResult.candidates);
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
