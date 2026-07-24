'use client';

/**
 * AgentTaskProgress.tsx
 *
 * #81: 从 SQLite 轮询切换到 IPC 事件流驱动，双视觉权重渲染。
 *
 * - 可折叠 "思考过程" 区域：plan + subagent 时间线（text-xs + muted）
 * - 主视觉 "结果" 区域：CEO 最终回复（完整字重/颜色）
 * - HITL 中断卡片：统一通过事件流触发
 */

import {useEffect, useState, useCallback, useReducer, useRef} from 'react';
import {Task, TaskContent, TaskItem, TaskTrigger} from '@/components/ai-elements/task';
import {useTheme} from '@/hooks/use-theme';
import {agentTaskApi} from '@/lib/electron-api';
import type {AgentTask, CeoEvent} from '@/types/domain';
import {CheckCircle2, Circle, Loader2, XCircle, Brain, ChevronDown} from 'lucide-react';
import InterruptApprovalCard from './InterruptApprovalCard';

// ─── Subagent 状态 ───────────────────────────────────────────────────────────

interface SubagentState {
  name: string;
  description?: string;
  status: 'running' | 'completed';
}

interface PlanState {
  intent?: string;
  skill?: string;
  todos?: Array<{content: string; status: string}>;
}

interface StepState {
  subagent: string;
  tool: string;
  status: 'running' | 'completed' | 'failed';
}

type UiPhase = 'planning' | 'executing' | 'aggregating' | 'replying' | 'completed' | 'failed' | 'interrupted';

interface ProgressState {
  phase: UiPhase;
  plan: PlanState | null;
  subagents: SubagentState[];
  steps: StepState[];
  ceoOutput: string;
  /** #88: 流式渐进的回复文本（reply_delta 逐 token 累积） */
  streamingReply: string;
  /** #88: 中间推理文本，在思考过程折叠区展示 */
  thinkingTexts: string[];
  interruptData: unknown[] | null;
  error: string | null;
}

const initialState: ProgressState = {
  phase: 'planning',
  plan: null,
  subagents: [],
  steps: [],
  ceoOutput: '',
  streamingReply: '',
  thinkingTexts: [],
  interruptData: null,
  error: null,
};

type ProgressAction =
  | {type: 'event'; event: CeoEvent}
  | {type: 'reset'};

function progressReducer(state: ProgressState, action: ProgressAction): ProgressState {
  if (action.type === 'reset') return initialState;

  const {event} = action;

  switch (event.type) {
    case 'plan_created':
      return {
        ...state,
        phase: 'executing',
        plan: {
          intent: event.data.plan?.intent,
          skill: event.data.plan?.skill,
          todos: event.data.plan?.todos,
        },
        steps: [
          ...state.steps,
          {
            subagent: 'ceo',
            tool: 'intent_router',
            status: 'completed',
          },
        ],
      };

    case 'subagent_dispatched':
      return {
        ...state,
        phase: 'executing',
        subagents: [
          ...state.subagents,
          {
            name: event.data.subagent?.name ?? 'unknown',
            description: event.data.subagent?.description,
            status: 'running',
          },
        ],
        steps: [
          ...state.steps,
          {
            subagent: event.data.subagent?.name ?? 'unknown',
            tool: 'task',
            status: 'running',
          },
        ],
      };

    case 'subagent_completed': {
      const saName = event.data.result?.subagent ?? 'unknown';
      return {
        ...state,
        subagents: state.subagents.map((sa) =>
          sa.name === saName ? {...sa, status: 'completed' as const} : sa,
        ),
        steps: [
          ...state.steps,
          {
            subagent: saName,
            tool: 'task',
            status: 'completed',
          },
        ],
      };
    }

    case 'aggregating':
      return {
        ...state,
        phase: 'aggregating',
        steps: [
          ...state.steps,
          {
            subagent: event.data.step?.subagent ?? 'ceo',
            tool: event.data.step?.tool ?? 'query',
            status: event.data.step?.status ?? 'completed',
          },
        ],
      };

    case 'reply_delta':
      return {
        ...state,
        phase: 'replying',
        streamingReply: state.streamingReply + (event.data.delta ?? ''),
      };

    case 'completed':
      return {
        ...state,
        phase: 'completed',
        ceoOutput: event.data.finalReply ?? state.streamingReply,
        streamingReply: '',
        thinkingTexts: event.data.thinkingTexts ?? [],
      };

    case 'interrupted':
      return {
        ...state,
        phase: 'interrupted',
        interruptData: event.data.interrupt ?? null,
      };

    case 'error':
      return {
        ...state,
        phase: 'failed',
        error: event.data.error ?? '未知错误',
      };

    default:
      return state;
  }
}

// ─── 状态图标组件 ─────────────────────────────────────────────────────────────

