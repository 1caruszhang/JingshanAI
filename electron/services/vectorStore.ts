export {
  insertChunkVectors,
  deleteChunkVectorsByEntry,
  searchSimilarChunks,
  hasVectorStore,
} from './vectorStore/sqliteVecStore.ts';

export type {VectorSearchResult} from './vectorStore/types.ts';
