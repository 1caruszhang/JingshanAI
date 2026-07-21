-- projects: 项目表
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- knowledge_entries: 知识库原始条目（project = 公司 = 知识库）
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  source_type TEXT,
  source_file_path TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- knowledge_chunks: 知识库切片
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT,
  token_count INTEGER,
  metadata_json TEXT,
  quality_score REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 关键词索引
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts USING fts5(
  chunk_text,
  entry_title,
  source_type,
  content='knowledge_chunks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai
AFTER INSERT ON knowledge_chunks
BEGIN
  INSERT INTO knowledge_chunk_fts(rowid, chunk_text, entry_title, source_type)
  VALUES (
    new.id,
    new.chunk_text,
    (SELECT title FROM knowledge_entries WHERE id = new.entry_id),
    (SELECT source_type FROM knowledge_entries WHERE id = new.entry_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad
AFTER DELETE ON knowledge_chunks
BEGIN
  DELETE FROM knowledge_chunk_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_au
AFTER UPDATE ON knowledge_chunks
BEGIN
  DELETE FROM knowledge_chunk_fts WHERE rowid = old.id;
  INSERT INTO knowledge_chunk_fts(rowid, chunk_text, entry_title, source_type)
  VALUES (
    new.id,
    new.chunk_text,
    (SELECT title FROM knowledge_entries WHERE id = new.entry_id),
    (SELECT source_type FROM knowledge_entries WHERE id = new.entry_id)
  );
END;

-- knowledge_chunk_vectors: 向量映射表（Adapter 模式）
-- 实际向量存储在 sqlite-vec 虚拟表 vec_knowledge_embeddings 中，
-- 此处只保存 chunk_id 与 vec_rowid 的映射关系及元数据。
CREATE TABLE IF NOT EXISTS knowledge_chunk_vectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL UNIQUE REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  vec_rowid INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kcv_project_id ON knowledge_chunk_vectors(project_id);
CREATE INDEX IF NOT EXISTS idx_kcv_chunk_id ON knowledge_chunk_vectors(chunk_id);
CREATE INDEX IF NOT EXISTS idx_kcv_vec_rowid ON knowledge_chunk_vectors(vec_rowid);

CREATE TABLE IF NOT EXISTS vector_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- enterprise_facts: 企业结构化事实
CREATE TABLE IF NOT EXISTS enterprise_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT,
  confidence REAL DEFAULT 1.0,
  source_entry_id INTEGER,
  source_chunk_id INTEGER,
  source_quote TEXT,
  extraction_model TEXT,
  extraction_prompt_version TEXT,
  status TEXT DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- chat_sessions: 聊天会话（公共会话，不绑定 project）
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  session_type TEXT DEFAULT 'public',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- chat_messages: 聊天消息（004 迁移会补充 project_id）
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model TEXT,
  -- render_json 由迁移 011 统一添加，保持 001 与后续迁移无冲突
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- publish_records: 发布记录
CREATE TABLE IF NOT EXISTS publish_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER,
  platform TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- visibility_checks: 可见性检测
CREATE TABLE IF NOT EXISTS visibility_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publish_record_id INTEGER REFERENCES publish_records(id) ON DELETE CASCADE,
  query TEXT,
  rank INTEGER,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- model_call_logs: 模型调用日志
CREATE TABLE IF NOT EXISTS model_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- app_errors: 全局错误记录
CREATE TABLE IF NOT EXISTS app_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_code TEXT,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  context_json TEXT,
  recoverable BOOLEAN DEFAULT FALSE,
  retryable BOOLEAN DEFAULT FALSE,
  task_id INTEGER,
  step_id INTEGER,
  run_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- app_settings: 应用配置
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 默认配置
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('vec_enabled', 'true');

-- assistant_runs: 助手运行记录
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

-- assistant_stream_events: 流式事件持久化
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

-- assistant_tool_calls: 工具调用审计
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

-- tool_approvals: 高风险工具审批
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

-- assistant_queue_items: 队列 / 待办 / 可折叠任务
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

-- assistant_reasoning_steps: 推理步骤摘要
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

-- reflection_hypotheses: 优化假设
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

-- reflection_hypothesis_evidence: 优化假设证据
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

-- retrieval_logs: 检索日志
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

-- agent_tasks: Agent-first 任务运行记录
CREATE TABLE IF NOT EXISTS agent_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  project_id INTEGER,
  title TEXT,
  user_goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  current_objective TEXT,
  last_action TEXT,
  risk_level TEXT DEFAULT 'low',
  allowed_actions_json TEXT,
  context_snapshot_json TEXT,
  budget_json TEXT,
  usage_json TEXT,
  failure_count INTEGER DEFAULT 0,
  loop_count INTEGER DEFAULT 0,
  max_loop_count INTEGER DEFAULT 12,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_project_id ON agent_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_session_id ON agent_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);

-- agent_task_steps: Agent 任务步骤
CREATE TABLE IF NOT EXISTS agent_task_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  parent_step_id INTEGER,
  step_type TEXT NOT NULL,
  action_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  input_json TEXT,
  output_json TEXT,
  validation_json TEXT,
  error_id INTEGER,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 2,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_task_steps_task_id ON agent_task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_steps_status ON agent_task_steps(status);

-- execution_ledger: Agent 执行审计日志
CREATE TABLE IF NOT EXISTS execution_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  step_id INTEGER,
  project_id INTEGER,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_name TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_execution_ledger_task_id ON execution_ledger(task_id);
CREATE INDEX IF NOT EXISTS idx_execution_ledger_project_id ON execution_ledger(project_id);

-- agent_artifacts: Agent 产物（草稿、报告、计划等）
CREATE TABLE IF NOT EXISTS agent_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  project_id INTEGER,
  artifact_type TEXT NOT NULL,
  title TEXT,
  content TEXT,
  metadata_json TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_task_id ON agent_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_project_id ON agent_artifacts(project_id);

-- agent_locks: Agent 任务并发锁
CREATE TABLE IF NOT EXISTS agent_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL UNIQUE,
  task_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_locks_expires_at ON agent_locks(expires_at);
