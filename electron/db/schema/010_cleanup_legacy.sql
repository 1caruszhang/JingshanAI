-- v1.5 清理迁移：删除旧 GEO Workflow 表，补齐 enterprise_facts 溯源字段与 app_errors 表
-- 说明：旧表（geo_runs / geo_run_steps / geo_artifacts / human_approvals / reflection_rules）
-- 不再被应用使用；开发环境数据无价值，本迁移直接删除。

DROP TABLE IF EXISTS geo_run_steps;
DROP TABLE IF EXISTS geo_artifacts;
DROP TABLE IF EXISTS human_approvals;
DROP TABLE IF EXISTS reflection_rules;
DROP TABLE IF EXISTS geo_runs;

-- 全局错误记录表
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

-- 重建 enterprise_facts，补齐文档要求的溯源字段
ALTER TABLE enterprise_facts RENAME TO enterprise_facts_legacy;

CREATE TABLE enterprise_facts (
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

INSERT INTO enterprise_facts (
  id, project_id, fact_type, fact_key, fact_value, confidence,
  source_entry_id, source_chunk_id, source_quote, extraction_model, extraction_prompt_version,
  status, created_at
)
SELECT
  id, project_id, fact_type, fact_key, fact_value, confidence,
  NULL, NULL, NULL, NULL, NULL,
  status, created_at
FROM enterprise_facts_legacy;

DROP TABLE enterprise_facts_legacy;
