import type {ModelRoute} from './types.ts';

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export const DOUBAO_MODEL_ROUTES: Record<string, ModelRoute> = {
  chat: {
    role: 'chat',
    provider: 'doubao',
    apiMode: 'responses',
    model: env('DOUBAO_MODEL', 'doubao-seed-2-0-lite-260428')!,
    stream: false,
    timeoutMs: 60000,
    maxRetries: 1,
  },

  source_discovery: {
    role: 'source_discovery',
    provider: 'doubao',
    apiMode: 'responses',
    model: env('DOUBAO_MODEL', 'doubao-seed-2-0-lite-260428')!,
    stream: false,
    skill: 'source-discovery',
    promptVersion: 'source-discovery.prompt-contract.v1',
    toolType: 'function',
    timeoutMs: 90000,
    maxRetries: 1,
  },

  article_generation: {
    role: 'article_generation',
    provider: 'doubao',
    apiMode: 'responses',
    model: env('DOUBAO_MODEL', 'doubao-seed-2-0-lite-260428')!,
    stream: true,
    skill: 'article-generation',
    promptVersion: 'article-generation.prompt-contract.v1',
    toolType: 'function',
    timeoutMs: 180000,
    maxRetries: 1,
  },

  geo_style_review: {
    role: 'geo_style_review',
    provider: 'doubao',
    apiMode: 'responses',
    model: env('DOUBAO_MODEL', 'doubao-seed-2-0-lite-260428')!,
    stream: false,
    skill: 'geo-review',
    promptVersion: 'geo-review.prompt-contract.v1',
    toolType: 'none',
    timeoutMs: 60000,
    maxRetries: 1,
  },

  reflection_validation: {
    role: 'reflection_validation',
    provider: 'doubao',
    apiMode: 'responses',
    model: env('DOUBAO_MODEL', 'doubao-seed-2-0-lite-260428')!,
    stream: false,
    skill: 'reflection-validation',
    promptVersion: 'reflection-validation.prompt-contract.v1',
    toolType: 'none',
    timeoutMs: 60000,
    maxRetries: 1,
  },

  visibility_check: {
    role: 'visibility_check',
    provider: 'doubao',
    apiMode: 'responses',
    model: env('DOUBAO_MODEL', 'doubao-seed-2-0-lite-260428')!,
    stream: true,
    skill: 'visibility-check',
    promptVersion: 'visibility-check.prompt-contract.v1',
    toolType: 'doubao_app',
    doubaoAppFeature: (env('DOUBAO_VISIBILITY_MODE', 'ai_search') as
      | 'ai_search'
      | 'reasoning_search')!,
    timeoutMs: 90000,
    maxRetries: 1,
  },

  embedding: {
    role: 'embedding',
    provider: 'doubao',
    apiMode: 'embeddings',
    model: env('ARK_EMBEDDING_MODEL', 'doubao-embedding')!,
    stream: false,
    timeoutMs: 30000,
    maxRetries: 2,
  },
};

export function getDoubaoRoute(role: string): ModelRoute | undefined {
  return DOUBAO_MODEL_ROUTES[role];
}
