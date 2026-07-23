import type {BrowserWindow} from 'electron';
import {createRun, updateRunStatus} from './assistantRunService.ts';
import {addMessage} from './assistantMessageService.ts';
import {storeEvent} from './assistantEventStore.ts';
import {executeStream} from '../models/modelRouter.ts';
import type {AssistantStreamEvent} from './types.ts';
import type {UnifiedChatMessage} from '../models/types.ts';
import {getDb} from '../../db/connection.ts';
import type {ChatMessage} from '@/types/domain';

export interface StartAssistantRunInput {
  sessionId?: number | null;
  projectId?: number | null;
  requestId: string;
  runType?: string;
}

// Map from requestId to AbortController for in-flight streams
const activeControllers = new Map<string, AbortController>();

// Map from requestId to pending tool-approval Promise resolvers
// used by toolApproval:respond to resume the suspended generator
const pendingApprovals = new Map<number, {resolve: (approved: boolean) => void}>();

export function resolveToolApproval(approvalId: number, approved: boolean): void {
  const pending = pendingApprovals.get(approvalId);
  if (pending) {
    pending.resolve(approved);
    pendingApprovals.delete(approvalId);
  }
}

function sendEvent(win: BrowserWindow | null, event: AssistantStreamEvent): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('assistant:event', event);
  }
}

function getHistory(sessionId: number, limit = 50): UnifiedChatMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
    )
    .all(sessionId, limit) as ChatMessage[];
  return rows.map((r) => ({role: r.role as 'user' | 'assistant' | 'system', content: r.content}));
}

function isHighRiskTool(toolName: string): boolean {
  return /write|update|delete|insert|publish/i.test(toolName);
}

