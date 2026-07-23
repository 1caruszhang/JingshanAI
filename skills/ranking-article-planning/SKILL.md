---
name: ranking-article-planning
description: 基于已生成的排行榜入选数据，规划排行榜文章的 Markdown 大纲与章节结构
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - plan_ranking_article
  - generate_ranking_outline
  - structure_ranking_content
preconditions:
  - selected_question_exists
  - ranking_entries_count >= 2
  - ranking_theme_selected
risk_level: low
requires_confirmation: false
---

# ranking-article-planning

## 目标

在生成排行榜文章正文前，先根据已有的排行榜数据设计文章结构：详细大纲与顶层章节列表，作为 `ranking-article-generation` 的前置规划。

## 使用场景

排行榜生成流程第四步：主题选定 → 标准生成 → 理由生成 → **本 Skill（规划）** → 文章生成。

## 输入

- `theme`: 排行榜主题（来自 `ranking-theme-selection` 输出）。
- `entries`: 排行榜入选数据列表（来自 `ranking-reason-generation` 输出）。
- `targetQuestion`: 目标问题。

## 输出

JSON 对象：

```json
{
  "outline": "# 标题\n## 引言\n## TOP N 排行榜\n### 第 1 名...",
  "structure": ["引言", "排行榜概览", "详细评析", "总结建议"]
}
```

## 约束

- 大纲必须符合 GEO 优化原则：开门见山、结论前置、使用列表与表格。
- `structure` 至少 2 个顶层章节。
- 不生成文章正文，只输出结构规划。

## Domain 差异

### local_service

大纲侧重本地化信息：服务区域介绍、评选来源（本地调研/平台数据）、联系方式汇总。

### saas

大纲侧重功能对比：功能矩阵表、集成列表、定价概览、适用规模说明。

### ecommerce

大纲侧重购买决策：商品亮点矩阵、买家须知、促销信息汇总、推荐理由排序。
