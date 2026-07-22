-- Phase 7：为文章元数据增加信源推荐字段
-- source_recommendation 存储信源发现（source discovery）阶段产出的 JSON，可为 NULL

ALTER TABLE article_artifacts_meta ADD COLUMN source_recommendation TEXT;