export async function startRun(
  input: StartAssistantRunInput,
  mainWindow: BrowserWindow | null,
): Promise<{runId: number}> {
  const run = createRun({
    sessionId: input.sessionId,
    projectId: input.projectId,
    requestId: input.requestId,
    runType: input.runType ?? 'chat',
  });
  const runId = run.id;

  const controller = new AbortController();
  activeControllers.set(input.requestId, controller);

  // Fire-and-forget: run the streaming loop asynchronously
  void (async () => {
    // Build messages from history
    const messages: UnifiedChatMessage[] = [];
    if (input.sessionId) {
      const history = getHistory(input.sessionId);
      messages.push(...history);
    }

    let fullText = '';

    // Emit message_start
    const startEvent: AssistantStreamEvent = {
      type: 'message_start',
      runId,
      requestId: input.requestId,
    };
    sendEvent(mainWindow, startEvent);
    storeEvent(runId, 'message_start', startEvent, input.requestId);

    try {
      const stream = executeStream('chat', {messages, signal: controller.signal});

      for await (const event of stream) {
        if (controller.signal.aborted) break;

        if (event.deltaText) {
          fullText += event.deltaText;
          const delta: AssistantStreamEvent = {
            type: 'text_delta',
            runId,
            delta: event.deltaText,
          };
          sendEvent(mainWindow, delta);
          storeEvent(runId, 'text_delta', delta, input.requestId);
        }

        // Handle tool calls (Ticket 3 integration point)
        if (event.toolCall) {
          const toolCallData = event.toolCall as {name?: string; id?: string; arguments?: unknown};
          const toolName = toolCallData.name ?? 'unknown_tool';
          const toolArgs = toolCallData.arguments;

          // Write tool_call record
          const db = getDb();
          const tcResult = db
            .prepare(
              `INSERT INTO assistant_tool_calls
               (run_id, tool_name, arguments_json, status, approval_required, created_at, updated_at)
               VALUES (?, ?, ?, 'requested', ?, datetime('now'), datetime('now'))`,
            )
            .run(runId, toolName, JSON.stringify(toolArgs), isHighRiskTool(toolName) ? 1 : 0);
          const toolCallId = Number(tcResult.lastInsertRowid);

          const toolCallEvent: AssistantStreamEvent = {
            type: 'tool_call_requested',
            toolCallId,
            toolName,
            argumentsPreview: toolArgs,
            approvalRequired: isHighRiskTool(toolName),
          };
          sendEvent(mainWindow, toolCallEvent);
          storeEvent(runId, 'tool_call_requested', toolCallEvent, input.requestId);

          if (isHighRiskTool(toolName)) {
            // Insert approval record
            const approvalResult = db
              .prepare(
                `INSERT INTO tool_approvals
                 (tool_call_id, requested_by, approval_type, status, requested_at)
                 VALUES (?, 'assistant', 'write_operation', 'requested', datetime('now'))`,
              )
              .run(toolCallId);
            const approvalId = Number(approvalResult.lastInsertRowid);

            const approvalEvent: AssistantStreamEvent = {
              type: 'approval_requested',
              approvalId,
              toolCallId,
              title: `工具调用审批: ${toolName}`,
              description: JSON.stringify(toolArgs),
            };
            sendEvent(mainWindow, approvalEvent);
            storeEvent(runId, 'approval_requested', approvalEvent, input.requestId);

            // Suspend and wait for user response
            const approved = await new Promise<boolean>((resolve) => {
              pendingApprovals.set(approvalId, {resolve});
            });

            if (!approved) {
              // User rejected
              const interruptedEvent: AssistantStreamEvent = {
                type: 'message_interrupted',
                runId,
                reason: 'tool_rejected',
              };
              sendEvent(mainWindow, interruptedEvent);
              storeEvent(runId, 'message_interrupted', interruptedEvent, input.requestId);
              updateRunStatus(runId, 'interrupted');
              if (input.sessionId && fullText) {
                addMessage(input.sessionId, 'assistant', fullText, {projectId: input.projectId});
              }
              activeControllers.delete(input.requestId);
              return;
            }

            // Tool approved — emit tool_call_started before execution
            const startedEvent: AssistantStreamEvent = {
              type: 'tool_call_started',
              toolCallId,
            };
            sendEvent(mainWindow, startedEvent);
            storeEvent(runId, 'tool_call_started', startedEvent, input.requestId);

            // Execute the tool (placeholder: real tool dispatch goes here)
            const resultSummary = `工具 ${toolName} 执行完成`;
            db.prepare(
              `UPDATE assistant_tool_calls SET status = 'completed', result_summary = ?, updated_at = datetime('now') WHERE id = ?`,
            ).run(resultSummary, toolCallId);

            const resultEvent: AssistantStreamEvent = {
              type: 'tool_call_result',
              toolCallId,
              resultSummary,
            };
            sendEvent(mainWindow, resultEvent);
            storeEvent(runId, 'tool_call_result', resultEvent, input.requestId);
          } else {
            // Low-risk tool: emit started + result immediately without approval
            const startedEvent: AssistantStreamEvent = {
              type: 'tool_call_started',
              toolCallId,
            };
            sendEvent(mainWindow, startedEvent);
            storeEvent(runId, 'tool_call_started', startedEvent, input.requestId);

            const resultSummary = `工具 ${toolName} 执行完成`;
            db.prepare(
              `UPDATE assistant_tool_calls SET status = 'completed', result_summary = ?, updated_at = datetime('now') WHERE id = ?`,
            ).run(resultSummary, toolCallId);

            const resultEvent: AssistantStreamEvent = {
              type: 'tool_call_result',
              toolCallId,
              resultSummary,
            };
            sendEvent(mainWindow, resultEvent);
            storeEvent(runId, 'tool_call_result', resultEvent, input.requestId);
          }
        }
      }

      if (controller.signal.aborted) {
        // Cancelled by user
        const interruptedEvent: AssistantStreamEvent = {
          type: 'message_interrupted',
          runId,
          reason: 'cancelled',
        };
        sendEvent(mainWindow, interruptedEvent);
        storeEvent(runId, 'message_interrupted', interruptedEvent, input.requestId);
        updateRunStatus(runId, 'cancelled');
      } else {
        // Completed normally
        const completedEvent: AssistantStreamEvent = {
          type: 'message_completed',
          runId,
        };
        sendEvent(mainWindow, completedEvent);
        storeEvent(runId, 'message_completed', completedEvent, input.requestId);
        updateRunStatus(runId, 'completed');
      }

      // Persist assistant message if we have content
      if (input.sessionId && fullText) {
        addMessage(input.sessionId, 'assistant', fullText, {projectId: input.projectId});
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) {
        const interruptedEvent: AssistantStreamEvent = {
          type: 'message_interrupted',
          runId,
          reason: 'cancelled',
        };
        sendEvent(mainWindow, interruptedEvent);
        storeEvent(runId, 'message_interrupted', interruptedEvent, input.requestId);
        updateRunStatus(runId, 'cancelled');
      } else {
        const errorEvent: AssistantStreamEvent = {
          type: 'error',
          message: (err as Error)?.message ?? 'Unknown error',
          recoverable: false,
          retryable: true,
        };
        sendEvent(mainWindow, errorEvent);
        storeEvent(runId, 'error', errorEvent, input.requestId);
        updateRunStatus(runId, 'failed');
      }

      if (input.sessionId && fullText) {
        addMessage(input.sessionId, 'assistant', fullText, {projectId: input.projectId});
      }
    } finally {
      activeControllers.delete(input.requestId);
    }
  })();

  return {runId};
}

export function cancelRun(requestId: string): void {
  const controller = activeControllers.get(requestId);
  if (controller) {
    controller.abort();
  }
}
