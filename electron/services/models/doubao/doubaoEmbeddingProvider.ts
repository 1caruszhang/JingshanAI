import type {EmbeddingResult} from '../../embedding.ts';

interface DoubaoEmbeddingResponse {
  data:
    | Array<{
        embedding: number[];
        index: number;
        object: string;
      }>
    | {
        embedding: number[];
        index: number;
        object: string;
      };
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

function getConfig(): {
  apiKey: string;
  baseUrl: string;
  model: string;
  endpoint: string;
  isMultimodal: boolean;
  dimensions: number | undefined;
  queryInstructions: string | undefined;
  corpusInstructions: string | undefined;
} {
  const apiKey = process.env.ARK_EMBEDDING_API_KEY ?? process.env.ARK_API_KEY;
  const baseUrl = (process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(
    /\/$/,
    '',
  );
  const model = process.env.ARK_EMBEDDING_MODEL;
  const endpoint = process.env.ARK_EMBEDDING_ENDPOINT ?? '/embeddings';
  const isMultimodal = endpoint.includes('/multimodal') || model?.includes('vision') === true;
  const dimensions = process.env.ARK_EMBEDDING_DIMENSIONS
    ? parseInt(process.env.ARK_EMBEDDING_DIMENSIONS, 10)
    : undefined;
  const queryInstructions = process.env.ARK_EMBEDDING_QUERY_INSTRUCTIONS;
  const corpusInstructions = process.env.ARK_EMBEDDING_CORPUS_INSTRUCTIONS;

  if (!apiKey) {
    throw new Error('ARK_API_KEY not configured');
  }
  if (!model) {
    throw new Error('ARK_EMBEDDING_MODEL not configured');
  }

  return {apiKey, baseUrl, model, endpoint, isMultimodal, dimensions, queryInstructions, corpusInstructions};
}

function parseEmbeddings(data: DoubaoEmbeddingResponse['data']): number[][] {
  if (Array.isArray(data)) {
    return data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
  return [data.embedding];
}

async function callEmbeddingApi(
  text: string,
  instructions: string | undefined,
  retryWithoutInstructions = true,
): Promise<{embedding: number[]; model: string}> {
  const {apiKey, baseUrl, model, endpoint, isMultimodal, dimensions} = getConfig();
  const url = `${baseUrl}${endpoint}`;

  const body: Record<string, unknown> = {
    model,
    encoding_format: 'float',
  };

  if (isMultimodal) {
    body.input = [{type: 'text', text: String(text ?? '')}];
  } else {
    body.input = [text];
    if (dimensions) {
      body.dimensions = dimensions;
    }
    if (instructions) {
      body.instructions = instructions;
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const shouldRetry =
      !isMultimodal &&
      instructions &&
      retryWithoutInstructions &&
      (errText.includes('instructions') || errText.includes('Instruction'));

    if (shouldRetry) {
      const single = await callEmbeddingApi(text, undefined, false);
      return single;
    }

    throw new Error(
      `Embedding request failed: ${response.status} ${response.statusText}\n${errText}`,
    );
  }

  const json = (await response.json()) as DoubaoEmbeddingResponse;
  const embeddings = parseEmbeddings(json.data);
  if (embeddings.length === 0 || embeddings[0].length === 0) {
    throw new Error('Embedding response contained empty vectors');
  }
  return {embedding: embeddings[0], model: json.model ?? model};
}

async function callEmbeddings(
  texts: string[],
  instructions: string | undefined,
): Promise<EmbeddingResult> {
  const {model, isMultimodal} = getConfig();

  if (isMultimodal) {
    // 豆包多模态接口一次只处理一个文本
    const embeddings: number[][] = [];
    let responseModel = model;
    for (const text of texts) {
      const result = await callEmbeddingApi(text, undefined, false);
      embeddings.push(result.embedding);
      responseModel = result.model;
    }
    return {embeddings, dimension: embeddings[0].length, model: responseModel};
  }

  // 标准 embeddings 接口：批量请求
  const {apiKey, baseUrl, endpoint, dimensions} = getConfig();
  const url = `${baseUrl}${endpoint}`;

  const body: Record<string, unknown> = {
    model,
    input: texts,
    encoding_format: 'float',
  };
  if (dimensions) {
    body.dimensions = dimensions;
  }
  if (instructions) {
    body.instructions = instructions;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const shouldRetry =
      instructions &&
      (errText.includes('instructions') || errText.includes('Instruction'));

    if (shouldRetry) {
      return callEmbeddings(texts, undefined);
    }

    throw new Error(
      `Embedding request failed: ${response.status} ${response.statusText}\n${errText}`,
    );
  }

  const data = (await response.json()) as DoubaoEmbeddingResponse;
  const embeddings = parseEmbeddings(data.data);
  const dim = embeddings[0]?.length ?? 0;
  if (dim === 0) {
    throw new Error('Embedding response contained empty vectors');
  }
  for (const vec of embeddings) {
    if (vec.length !== dim) {
      throw new Error('Embedding vectors have inconsistent dimensions');
    }
  }

  return {embeddings, dimension: dim, model: data.model ?? model};
}

export async function embedQuery(text: string): Promise<number[]> {
  const {queryInstructions} = getConfig();
  const result = await callEmbeddings([text], queryInstructions);
  return result.embeddings[0];
}

export async function embedCorpus(texts: string[]): Promise<EmbeddingResult> {
  const {corpusInstructions} = getConfig();
  return callEmbeddings(texts, corpusInstructions);
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  // 通用入口默认使用 corpus instructions；调用方如需 query 语义请用 embedQuery/embedCorpus
  return embedCorpus(texts);
}

export function getEmbeddingDimension(): number | undefined {
  return getConfig().dimensions;
}
