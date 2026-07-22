-- Migration 017: 将 assistant_runs.session_id 改为可空
-- 背景: session_id 原为 NOT NULL REFERENCES chat_sessions，导致无 session 场景下
--       assistant:streamStart 因外键约束失败。Phase 8 真流式实现需要支持无 session 调用。
--
-- SQLite 不支持 ALTER COLUMN，使用 rename → recreate → copy → drop 模式。
-- 注意: 保留原有 ON DELETE CASCADE 语义（删除 session 时联删 runs），
--       仅去掉 NOT NULL 约束，允许 session_id 为 NULL。

PRAGMA foreign_keys = OFF;

-- 1. 保留旧表数据，重命名为临时表
ALTER TABLE assistant_runs RENAME TO assistant_runs_old;

-- 2. 重建表，session_id 改为可空（保留 ON DELETE CASCADE，仅去掉 NOT NULL）
CREATE TABLE assistant_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
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

-- 3. 复制所有现有数据（显式列列表，不依赖列顺序）
INSERT INTO assistant_runs (
  id, session_id, project_id, request_id, run_type, status,
  current_step, provider, provider_api, provider_response_id,
  previous_response_id, input_json, output_json, error_id,
  started_at, completed_at, updated_at
)
SELECT
  id, session_id, project_id, request_id, run_type, status,
  current_step, provider, provider_api, provider_response_id,
  previous_response_id, input_json, output_json, error_id,
  started_at, completed_at, updated_at
FROM assistant_runs_old;

-- 4. 删除临时旧表
DROP TABLE assistant_runs_old;

-- 5. 重建索引
CREATE INDEX IF NOT EXISTS idx_assistant_runs_session_id ON assistant_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_assistant_runs_request_id ON assistant_runs(request_id);
CREATE INDEX IF NOT EXISTS idx_assistant_runs_status ON assistant_runs(status);

PRAGMA foreign_keys = ON;
