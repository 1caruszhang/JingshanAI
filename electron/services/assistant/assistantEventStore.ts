import {getDb} from '../../db/connection.ts';
import type {AssistantStreamEventRecord} from '@/types/domain';

export function storeEvent(
  runId: number,
  eventType: string,
  eventJson: unknown,
  requestId?: string,
): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO assistant_stream_events
       (run_id, request_id, event_type, event_json, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(runId, requestId ?? '', eventType, JSON.stringify(eventJson));
  } catch {
    // Non-blocking: don't let storage failure break the stream
  }
}

export function getEvents(runId: number): AssistantStreamEventRecord[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM assistant_stream_events WHERE run_id = ? ORDER BY created_at')
    .all(runId) as AssistantStreamEventRecord[];
}
