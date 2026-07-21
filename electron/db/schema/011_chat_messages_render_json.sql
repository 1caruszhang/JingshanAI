-- v1.4.7 补齐 chat_messages.render_json，用于 Message Parts 恢复
-- 001_init.sql 中 chat_messages 不创建该列，由本迁移统一添加，避免新旧库冲突
ALTER TABLE chat_messages ADD COLUMN render_json TEXT;