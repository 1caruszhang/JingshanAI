---
name: support-article-generation
description: 基于企业已确认事实与 Evidence Pack，生成面向 GEO 的支持类文章（企业简介、案例、问答等）
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - generate_support_article
  - write_enterprise_profile
  - generate_faq_article
  - create_geo_content
preconditions:
  - confirmed_facts_count > 0
  - selected_question_exists
  - evidence_pack_available
  - article_outline_available
risk_level: low
requires_confirmation: true
---

# support-article-generation

## 目标

基于项目已确认事实与检索得到的 Evidence Pack，为 GEO 营销生成一篇「支持类文章」。

## 使用场景

用户在 Phase 7 文章生成 MVP 中点击「生成文章」时调用。通常由 `support-article-planning` 先生成大纲，再由本 Skill 根据大纲填充完整正文。

## 输入

- `projectName`: 项目名称。
- `supportArticleType`: 子类型，例如 `enterprise_profile`。
- `targetQuestion`: 目标问题/主题。
- `evidencePack`: Evidence Pack，包含已确认事实、参考资料、缺失字段、风险提示。
- `outline`（可选）: 来自 `support-article-planning` 的文章大纲。
- `keyPoints`（可选）: 核心要点列表。
- `suggestedLength`（可选）: 建议字数。

## 输出

JSON 对象：

```json
{
  "title": "文章标题",
  "content": "完整 Markdown 文章内容",
  "confidence": 0.85
}
```

## 约束

- 只使用输入中提供的事实与资料，禁止编造。
- 如果证据不足，在正文中明确说明并给出建议。
- 文章应适合生成式引擎优化（GEO）：结构清晰、小标题、关键信息前置。
- 不调用外部工具，不写入数据库，不执行发布。

## Domain 差异

### local_service

重点突出地理位置、服务覆盖范围、本地口碑与案例；CTA 指向预约或到店。

### saas

重点突出产品功能对比、集成生态、定价透明度；CTA 指向免费试用或演示。

### ecommerce

重点突出商品特性、售后保障、物流时效；CTA 指向购买页或优惠活动。
