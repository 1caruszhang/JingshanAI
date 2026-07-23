/**
 * toolGuard.ts
 *
 * Provides risk-level-aware tool execution guards for the Agent Runtime.
 *
 * Three risk tiers (driven by skills/<name>/SKILL.md frontmatter `risk_level`):
 *   - high   (e.g. publish.plan)         → write tool_approvals + pause task in
 *                                          `waiting_approval` state until the user
 *                                          approves via the UI.
 *   - medium / low                       → execute immediately, then push an
 *                                          `approval_request` MessagePart to the
 *                                          current chat message as an informational
 *                                          confirmation card.
 *
 * All tool invocations (regardless of risk) write before/after records to
 * `execution_ledger` via the T6 append() API.
 */

import {getDb} from '../../db/connection';
import * as executionLedger from './executionLedger';
import {getSkill} from './skillRegistry';
import {preview, type LedgerEventType} from './ledgerEvents';

export type ToolRiskLevel = 'low' | 'medium' | 'high';

// Skill names that must always be treated as high-risk regardless of SKILL.md
// presence. The publish.plan contract is defined by T8.
const HIGH_RISK_SKILLS: ReadonlySet<string> = new Set(['publish.plan']);

/**
 * Returns the risk level for a skill invocation.
 *
 * Resolution order:
 *   1. `publish.plan` is always 'high'.
 *   2. If a SKILL.md exists for `skillName`, use its frontmatter `risk_level`.
 *   3. Default to 'low'.
 */
export function evaluateToolRisk(skillName: string, _args: unknown): ToolRiskLevel {
  if (HIGH_RISK_SKILLS.has(skillName)) {
    return 'high';
  }

  try {
    const skill = getSkill(skillName);
    if (skill?.frontmatter?.risk_level) {
      return skill.frontmatter.risk_level;
    }
  } catch (err) {
    // If the skill registry fails to load, fall through to 'low' — never
    // block execution on metadata lookup failures.
    console.warn(`[toolGuard] failed to resolve risk level for ${skillName}:`, err);
  }

  return 'low';
}

/**
 * Returns true if the given skill call requires user approval before execution.
 * Only 'high' risk level requires blocking approval; 'medium' / 'low' return
 * false (the Agent auto-continues and only emits an informational card).
 */
export function requiresApproval(_skillName: string, riskLevel: string): boolean {
  return riskLevel === 'high';
}

// ── Execution-time guard ─────────────────────────────────────────────────────

export interface GuardedToolCallOptions {
  skillName: string;
  args: Record<string, unknown>;
  /** The agent task currently being executed; used to pause on high-risk. */
  taskId?: number | null;
  /** The agent task step associated with this tool call. */
  stepId?: number | null;
  /** Current project id for ledger entries. */
  projectId?: number | null;
  /** The current assistant tool_call row id (from assistant_tool_calls). */
  toolCallRowId?: number | null;
  /** The current chat message id to attach approval_request MessageParts to. */
  messageId?: number | null;
  /**
   * Resolver invoked for high-risk tools once the approval row is written.
   * Should return a Promise<boolean> that resolves when the user approves
   * (true) or rejects (false) the tool call. If omitted, the call is
   * auto-rejected (safe default).
   */
  waitForApproval?: (approvalId: number) => Promise<boolean>;
}

export interface GuardedToolCallResult<T = unknown> {
  status: 'completed' | 'waiting_approval' | 'rejected' | 'failed';
  riskLevel: ToolRiskLevel;
  approvalId?: number;
  result?: T;
  error?: string;
}

/**
 * Executes a skill under the toolGuard policy:
 *
 * 1. Appends `tool_call_requested` to execution_ledger.
 * 2. If risk = high: writes `tool_approvals` row, sets task status to
 *    `waiting_approval`, awaits user approval via `waitForApproval`. If the
 *    user rejects, marks task as `failed` and returns.
 * 3. Executes `executor`.
 * 4. Appends `tool_call_completed` (or `tool_call_failed`) to execution_ledger.
 * 5. For medium/low risk: pushes an `approval_request` MessagePart to the
 *    current chat message so the user can see what happened.
 */
