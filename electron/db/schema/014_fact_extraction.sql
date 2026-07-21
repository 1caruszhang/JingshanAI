-- Phase 6：企业事实抽取与人工确认
-- 为 enterprise_facts 增加审计与溯源字段

ALTER TABLE enterprise_facts ADD COLUMN reviewed_at TEXT;
ALTER TABLE enterprise_facts ADD COLUMN reviewed_by TEXT;
ALTER TABLE enterprise_facts ADD COLUMN review_metadata_json TEXT;
ALTER TABLE enterprise_facts ADD COLUMN replaces_fact_id INTEGER REFERENCES enterprise_facts(id) ON DELETE SET NULL;
ALTER TABLE enterprise_facts ADD COLUMN extracted_json TEXT;

CREATE INDEX IF NOT EXISTS idx_enterprise_facts_project_status ON enterprise_facts(project_id, status);
CREATE INDEX IF NOT EXISTS idx_enterprise_facts_source ON enterprise_facts(source_entry_id, source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_facts_type ON enterprise_facts(project_id, fact_type);
CREATE INDEX IF NOT EXISTS idx_enterprise_facts_replaces ON enterprise_facts(replaces_fact_id);
