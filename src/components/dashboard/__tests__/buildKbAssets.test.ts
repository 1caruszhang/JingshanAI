/**
 * #104: Unit tests for buildKbAssets — file-name extraction + type badges.
 *
 * Verifies the acceptance criteria from issue #104:
 *  - actual file name is extracted from `source_file_path`
 *  - falls back to `entry.title` when no path is present
 *  - `detectFileType` is applied to file entries
 *  - manually-pasted text entries get `sourceType='text'` and no `fileType`
 *  - unknown extensions leave `fileType` undefined
 *  - only the first 5 entries are returned
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildKbAssets } from '../useDashboardData';
import type { KnowledgeEntry } from '../../../types/domain';

function makeEntry(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: 1,
    project_id: 1,
    title: 'default-title',
    content: '一些内容 more content',
    source_type: 'file',
    source_file_path: null,
    metadata_json: null,
    status: 'indexed',
    created_at: '2026-01-01',
    ...overrides,
  };
}

describe('buildKbAssets', () => {
  it('extracts the actual file name from source_file_path', () => {
    const assets = buildKbAssets([
      makeEntry({ title: '用户填的标题', source_file_path: '/docs/企业白皮书.pdf' }),
    ]);
    assert.equal(assets[0].name, '企业白皮书.pdf');
    assert.equal(assets[0].fileType, 'pdf');
    assert.equal(assets[0].sourceType, 'file');
  });

  it('falls back to entry.title when source_file_path is absent', () => {
    const assets = buildKbAssets([
      makeEntry({ title: 'only-title', source_file_path: null }),
    ]);
    assert.equal(assets[0].name, 'only-title');
    assert.equal(assets[0].fileType, undefined);
    assert.equal(assets[0].sourceType, 'file');
  });

  it('marks manually-pasted text entries with sourceType=text and no fileType', () => {
    const assets = buildKbAssets([
      makeEntry({ title: '粘贴笔记', source_type: 'text', source_file_path: null }),
    ]);
    assert.equal(assets[0].name, '粘贴笔记');
    assert.equal(assets[0].sourceType, 'text');
    assert.equal(assets[0].fileType, undefined);
  });

  it('detects image/docx/text file types', () => {
    const assets = buildKbAssets([
      makeEntry({ source_file_path: '/a/logo.png' }),
      makeEntry({ source_file_path: '/b/brief.docx' }),
      makeEntry({ source_file_path: '/c/notes.md' }),
    ]);
    assert.deepEqual(
      assets.map((a) => a.fileType),
      ['image', 'docx', 'text'],
    );
  });

  it('leaves fileType undefined for unknown extensions', () => {
    const assets = buildKbAssets([
      makeEntry({ source_file_path: '/x/archive.zip' }),
    ]);
    assert.equal(assets[0].fileType, undefined);
    assert.equal(assets[0].sourceType, 'file');
  });

  it('maps status to indexed/pending', () => {
    const assets = buildKbAssets([
      makeEntry({ status: 'indexed' }),
      makeEntry({ status: 'pending' }),
      makeEntry({ status: 'failed' }),
    ]);
    assert.equal(assets[0].status, 'indexed');
    assert.equal(assets[1].status, 'pending');
    assert.equal(assets[2].status, 'pending');
  });

  it('returns at most 5 entries', () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ id: i + 1, title: `entry-${i}` }),
    );
    const assets = buildKbAssets(entries);
    assert.equal(assets.length, 5);
  });

  it('counts words from content', () => {
    const assets = buildKbAssets([
      makeEntry({ content: 'hello world 你好' }),
    ]);
    // 2 latin words + 2 cjk chars = 4
    assert.equal(assets[0].words, 4);
  });
});
