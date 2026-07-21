import type {ModelRoute} from './types.ts';

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

function deepSeekModel(envName: string, fallback: string): string {
  return env(envName, fallback)!;
}

export const DEEPSEEK_MODEL_ROUTES: Record<string, ModelRoute> = {
  fact_extraction: {
    role: 'fact_extraction',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_PRO_MODEL', 'deepseek-v4-pro'),
    stream: false,
    skill: 'fact-extraction',
    promptVersion: 'fact-extraction.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },

  memory_summary: {
    role: 'memory_summary',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_FAST_MODEL', 'deepseek-v4-flash'),
    stream: false,
    skill: 'memory-summary',
    promptVersion: 'memory-summary.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },

  context_compression: {
    role: 'context_compression',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_FAST_MODEL', 'deepseek-v4-flash'),
    stream: false,
    skill: 'context-compression',
    promptVersion: 'context-compression.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },

  workflow_planning: {
    role: 'workflow_planning',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_PRO_MODEL', 'deepseek-v4-pro'),
    stream: true,
    skill: 'workflow-planning',
    promptVersion: 'workflow-planning.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },

  reflection_candidate: {
    role: 'reflection_candidate',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_PRO_MODEL', 'deepseek-v4-pro'),
    stream: false,
    skill: 'reflection-candidate',
    promptVersion: 'reflection-candidate.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },

  agent_runtime: {
    role: 'agent_runtime',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_PRO_MODEL', 'deepseek-v4-pro'),
    stream: false,
    skill: 'agent-runtime',
    promptVersion: 'agent-runtime.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },

  claim_parsing: {
    role: 'claim_parsing',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_FAST_MODEL', 'deepseek-v4-flash'),
    stream: false,
    skill: 'claim-parsing',
    promptVersion: 'claim-parsing.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },

  claim_review: {
    role: 'claim_review',
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: deepSeekModel('DEEPSEEK_FAST_MODEL', 'deepseek-v4-flash'),
    stream: false,
    skill: 'claim-review',
    promptVersion: 'claim-review.prompt-contract.v1',
    timeoutMs: parseInt(env('DEEPSEEK_TIMEOUT_MS', '90000')!, 10),
    maxRetries: parseInt(env('DEEPSEEK_MAX_RETRIES', '1')!, 10),
  },
};

export function getDeepseekRoute(role: string): ModelRoute | undefined {
  return DEEPSEEK_MODEL_ROUTES[role];
}
