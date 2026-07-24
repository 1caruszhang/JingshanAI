/**
 * multipartMessage.test.ts
 *
 * #91: IPC seam 集成测试 — 验证 buildHumanContent 在所有边界条件下的正确行为。
 *
 * 测试场景（对应 AC）：
 *   1. 无文件 → 返回纯文本字符串，向后兼容
 *   2. 附带图片 → multipart（1 text + 1 image_url）
 *   3. 附带 .md 文本文件 → multipart，text block 包含文件内容
 *   4. 多文件混合（文本+图片）→ 正确拼接所有 block
 *   5. 空文件内容边界 → 优雅降级（跳过无 content 的文件）
 *   6. 非文本 MIME → 跳过（不尝试解码为文本）
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHumanContent,
  decodeTextFromDataUrl,
  type FileAttachment,
} from '../multipartMessage.ts';

// ——— 辅助函数 ———

/** 创建 base64 data URL（text/plain） */
function makeTextDataUrl(content: string): string {
  const b64 = Buffer.from(content, 'utf-8').toString('base64');
  return `data:text/plain;base64,${b64}`;
}

/** 创建 base64 data URL（text/markdown） */
function makeMarkdownDataUrl(content: string): string {
  const b64 = Buffer.from(content, 'utf-8').toString('base64');
  return `data:text/markdown;base64,${b64}`;
}

/** 创建模拟的 image data URL */
const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ——— decodeTextFromDataUrl ———

describe('#91 decodeTextFromDataUrl', () => {
  it('decodes text/plain data URL correctly', () => {
    const result = decodeTextFromDataUrl(makeTextDataUrl('Hello World'));
    assert.equal(result, 'Hello World');
  });

  it('decodes text/markdown data URL correctly', () => {
    const result = decodeTextFromDataUrl(makeMarkdownDataUrl('# Title\n\nContent'));
    assert.equal(result, '# Title\n\nContent');
  });

  it('returns null for image data URLs', () => {
    const result = decodeTextFromDataUrl(IMAGE_DATA_URL);
    assert.equal(result, null);
  });

  it('returns null for malformed data URLs', () => {
    assert.equal(decodeTextFromDataUrl('not-a-data-url'), null);
    assert.equal(decodeTextFromDataUrl('data:image/png;base64,'), null);
    assert.equal(decodeTextFromDataUrl(''), null);
  });

  it('handles UTF-8 content with multi-byte characters', () => {
    const content = '你好世界 🌍';
    const result = decodeTextFromDataUrl(makeTextDataUrl(content));
    assert.equal(result, content);
  });
});

// ——— buildHumanContent ———

describe('#91 buildHumanContent — no files (backward compatible)', () => {
  it('returns plain string when files is undefined', () => {
    const result = buildHumanContent('Hello');
    assert.equal(typeof result, 'string');
    assert.equal(result, 'Hello');
  });

  it('returns plain string when files is empty array', () => {
    const result = buildHumanContent('Hello', []);
    assert.equal(typeof result, 'string');
    assert.equal(result, 'Hello');
  });
});

describe('#91 buildHumanContent — image files', () => {
  it('produces multipart with 1 text + 1 image_url block', () => {
    const files: FileAttachment[] = [
      {name: 'photo.png', type: 'image/png', bytes: 100, content: IMAGE_DATA_URL},
    ];
    const result = buildHumanContent('分析这张图', files);

    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    assert.equal(result.length, 2);
    assert.equal(result[0].type, 'text');
    assert.equal((result[0] as {text: string}).text, '分析这张图');
    assert.equal(result[1].type, 'image_url');
    assert.equal(
      (result[1] as {image_url: {url: string}}).image_url.url,
      IMAGE_DATA_URL,
    );
  });

  it('handles multiple images', () => {
    const files: FileAttachment[] = [
      {name: 'a.png', type: 'image/png', bytes: 100, content: IMAGE_DATA_URL},
      {name: 'b.jpg', type: 'image/jpeg', bytes: 200, content: IMAGE_DATA_URL},
    ];
    const result = buildHumanContent('比较这两张图', files);

    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    assert.equal(result.length, 3); // 1 text + 2 images
    assert.equal(result[0].type, 'text');
    assert.equal(result[1].type, 'image_url');
    assert.equal(result[2].type, 'image_url');
  });
});

