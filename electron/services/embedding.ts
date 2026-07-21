import {
  embedCorpus,
  embedQuery,
  getEmbeddingDimension as providerGetDimension,
} from './models/doubao/doubaoEmbeddingProvider.ts';

export interface EmbeddingResult {
  embeddings: number[][];
  dimension: number;
  model: string;
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  const result = await embedCorpus(texts);
  return normalizeResult(result);
}

export async function embedText(text: string): Promise<number[]> {
  return embedQuery(text);
}

export function getEmbeddingDimension(): number | undefined {
  return providerGetDimension();
}

function normalizeResult(result: {
  embeddings: number[][];
  dimension: number;
  model: string;
}): EmbeddingResult {
  return {
    embeddings: result.embeddings,
    dimension: result.dimension,
    model: result.model,
  };
}
