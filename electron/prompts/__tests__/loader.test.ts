/**
 * loader.test.ts
 *
 * node:test smoke + 行为测试：
 *   1. 验证 node:test + tsx 测试框架接线可用（smoke）
 *   2. 验证 `stripFrontmatter` 剥离 YAML frontmatter，对无 frontmatter 文本返回原文
 *   3. 验证 `loadPrompt('soul')` 仍返回全文（含 frontmatter 若有）
 *   4. 验证 `formatEvidence` 可从 ragService 导入
 *
 * 注：`loadPromptBody` 的文件读取路径依赖 Electron app（userData），
 * 这里通过 `stripFrontmatter` 纯函数覆盖 frontmatter 剥离逻辑；
 * 并对内置默认无 frontmatter 的 `soul.md` 跑一次 `loadPromptBody` 端到端断言。
 */

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPrompt, loadPromptBody, stripFrontmatter} from '../loader.ts';
import {formatEvidence} from '../../services/ragService.ts';

test('smoke: node:test + tsx 接线可用', () => {
  assert.equal(1 + 1, 2);
});

test('stripFrontmatter: 剥离 YAML frontmatter 块', () => {
  const input = '---\nname: x\ntitle: 测试\n---\nbody line 1\nbody line 2\n';
  assert.equal(stripFrontmatter(input), 'body line 1\nbody line 2\n');
});

test('stripFrontmatter: 无 frontmatter 返回全文', () => {
  const input = '# soul\n\n身份段...\n';
  assert.equal(stripFrontmatter(input), input);
});

test('stripFrontmatter: 仅剥离首个 frontmatter 块，保留正文中的 --- 分隔', () => {
  const input = '---\nname: x\n---\nintro\n\n---\n\nmore body\n';
  assert.equal(stripFrontmatter(input), 'intro\n\n---\n\nmore body\n');
});

test('loadPrompt: 返回全文（不剥离 frontmatter）', () => {
  // soul.md 内置默认无 frontmatter，loadPrompt 应原样返回
  const raw = loadPrompt('soul');
  assert.ok(raw.length > 0, 'soul.md 内容非空');
  assert.ok(raw.includes('# soul.md'), 'soul.md 包含标题');
});

test('loadPromptBody: 对无 frontmatter 的 soul.md 返回全文', () => {
  const body = loadPromptBody('soul');
  const raw = loadPrompt('soul');
  assert.equal(body, raw, '无 frontmatter 时 body 等于原文');
});

test('formatEvidence: 可从 ragService 导入且为函数', () => {
  assert.equal(typeof formatEvidence, 'function');
});