function StatusDot({status}: {status: 'running' | 'completed' | 'failed'}) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />;
    case 'failed':
      return <XCircle className="w-3 h-3 text-red-500 shrink-0" />;
    case 'running':
      return <Loader2 className="w-3 h-3 text-primary shrink-0 animate-spin" />;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgentTaskProgressProps {
  taskId: number;
  onDone?: () => void;
  /** #88: 任务完成时回调，携带最终回复文本（供 ChatInterface 持久化） */
  onCompleted?: (reply: string) => void;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function AgentTaskProgress({taskId, onDone, onCompleted}: AgentTaskProgressProps) {
  const {t} = useTheme();
  const [state, dispatch] = useReducer(progressReducer, initialState);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const completedRef = useRef(false);
  // #fix: ref 同步最新 state，轮询闭包中读取最新 streamingReply
  const stateRef = useRef(initialState);
  stateRef.current = state;

  const handleInterruptResolved = useCallback(() => {
    // #88: 重置 completedRef，使 resume 后的 completed 能再次触发 onCompleted
    completedRef.current = false;
    dispatch({type: 'reset'});
  }, []);

  // #88: completed 事件到达时，通知 ChatInterface 持久化最终回复
  useEffect(() => {
    if (state.phase === 'completed' && !completedRef.current) {
      completedRef.current = true;
      onCompleted?.(state.ceoOutput);
    }
  }, [state.phase, state.ceoOutput, onCompleted]);

  useEffect(() => {
    let mounted = true;
    let doneCalled = false;

    // 订阅 CEO 事件流
    const cleanupEvent = agentTaskApi.onEvent((event) => {
      if (!mounted || event.taskId !== taskId) return;
      dispatch({type: 'event', event});
    });

    /**
     * #fix: 统一终态出口。轮询/初始加载检测到终态时，必须先把最终回复回填到 UI
     * （onCompleted）再卸载组件（onDone），否则"CEO 正在汇总结果..."和思考过程
     * 折叠区会随组件卸载一起消失，而消息列表却没有新 assistant 消息 → UI 空白。
     *
     * 回复来源优先级：
     *   1. stateRef.streamingReply（reply_delta 累积，最完整）
     *   2. agent_artifacts 中 artifact_type='agent_response' 的 content
     *      （runtime 在 emit completed 之前已写入 DB，是权威兜底来源）
     *
     * completedRef 只在 onCompleted 真正被调用前置位，避免空回复提前占位
     * 导致后续 completed 事件无法补触发。
     */
    const finalizeTerminal = async (status: string) => {
      if (doneCalled) return;
      doneCalled = true;

      if (status === 'completed' && !completedRef.current) {
        let reply = stateRef.current.streamingReply;
        if (!reply) {
          // 兜底：从 agent_artifacts 拉取已落盘的最终回复
          try {
            const artifacts = await agentTaskApi.artifacts(taskId);
            const resp = (artifacts ?? []).find(
              (a) => a.artifact_type === 'agent_response',
            );
            if (resp?.content) reply = resp.content;
          } catch {
            // artifacts 拉取失败，静默降级
          }
        }
        if (reply) {
          completedRef.current = true;
          onCompleted?.(reply);
        }
      }
      onDone?.();
    };

    // 初始加载：从 DB 获取当前 task 状态（事件流可能在组件挂载前已经开始）
    agentTaskApi.get(taskId).then(async (task) => {
      if (!mounted || !task) return;
      setTaskStatus(task.status);

      const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
      if (terminalStatuses.has(task.status)) {
        await finalizeTerminal(task.status);
      }
    });

    // 轮询检查 task 终态（事件流可能因网络/渲染原因丢失 completed 事件）
    const pollInterval = setInterval(async () => {
      if (!mounted || doneCalled) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const task = await agentTaskApi.get(taskId);
        if (!mounted || !task) return;
        setTaskStatus(task.status);

        const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
        if (terminalStatuses.has(task.status)) {
          await finalizeTerminal(task.status);
        }
      } catch {
        // 静默忽略轮询失败
      }
    }, 1000);

    return () => {
      mounted = false;
      cleanupEvent();
      clearInterval(pollInterval);
    };
  }, [taskId, onDone, onCompleted]);

  // 合并事件流 + 轮询的终止判断
  useEffect(() => {
    if (state.phase === 'completed' || state.phase === 'failed') {
      // 事件流已经告知完成，但我们也等轮询确认 taskStatus 变化
    }
  }, [state.phase]);

  // ─── 渲染 ───────────────────────────────────────────────────────────────────

  const showThinking =
    state.plan !== null ||
    state.subagents.length > 0 ||
    state.steps.length > 0 ||
    state.thinkingTexts.length > 0;

  const isTerminal = state.phase === 'completed' || state.phase === 'failed';

  return (
    <div className="w-full max-w-3xl mx-auto space-y-3">
      {/* ── 主视觉：CEO 结果（已完成且无 onCompleted 回调时显示） ── */}
      {/* #88: 有 onCompleted 时主回复由 ChatInterface 消息流接管，避免重复 */}
      {state.phase === 'completed' && state.ceoOutput && !onCompleted && (
        <div className="prose prose-sm dark:prose-invert max-w-none p-4 rounded-lg border bg-card">
          <div className="whitespace-pre-wrap text-sm text-foreground">
            {state.ceoOutput}
          </div>
        </div>
      )}

      {/* ── 流式渐进回复（reply_delta 逐 token 累积，replying 阶段显示） ── */}
      {state.phase === 'replying' && state.streamingReply && (
        <div className="prose prose-sm dark:prose-invert max-w-none p-4 rounded-lg border bg-card">
          <div className="whitespace-pre-wrap text-sm text-foreground">
            {state.streamingReply}
          </div>
        </div>
      )}

      {/* ── 正在输出中（未完成且未进入流式回复时显示占位） ── */}
      {!isTerminal && state.phase !== 'replying' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>
            {state.phase === 'planning'
              ? 'CEO 正在分析你的需求...'
              : state.phase === 'executing'
                ? 'CEO 正在协调子 Agent 执行任务...'
                : state.phase === 'aggregating'
                  ? 'CEO 正在汇总结果...'
                  : '处理中...'}
          </span>
        </div>
      )}

      {/* ── 错误状态 ── */}
      {state.phase === 'failed' && state.error && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50">
          <span className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </span>
        </div>
      )}

      {/* ── HITL 中断卡片 ── */}
      {state.phase === 'interrupted' && state.interruptData && (
        <InterruptApprovalCard
          taskId={taskId}
          interruptData={state.interruptData}
          onResolved={handleInterruptResolved}
        />
      )}

      {/* ── 可折叠思考过程 ── */}
      {showThinking && (
        <Task defaultOpen={thinkingExpanded}>
          <TaskTrigger title={t.chatAgentTaskTitle}>
            <button
              onClick={() => setThinkingExpanded(!thinkingExpanded)}
              className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
            >
              <Brain className="size-4" />
              <p className="text-xs font-medium">思考过程</p>
              <ChevronDown
                className={`size-3.5 transition-transform ${
                  thinkingExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>
          </TaskTrigger>
          <TaskContent>
            <div className="space-y-2 text-xs">
              {/* Plan */}
              {state.plan && (
                <div className="text-muted-foreground">
                  {state.plan.intent && (
                    <p>
                      <span className="font-medium text-foreground/70">意图：</span>
                      {state.plan.intent}
                    </p>
                  )}
                  {state.plan.skill && (
                    <p>
                      <span className="font-medium text-foreground/70">匹配技能：</span>
                      {state.plan.skill}
                    </p>
                  )}
                  {state.plan.todos && state.plan.todos.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {state.plan.todos.map((todo, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <StatusDot
                            status={
                              todo.status === 'completed'
                                ? 'completed'
                                : todo.status === 'in_progress'
                                  ? 'running'
                                  : 'failed'
                            }
                          />
                          <span>{todo.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Subagent 时间线 */}
              {state.subagents.map((sa, i) => (
                <div key={`${sa.name}-${i}`} className="flex items-center gap-2">
                  <StatusDot status={sa.status} />
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground/70">
                      {sa.name}
                    </span>
                    {sa.description ? ` — ${sa.description}` : ''}
                  </span>
                </div>
              ))}

              {/* 额外步骤（针对没有 subagent 的步骤） */}
              {state.steps
                .filter(
                  (s) =>
                    !state.subagents.some(
                      (sa) =>
                        sa.name === s.subagent &&
                        s.tool === 'task',
                    ) && s.tool !== 'task',
                )
                .slice(-5) // 最多显示最近 5 条
                .map((step, i) => (
                  <div key={`step-${i}`} className="flex items-center gap-2">
                    <StatusDot status={step.status} />
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground/70">
                        {step.subagent}
                      </span>
                      {' · '}
                      {step.tool}
                    </span>
                  </div>
                ))}

              {/* #88: 中间推理文本（规划/身份确认/工具调用后评估），小字号灰阶色 */}
              {state.thinkingTexts.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                  {state.thinkingTexts.map((text, i) => (
                    <p
                      key={`thinking-${i}`}
                      className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap"
                    >
                      {text}
                    </p>
                  ))}
                </div>
              )}

              {/* 思考过程仍在进行中 */}
              {!isTerminal && (
                <div className="flex items-center gap-2 text-muted-foreground/60">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>思考中...</span>
                </div>
              )}
            </div>
          </TaskContent>
        </Task>
      )}
    </div>
  );
}
