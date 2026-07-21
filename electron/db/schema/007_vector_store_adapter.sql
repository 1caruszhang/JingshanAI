-- VectorStore Adapter 迁移：把旧的 sqlite-vec 虚拟表改为 Adapter + 映射表模式
-- 1. 删除旧版直接保存 chunk_id/embedding 的虚拟表（如果存在）
DROP TABLE IF EXISTS knowledge_chunk_vectors;

-- 2. 创建映射表：chunk -> sqlite-vec 虚拟表行号
CREATE TABLE IF NOT EXISTS knowledge_chunk_vectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL UNIQUE REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  vec_rowid INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kcv_project_id ON knowledge_chunk_vectors(project_id);
CREATE INDEX IF NOT EXISTS idx_kcv_chunk_id ON knowledge_chunk_vectors(chunk_id);
CREATE INDEX IF NOT EXISTS idx_kcv_vec_rowid ON knowledge_chunk_vectors(vec_rowid);

-- 3. 向量存储元数据
CREATE TABLE IF NOT EXISTS vector_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. 已有向量已不可用，标记为待重新索引
UPDATE knowledge_entries SET status = 'pending' WHERE status = 'indexed';
