---
name: geo-local-optimizer
description: 制定本地商户的 AI 本地搜索 GEO 优化方案，统筹门店页面、地图列表、评论问答与结构化数据，让 AI 答案准确理解并安全引用门店信息
domains:
  - local_service
capabilities:
  - generate_local_geo_plan
  - optimize_local_presence
  - design_local_page_structure
preconditions: []
risk_level: low
requires_confirmation: false
---

# geo-local-optimizer

## 目标

把用户从「我有一家（或多家）本地门店 / 本地服务生意」带到一份**结构化的本地 GEO 优化方案**，使得：

- 每个门店与服务区域都**容易被 AI 模型理解并安全引用**；
- 网页、地图 / 列表资料、评论、问答与本地内容被统一为**一个一致的实体**；
- 同时覆盖传统搜索 + 地图包（map pack）与 ChatGPT / Perplexity / Gemini / Claude 式的本地问答。

本 Skill 聚焦**策略、结构与工作流**，是编排型 Skill：在可用时应与其他 GEO skill 协同（站点审计、schema 生成、llms.txt、多模态标注等），而不是替代它们。

## 使用场景

当用户经营或支持本地生意，且目标与「本地被发现」相关时调用，例如：

- 餐饮：咖啡馆、餐厅、烘焙店、奶茶店；
- 日常服务：健身房、美发沙龙、洗衣店、宠物店、维修、上门服务；
- 医疗与专业服务：诊所、牙科、心理咨询、律所、培训中心；
- 零售门店：便利店、精品店、电子产品店、书店。

典型触发信号：

- 「near me」式查询、城市 / 区域 + 服务（如「望京 牙科」「静安 私教」）、地标式搜索（如「国贸附近的咖啡」）；
- 门店页 / 门店详情页 / 门店查找器、地图 / 点评 / 外卖 / 本地目录平台资料；
- 本地评论、问答、UGC 与口碑；
- 如何让本地查询的 AI 答案更可能提到这家商户。

即使用户没有明说「GEO」或「本地 SEO」，只要描述了带明确地理位置的门店并希望本地客户更容易在搜索或 AI 答案中找到，就应考虑本 Skill。

## 输入

- `businessContext`: 商户与地域上下文，包括：
  - 品类 / 行业、单店 vs 多店 / 加盟；
  - 每个门店的完整地址（城市 / 区 / 街道 / 地标）与服务范围（步行半径、驾车时长或指定区域）；
  - 目标客户与语言（通勤族、亲子家庭、学生、外籍人士等）;
  - 核心服务 / 爆品、价格带（平价 / 中端 / 高端）与差异化卖点；
  - 现有数字资产：官网、落地页、门店查找器、地图 / 点评 / 外卖平台资料。
- `currentPresence`（可选）: 现有本地触点的 URL 或描述，用于现状审计。

## 输出

除非用户另有要求，输出为一份 Markdown 本地 GEO 方案，按以下 8 个小节组织（对应下方 8 步工作流）：

1. `## Local Business Brief` — 6–10 条要点的商户简报；
2. `## Local Presence Snapshot` — 现状概述 1–2 段 + 触点状态表（平台 / 状态 Good-OK-Poor-Missing / 关键问题）；
3. `## Local Entity & Page Plan` — 核心页面表（页面 / 主要意图 / 目标地域 / 实体类型 / 建议 URL）；
4. `## Local Page Structures` — 至少一套门店页模板，可附多门店或高低客单价变体；
5. `## Local Structured Data Package` — 1–2 个 JSON-LD 示例 + 「URL 模式 → Schema 类型 → 必填字段」映射表；
6. `## Local Reputation & Q&A Plan` — 邀评话术、优质评论范式、Top FAQ 及标准答案草稿；
7. `## Local AI & Crawler Signaling Plan` — sitemap / llms.txt / 内链 / 外部引用的行动清单与映射表；
8. `## Measurement & Iteration` — 5–10 个可执行指标与 1–3 个月一次的复盘节奏。

写作要求：Markdown 标题与表格、要点列表代替大段文字、短句可执行，方便商户直接抄进任务清单。若用户只要求子集，保留标题但标注「本次不涉及」。

辅助脚本 `scripts/generate_local_page_outline.ts` 提供门店页标准分节，可在 Electron 主进程中直接 import 调用：

```ts
import {
  getDefaultLocationPageSections,
  exportLocationPageOutline,
} from './scripts/generate_local_page_outline.ts';

const sections = getDefaultLocationPageSections(); // LocalPageSection[]：8 个标准分节
const outline = exportLocationPageOutline();       // 同内容的纯对象数组，便于序列化或贴入表格
```

更完整的页面模板（咖啡馆、城市级服务区域页、诊所）见 `references/local-page-templates.md`，按需摘取适配，不要默认全量内联。

## 约束

- 本地 AI 搜索的核心思路：查询通常是「意图 + 地理 + 约束」的组合，目标是**让模型能安全地把这家店推荐给别人**，而不是堆砌关键词。
- 始终保证 NAP（Name / Address / Phone）在各平台一致；这是地图与列表系统的硬要求。
- 结构化数据按实体选 `@type`：`LocalBusiness` 或其子类型（`Restaurant`、`CafeOrCoffeeShop`、`Store`、`MedicalClinic`、`Dentist`、`HealthClub` 等）、上门服务用 `Service`、关键从业者用 `Person`；必填字段包括 `name`、`image`、`url`、`telephone`、`address`、`geo`、`openingHoursSpecification`、`areaServed`、`sameAs` 等。
- 评论与口碑引擎要可持续：提供自然的邀评话术、高信息量评论模板（场景 + 用过的服务 + 适合谁）、差评回应结构（共情 → 说明 → 建设性解决）。
- 内链锚文本尽量组合「地理 + 场景 + 品类」。
- 本 Skill 为只读 / 纯生成，不修改任何数据；所有输出均为建议方案。

## Domain 差异

本 Skill 仅适用于 `local_service`（本地服务行业），不适用于 `saas` 与 `ecommerce`：

- 所有方法论都围绕「门店 + 地理 + 本地触点」设计，依赖地图 / 列表平台、评论问答、服务区域等本地独有信号；
- 高复购低客单的本地零售 / 餐饮与高客单重信任的本地服务（医疗、教育、家装等）在页面模板与口碑策略上有差异，输出 `## Local Page Structures` 时应按需给出变体。
