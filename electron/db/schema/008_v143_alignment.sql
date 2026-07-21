-- v1.4.3 基础架构对齐迁移：补充 Assistant Runtime、工具审批、队列、反思假设、检索日志
-- 及 provider metadata 字段

-- 1. projects 扩展
ALTER TABLE projects ADD COLUMN industry TEXT;
ALTER TABLE projects ADD COLUMN region TEXT;
ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active';

-- 2. knowledge_entries 扩展
ALTER TABLE knowledge_entries ADD COLUMN metadata_json TEXT;

-- 3. chat_sessions 扩展
ALTER TABLE chat_sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE chat_sessions ADD COLUMN last_provider_response_id TEXT;

-- 4. chat_messages 扩展
ALTER TABLE chat_messages ADD COLUMN intent TEXT;
ALTER TABLE chat_messages ADD COLUMN metadata_json TEXT;

-- 9. publish_records 扩展
ALTER TABLE publish_records ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE publish_records ADD COLUMN channel_type TEXT;
ALTER TABLE publish_records ADD COLUMN publish_title TEXT;
ALTER TABLE publish_records ADD COLUMN external_id TEXT;
ALTER TABLE publish_records ADD COLUMN estimated_price REAL;
ALTER TABLE publish_records ADD COLUMN actual_price REAL;
ALTER TABLE publish_records ADD COLUMN published_at TEXT;

-- 10. visibility_checks 扩展（对齐 v1.4.3 Responses API + doubao_app）
ALTER TABLE visibility_checks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE visibility_checks ADD COLUMN artifact_id INTEGER;
ALTER TABLE visibility_checks ADD COLUMN target_engine TEXT DEFAULT 'doubao';
ALTER TABLE visibility_checks ADD COLUMN check_provider TEXT DEFAULT 'doubao';
ALTER TABLE visibility_checks ADD COLUMN check_api_mode TEXT DEFAULT 'responses';
ALTER TABLE visibility_checks ADD COLUMN check_tool_type TEXT DEFAULT 'doubao_app';
ALTER TABLE visibility_checks ADD COLUMN check_feature TEXT;
ALTER TABLE visibility_checks ADD COLUMN check_method TEXT DEFAULT 'doubao_app_ai_search';
ALTER TABLE visibility_checks ADD COLUMN provider_response_id TEXT;
ALTER TABLE visibility_checks ADD COLUMN published_url TEXT;
ALTER TABLE visibility_checks ADD COLUMN mentioned BOOLEAN DEFAULT FALSE;
ALTER TABLE visibility_checks ADD COLUMN cited BOOLEAN DEFAULT FALSE;
ALTER TABLE visibility_checks ADD COLUMN citation_urls_json TEXT;
ALTER TABLE visibility_checks ADD COLUMN answer_text TEXT;
ALTER TABLE visibility_checks ADD COLUMN search_summary TEXT;
ALTER TABLE visibility_checks ADD COLUMN matched_snippets_json TEXT;
ALTER TABLE visibility_checks ADD COLUMN raw_response_json TEXT;

-- 11. model_call_logs 扩展
ALTER TABLE model_call_logs ADD COLUMN run_id INTEGER;
ALTER TABLE model_call_logs ADD COLUMN stage TEXT;
ALTER TABLE model_call_logs ADD COLUMN provider TEXT;
ALTER TABLE model_call_logs ADD COLUMN api_mode TEXT;
ALTER TABLE model_call_logs ADD COLUMN provider_response_id TEXT;
ALTER TABLE model_call_logs ADD COLUMN previous_response_id TEXT;
ALTER TABLE model_call_logs ADD COLUMN provider_event_id TEXT;
ALTER TABLE model_call_logs ADD COLUMN skill_name TEXT;
ALTER TABLE model_call_logs ADD COLUMN prompt_version TEXT;
ALTER TABLE model_call_logs ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE model_call_logs ADD COLUMN latency_ms INTEGER;
ALTER TABLE model_call_logs ADD COLUMN cost_estimate REAL;
ALTER TABLE model_call_logs ADD COLUMN status TEXT;
ALTER TABLE model_call_logs ADD COLUMN error_message TEXT;

