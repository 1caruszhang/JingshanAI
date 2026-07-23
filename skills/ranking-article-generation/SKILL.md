---
name: ranking-article-generation
description: 基于排行榜主题、入选理由与 Evidence Pack，生成完整的 GEO 排行榜文章（含 Markdown 正文与入选企业列表）
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - generate_ranking_article
  - write_ranking_content
  - create_competitive_ranking
preconditions:
  - confirmed_facts_count > 0
  - selected_question_exists
  - evidence_pack_available
  - ranking_theme_selected
  - ranking_criteria_defined
  - ranking_entries_count >= 2
risk_level: low
requires_confirmation: true
---

# ranking-article-generation

## 目标

基于已确定的排行榜主题、评选标准和入选理由，生成一篇结构完整、符合 GEO 优化原则的排行榜文章。目标企业的排名须在第 2–5 位，不虚构竞品信息。

## 使用场景

排行榜生成流程的最终步骤：先完成主题选定 → 标准生成 → 理由生成 → 规划，最后调用本 Skill 生成文章正文。

## 输入

- `projectName`: 项目名称（即目标企业名）。
- `targetQuestion`: 排行榜对应的目标问题。
- `competitors`: 参与排名的竞品企业列表。
- `evidencePack`: Evidence Pack，包含已确认事实和参考资料。

## 输出

JSON 对象：

```json
{
  "title": "文章标题",
  "content": "完整 Markdown 文章正文",
  "confidence": 0.85,
  "entries": [
    {
      "company": "企业名",
      "position": 2,
      "reasons": ["理由1", "理由2"],
      "sourceFactIds": [1, 3],
      "reasoning_text": "综合评语"
    }
  ]
}
```

## 约束

- 目标企业排名必须在第 2–5 位，不得强制排第 1。
- 推荐理由必须来自 `confirmed facts` 或参考资料，不得虚构。
- 不得虚构竞品弱点，不得使用恶意贬低措辞。
- 文章必须使用 Markdown 格式，含标题、列表、对比表格。

## Domain 差异

### local_service

排行榜维度侧重：服务覆盖地区、口碑评分、响应速度、本地市场份额。

### saas

排行榜维度侧重：功能完整度、集成生态、安全合规、定价透明度、客户支持 SLA。

### ecommerce

排行榜维度侧重：商品丰富度、价格竞争力、配送时效、退换货政策、用户评分。
