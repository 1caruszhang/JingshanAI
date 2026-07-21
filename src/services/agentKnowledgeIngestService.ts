import {kbApi, factApi} from '../lib/electron-api';
import type {EnterpriseFact} from '../types/domain';

export interface IngestIntentResult {
  handled: boolean;
  type: 'fact_review' | 'text';
  content: string;
  facts?: EnterpriseFact[];
}

const INGEST_KEYWORDS = ['录入', '上传', '资料', '文档', '企业介绍', '公司简介', '这是', '我们叫', '我们公司'];

function looksLikeIngest(text: string): boolean {
  if (text.length > 300) return true;
  const lowered = text.toLowerCase();
  return INGEST_KEYWORDS.some((k) => lowered.includes(k));
}

export async function handleIngestIntent(
  text: string,
  projectId: number,
): Promise<IngestIntentResult | null> {
  if (!looksLikeIngest(text)) {
    return null;
  }

  const title = text.split(/\n|\r/)[0]?.slice(0, 40) || 'Agent 录入';
  const ingestResult = await kbApi.ingestText(projectId, title, text);

  if (ingestResult.status === 'failed') {
    return {
      handled: true,
      type: 'text',
      content: `资料录入失败：${ingestResult.error ?? '未知错误'}`,
    };
  }

  const extraction = await factApi.extract({
    projectId,
    entryId: ingestResult.entryId,
  });

  if (extraction.extractedCount === 0) {
    return {
      handled: true,
      type: 'text',
      content: '资料已录入知识库，但未从中提取到可确认的企业事实。',
    };
  }

  const pending = await factApi.listPending({projectId});

  return {
    handled: true,
    type: 'fact_review',
    content: '我识别到你在录入企业资料，并从中抽取出以下事实，请确认或拒绝：',
    facts: pending.slice(0, 20),
  };
}
