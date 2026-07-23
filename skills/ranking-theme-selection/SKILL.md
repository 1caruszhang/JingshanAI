---
name: ranking-theme-selection
description: 根据项目名称、目标问题和企业事实，确定最适合的排行榜主题、建议上榜企业数量和核心评选维度
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - select_ranking_theme
  - determine_ranking_scope
  - choose_competitor_count
preconditions:
  - confirmed_facts_count > 0
  - evidence_pack_available
risk_level: low
requires_confirmation: false
---

# ranking-theme-selection

## 目标

分析目标问题和企业核心事实，为排行榜文章选定最合适的主题、上榜企业数量（含目标企业）和评选维度方向，作为整个排行榜生成流程的起点。

## 使用场景

排行榜生成流程**第一步**：**本 Skill（主题选定）** → 标准生成 → 理由生成 → 规划 → 文章生成。

## 输入

- `projectName`: 项目名称（目标企业）。
- `targetQuestion`: 用户的目标问题，如「国内最值得推荐的 SaaS CRM 是哪家」。
- `evidencePack`: Evidence Pack，用于了解企业核心优势和可用事实。

## 输出

JSON 对象：

```json
{
  "theme": "国内 TOP 5 SaaS CRM 服务商",
  "competitorCount": 5,
  "rankingDimensions": ["功能完整度", "客户案例", "定价透明度"]
}
```

## 约束

- `theme` 简洁有力（10–30 字），需贴合目标问题的搜索意图。
- `competitorCount` 范围 2–10（含目标企业）。
- `rankingDimensions` 3–5 个维度方向名称（非正式标准，后续由 `ranking-criteria-generation` 细化）。

## Domain 差异

### local_service

主题聚焦地域范围（如"北京 TOP 5 装修公司"），维度侧重本地口碑和服务能力。

### saas

主题聚焦功能类别（如"国内 TOP 5 营销自动化 SaaS"），维度侧重技术能力和生态整合。

### ecommerce

主题聚焦商品品类（如"2024 年最佳电动牙刷品牌 TOP 5"），维度侧重品质和用户体验。
