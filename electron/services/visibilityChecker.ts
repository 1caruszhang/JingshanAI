import {getDb} from '../db/connection.ts';
import {streamResponse} from './models/doubao/doubaoResponsesClient.ts';
import {modelRouter} from './models/modelRouter.ts';
import type {DoubaoProviderStreamEvent} from './models/doubao/types.ts';
import {
  buildDoubaoAppTool,
  getDoubaoAssistantBetaHeader,
  getDoubaoAssistantRoleDescription,
  type DoubaoAppFeature,
} from './models/doubao/doubaoAppTool.ts';

export type VisibilityCheckOptions = {
  projectId: number;
  publishRecordId?: number;
  artifactId?: number;
  publishedUrl: string;
  query?: string;
  deep?: boolean;
};

export type VisibilityCheckResult = {
  visibilityCheckId: number;
  mentioned: boolean;
  cited: boolean;
  answerText: string;
  citationUrls: string[];
};

function getVisibilityFeature(deep?: boolean): DoubaoAppFeature {
  if (deep) {
    const mode = process.env.DOUBAO_VISIBILITY_DEEP_MODE;
    if (mode === 'ai_search' || mode === 'reasoning_search') return mode;
    return 'reasoning_search';
  }
  const mode = process.env.DOUBAO_VISIBILITY_MODE;
  if (mode === 'ai_search' || mode === 'reasoning_search') return mode;
  return 'ai_search';
}

function buildVisibilityQuery(publishedUrl: string, query?: string): string {
  if (query) return query;
  return `请联网搜索并判断以下文章是否被检索、提及或引用：${publishedUrl}`;
}

function extractCitationUrls(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw == null) return [];
  const r = raw as Record<string, unknown>;
  const urls: string[] = [];

  const pushUrl = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('http')) {
      urls.push(value);
    }
  };

  const scan = (value: unknown) => {
    if (typeof value === 'string') {
      pushUrl(value);
    } else if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (typeof value === 'object' && value != null) {
      Object.values(value).forEach(scan);
    }
  };

  const citations = r.citations ?? r.citation ?? r.search_results ?? r.results;
  if (citations) scan(citations);

  // 有些事件会把结果放在 result 字段
  if (r.result) scan(r.result);

  return [...new Set(urls)];
}

function buildInputMessage(query: string) {
  return {
    type: 'message' as const,
    role: 'user' as const,
    content: [{type: 'input_text' as const, text: query}],
  };
}

export async function runVisibilityCheck(
  options: VisibilityCheckOptions,
): Promise<VisibilityCheckResult> {
  const route = modelRouter('visibility_check');
  const feature = options.deep
    ? getVisibilityFeature(true)
    : (route.doubaoAppFeature ?? getVisibilityFeature(false));
  const roleDescription = getDoubaoAssistantRoleDescription();
  const tool = buildDoubaoAppTool(feature, roleDescription);
  const query = buildVisibilityQuery(options.publishedUrl, options.query);

  const stream = streamResponse({
    model: route.model,
    input: [buildInputMessage(query)],
    stream: true,
    tools: [tool],
    extraHeaders: getDoubaoAssistantBetaHeader(),
  });

  let providerResponseId = '';
  let answerText = '';
  let searchSummary = '';
  const citationUrls: string[] = [];
  const rawEvents: unknown[] = [];

  for await (const event of stream) {
    rawEvents.push(event.rawEvent);
    if (event.responseId) {
      providerResponseId = event.responseId;
    }

    switch (event.providerEventType) {
      case 'response_doubao_app_call_output_text_delta':
        answerText += event.deltaText ?? '';
        break;
      case 'response_doubao_app_call_output_text_done':
        if (!answerText && typeof event.rawEvent === 'object' && event.rawEvent != null) {
          const text = (event.rawEvent as Record<string, unknown>).text;
          if (typeof text === 'string') answerText = text;
        }
        break;
      case 'response_doubao_app_call_search_completed':
      case 'response_doubao_app_call_reasoning_search_completed': {
        const urls = extractCitationUrls(event.rawEvent);
        citationUrls.push(...urls);
        const summary = extractSearchSummary(event.rawEvent);
        if (summary) searchSummary = summary;
        break;
      }
    }
  }

  const uniqueUrls = [...new Set(citationUrls)];
  const mentioned = uniqueUrls.length > 0 || answerText.length > 0;
  const cited = uniqueUrls.length > 0;
  const confidence = cited ? 1.0 : mentioned ? 0.6 : 0.0;

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO visibility_checks (
      project_id, artifact_id, publish_record_id, target_engine,
      check_provider, check_api_mode, check_tool_type, check_feature, check_method,
      provider_response_id, published_url, query, mentioned, cited,
      citation_urls_json, answer_text, search_summary, matched_snippets_json,
      confidence, raw_response_json, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );

  const result = insert.run(
    options.projectId,
    options.artifactId ?? null,
    options.publishRecordId ?? null,
    'doubao',
    'doubao',
    'responses',
    'doubao_app',
    feature,
    `doubao_app_${feature}`,
    providerResponseId,
    options.publishedUrl,
    query,
    mentioned ? 1 : 0,
    cited ? 1 : 0,
    JSON.stringify(uniqueUrls),
    answerText,
    searchSummary || answerText,
    JSON.stringify(uniqueUrls),
    confidence,
    JSON.stringify(rawEvents),
  );

  return {
    visibilityCheckId: Number(result.lastInsertRowid),
    mentioned,
    cited,
    answerText,
    citationUrls: uniqueUrls,
  };
}

function extractSearchSummary(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw == null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.summary === 'string') return r.summary;
  if (typeof r.search_summary === 'string') return r.search_summary;
  if (typeof r.answer === 'string') return r.answer;
  return undefined;
}
