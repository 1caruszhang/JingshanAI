-- 修正 reflection_hypotheses 表结构，使其与开发文档 23.7 节设计一致
-- 保留现有字段，仅补充缺失字段

ALTER TABLE reflection_hypotheses ADD COLUMN region TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN content_format TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN article_strategy_type TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN ranking_type TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN ranking_theme TEXT;

ALTER TABLE reflection_hypotheses ADD COLUMN hypothesis_text TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN target_skill TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN target_engine TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN target_channel TEXT;

ALTER TABLE reflection_hypotheses ADD COLUMN applicable_conditions_json TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN excluded_conditions_json TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN recommended_action_json TEXT;

ALTER TABLE reflection_hypotheses ADD COLUMN positive_examples_json TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN negative_examples_json TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN inconclusive_examples_json TEXT;

ALTER TABLE reflection_hypotheses ADD COLUMN positive_count INTEGER DEFAULT 0;
ALTER TABLE reflection_hypotheses ADD COLUMN negative_count INTEGER DEFAULT 0;
ALTER TABLE reflection_hypotheses ADD COLUMN inconclusive_count INTEGER DEFAULT 0;
ALTER TABLE reflection_hypotheses ADD COLUMN evidence_project_count INTEGER DEFAULT 1;
ALTER TABLE reflection_hypotheses ADD COLUMN evidence_industry_count INTEGER DEFAULT 1;

ALTER TABLE reflection_hypotheses ADD COLUMN validation_result_json TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN generated_by_model TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN validated_by_model TEXT;

ALTER TABLE reflection_hypotheses ADD COLUMN human_review_status TEXT DEFAULT 'pending';
ALTER TABLE reflection_hypotheses ADD COLUMN human_review_note TEXT;

ALTER TABLE reflection_hypotheses ADD COLUMN activated_at TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN degraded_at TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN archived_at TEXT;
ALTER TABLE reflection_hypotheses ADD COLUMN rejected_at TEXT;
