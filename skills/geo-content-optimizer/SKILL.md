---
name: geo-content-optimizer
description: 审计并优化现有内容以最大化其在 ChatGPT、Perplexity、Gemini 等 AI 平台的被引用率，输出引用就绪度评分、问题清单与结构化改写建议
domains: []
capabilities:
  - optimize_content_for_ai_citation
  - analyze_geo_readiness
  - audit_content_citation_score
preconditions:
  - article_outline_available
risk_level: low
requires_confirmation: false
---

# geo-content-optimizer

> 方法论来源：GEOly AI（geoly.ai）—— AI 愿意引用的内容遵循可预测的模式。

## 目标

对已有内容（文章、产品页、FAQ、落地页、About 页）做 GEO（Generative Engine Optimization）审计与优化，最大化其被 AI 平台（ChatGPT、Perplexity、Gemini、Google AI 等）引用的概率。产出引用就绪度评分（0–100）、按维度拆解的问题清单，以及可执行的改写建议。

## 使用场景

- 文章或页面内容生成完成后，作为「GEO 优化」子步骤调用；
- 用户明确要求「让内容更容易被 AI 引用」「做 GEO 优化」「内容没被 AI 引用，帮我改」时；
- Agent 审核阶段对发布前内容做引用就绪度体检。

## 输入

两个脚本均以 TypeScript 函数形式导出（Electron 主进程直接 import 调用，无 CLI）：

- `analyzeContent(content: string): GeoAnalysisReport` — 传入 Markdown 内容字符串，返回审计报告。
- `optimizeContent(content: string, contentType?: ContentType): GeoOptimizationResult` — 传入内容字符串与内容类型（`'article' | 'product' | 'faq' | 'landing' | 'about'`，默认 `'article'`），返回优化结果。

辅助函数：`formatAnalysisMarkdown(report)` 将报告渲染为 Markdown；`generateChangelog(changes)` 将变更列表渲染为分类 changelog。

## 输出

### 审计报告（`GeoAnalysisReport`）

```json
{
  "overallScore": 58,
  "maxScore": 80,
  "percentage": 72,
  "grade": "B",
  "dimensionScores": {
    "directAnswer": 8,
    "entityRich": 6,
    "structuredFormat": 9,
    "factDense": 3,
    "faqFormatted": 6,
    "definitionClarity": 6,
    "authoritativeVoice": 9,
    "scannable": 9
  },
  "wordCount": 850,
  "issues": ["Content lacks data density"],
  "suggestions": ["Include specific numbers, dates, and statistics to support claims"]
}
```

评分等级：90+ A+（极易被引用）/ 80+ A / 70+ B / 60+ C / 50+ D / 其余 F。

### 优化结果（`GeoOptimizationResult`）

包含 `original`（原文）、`optimized`（优化后文本）、`changes`（变更说明列表）、`wordCountOriginal` / `wordCountOptimized`。当前优化器以「诊断 + 变更建议」为主，不自动重写正文。

## GEO 引用框架（评分维度）

AI 平台偏好具备以下信号的内容，审计器按这 8 个维度各打 0–10 分：

| 信号 | 实现方式 |
|------|----------|
| **直接回答优先** | 前 2 句给出明确答案 |
| **实体丰富** | 品牌、产品、主题显式命名 |
| **结构化格式** | H2/H3 标题、列表、表格 |
| **事实密度** | 数字、日期、带 sources 的统计 |
| **FAQ 格式** | 显式 Q&A 块（至少 2–3 个） |
| **定义清晰** | 关键术语一句话定义 |
| **权威语气** | 陈述句，不用模糊措辞 |
| **可扫读** | 列表、表格、加粗、短段落 |

完整框架细节见 [references/citation-framework.md](references/citation-framework.md)。

## 8 条优化规则

1. **回答前置** — 去掉 "In today's digital landscape..." 式开场，第一句直接定义或回答。
2. **定义块** — 关键术语用 `**术语**: 一句话定义` 格式在首次出现处定义。
3. **标题结构化** — H2 分节、H3 分子节，每 300–400 词一个 H2。
4. **FAQ 化** — 把隐含疑问转成显式 `## Frequently Asked Questions` + `**Q: ...?**` 问答块。
5. **补数据点** — 用具体数字、年份、来源替换 "many businesses" 类模糊表述。
6. **实体优先写作** — 品牌名前 100 词内出现；产品、人物、地点带完整名称与上下文。
7. **去模糊化** — `might be` → `is`，`could potentially` → `does`，`it seems that` → 删除。
8. **可扫读排版** — 并列项用无序列表、步骤用有序列表、对比用表格、关键术语加粗、长段落（>100 词）拆分。

完整规则与 Before/After 示例见 [references/optimization-rules.md](references/optimization-rules.md) 与 [references/examples.md](references/examples.md)。

## 内容类型差异

| 类型 | 优化重点 | 关键手法 |
|------|----------|----------|
| article | 信息密度 | 导语直接回答、实体提及、数据 |
| product | 功能清晰 | 规格表、使用场景、竞品对比 |
| faq | 回答完整 | 直接 Q&A、答案 50–150 词、带数据 |
| landing | 价值主张 | 明确利益点、社会证明、CTA |
| about | 实体权威 | 创立故事、资质、里程碑 |

各类型细则见 [references/content-types.md](references/content-types.md)。

## 约束

- 纯只读分析 / 纯文本生成，不修改任何项目数据，无副作用。
- 优化器不虚构数据：添加数据点的建议必须由调用方（或上层 Agent）结合 Evidence Pack 的事实填充，不得编造统计数字。
- 评分器基于规则与正则的启发式判断，英文内容信号最准确；中文内容的实体识别与弱开场检测可能偏弱，结论供参考而非绝对判定。

## Domain 差异

本 Skill 适用于所有 domain（`domains` 为空列表），无行业特化逻辑。不同 domain 的差异体现在内容类型选择上（如 ecommerce 偏 product/landing，local_service 偏 landing/about，saas 偏 article/product），框架与评分规则统一适用。
