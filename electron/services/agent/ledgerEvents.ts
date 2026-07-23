/**
 * ledgerEvents.ts
 *
 * Shared primitives for the agent tool-guard ledger: the event-type union and
 * a small preview helper used when recording tool payloads to execution_ledger.
 *
 * Centralising these here removes duplicated string literals and duplicated
 * preview helpers across toolGuard.ts and geoAgentFactory.ts.
 */

export type LedgerEventType =
  | 'tool_call_requested'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'tool_approval_requested'
  | 'tool_approval_granted'
  | 'tool_call_rejected';

/**
 * Truncates a JSON-serialisable value to a short preview string for ledger
 * payload storage. Never throws.
 */
export function preview(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return String(value).slice(0, 200);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return String(value).slice(0, 200);
  }
}
