export async function acquireLock(_lockKey: string, _taskId: number, _owner: string, _ttlMs?: number): Promise<boolean> {
  throw new Error('AgentLockManager.acquireLock not implemented');
}

export async function releaseLock(_lockKey: string, _owner: string): Promise<void> {
  throw new Error('AgentLockManager.releaseLock not implemented');
}
