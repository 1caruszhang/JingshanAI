-- chat_sessions 改为公共会话，不绑定 project
CREATE TABLE chat_sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  session_type TEXT DEFAULT 'public',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO chat_sessions_new (id, title, session_type, created_at)
SELECT id, title, session_type, created_at FROM chat_sessions;

DROP TABLE chat_sessions;
ALTER TABLE chat_sessions_new RENAME TO chat_sessions;

-- chat_messages 增加 project_id，记录消息发生时的项目上下文
ALTER TABLE chat_messages ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