describe('#91 buildHumanContent — text files', () => {
  it('embeds markdown file content in text block', () => {
    const mdContent = '# My Document\n\nSome content here.';
    const files: FileAttachment[] = [
      {
        name: 'readme.md',
        type: 'text/markdown',
        bytes: 100,
        content: makeMarkdownDataUrl(mdContent),
      },
    ];
    const result = buildHumanContent('总结这个文档', files);

    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    // 只有 text block（无图片）
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');

    const text = (result[0] as {text: string}).text;
    assert.ok(text.includes('[文件: readme.md]'));
    assert.ok(text.includes(mdContent));
    assert.ok(text.includes('用户消息：总结这个文档'));
  });

  it('embeds plain text file content in text block', () => {
    const content = 'Plain text content line 1\nline 2';
    const files: FileAttachment[] = [
      {name: 'notes.txt', type: 'text/plain', bytes: 50, content: makeTextDataUrl(content)},
    ];
    const result = buildHumanContent('分析', files);

    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    assert.equal(result.length, 1);
    const text = (result[0] as {text: string}).text;
    assert.ok(text.includes('[文件: notes.txt]'));
    assert.ok(text.includes(content));
  });
});

describe('#91 buildHumanContent — mixed files', () => {
  it('correctly concatenates text + image blocks', () => {
    const mdContent = '# Doc';
    const files: FileAttachment[] = [
      {name: 'doc.md', type: 'text/markdown', bytes: 50, content: makeMarkdownDataUrl(mdContent)},
      {name: 'chart.png', type: 'image/png', bytes: 200, content: IMAGE_DATA_URL},
      {name: 'photo.jpg', type: 'image/jpeg', bytes: 300, content: IMAGE_DATA_URL},
    ];
    const result = buildHumanContent('分析这些', files);

    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    // text first, then images
    assert.equal(result.length, 3);
    assert.equal(result[0].type, 'text');
    assert.equal(result[1].type, 'image_url');
    assert.equal(result[2].type, 'image_url');

    const text = (result[0] as {text: string}).text;
    assert.ok(text.includes('[文件: doc.md]'));
    assert.ok(text.includes('用户消息：分析这些'));
  });

  it('handles multiple text files concatenated together', () => {
    const files: FileAttachment[] = [
      {name: 'a.md', type: 'text/markdown', bytes: 30, content: makeMarkdownDataUrl('# A')},
      {name: 'b.txt', type: 'text/plain', bytes: 30, content: makeTextDataUrl('Content B')},
    ];
    const result = buildHumanContent('总结', files);

    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    // 只有 text block
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');

    const text = (result[0] as {text: string}).text;
    assert.ok(text.includes('[文件: a.md]'));
    assert.ok(text.includes('[文件: b.txt]'));
    assert.ok(text.includes('# A'));
    assert.ok(text.includes('Content B'));
  });
});

describe('#91 buildHumanContent — edge cases', () => {
  it('skips files with no content gracefully', () => {
    const files: FileAttachment[] = [
      {name: 'empty.txt', type: 'text/plain', bytes: 0}, // no content
      {name: 'real.md', type: 'text/markdown', bytes: 20, content: makeMarkdownDataUrl('# Real')},
      {name: 'no-content.png', type: 'image/png', bytes: 0}, // no content
    ];
    const result = buildHumanContent('处理', files);

    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    // Only the file with content produces a block
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');

    const text = (result[0] as {text: string}).text;
    assert.ok(text.includes('[文件: real.md]'));
    assert.ok(!text.includes('empty.txt'));
  });

  it('all files without content produces plain string', () => {
    const files: FileAttachment[] = [
      {name: 'a.png', type: 'image/png', bytes: 0},
      {name: 'b.txt', type: 'text/plain', bytes: 0},
    ];
    const result = buildHumanContent('Hello', files);

    // Should fall through to plain text since no blocks were added
    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');
    assert.equal((result[0] as {text: string}).text, 'Hello');
  });

  it('non-text MIME types with data URL are skipped for text decoding', () => {
    // e.g., application/pdf with a data URL — should not decode as text
    const pdfB64 = Buffer.from('fake pdf', 'utf-8').toString('base64');
    const files: FileAttachment[] = [
      {name: 'doc.pdf', type: 'application/pdf', bytes: 50, content: `data:application/pdf;base64,${pdfB64}`},
    ];
    const result = buildHumanContent('分析', files);

    // PDF is not text/* or image/* — should be skipped gracefully
    assert.ok(Array.isArray(result));
    if (!Array.isArray(result)) return;

    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');
    assert.equal((result[0] as {text: string}).text, '分析');
  });
});