export async function executeWithGuard<T>(
  options: GuardedToolCallOptions,
  executor: () => Promise<T>,
): Promise<GuardedToolCallResult<T>> {
  const {
    skillName,
    args,
    taskId = null,
    stepId = null,
    projectId = null,
    toolCallRowId = null,
    messageId = null,
    waitForApproval,
  } = options;

  const riskLevel = evaluateToolRisk(skillName, args);
  const db = getDb();

  const appendLedger = (eventType: LedgerEventType, payload: unknown) =>
    executionLedger.append(taskId, eventType, payload, {
      stepId: stepId ?? undefined,
      projectId: projectId ?? undefined,
      eventName: skillName,
    });

  // 1. Ledger — before
  await appendLedger('tool_call_requested', {skillName, args, riskLevel});

  // 2. High-risk gating
  if (requiresApproval(skillName, riskLevel)) {
    let approvalId: number | undefined;
    try {
      const insertResult = db
        .prepare(
          `INSERT INTO tool_approvals (tool_call_id, requested_by, approval_type, status, requested_at)
           VALUES (?, 'agent', ?, 'requested', datetime('now'))`,
        )
        .run(toolCallRowId ?? 0, skillName);
      approvalId = Number(insertResult.lastInsertRowid);
    } catch (err) {
      console.error('[toolGuard] failed to insert tool_approvals:', err);
    }

    // Pause the owning task
    if (taskId != null) {
      try {
        db.prepare(
          `UPDATE agent_tasks SET status = 'waiting_approval', updated_at = datetime('now') WHERE id = ?`,
        ).run(taskId);
      } catch (err) {
        console.error('[toolGuard] failed to set task waiting_approval:', err);
      }
    }

    await appendLedger('tool_approval_requested', {skillName, approvalId});

    // Wait for the user decision
    const approved = waitForApproval ? await waitForApproval(approvalId ?? -1) : false;

    if (!approved) {
      if (approvalId != null) {
        try {
          db.prepare(
            `UPDATE tool_approvals SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?`,
          ).run(approvalId);
        } catch (err) {
          console.error('[toolGuard] failed to mark approval rejected:', err);
        }
      }
      if (taskId != null) {
        try {
          db.prepare(
            `UPDATE agent_tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?`,
          ).run(taskId);
        } catch (err) {
          console.error('[toolGuard] failed to mark task failed:', err);
        }
      }

      await appendLedger('tool_call_rejected', {skillName, approvalId});

      return {status: 'rejected', riskLevel, approvalId};
    }

    // Approved → resume task to running and continue execution
    if (approvalId != null) {
      try {
        db.prepare(
          `UPDATE tool_approvals SET status = 'approved', reviewed_at = datetime('now') WHERE id = ?`,
        ).run(approvalId);
      } catch (err) {
        console.error('[toolGuard] failed to mark approval approved:', err);
      }
    }
    if (taskId != null) {
      try {
        db.prepare(
          `UPDATE agent_tasks SET status = 'running', updated_at = datetime('now') WHERE id = ?`,
        ).run(taskId);
      } catch (err) {
        console.error('[toolGuard] failed to resume task:', err);
      }
    }

    await appendLedger('tool_approval_granted', {skillName, approvalId});
  }

  // 3. Execute
  let result: T;
  try {
    result = await executor();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendLedger('tool_call_failed', {skillName, error: message});
    return {status: 'failed', riskLevel, error: message};
  }

  // 4. Ledger — after
  await appendLedger('tool_call_completed', {skillName, resultPreview: preview(result)});

  // 5. For medium/low risk: push an approval_request MessagePart as a
  // confirmation card on the current chat message.
  if (riskLevel !== 'high' && messageId != null) {
    pushApprovalRequestMessagePart(messageId, skillName, args);
  }

  return {status: 'completed', riskLevel, result};
}

/**
 * Appends an `approval_request` MessagePart to the `render_json` of the given
 * chat message. Uses a synthetic negative approvalId to indicate "informational
 * only" (no actual tool_approvals row).
 */
function pushApprovalRequestMessagePart(
  messageId: number,
  skillName: string,
  args: Record<string, unknown>,
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

    parts.push({
      type: 'approval_request',
      approvalId: -1,
      skillName,
      argsPreview: preview(args),
      // Informational only — user can ignore and the Agent auto-continues.
      autoApproved: true,
    });

    db.prepare(`UPDATE chat_messages SET render_json = ? WHERE id = ?`).run(
      JSON.stringify(parts),
      messageId,
    );
  } catch (err) {
    console.warn('[toolGuard] failed to push approval_request MessagePart:', err);
  }
}
