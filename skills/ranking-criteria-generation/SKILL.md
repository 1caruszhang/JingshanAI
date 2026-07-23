---
name: ranking-criteria-generation
description: 为给定排行榜主题生成客观、可量化的评选标准列表（3–6 个维度，含名称、权重和描述）
domains:
  - local_service
  - saas
  - ecommerce
capabilities:
  - generate_ranking_criteria
  - define_evaluation_dimensions
  - create_scoring_framework
preconditions:
  - ranking_theme_selected
  - evidence_pack_available
risk_level: low
requires_confirmation: false
---

# ranking-criteria-generation

## 目标

为排行榜主题设计客观中性的评选标准，确保标准可从公开信息或企业事实中验证，为后续 `ranking-reason-generation` 提供评分框架。

## 使用场景

排行榜生成流程第二步：主题选定 → **本 Skill（标准生成）** → 理由生成 → 规划 → 文章生成。

## 输入

- `theme`: 排行榜主题（来自 `ranking-theme-selection` 输出）。
- `evidencePack`: Evidence Pack，用于了解可用的事实类型，辅助设计可验证的标准。

## 输出

JSON 对象：

```json
{
  "criteria": [
    {
      "name": "标准名称",
      "weight": 0.3,
      "description": "评选说明"
    }
  ]
}
```

所有 `weight` 之和等于 1.0。

## 约束

- 生成 3–6 个评选维度。
- 标准必须客观中性，不能带有倾向性或对特定企业有利。
- 每个维度权重范围 0.05–0.50。
- 所有权重之和必须精确等于 1.0。

## Domain 差异

### local_service

推荐维度：服务覆盖范围、客户评价分数、响应速度、资质认证、本地市场占有率。

### saas

推荐维度：功能完整度、安全合规等级、集成能力、客户支持质量、定价透明度、文档完善度。

### ecommerce

推荐维度：商品品质与丰富度、价格竞争力、配送时效与履约率、退换货政策、用户评分与口碑。
