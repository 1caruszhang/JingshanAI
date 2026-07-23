---
name: geo-schema-gen
description: 生成并校验符合 Schema.org 规范的 JSON-LD 结构化数据标记，支持 Organization、FAQPage、Article、Product 等类型，提升 AI 对品牌内容的理解与引用率
domains: []
capabilities:
  - generate_schema_markup
  - validate_schema_markup
  - batch_generate_schemas
preconditions: []
risk_level: low
requires_confirmation: false
---

# geo-schema-gen

## 目标

为任意类型的页面生成可直接上线的 Schema.org JSON-LD 结构化数据标记，并对已有标记做完整性与最佳实践校验。结构化数据是 AI 平台理解品牌与内容的语言：它告诉 AI 内容是什么（实体类型）、由谁创建（作者、发布方）、何时发布（时效性）、与其他内容的关系（面包屑）。缺少 Schema 时，AI 只能依赖 NLP 推断，可靠性更低。

## 使用场景

文章或页面内容定稿后，作为「结构化数据生成」子步骤调用；或在 GEO 优化阶段对现有页面批量补全 Schema 标记、校验既有标记是否符合 Google Rich Results 资格。

## 支持的 Schema 类型

| 类型 | 优先级 | 适用场景 |
|------|--------|----------|
| `Organization` | 关键 | 首页、About 页 — 建立品牌实体 |
| `FAQPage` | 关键 | FAQ/支持页 — 直接供给 AI 问答 |
| `Article` / `BlogPosting` | 高 | 博客、新闻 — 提升可引用性 |
| `Product` | 高 | 产品/定价页 — 支持购物类引用 |
| `HowTo` | 高 | 教程、指南 — 支持分步回答 |
| `WebSite` | 高 | 首页 — 启用站内搜索理解 |
| `BreadcrumbList` | 中 | 所有页面 — 改善导航理解 |
| `VideoObject` | 中 | 视频页 — 支持视频引用 |
| `LocalBusiness` | 中 | 实体门店 — 本地 AI 搜索 |

完整类型说明见 [references/schema-types.md](references/schema-types.md)，字段要求见 [references/field-reference.md](references/field-reference.md)。

## 输入

脚本位于 `scripts/`，在 Electron 主进程中以 ESM import 调用（均为纯函数，无网络/文件 I/O）：

- 从结构化数据生成：`generateSchemaFromData(data: SchemaObject): SchemaObject | null`（`scripts/generate_schema.ts`）。`data` 必须包含 `@type` 或 `type` 字段；已知类型会深合并到内置模板上，未知类型原样返回。
- 从已抓取的 HTML 生成：`generateSchemaFromHtml(schemaType: string, url: string, html: string): SchemaObject | null`。由调用方负责抓取页面，函数自动提取标题、description、author 等元数据（支持 `Article`/`BlogPosting`/`Organization`）。
- 校验：`validateSchema(schema: unknown, options?: {strict?: boolean}): ValidationResult`（`scripts/validate_schema.ts`）。`strict: true` 时 warning 也视为不通过。
- 批量生成：`batchGenerateSchemas(pages: {url, html}[], options?: {limit?: number}): BatchSummary`（`scripts/batch_generate.ts`）。自动检测页面类型并提取数据；另导出 `parseSitemapUrls(xml)` 用于从 sitemap XML 解析 URL 列表。
- 输出包装：`wrapSchemaAsHtml(schema)` 生成可直接粘贴的 `<script type="application/ld+json">` 标签；`wrapSchemaAsMarkdown(schema)` 生成带说明的 Markdown。

## 输出

生成结果为 JSON-LD 对象（`SchemaObject`），嵌入页面 `<head>`：

```html
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    ...
  }
  </script>
</head>
```

校验结果结构：

```json
{
  "valid": true,
  "errors": [],
  "warnings": ["Description is quite short (< 50 chars)"],
  "info": []
}
```

## 约束

- 所有函数均为纯函数，不抓取 URL、不读写文件；页面 HTML 与 sitemap 内容由调用方提供。
- `@context` 必须使用 `https://schema.org`（而非 `http://`）。
- 同一页面不得放置多个互相冲突的 Organization schema，只保留一个完整版本。
- 模板中的占位字段必须替换为真实、准确的数据，不得原样发布。
- 上线前建议用外部工具复验：https://validator.schema.org 与 Google Rich Results Test。
- 常见错误：价格带货币符号、FAQ 项缺少 `acceptedAnswer`、面包屑项缺少 `position` —— `validateSchema` 会逐项检出。
- 多类型页面可将多个 schema 放入数组或 `@graph`；嵌套实体（Product + Offer + Review）按层级组合。

## Domain 差异

本 Skill 适用于所有 domain（`domains` 为空列表）。类型选择有行业倾向：本地服务（`local_service`）优先考虑 `LocalBusiness`；电商（`ecommerce`）优先考虑 `Product`（含 `offers`）；SaaS 以 `Organization` + `WebSite` + `FAQPage` 为核心。行业示例见 [references/examples.md](references/examples.md)。
