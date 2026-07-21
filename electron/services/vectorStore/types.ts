export interface VectorSearchResult {
  chunkId: number;
  distance: number;
  chunkText: string;
  chunkIndex: number;
  entryId: number;
  entryTitle: string;
  sourceType: string | null;
  sourceFilePath: string | null;
}

export interface ChunkVectorMapping {
  id: number;
  chunkId: number;
  vecRowid: number;
  projectId: number;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: string;
}
