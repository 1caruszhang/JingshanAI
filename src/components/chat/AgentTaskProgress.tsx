'use client';

import { useEffect, useState } from 'react';
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import { useTheme } from '@/hooks/use-theme';
import { agentTaskApi } from '@/lib/electron-api';
import type { AgentTask, AgentTaskStep, StepStatus } from '@/types/domain';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';

const STEP_LABELS: Record<string, string> = {
  plan: '分析用户意图',
  tool_call: '调用工具',
  skill_call: '调用技能',
  subagent_call: '调用子 Agent',
  validation: '验证结果',
  approval_request: '等待审批',
  artifact_write: '写入产物',
  retry: '重试',
  recovery: '恢复',
  final_response: '生成回答',
};

function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />;
    case 'cancelled':
      return <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />;
    case 'pending':
    default:
      return <Circle className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}

interface AgentTaskProgressProps {
  taskId: number;
  onDone?: () => void;
}

const RUNNING_STATUSES = new Set<AgentTask['status']>([
  'created',
  'planning',
  'running',
  'waiting_user_input',
  'waiting_approval',
  'waiting_external_result',
  'retrying',
]);

export default function AgentTaskProgress({ taskId, onDone }: AgentTaskProgressProps) {
  const { t } = useTheme();
  const [steps, setSteps] = useState<AgentTaskStep[]>([]);
  const [task, setTask] = useState<AgentTask | null>(null);

  useEffect(() => {
    let mounted = true;
    let doneCalled = false;

    const fetchState = async () => {
      try {
        const [taskData, stepsData] = await Promise.all([
          agentTaskApi.get(taskId),
          agentTaskApi.timeline(taskId),
        ]);
        if (!mounted) return;

        setTask(taskData);
        setSteps(stepsData ?? []);

        if (taskData && !RUNNING_STATUSES.has(taskData.status) && !doneCalled) {
          doneCalled = true;
          onDone?.();
        }
      } catch {
        // 轮询失败时静默忽略，避免打断用户体验
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 500);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [taskId, onDone]);

  const visibleSteps = steps.length > 0
    ? steps
    : ([{ id: 0, step_type: 'plan', status: 'running' }] as AgentTaskStep[]);

  return (
    <Task className="w-full max-w-3xl mx-auto">
      <TaskTrigger title={t.chatAgentTaskTitle} />
      <TaskContent>
        {visibleSteps.map((step) => (
          <TaskItem key={step.id}>
            <div className="flex items-center gap-2">
              <StepStatusIcon status={step.status} />
              <span className="text-foreground">{STEP_LABELS[step.step_type] ?? step.step_type}</span>
            </div>
          </TaskItem>
        ))}
        {task?.status === 'failed' && task.current_objective && (
          <TaskItem>
            <span className="text-red-500 text-xs">{task.current_objective}</span>
          </TaskItem>
        )}
      </TaskContent>
    </Task>
  );
}
