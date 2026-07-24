import {kbApi, factApi} from '../lib/electron-api';
import type {EnterpriseFact} from '../types/domain';

export interface IngestIntentResult {
  handled: boolean;
  type: 'fact_review' | 'text';
  content: string;
  facts?: EnterpriseFact[];
}

/** 上传文件自动入库的结果 */
export interface UploadedFileIngestResult {
  /** 成功入库的条目数 */
  entryCount: number;
  /** 抽取到的事实总数 */
  extractedCount: number;
  /** 待确认的事实列表（供 UI 展示审批卡片） */
  facts: EnterpriseFact[];
}

const INGEST_KEYWORDS = ['录入', '上传', '资料', '文档', '企业介绍', '公司简介', '这是', '我们叫', '我们公司'];

function looksLikeIngest(text: string): boolean {
  if (text.length > 300) return true;
  const lowered = text.toLowerCase();
  return INGEST_KEYWORDS.some((k) => lowered.includes(k));
}

/**
 * 在浏览器侧将 base64 data URL 解码为 UTF-8 文本。
 * 与主进程 multipartMessage.decodeTextFromDataUrl 的正则保持一致，
 * 但用 atob + TextDecoder 替代 Buffer（渲染层无 Node API）。
 */
function decodeDataUrlToText(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;,]*)(?:;[^;]*)*;base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  // 仅解码文本类；空 MIME（FileReader 对未知类型产出）也按文本处理
  if (mime !== '' && !mime.startsWith('text/')) return null;
  try {
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
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

/**
 * 将用户在对话中上传的文本类文件（txt/md）自动录入知识库并抽取事实。
 *
 * 流程：解码 base64 content → kbApi.ingestText → factApi.extract → 返回待确认事实。
 * 图片等非文本文件会被跳过（当前只支持文本入库）。
 *
 * 这是"上传文档 → 自动入库 → 走原流程"的关键衔接：
 * 子 agent（contentAgent 等）通过 knowledge_entries / 向量库读取数据，
 * 所以必须先把文件内容落库，子 agent 才看得到。
 *
 * @returns 入库结果；如果没有任何文本文件被成功处理，返回 null。
 */
export async function ingestUploadedFiles(
  files: Array<{name: string; type: string; bytes: number; content?: string}>,
  projectId: number,
): Promise<UploadedFileIngestResult | null> {
  let entryCount = 0;
  let totalExtracted = 0;
  let lastEntryId: number | undefined;

  for (const file of files) {
    // 图片等非文本文件跳过——当前 ingestText 只接受纯文本
    if (file.type.startsWith('image/')) continue;
    if (!file.content) continue;

    const text = decodeDataUrlToText(file.content);
    if (!text || text.trim().length === 0) continue;

    const ingestResult = await kbApi.ingestText(projectId, file.name, text);
    if (ingestResult.status === 'failed') continue;

    entryCount += 1;
    lastEntryId = ingestResult.entryId;

    // 对刚入库的条目抽取事实
    const extraction = await factApi.extract({
      projectId,
      entryId: ingestResult.entryId,
    });
    totalExtracted += extraction.extractedCount;
  }

  if (entryCount === 0) return null;

  // 拉取当前项目所有待确认事实，供 UI 展示审批卡片
  const pending = await factApi.listPending({projectId});

  return {
    entryCount,
    extractedCount: totalExtracted,
    facts: pending.slice(0, 20),
  };
}
