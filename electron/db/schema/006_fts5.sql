-- FTS5 关键词索引
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts USING fts5(
  chunk_text,
  entry_title,
  source_type,
  content='knowledge_chunks',
  content_rowid='id'
);

-- 迁移已有 chunk 到 FTS5
INSERT INTO knowledge_chunk_fts(rowid, chunk_text, entry_title, source_type)
SELECT c.id, c.chunk_text, e.title, e.source_type
FROM knowledge_chunks c
JOIN knowledge_entries e ON c.entry_id = e.id;

-- 触发器保持 FTS5 同步
CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai
AFTER INSERT ON knowledge_chunks
BEGIN
  INSERT INTO knowledge_chunk_fts(rowid, chunk_text, entry_title, source_type)
  VALUES (
    new.id,
    new.chunk_text,
    (SELECT title FROM knowledge_entries WHERE id = new.entry_id),
    (SELECT source_type FROM knowledge_entries WHERE id = new.entry_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad
AFTER DELETE ON knowledge_chunks
BEGIN
  DELETE FROM knowledge_chunk_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_au
AFTER UPDATE ON knowledge_chunks
BEGIN
  DELETE FROM knowledge_chunk_fts WHERE rowid = old.id;
  INSERT INTO knowledge_chunk_fts(rowid, chunk_text, entry_title, source_type)
  VALUES (
    new.id,
    new.chunk_text,
    (SELECT title FROM knowledge_entries WHERE id = new.entry_id),
    (SELECT source_type FROM knowledge_entries WHERE id = new.entry_id)
  );
END;
