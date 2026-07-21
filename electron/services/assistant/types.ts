export type AssistantQueueItem = {
  id: number;
  session_id: number | null;
  run_id: number | null;
  parent_id: number | null;
  item_type: string;
  title: string;
  description: string | null;
  status: string;
  order_index: number;
  collapsible: boolean;
  collapsed: boolean;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type AssistantStreamEvent =
  | {type: 'message_start'; messageId?: number; runId?: number; requestId: string}
  | {
      type: 'run_progress';
      messageId?: number;
      runId?: number;
      requestId?: string;
      status: string;
    }
  | {
      type: 'output_item_added';
      messageId?: number;
      runId?: number;
      itemId?: string;
      itemType: string;
    }
  | {type: 'reasoning_step_start'; stepId: string; title: string}
  | {type: 'reasoning_step_delta'; stepId: string; delta: string}
  | {type: 'text_delta'; messageId?: number; runId?: number; delta: string}
  | {
      type: 'text_segment_completed';
      messageId?: number;
      runId?: number;
      text?: string;
      rawEvent?: unknown;
    }
  | {type: 'reasoning_step_completed'; stepId: string; title: string}
  | {type: 'search_progress'; stepId: string; message?: string; rawEvent?: unknown}
  | {type: 'search_completed'; stepId: string; resultsSummary?: string; rawEvent?: unknown}
  | {type: 'reasoning_search_completed'; stepId: string; resultsSummary?: string; rawEvent?: unknown}
  | {
      type: 'message_text_done';
      messageId?: number;
      runId?: number;
      text?: string;
      rawEvent?: unknown;
    }
  | {
      type: 'tool_call_requested';
      toolCallId?: number;
      toolName: string;
      argumentsPreview: unknown;
      approvalRequired: boolean;
    }
  | {
      type: 'approval_requested';
      approvalId?: number;
      toolCallId?: number;
      title: string;
      description?: string;
    }
  | {type: 'tool_call_started'; toolCallId?: number}
  | {type: 'tool_call_result'; toolCallId?: number; resultSummary: string}
  | {type: 'queue_item_updated'; item: AssistantQueueItem}
  | {type: 'message_completed'; messageId?: number; runId?: number}
  | {type: 'message_interrupted'; messageId?: number; runId?: number; reason: string}
  | {
      type: 'error';
      errorId?: number;
      message: string;
      recoverable: boolean;
      retryable: boolean;
    };
