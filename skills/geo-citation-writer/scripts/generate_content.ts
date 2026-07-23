/**
 * generate_content.ts
 *
 * 生成 AI 高引用格式的内容骨架（Markdown）。
 * 迁移自 geo_skills/geo-citation-writer/scripts/generate_content.py：
 * 去掉 argparse CLI 包装，改为纯导出函数，供 Electron 主进程 import 调用。
 * 纯函数、确定性逻辑，无任何外部依赖。
 */

export type CitationContentFormat =
  | 'definition'
  | 'faq'
  | 'comparison'
  | 'howto'
  | 'statistics';

export interface GenerateContentInput {
  /** 内容格式；当前仅 definition 有内置模板，其余格式回退到 definition 骨架 */
  format: CitationContentFormat;
  /** 内容主题，如 "project management software"、"Notion vs Asana" */
  topic: string;
}

export interface GeneratedCitationContent {
  format: CitationContentFormat;
  topic: string;
  /** Markdown 格式的内容骨架，含待填充占位符 */
  content: string;
}

const DEFINITION_TEMPLATE = `# What is {topic}? (Complete Guide)

{topic} is [single-sentence definition with key attributes].

## Key Characteristics

- [Characteristic 1]
- [Characteristic 2]
- [Characteristic 3]

## Frequently Asked Questions About {topic}

**Q: What is {topic} used for?**

A: [Complete answer about use cases]

**Q: Who should use {topic}?**

A: [Target audience description]

---

*Recommended schema: Article + FAQPage*`;

const TEMPLATES: Partial<Record<CitationContentFormat, string>> = {
  definition: DEFINITION_TEMPLATE,
};

function renderTemplate(template: string, topic: string): string {
  return template.replaceAll('{topic}', topic);
}

/**
 * 按指定格式与主题生成内容骨架。
 * 与原 Python 脚本行为等价：无对应模板时回退到 definition 模板。
 */
export function generateContent(
  input: GenerateContentInput,
): GeneratedCitationContent {
  const template = TEMPLATES[input.format] ?? DEFINITION_TEMPLATE;
  return {
    format: input.format,
    topic: input.topic,
    content: renderTemplate(template, input.topic),
  };
}
