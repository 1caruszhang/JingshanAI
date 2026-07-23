/**
 * loader.ts
 *
 * 加载 prompts/*.md 文件作为 LLM prompt 文本。
 *
 * 解析顺序（首个命中生效，逐文件独立覆盖）：
 *   1. userData 同名文件（用户可编辑覆盖，运行时可改即时生效）
 *   2. 仓库/打包内置默认（`prompts/{name}.md`）
 *
 * 每次调用都 `readFileSync` 读盘，无缓存、无 watcher——保证「改了就生效」。
 *
 * 特殊处理：
 *   - `loadPrompt('soul')`：读盘后，若 `.env` 的 `CONTACT_INFO` 非空，则用它覆盖
 *     soul.md 中「## 联系方式」段的占位内容（`[待填写：...]`）。联系方式段按需
 *     轻量解析，其余身份/能力边界/语气段整份作为 system prompt 注入。
 */

import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {getUserDataPath} from '../utils/paths.ts';

/**
 * 解析内置 prompts 目录（仓库源码或打包资源）。
 * 与 `getMigrationsPath` 同构：打包态取 `process.resourcesPath/prompts`，
 * 开发态取 `process.cwd()/prompts`。
 */
function resolveBuiltinPromptsDir(): string {
  if (typeof process.resourcesPath === 'string' && existsSync(join(process.resourcesPath, 'prompts'))) {
    return join(process.resourcesPath, 'prompts');
  }
  return join(process.cwd(), 'prompts');
}

/**
 * 读取指定 prompt 的原始 Markdown 文本（userData 覆盖优先于内置默认）。
 * 找不到任何文件时抛错——调用方应保证文件存在。
 */
function readPromptRaw(name: string): string {
  const fileName = `${name}.md`;

  // 1. userData 覆盖（Electron app 未初始化时跳过，回退到内置默认）
  try {
    const userDataPath = join(getUserDataPath(), fileName);
    if (existsSync(userDataPath)) {
      return readFileSync(userDataPath, 'utf8');
    }
  } catch {
    // 非 Electron 环境（如单元测试）下 getUserDataPath 会抛错，此处忽略
  }

  // 2. 内置默认
  const builtinPath = join(resolveBuiltinPromptsDir(), fileName);
  if (existsSync(builtinPath)) {
    return readFileSync(builtinPath, 'utf8');
  }

  throw new Error(`[prompts/loader] prompt file not found: ${fileName} (checked userData + builtin)`);
}

/**
 * 用 `replacement` 替换 soul.md 中「## 联系方式」段的内容（从该标题下一行起，
 * 到下一个 `## ` 标题或文件末尾）。仅替换段落正文，保留标题本身。
 *
 * 用 `m` 标志让 `^##` 匹配任意行首；lookahead 用 `$(?![\s\S])` 锚定真正的
 * 字符串末尾（EOF）而非每行行尾——避免 lazy 量词在第一行行尾就提前停止。
 */
function replaceContactSection(soulMd: string, replacement: string): string {
  const contactRegex = /(^##\s+联系方式\s*\n)([\s\S]*?)(?=^##\s|$(?![\s\S]))/m;
  if (!contactRegex.test(soulMd)) {
    // 没有联系方式段，直接追加
    return `${soulMd.trimEnd()}\n\n## 联系方式\n\n${replacement}\n`;
  }
  return soulMd.replace(contactRegex, (_, heading: string) => `${heading}${replacement}\n\n`);
}

/**
 * 加载并返回 prompt 文本。
 *
 * @param name prompt 名（不含扩展名），如 `'soul'`、`'qa'`
 */
export function loadPrompt(name: string): string {
  const raw = readPromptRaw(name);

  if (name === 'soul') {
    const contactInfo = process.env.CONTACT_INFO?.trim();
    if (contactInfo) {
      // 支持 \n 转义换行
      return replaceContactSection(raw, contactInfo.replace(/\\n/g, '\n'));
    }
  }

  return raw;
}

/**
 * 剥离 Markdown 顶部的 YAML frontmatter（`---\n...\n---` 块），返回正文。
 * 仅当文件以 `---` 起始时剥离首个 frontmatter 块；否则原样返回。
 * 正文中的 `---` 分隔线不受影响。
 */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  // 跳过开头的 `---` 行，找到下一个独占一行的 `---` 作为 frontmatter 结束
  const afterOpen = content.slice(3);
  const nlIdx = afterOpen.indexOf('\n');
  if (nlIdx === -1) {
    return content;
  }
  const rest = afterOpen.slice(nlIdx + 1);
  const closeMatch = rest.match(/^---\s*(?:\r?\n|$)/m);
  if (!closeMatch || closeMatch.index === undefined) {
    return content;
  }
  return rest.slice(closeMatch.index + closeMatch[0].length);
}

/**
 * 加载 prompt 并剥离 YAML frontmatter，只返回正文。
 * 供 md-driven runtime 作 system prompt 注入（避免 frontmatter 进 system 段成为噪声）。
 * 对无 frontmatter 的文件（如 soul.md）返回全文，与 `loadPrompt` 一致。
 *
 * @param name prompt 名（不含扩展名）
 */
export function loadPromptBody(name: string): string {
  return stripFrontmatter(loadPrompt(name));
}
