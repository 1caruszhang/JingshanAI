import {ChatOpenAI} from '@langchain/openai';
import {getDeepseekRoute} from '../models/deepseekModelConfig.ts';

export function createAgentModel(): ChatOpenAI {
  const route = getDeepseekRoute('agent_runtime');
  if (!route) {
    throw new Error('No agent_runtime model route configured');
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  return new ChatOpenAI({
    modelName: route.model,
    apiKey,
    configuration: {baseURL},
    temperature: 0.3,
    maxRetries: route.maxRetries ?? 1,
    timeout: route.timeoutMs ?? 90000,
  });
}
