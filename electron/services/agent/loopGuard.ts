import {getDb} from '../../db/connection';

export function checkLoopGuard(taskId: number, loopCount: number): {allowed: boolean; reason?: string} {
  const db = getDb();

  // Fetch max_loop_count for this task
  const task = db
    .prepare('SELECT max_loop_count FROM agent_tasks WHERE id = ?')
    .get(taskId) as {max_loop_count: number} | undefined;

  const maxLoops = task?.max_loop_count ?? 12;

  if (loopCount >= maxLoops) {
    // Update task status to failed
    try {
      db.prepare("UPDATE agent_tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    } catch (err) {
      console.error('[loopGuard] failed to update task status:', err);
    }
    return {allowed: false, reason: `已达到最大循环次数（${maxLoops}）`};
  }

  // Count consecutive failed steps (most recent steps that are all failed)
  const steps = db
    .prepare(
      `SELECT status FROM agent_task_steps
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
    )
    .all(taskId) as {status: string}[];

  let consecutiveFailed = 0;
  for (const step of steps) {
    if (step.status === 'failed') {
      consecutiveFailed++;
    } else {
      break;
    }
  }

  if (consecutiveFailed >= 3) {
    // Update task status to failed
    try {
      db.prepare("UPDATE agent_tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    } catch (err) {
      console.error('[loopGuard] failed to update task status:', err);
    }
    return {allowed: false, reason: '连续失败 3 次，Agent 已停止'};
  }

  return {allowed: true};
}