-- 12. knowledge_chunk_vectors 扩展
ALTER TABLE knowledge_chunk_vectors ADD COLUMN embedding_provider TEXT DEFAULT 'doubao';

-- 13. Assistant Runtime 表
CREATE TABLE IF NOT EXISTS assistant_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  current_step TEXT,
  provider TEXT,
  provider_api TEXT,
  provider_response_id TEXT,
  previous_response_id TEXT,
  input_json TEXT,
  output_json TEXT,
  error_id INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_runs_session_id ON assistant_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_assistant_runs_request_id ON assistant_runs(request_id);
CREATE INDEX IF NOT EXISTS idx_assistant_runs_status ON assistant_runs(status);

CREATE TABLE IF NOT EXISTS assistant_stream_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  message_id INTEGER,
  run_id INTEGER REFERENCES assistant_runs(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_stream_events_run_id ON assistant_stream_events(run_id);
CREATE INDEX IF NOT EXISTS idx_assistant_stream_events_request_id ON assistant_stream_events(request_id);

CREATE TABLE IF NOT EXISTS assistant_tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  run_id INTEGER REFERENCES assistant_runs(id) ON DELETE CASCADE,
  message_id INTEGER,
  project_id INTEGER,
  provider TEXT,
  provider_api TEXT,
  provider_tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  tool_namespace TEXT,
  arguments_json TEXT,
  result_json TEXT,
  result_summary TEXT,
  status TEXT DEFAULT 'requested',
  approval_required BOOLEAN DEFAULT FALSE,
  approval_id INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_tool_calls_run_id ON assistant_tool_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_assistant_tool_calls_status ON assistant_tool_calls(status);

CREATE TABLE IF NOT EXISTS tool_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_call_id INTEGER NOT NULL REFERENCES assistant_tool_calls(id) ON DELETE CASCADE,
  requested_by TEXT DEFAULT 'assistant',
  approval_type TEXT NOT NULL,
  status TEXT DEFAULT 'requested',
  reviewer_note TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_approvals_status ON tool_approvals(status);

CREATE TABLE IF NOT EXISTS assistant_queue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  run_id INTEGER REFERENCES assistant_runs(id) ON DELETE CASCADE,
  parent_id INTEGER,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  order_index INTEGER DEFAULT 0,
  collapsible BOOLEAN DEFAULT TRUE,
  collapsed BOOLEAN DEFAULT FALSE,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_queue_items_run_id ON assistant_queue_items(run_id);
CREATE INDEX IF NOT EXISTS idx_assistant_queue_items_status ON assistant_queue_items(status);

CREATE TABLE IF NOT EXISTS assistant_reasoning_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  run_id INTEGER REFERENCES assistant_runs(id) ON DELETE CASCADE,
  message_id INTEGER,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT DEFAULT 'running',
  order_index INTEGER DEFAULT 0,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_reasoning_steps_run_id ON assistant_reasoning_steps(run_id);

-- 14. 反思假设系统
CREATE TABLE IF NOT EXISTS reflection_hypotheses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  industry TEXT,
  channel_name TEXT,
  target_stage TEXT NOT NULL,
  hypothesis_type TEXT NOT NULL,
  content TEXT NOT NULL,
  positive_examples INTEGER DEFAULT 0,
  negative_examples INTEGER DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  effect_score REAL DEFAULT 0,
  confidence REAL DEFAULT 0,
  status TEXT DEFAULT 'candidate',
  last_validated_at TEXT,
  decay_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reflection_hypotheses_status ON reflection_hypotheses(status);

CREATE TABLE IF NOT EXISTS reflection_hypothesis_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_id INTEGER NOT NULL REFERENCES reflection_hypotheses(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id INTEGER,
  visibility_check_id INTEGER,
  evidence_type TEXT NOT NULL,
  evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reflection_hypothesis_evidence_hypothesis_id ON reflection_hypothesis_evidence(hypothesis_id);

-- 15. 检索日志
CREATE TABLE IF NOT EXISTS retrieval_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  fact_hit_count INTEGER DEFAULT 0,
  keyword_hit_count INTEGER DEFAULT 0,
  vector_hit_count INTEGER DEFAULT 0,
  selected_evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_retrieval_logs_project_id ON retrieval_logs(project_id);
