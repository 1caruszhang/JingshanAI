export interface Chunk {
  text: string;
  index: number;
  start: number;
  end: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separator?: string;
}

export function splitText(
  text: string,
  options: ChunkOptions = {},
): Chunk[] {
  const chunkSize = options.chunkSize ?? 800;
  const chunkOverlap = options.chunkOverlap ?? 100;
  const separator = options.separator ?? '\n';

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) {
    return [{text: normalized, index: 0, start: 0, end: normalized.length}];
  }

  const separators = separator.split('');
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      // Try to break at a separator boundary
      const window = normalized.slice(start, end);
      let bestBreak = -1;
      for (const sep of separators) {
        const pos = window.lastIndexOf(sep);
        if (pos > bestBreak) {
          bestBreak = pos;
        }
      }
      if (bestBreak > chunkSize * 0.3) {
        end = start + bestBreak + 1;
      }
    }

    chunks.push({
      text: normalized.slice(start, end).trim(),
      index,
      start,
      end,
    });

    const nextStart = Math.max(end - chunkOverlap, start + 1);
    if (nextStart >= normalized.length) break;
    start = nextStart;
    index++;

    // Safety: avoid infinite loops when overlap is too large
    if (index > normalized.length) {
      throw new Error('Chunking failed: too many iterations');
    }
  }

  return chunks;
}
