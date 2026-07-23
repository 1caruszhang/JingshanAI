---
name: geo-citation-writer
description: 撰写 AI 高引用格式的内容资产，覆盖定义文章、FAQ 页面、对比指南、操作教程与原创数据统计，提升内容在 ChatGPT、Perplexity 等 AI 平台中的被引用率
domains: []
capabilities:
  - write_citation_content
  - generate_definition_article
  - generate_faq_page
  - generate_comparison_guide
preconditions: []
risk_level: low
requires_confirmation: false
---

# geo-citation-writer

## 目标

以 AI 平台最常引用的格式撰写内容资产，提升内容被 ChatGPT、Perplexity、Gemini、Claude 等 AI 搜索引用的概率。支持 5 种高引用格式：定义文章（What is X?）、FAQ 页面、对比指南（A vs B）、操作教程（How-To）、原创数据/统计盘点。

## 使用场景

- 需要围绕某个主题撰写面向 AI 引用的内容时调用，如「写一篇 RAG 的定义文章」「做一页项目管理软件的 FAQ」「写 Notion vs Asana 的对比指南」。
- 内容规划（planning）完成后，作为具体的文章撰写步骤由 Agent 调用。
- 发布前可配合 `geo-schema-gen` 类 Skill 补充结构化数据标记。

## 输入

- `format`: 内容格式，枚举值 `definition` / `faq` / `comparison` / `howto` / `statistics`。
- `topic`: 内容主题字符串，如 `"project management software"`、`"Notion vs Asana"`。

调用方式（TypeScript，Electron 主进程内 import 使用，非命令行工具）：

```ts
import {generateContent} from './scripts/generate_content.ts';

const result = generateContent({format: 'faq', topic: 'project management software'});
// result.content 为生成好的 Markdown 内容骨架
```

格式选择参考：

| 目标 | 推荐格式 |
|------|---------|
| 建立主题权威 | 定义文章（definition） |
| 解答支持类问题 | FAQ 页面（faq） |
| 捕获商业决策意图 | 对比指南（comparison） |
| 推动产品采用 | 操作教程（howto） |
| 吸引 PR 与外链 | 统计盘点（statistics） |

## 输出

`GeneratedCitationContent` 对象：

```json
{
  "format": "faq",
  "topic": "project management software",
  "content": "# ...（Markdown 格式的内容骨架，含各章节占位符）"
}
```

`content` 为对应格式的结构化 Markdown 骨架，各章节含待填充占位符，供后续写作或 LLM 扩写。

## 约束

### 五种格式的结构约定

1. **定义文章（What is X?）**：首句直接给出单句定义（含关键属性）→ 关键特征列表 → 工作机制 → 与相近概念对比表 → 实例 → FAQ 小节。推荐 schema：Article + FAQPage。
2. **FAQ 页面**：按「通用问题 → 子主题问题 → 故障排查/边界情况」分组；5–15 个问题，每个答案 50–150 词、自成一体不依赖上下文、尽量包含具体数据。推荐 schema：FAQPage。
3. **对比指南（A vs B）**：开头给出「快速答案」（各自适合的场景）→ 并排对比表 → 双方优势详析 → 「如何选择」按使用场景给出标准 → 结论。保持客观以建立信任，包含具体数据，每年更新。推荐 schema：Article + FAQPage。
4. **操作教程（How-To）**：开头列出前置条件、预计耗时、难度 → 编号步骤（每步一个动作，动宾结构标题，附「✅ 预期结果」）→ 常见错误 → FAQ。推荐 schema：HowTo + FAQPage。
5. **原创数据/统计盘点**：开头一句给出最有冲击力的核心发现 → 按子类目分组列出统计（每条注明来源与年份）→ 方法论说明 → 关键结论。推荐 schema：Article。

### 通用写作规则

- 首句即答案：第一段第一句话直接回答问题。
- 具体化：使用数据、名称、日期，避免空泛表述。
- 每个小节自成一体，脱离上下文也能独立成立。
- 每 300–500 词使用一个 H2 标题。
- 每种格式都应附 FAQ 小节。
- 品牌植入：全文自然提及品牌 2–3 次，前 100 词内出现一次，不强行植入（可信度优先）。
- 避免 AI 腔词汇（delve into、leverage、in today's digital landscape 等），完整黑名单见 `references/ai-vocabulary.md`。

### 边界条件

- 当前脚本仅内置 `definition` 模板；其余格式传入后回退到 definition 骨架，完整结构需按上方格式约定由 Agent/LLM 扩写。
- 纯生成、无副作用：不读写文件系统、不调用外部服务。
- 生成的是内容骨架而非终稿，发布前需人工或后续 Skill 补全具体事实与数据。

## Domain 差异

本 Skill 适用于所有 domain（`domains` 为空列表），无特化差异。5 种格式为跨行业通用结构；不同行业的差异体现在主题、对比对象和数据来源上，由调用方在 `topic` 与后续扩写中体现。
