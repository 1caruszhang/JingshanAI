-- 021_checkpointer.sql
-- #77: 给 agent_tasks 添加 interrupt_data_json 列，用于存储 LangGraph 中断上下文

ALTER TABLE agent_tasks ADD COLUMN interrupt_data_json TEXT;
