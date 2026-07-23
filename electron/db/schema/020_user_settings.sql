-- v1.5 #37 登录信息进设置：通用 key-value 设置表
-- 本轮仅存用户名（user_name）；手机号/公司等留待真实账号体系。
-- 运行时可改即时生效，upsert 语义。

CREATE TABLE IF NOT EXISTS user_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO user_settings (key, value) VALUES ('user_name', '');
