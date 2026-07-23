---
name: geo-fact-checker
description: 核查内容中的事实性断言（数字、日期、排名、竞品数据、引述统计），对照可靠来源验证真伪并输出结构化核查报告与修正建议
domains: []
capabilities:
  - fact_check_content
  - extract_factual_claims
  - verify_claim_sources
preconditions: []
risk_level: low
requires_confirmation: false
---

# geo-fact-checker

## 目标

对文章或落地页内容做严格的事实核查，提升内容在 AI 搜索与 GEO（Generative Engine Optimization）场景下的事实可靠性与可引用性。核心目标：

- 识别影响可信度的事实性断言（数字、日期、排名、竞品信息、基准数据等）。
- 对照可靠外部来源逐条验证这些断言。
- 明确标记不一致、不确定和过时的信息。
- 提出有证据支撑的修正文案，使内容可以被 AI 安全引用。

始终将**准确性、透明性、可追溯性**置于文采之上。

## 使用场景

文章或页面文案生成完成后，作为「事实核查」子步骤调用；或在内容更新旧数据、准备发布高可信度内容（报告、对比页、落地页、数据驱动文章）时使用。典型触发信号：

- 用户要求核查、验证、校验内容。
- 内容包含数字、日期、排名、市场份额、用户数、营收、增长率、基准或统计数据。
- 内容涉及竞品、「top X 工具」、「市场领导者」等依赖外部事实的比较。
- 用户希望把旧内容更新到最新年份的数据。

不适用：纯虚构/创意内容；不涉及外部事实的简单代码或数学问题。

## 输入

- `content`: 待核查的文章或文案全文（Markdown 或纯文本）。
- `timeHorizon`（可选）: 时间基准，如「截至 2026 年」「保持原文年份语境」。未指定时：常青概念按当前日期核查；历史描述按文中所述年份核查。
- `regions` / `industry`（可选）: 限定相关事实的地域、语言、行业范围。

可用辅助脚本 `scripts/claim_extractor.ts` 做断言的自动提取与分类：

```ts
import {extractCandidateClaims} from './scripts/claim_extractor.ts';

const claims = extractCandidateClaims(content);
// claims: [{id: 'C1', text: '...', claimType: 'numeric-statistic'}, ...]
```

内容较短时也可以由 Agent 手动提取，脚本仅用于复杂或批量场景。

## 输出

结构化事实核查报告（Markdown，人类与 AI 爬虫均易解析），默认包含四部分：

1. **假设与范围** — 时间基准、地域及使用的约束条件。
2. **断言清单表** — 每条断言包含：
   - `ID`（如 `C1`）
   - `原文断言`
   - `断言类型`（`numeric-statistic` / `date` / `ranking` / `competitor-info` / `quote` / `general-fact`）
   - `状态`（`verified` / `partially_verified` / `outdated` / `contradicted` / `uncertain`）
   - `关键证据摘要`
   - `主要来源`（域名 + 年份）
3. **建议修正文案** — 按段落分组给出改写建议。
4. **风险与待确认问题** — 证据薄弱、相互矛盾或可能很快变化的点。

示例（简化）：

> 输入：「我们的平台是全球 #1 的 AI 内容工具，2020 年服务超过 500 万用户。」

- `C1`: 「全球 #1 AI 内容工具」 — 状态：`uncertain`。多个工具用不同口径自称领先，无一致独立排名；建议软化为「领先的 AI 内容工具之一」或注明口径与地域。
- `C2`: 「2020 年 500 万用户」 — 状态：`verified` 或 `outdated`（取决于最新数据）。若语境是 2020 年则保留历史数字；若语境是「现在」则更新为最新用户数。

## 约束

- 工作流程：确认核查范围（时间基准/地域/行业）→ 提取并分类断言 → 制定验证计划（2–6 条要点）→ 用搜索/抓取工具收集证据 → 逐条比对定级 → 提出修正 → 输出结构化报告。
- 每条断言至少收集 1 个高质量佐证或证伪来源；优先权威来源（官网、政府、标准组织、知名研究机构），时效性断言须用近期有日期的来源。
- 数字比对须明确容差与单位；排名类断言须区分范围（全球/区域/细分）、时间与口径（营收/用户/流量）。
- 不得为凑「verified」而拉伸证据；存疑时选择 `uncertain` 或 `partially_verified`。
- 找不到可靠来源时如实说明，禁止猜测；证据为约数或各来源区间不一致时须透明标注。
- 对 `contradicted` 断言：给出符合证据的修正事实，或建议删除；对 `uncertain` 断言：改用谨慎措辞（「常被称为」「部分报告显示」）或建议省略。
- 引用来源时保持引文简短并注明域名；除非用户要求，不输出原始 URL。
- 只读/纯生成操作：不修改任何项目数据，不写库，不发布内容。
- 参考文件按需阅读以保持上下文精简：`references/fact-checking-patterns.md`（核查模式与清单）、`references/claim-types.md`（断言类型分类与处理指引）。

## Domain 差异

本 Skill 适用于所有 domain（`domains` 为空列表），无特化差异。不同 domain 的差异体现在断言的证据来源选择上（如电商类偏市场报告、本地服务类偏区域数据），核查流程与断言分类体系统一处理。
