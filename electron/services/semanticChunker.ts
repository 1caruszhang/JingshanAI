export interface SemanticChunk {
  text: string;
  index: number;
  contentType:
    | 'paragraph'
    | 'faq'
    | 'table'
    | 'case'
    | 'contact'
    | 'profile'
    | 'service'
    | 'trust'
    | 'risk'
    | 'list';
  metadata: Record<string, unknown>;
}

export interface SemanticChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

const FAQ_PATTERNS = [
  /^\s*[Qq]\s*[：:：]\s*(.+?)\n+\s*[Aa]\s*[：:：]\s*(.+)/ms,
  /^\s*(?:问|问题)\s*[：:：]\s*(.+?)\n+\s*(?:答|回答)\s*[：:：]\s*(.+)/ms,
  /^\s*\d+[.．、]\s*(.+?)\n+\s*(?:答案?|答)[：:：]?\s*(.+)/ms,
];

function looksLikeTable(block: string): boolean {
  const lines = block.split('\n').filter((l) => l.trim());
  const pipeLines = lines.filter((l) => l.includes('|'));
  return pipeLines.length >= 2 && pipeLines.length / lines.length >= 0.5;
}

function looksLikeContact(block: string): boolean {
  const lowered = block.toLowerCase();
  const contactKeywords = ['电话', '邮箱', '地址', '联系方式', '客服', 'tel', 'email', 'address', 'contact'];
  return contactKeywords.some((kw) => lowered.includes(kw)) && block.length < 800;
}

function looksLikeRisk(block: string): boolean {
  const riskKeywords = ['风险提示', '免责声明', '法律声明', '隐私政策', '免责', '风险', '警告', '声明'];
  const lowered = block.toLowerCase();
  return riskKeywords.some((kw) => lowered.includes(kw)) && block.length < 1200;
}

function looksLikeProfile(block: string): boolean {
  const profileKeywords = ['公司简介', '企业简介', '关于我们', '公司介绍', '企业介绍', 'company profile', 'about us'];
  const lowered = block.toLowerCase();
  return profileKeywords.some((kw) => lowered.includes(kw)) && block.length < 1500;
}

function looksLikeCase(block: string): boolean {
  const caseKeywords = ['案例', '客户案例', '成功案例', 'case study', '案例背景', '客户需求'];
  const lowered = block.toLowerCase();
  return caseKeywords.some((kw) => lowered.includes(kw));
}

function looksLikeService(block: string): boolean {
  const serviceKeywords = ['服务', '产品', '解决方案', '我们提供', '主营业务', 'services', 'products', 'solutions'];
  const lowered = block.toLowerCase();
  return serviceKeywords.some((kw) => lowered.includes(kw));
}

function looksLikeTrust(block: string): boolean {
  const trustKeywords = ['资质', '荣誉', '认证', '奖项', '背书', '合作伙伴', 'trusted', 'certified', 'award'];
  const lowered = block.toLowerCase();
  return trustKeywords.some((kw) => lowered.includes(kw)) && block.length < 1000;
}

function detectContentType(block: string): SemanticChunk['contentType'] {
  if (looksLikeTable(block)) return 'table';
  if (looksLikeFaq(block)) return 'faq';
  if (looksLikeContact(block)) return 'contact';
  if (looksLikeRisk(block)) return 'risk';
  if (looksLikeProfile(block)) return 'profile';
  if (looksLikeCase(block)) return 'case';
  if (looksLikeTrust(block)) return 'trust';
  if (looksLikeService(block)) return 'service';
  return 'paragraph';
}

function looksLikeFaq(block: string): boolean {
  return FAQ_PATTERNS.some((pattern) => pattern.test(block));
}

function splitFaq(block: string): Array<{question: string; answer: string}> {
  const results: Array<{question: string; answer: string}> = [];
  const pattern = /(?:^|\n)\s*(?:[Qq]|问|问题)\s*[：:：]\s*(.+?)(?:\n+\s*(?:[Aa]|答|回答)\s*[：:：]\s*(.+?))(?=(?:\n+\s*(?:[Qq]|问|问题)\s*[：:：]|$))/gs;
  let match;
  while ((match = pattern.exec(block)) !== null) {
    results.push({question: match[1].trim(), answer: match[2].trim()});
  }
  if (results.length === 0) {
    // fallback: split by numbered items
    const numbered = block.split(/(?:^|\n)\s*\d+[.．、]\s*/).filter(Boolean);
    for (let i = 0; i < numbered.length; i++) {
      const item = numbered[i].trim();
      const lines = item.split('\n');
      if (lines.length >= 2) {
        results.push({question: lines[0], answer: lines.slice(1).join('\n')});
      } else {
        results.push({question: `问题 ${i + 1}`, answer: item});
      }
    }
  }
  return results;
}

function splitParagraphs(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const lastBreak = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('. '));
      if (lastBreak > chunkSize * 0.3) {
        end = start + lastBreak + 1;
      }
    }
    chunks.push(normalized.slice(start, end).trim());
    const nextStart = Math.max(end - chunkOverlap, start + 1);
    if (nextStart >= normalized.length) break;
    start = nextStart;
  }
  return chunks;
}

function splitIntoBlocks(text: string): string[] {
  // Split by headers or double newlines, but keep tables and FAQ groups intact
  const blocks: string[] = [];
  const lines = text.split('\n');
  let current: string[] = [];

  const isHeader = (line: string) => /^#{1,6}\s+/.test(line) || /^\S+\s+={3,}$/.test(line) || /^\S+\s+-{3,}$/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeader(line) && current.length > 0) {
      blocks.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n').trim());

  return blocks.filter((b) => b.length > 0);
}

export function chunkDocument(
  text: string,
  options: SemanticChunkOptions = {},
): SemanticChunk[] {
  const {chunkSize = 800, chunkOverlap = 100} = options;
  const blocks = splitIntoBlocks(text);
  const chunks: SemanticChunk[] = [];

  for (const block of blocks) {
    const type = detectContentType(block);

    if (type === 'faq') {
      const faqs = splitFaq(block);
      for (const faq of faqs) {
        chunks.push({
          text: `Q：${faq.question}\nA：${faq.answer}`,
          index: chunks.length,
          contentType: 'faq',
          metadata: {question: faq.question},
        });
      }
      continue;
    }

    if (type === 'table') {
      chunks.push({
        text: block,
        index: chunks.length,
        contentType: 'table',
        metadata: {lineCount: block.split('\n').length},
      });
      continue;
    }

    if (type === 'contact' || type === 'risk' || type === 'trust' || type === 'profile') {
      chunks.push({
        text: block,
        index: chunks.length,
        contentType: type,
        metadata: {},
      });
      continue;
    }

    // Case / service / paragraph: use length-aware chunking
    const size = type === 'case' ? Math.min(chunkSize * 2, 1600) : chunkSize;
    const overlap = type === 'case' ? Math.min(chunkOverlap * 2, 200) : chunkOverlap;
    const parts = splitParagraphs(block, size, overlap);
    for (const part of parts) {
      chunks.push({
        text: part,
        index: chunks.length,
        contentType: type,
        metadata: {},
      });
    }
  }

  // Re-index after all chunks created
  chunks.forEach((c, i) => {
    c.index = i;
  });

  return chunks.filter((c) => c.text.trim().length > 0);
}
