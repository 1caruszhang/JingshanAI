---
name: claim-source-mapping
description: 为文章中指定的 Claim（断言），从 Evidence Pack 中找出最相关的事实或文档片段来源并给出置信度评分
domains: []
capabilities:
  - map_claim_sources
  - trace_article_claims
  - verify_claim_evidence
preconditions:
  - claim_text_provided
  - evidence_pack_available
risk_level: low
requires_confirmation: false
---

# claim-source-mapping

## 目标

为文章中的某个 Claim（断言），从提供的证据库（企业事实 + 参考资料）中找到最相关的来源，精确引用原文片段，并给出置信度评分。可用于文章溯源、引用核验和内容可信度增强。

## 使用场景

文章生成完成后，作为「溯源」子步骤独立调用；或在 Agent 审核阶段对每条高置信度断言执行来源验证。

## 输入

- `claimText`: 需要溯源的 Claim 文本（断言字符串）。
- `evidencePack`: Evidence Pack，包含已确认事实（facts）和参考资料（chunks）。

## 输出

`MappedSource[]` 数组（最多 3 条），若无相关来源则返回空数组：

```json
[
  {
    "sourceType": "fact",
    "sourceId": 3,
    "sourceQuote": "原文片段（≤200 字）",
    "confidence": 0.92
  }
]
```

## 约束

- 每次最多返回 3 条来源。
- `sourceQuote` 不超过 200 字，必须是原文截取，不得改写。
- 若 `facts` 和 `chunks` 均为空，直接返回空数组，不调用 LLM。
- 不修改任何数据，纯只读查询操作。

## Domain 差异

本 Skill 适用于所有 domain（`domains` 为空列表），无特化差异。不同 domain 的差异体现在 Evidence Pack 的内容结构上，本 Skill 统一处理。
