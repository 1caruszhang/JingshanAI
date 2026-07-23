---
name: geo-structured-writer
description: 重构非结构化文本为 AI 可引用的结构化内容，按六层结构栈补齐直接回答开头、H2/H3 标题、定义块、对比表格与 FAQ 块，提升内容被 AI 搜索引用的概率
domains: []
capabilities:
  - structure_content_for_ai
  - reformat_content_geo_friendly
  - add_geo_structure_blocks
preconditions: []
risk_level: low
requires_confirmation: false
---

# geo-structured-writer

> 方法论来源：GEOly AI（geoly.ai）——结构决定了内容是被 AI 跳过还是被 AI 引用。

## 目标

将非结构化文本重构为 AI 可读取、可引用的结构化内容，通过六层结构栈（直接回答开头、定义块、H2/H3 分节、表格/列表、FAQ、CTA）最大化内容被 AI 搜索引用的概率。

## 使用场景

当用户要求「为 AI 搜索重排内容格式」「把文章转成 GEO 友好结构」「给页面补 FAQ 和标题层级」「让内容对 AI 可读」时，由 Agent 在内容优化阶段调用。可对已有草稿做整体重构，也可在文章生成后作为结构化收尾步骤。

## 输入

- `content`: 待重构的原始文本（Markdown 或纯文本字符串）。
- `query`: （可选）内容要回答的核心查询，用于生成直接回答开头（Direct Answer Opener）。

## 六层结构栈（Structure Stack）

```
Layer 6: CTA / Next Step
Layer 5: FAQ Block
Layer 4: Structured Data（表格、列表）
Layer 3: Sectioned Body（H2/H3）
Layer 2: Definition Block
Layer 1: Direct Answer Opener
```

## 六条格式化规则

### 规则 1：直接回答开头（Direct Answer Opener）

用一句话完整回答核心查询，格式：`[主体] 是/做/意味着 [完整答案]。[上下文]。`

- ✅ 「GEO 是为 AI 生成答案优化内容的实践。」
- ❌ 「在当今数字化时代，许多品牌都在思考 AI……」

### 规则 2：分节标题（H2/H3）

- 每个大主题用 H2，每个子主题用 H3。
- 标题用描述性短语，不用单个词。
- ✅ 「GEO 对电商的核心收益」；❌ 「收益」

### 规则 3：定义块（Definition Block）

对专业术语使用定义块：

```markdown
**什么是 [术语]？**

[术语] 是 [一句话定义]。[上下文]。

关键属性：[属性1]、[属性2]、[属性3]
```

### 规则 4：数据表格

用表格替代对比段落：

```markdown
| 特性 | 方案 A | 方案 B |
|------|--------|--------|
| 价格 | $29/月 | $99/月 |
| 用户数 | 5 | 不限 |
```

### 规则 5：FAQ 块（必须）

文末至少 3 个问题：

```markdown
## Frequently Asked Questions

**Q: [用户会怎么输入这个问题]？**

A: [完整答案，2-4 句，可独立成立]
```

### 规则 6：编号步骤

流程类内容用编号步骤：

```markdown
## 如何 [达成结果]

1. **[动作动词] [任务]** — [说明]
2. **[动作动词] [任务]** — [说明]
```

## 输出

结构化重构报告，格式如下：

```markdown
# Structured Content Report

**Original**: [词数] words | Score: [X]/10
**Optimized**: [词数] words | Score: [X]/10

## Changes Applied

✅ Added Direct Answer Opener
✅ Restructured [n] sections with H2/H3
✅ Added Definition Block for: [terms]
✅ Converted [n] paragraphs to tables
✅ Added FAQ block with [n] questions
✅ Reformatted [n] processes as steps

## Recommended Schema

- Article
- FAQPage
- [其他建议的 schema]

---

## Restructured Content

[完整重构后的内容]
```

## 重构辅助函数

`scripts/structure_content.ts` 提供确定性辅助函数，可在 Electron 主进程直接 import 调用：

```ts
import {structureContent} from './scripts/structure_content.ts';

const structured = structureContent(rawContent);
// 在原文末尾追加 FAQ 块模板（问题答案为占位符，由 LLM 补全）
```

该函数为纯函数：原文逐行透传，末尾追加 FAQ 块模板；标题层级、定义块、表格等语义级重构由 LLM 按上述六条规则完成。

## 约束

- FAQ 块为必需项，至少 3 个问题，答案必须完整自包含。
- 直接回答开头必须是第一句话，不允许任何铺垫性引言。
- 对比类信息必须用表格呈现，不得保留对比段落。
- 纯生成操作，不修改项目数据，不写入外部系统。

## Domain 差异

本 Skill 适用于所有 domain（`domains` 为空列表），六层结构栈与六条规则为通用方法论，无行业特化差异；不同 domain 的差异体现在术语定义块与 FAQ 问题的具体措辞上，由 LLM 按项目上下文处理。

## 重构前后示例

### 重构前

```
Many companies are looking for ways to improve their visibility
in AI search. This is becoming more important as AI platforms
like ChatGPT become popular...
```

### 重构后

```markdown
# GEO (Generative Engine Optimization): Complete Guide

GEO is the practice of optimizing content to appear in
AI-generated answers on platforms like ChatGPT, Perplexity,
and Gemini.

## What is GEO?

**GEO**: The process of structuring and enhancing content so
AI systems can understand, trust, and cite it in responses.

Key attributes: structured data, entity clarity, factual accuracy

## GEO vs SEO

| Aspect | SEO | GEO |
|--------|-----|-----|
| Target | Search engines | AI systems |
| Focus | Keywords | Entities |
| Output | Rankings | Citations |

## Frequently Asked Questions

**Q: How is GEO different from SEO?**

A: SEO optimizes for search rankings; GEO optimizes for AI
citations. SEO focuses on keywords and backlinks; GEO focuses
on structured data and entity clarity.
```
