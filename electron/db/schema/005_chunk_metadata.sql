-- Add metadata columns to knowledge_chunks for semantic chunking and quality scoring
CREATE TABLE knowledge_chunks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT,
  token_count INTEGER,
  metadata_json TEXT,
  quality_score REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO knowledge_chunks_new (id, entry_id, chunk_text, chunk_index, content_hash, token_count, metadata_json, quality_score, created_at)
SELECT
  id,
  entry_id,
  chunk_text,
  chunk_index,
  NULL,
  NULL,
  NULL,
  0,
  created_at
FROM knowledge_chunks;

DROP TABLE knowledge_chunks;
ALTER TABLE knowledge_chunks_new RENAME TO knowledge_chunks;
