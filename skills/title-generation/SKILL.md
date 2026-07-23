---
name: title-generation
description: 基于目标问题和企业事实，生成 3–5 个面向生成式引擎的 GEO 标题候选，并给出评分和意图标注
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - generate_titles
  - suggest_article_titles
  - score_title_candidates
preconditions:
  - confirmed_facts_count > 0
  - evidence_pack_available
risk_level: low
requires_confirmation: false
---

# title-generation

## 目标

为文章或问答内容生成多个标题候选，每个候选附带评分（0–1）和意图标注（如「推荐」「怎么选」「排行榜」），帮助用户选择最符合 GEO 优化目标的标题。

## 使用场景

可在支持类文章或排行榜文章生成前独立调用，也可作为文章规划阶段的附属步骤，供用户确认标题方向。

## 输入

- `projectName`: 项目名称（目标企业）。
- `targetQuestion`: 目标问题/主题。
- `evidencePack`: Evidence Pack，用于了解企业核心优势（取前 5 条事实）。

## 输出

`TitleCandidate[]` 数组：

```json
[
  {
    "titleText": "2024 年国内最值得推荐的 SaaS CRM：TOP 5 深度评测",
    "score": 0.88,
    "intent": "排行榜",
    "notes": "搜索量高，包含决策意图词"
  }
]
```

## 约束

- 生成 3–5 个候选标题。
- 标题需包含决策意图词（推荐/怎么选/哪家好/排行榜）。
- 标题内容必须与可用事实一致，不虚构排名或数据。
- 若 LLM 调用失败，返回空数组而非抛出错误。

## Domain 差异

### local_service

标题风格：「[城市] 最好的 [服务类型] 是哪家？2024 年真实推荐」

### saas

标题风格：「[功能类别] SaaS 怎么选？[竞品数] 款产品横向对比」

### ecommerce

标题风格：「[品类] 怎么选？2024 年 [品牌数] 款热门产品实测排行」
