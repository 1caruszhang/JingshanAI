/**
 * checkpointer.ts
 *
 * SqliteSaver 单例工厂 — 将 @langchain/langgraph-checkpoint-sqlite 接入
 * 现有 nai-agent.db，为 DeepAgents thread state 提供持久化与中断恢复能力。
 *
 * #77 Checkpointer SQLite 后端
 */

import {SqliteSaver} from '@langchain/langgraph-checkpoint-sqlite';
import {getDb} from '../../db/connection.ts';

let saver: SqliteSaver | null = null;

/**
 * 获取 SqliteSaver 单例实例。
 *
 * SqliteSaver 会在首次 put()/getTuple() 时自动创建
 * checkpoints、checkpoint_writes、checkpoint_blobs 三张表。
 * 所有数据与现有业务表共存在同一个 nai-agent.db 中。
 */
export function getCheckpointer(): SqliteSaver {
  if (!saver) {
    const db = getDb();
    saver = new SqliteSaver(db);
  }
  return saver;
}

/**
 * 从 checkpoints 表中查询指定 thread_id 是否有 pending interrupt。
 *
 * LangGraph 中断时会将 __interrupt__ 写入 checkpoint_writes，
 * 且对应的 checkpoint 记录中 checkpoint JSON 包含 __interrupt__ 通道。
 * 此函数用于启动时扫描未完成任务的中断状态。
 */
export function hasPendingInterrupt(threadId: string): boolean {
  try {
    const db = getDb();
    // SqliteSaver 在首次使用时才建表，若表不存在则说明从未执行过任务
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'")
      .get();
    if (!tableExists) return false;

    // 查询该 thread 的最新 checkpoint 是否包含 interrupt
    const row = db
      .prepare(
        `SELECT checkpoint FROM checkpoints
         WHERE thread_id = ?
         ORDER BY checkpoint_id DESC
         LIMIT 1`,
      )
      .get(threadId) as {checkpoint: string} | undefined;

    if (!row) return false;

    // checkpoint 是 JSON 序列化的，检查是否包含 __interrupt__ 通道
    const cp = JSON.parse(row.checkpoint);
    const channels = cp.channel_versions || cp.channels || {};
    return '__interrupt__' in channels;
  } catch {
    return false;
  }
}
