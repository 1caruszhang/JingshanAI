-- v1.4.6 Agent-first Task Runtime 基础表
-- 为已有数据库补充 agent_tasks、agent_task_steps、execution_ledger、agent_artifacts、agent_locks

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
