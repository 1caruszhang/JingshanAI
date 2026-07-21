-- MVP 必需 schema：conversation memory + article generation + claim-source + ranking
-- 对应开发文档 Phase 7（文章生成 MVP）

-- 会话摘要（长期记忆）
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  summary_type TEXT NOT NULL,
  message_start_id INTEGER,
  message_end_id INTEGER,
  summary_json TEXT NOT NULL,
  token_estimate INTEGER DEFAULT 0,
  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_session_id ON conversation_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_project_id ON conversation_summaries(project_id);

-- 记忆事件审计日志
CREATE TABLE IF NOT EXISTS memory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_type TEXT NOT NULL,
  memory_table TEXT NOT NULL,
  memory_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  reason TEXT,
  actor TEXT NOT NULL,
  task_id INTEGER,
  project_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_table, memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_events_project_id ON memory_events(project_id);

-- 文章产物元数据
CREATE TABLE IF NOT EXISTS article_artifacts_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  article_strategy_type TEXT NOT NULL,
  content_format TEXT,
  support_article_type TEXT,
  ranking_type TEXT,
  ranking_theme TEXT,
  target_question TEXT,
  title TEXT,
  title_score_json TEXT,
  applied_hypotheses_json TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_artifacts_meta_artifact_id ON article_artifacts_meta(artifact_id);
CREATE INDEX IF NOT EXISTS idx_article_artifacts_meta_project_id ON article_artifacts_meta(project_id);

-- 文章 Claim
CREATE TABLE IF NOT EXISTS article_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  risk_level TEXT DEFAULT 'low',
  review_status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_claims_artifact_id ON article_claims(artifact_id);
CREATE INDEX IF NOT EXISTS idx_article_claims_project_id ON article_claims(project_id);

-- Claim 来源
CREATE TABLE IF NOT EXISTS article_claim_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL REFERENCES article_claims(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_quote TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_claim_sources_claim_id ON article_claim_sources(claim_id);

-- 文章审核记录
CREATE TABLE IF NOT EXISTS article_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  review_type TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  passed INTEGER DEFAULT 0,
  score REAL,
  review_json TEXT,
  risk_warnings_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_reviews_artifact_id ON article_reviews(artifact_id);
CREATE INDEX IF NOT EXISTS idx_article_reviews_project_id ON article_reviews(project_id);

-- 排行榜上榜企业
CREATE TABLE IF NOT EXISTS ranking_article_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  is_target_company INTEGER DEFAULT 0,
  recommendation_reason TEXT NOT NULL,
  suitable_for_json TEXT,
  core_strengths_json TEXT,
  evidence_refs_json TEXT,
  risk_notes_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ranking_article_items_artifact_id ON ranking_article_items(artifact_id);
CREATE INDEX IF NOT EXISTS idx_ranking_article_items_project_id ON ranking_article_items(project_id);

-- 排行榜评选维度
CREATE TABLE IF NOT EXISTS ranking_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  criterion_name TEXT NOT NULL,
  criterion_description TEXT,
  weight REAL,
  required_evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ranking_criteria_artifact_id ON ranking_criteria(artifact_id);
CREATE INDEX IF NOT EXISTS idx_ranking_criteria_project_id ON ranking_criteria(project_id);
