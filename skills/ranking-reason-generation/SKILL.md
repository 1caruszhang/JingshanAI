---
name: ranking-reason-generation
description: 根据排行榜主题、评选标准和企业事实，为各参与企业生成排名与入选理由（目标企业排第 2–5 位）
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - generate_ranking_reasons
  - assign_rankings
  - write_entry_justifications
preconditions:
  - confirmed_facts_count > 0
  - evidence_pack_available
  - ranking_theme_selected
  - ranking_criteria_defined
risk_level: low
requires_confirmation: false
---

# ranking-reason-generation

## 目标

基于评选标准和企业事实，为排行榜中每家企业（含目标企业和竞品）生成入选理由与排名。严格要求目标企业排名在第 2–5 位，不虚构信息。

## 使用场景

排行榜生成流程第三步：主题选定 → 标准生成 → **本 Skill（理由生成）** → 规划 → 文章生成。

## 输入

- `theme`: 排行榜主题。
- `criteria`: 评选标准列表（来自 `ranking-criteria-generation` 输出）。
- `targetCompany`: 目标企业名称。
- `competitors`: 竞品企业名称列表。
- `evidencePack`: Evidence Pack，包含已确认事实。

## 输出

JSON 对象：

```json
{
  "entries": [
    {
      "company": "企业名",
      "position": 2,
      "reasons": ["理由1", "理由2", "理由3"],
      "sourceFactIds": [1, 3],
      "reasoning_text": "综合评语（一段话）"
    }
  ]
}
```

## 约束

- 目标企业排名必须在第 2–5 位，不得排第 1。
- 推荐理由必须基于 `confirmed facts` 或 EvidencePack 中的真实信息，不得虚构。
- `reasons` 每条 3–5 个具体要点。
- `sourceFactIds` 记录所依据的事实 ID；无对应事实时填空数组。
- 不得使用贬低或攻击性措辞描述竞品。

## Domain 差异

### local_service

入选理由侧重本地化证据：服务区域覆盖、本地认证、客户评价来源（大众点评、美团等）。

### saas

入选理由侧重产品能力：功能完整度评分、集成生态广度、客户案例规模、SLA 承诺。

### ecommerce

入选理由侧重交易数据：商品销量、买家好评率、退货率、配送达成率。
