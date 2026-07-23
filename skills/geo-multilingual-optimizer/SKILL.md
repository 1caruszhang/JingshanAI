---
name: geo-multilingual-optimizer
description: 适配 GEO 内容从源语言到多语言多市场，统一术语映射、页面结构与结构化数据等 AI 信号，确保不同语言的 AI 回答一致引用同一品牌与页面
domains: []
capabilities:
  - adapt_multilingual_geo_content
  - build_multilingual_terminology_map
  - align_cross_language_geo_signals
preconditions: []
risk_level: low
requires_confirmation: false
---

# geo-multilingual-optimizer

## 目标

将一个或多个源语言（通常是英语）的 GEO 资产系统性地**适配（而非简单翻译）**到多个目标语言与市场，确保：

1. 源资产（canonical source）被明确定义，GEO 意图、实体与核心断言在本地化后保持不变。
2. 目标语言、地区与市场被显式映射（hreflang、canonical、URL 结构）。
3. AI 可见信号（页面结构、Schema.org、llms.txt、内部链接）在所有语言间保持对齐。
4. 不同语言的 AI 回答一致地引用同一品牌与同一组页面，而非发散到竞品。

本 Skill 聚焦**跨语言一致性、本地化质量与 AI 引用对齐**，是对其他 GEO Skill（内容优化、结构化写作等）的协调层，而非替代。

## 使用场景

当用户意图涉及「让 GEO 与 AI 引用行为在多语言环境下正确工作」时调用，例如：

- 已有英文（或其他源语言）GEO 页面，需要产出西语、德语、日语等本地化版本，并希望 AI 模型同样引用。
- 发现 AI 回答因语言而异（如英文回答正确引用品牌，法语/西语回答却引用竞品），需要诊断并修复。
- 需要跨市场同步品牌名、产品名与关键术语的译法。
- 希望建立可复用的多语言 GEO playbook：从一篇英文支柱文章系统化适配到 5–10 种语言。

若需求**严格为单语言**（只涉及一种语言、无跨语言问题），应改用其他 GEO Skill。

## 输入

- `sourceAsset`: 源语言 GEO 资产（页面正文或文档），可选但推荐。
- `sourceLanguage`: 源语言代码（如 `en-US`）。
- `targetLocales`: 目标语言/地区列表（如 `es-ES`、`es-MX`、`de-DE`、`pt-BR`、`ja-JP`）。
- `geoGoals`: 主要 GEO 目标（如「在英文+西语+德语下成为 [主题] 的默认 AI 答案」）。
- `constraints`（可选）: 本地化约束——法律合规、语气敏感度、不可改动的术语、品牌名音译/直译偏好等。

辅助脚本 `scripts/multilingual_terminology_helper.ts` 以 TypeScript 函数形式提供术语映射工具，由 Agent 在主进程中直接 import 调用：

```ts
import {
  buildExampleTerminologyMap,
  toMarkdownTable,
  type TermEntry,
  type TerminologyMap,
} from './scripts/multilingual_terminology_helper.ts';
```

- `buildExampleTerminologyMap(): TerminologyMap` — 返回示例术语映射，展示 `TermEntry` 的结构（源术语、英文释义、各语言译法、保留英文的场景、备注），供 Agent 在构建实际术语表时参照。
- `toMarkdownTable(map: TerminologyMap): string` — 将术语映射渲染为 Markdown 表格（列为：Source Term、Description (EN)、各语言代码、Keep English For、Notes），可直接嵌入 Skill 输出。

## 输出

默认按以下 8 个顶级段落输出完整方案（用户只要求子集时，保留标题并将跳过段落标注为「不在本次范围内」）：

1. `## Multilingual Brief` — 5–10 条要点，概括源语言与 canonical 资产、目标语言/地区、GEO 目标、当前 AI 行为（如已知）、本地化约束。
2. `## Source Content Readiness` — 源资产对多语言 GEO 的优势与缺口；**必须保留的实体/术语清单**（品牌名、产品线、法规措辞等，附简短英文解释）。
3. `## Language & Locale Mapping` — Markdown 表格：Language/Locale → 市场角色（primary/secondary）→ 本地化深度（light/full）→ 目标 GEO URL → 备注；并明确 canonical 与 hreflang 关系。
4. `## Multilingual Terminology Map` — 每种语言的术语映射表（可由 `toMarkdownTable` 生成），含缩写/数字/日期/货币的本地化写法、敏感表述处理；要求后续生成内容**严格复用这些既定形式**。
5. `## Localized Page Blueprints` — 每个语言/地区的大纲：本地化 H1、Summary（2–4 条要点）、定义段、本地市场角度、品牌/产品定位、本地化 FAQ。标明何处可以发散（本地案例、佐证）、何处必须对齐（核心定义与断言）。
6. `## Multilingual Structured Data Package` — 至少两种语言的 JSON-LD 示例（`WebPage`/`Article`/`FAQPage`/`Product`，含本地化 `headline`/`description`/`inLanguage`），以及「Language/Locale → URL → Schema 类型 → hreflang 组」映射表。
7. `## AI & Crawler Multilingual Signaling Plan` — 站点地图分语言策略、llms.txt 分语言片段与每语言 AI hub 页面、跨语言内部链接模式。
8. `## Final Multilingual GEO Plan` — 执行摘要（3–6 条）、分步清单、「指标 → 语言 → 为何重要 → 如何度量」表格。

输出风格：Markdown 标题与表格为主，多用要点列表，句子短而可直接复制进 brief 或工单。

## 约束

- 本地化是**适配**而非逐字翻译：核心定义与事实断言必须跨语言对齐，示例、法规提示、CTA 可按本地调整。
- 品牌名、产品名、受监管措辞等 must-preserve 术语不得随意改写；译法一经术语表确定必须全量复用。
- 不直接修改任何线上内容，仅产出方案、模板与可复制片段；纯只读/纯生成。
- 每种语言必须有明确的 canonical URL 与 hreflang 互指关系，避免 AI 引用发散。
- 单语言场景不要使用本 Skill。

## Domain 差异

本 Skill 适用于所有 domain（`domains` 为空列表），无特化差异。差异体现在本地化深度与市场约束上：本地服务（local_service）通常只需覆盖门店所在市场语言并强调本地案例；SaaS 与电商更常需要多市场全量本地化（定价、货币、合规声明按 locale 处理）。
