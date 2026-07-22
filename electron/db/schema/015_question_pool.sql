-- Phase 7：问题池（question pool）
-- 存储由 LLM 生成或人工添加的目标问题，供文章生成流程选用

CREATE TABLE IF NOT EXISTS question_pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'target',
  status TEXT NOT NULL DEFAULT 'candidate',
  score REAL,
  score_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_question_pools_project ON question_pools(project_id);
CREATE INDEX IF NOT EXISTS idx_question_pools_status ON question_pools(status);
