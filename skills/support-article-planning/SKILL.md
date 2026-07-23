---
name: support-article-planning
description: 在生成支持类文章前，分析企业事实与目标问题，制定文章大纲、核心要点和建议字数
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - plan_support_article
  - generate_article_outline
  - create_content_brief
preconditions:
  - confirmed_facts_count > 0
  - selected_question_exists
  - evidence_pack_available
risk_level: low
requires_confirmation: false
---

# support-article-planning

## 目标

在撰写支持类文章前，先制定清晰的内容规划方案：结构化大纲、核心要点与建议字数，作为 `support-article-generation` 的前置步骤。

## 使用场景

当用户请求生成支持类文章时，Agent 应先调用本 Skill 生成规划，再将输出传递给 `support-article-generation`。

## 输入

- `projectName`: 项目名称。
- `supportArticleType`: 文章子类型（如 `enterprise_profile`）。
- `targetQuestion`: 需要回答的核心问题。
- `evidencePack`: Evidence Pack，包含已确认事实和参考资料。

## 输出

JSON 对象：

```json
{
  "outline": "# 标题\n## 一级章节\n### 二级章节...",
  "keyPoints": ["核心要点1", "核心要点2"],
  "suggestedLength": 1200
}
```

## 约束

- 大纲必须是有效的 Markdown 格式，含标题层级。
- `keyPoints` 至少 1 条，最多 6 条。
- `suggestedLength` 范围 500–3000 字。
- 只基于可用事实规划，不生成文章正文。

## Domain 差异

### local_service

大纲侧重：服务区域、典型客户案例、联系方式与预约入口。

### saas

大纲侧重：产品功能模块、竞品对比维度、集成与 API 说明、定价层级。

### ecommerce

大纲侧重：商品分类、买家指南、物流与退换货政策、促销活动。
