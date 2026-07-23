-- Phase 7：信源发现「采用 / 跳过」决策持久化
-- source_decisions 存储 SourceDiscoveryView 阶段用户对每个推荐信源的决策，
-- 以 project_id + target_question + url 为唯一键，便于重新进入视图时恢复状态，
-- 并在文章生成时把「采用」的信源写入 article_artifacts_meta.source_recommendation。

CREATE TABLE IF NOT EXISTS source_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_question TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  relevance_reason TEXT,
  decision TEXT NOT NULL CHECK(decision IN ('adopted', 'skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, target_question, url)
);

CREATE INDEX IF NOT EXISTS idx_source_decisions_project_question
  ON source_decisions(project_id, target_question);
