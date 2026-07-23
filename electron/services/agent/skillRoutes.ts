/**
 * skillRoutes.ts
 *
 * Declarative routing table for `intentRouter.route()`. Every intent the agent
 * recognises has exactly one row here; the router never reads capabilities /
 * domains from SKILL.md to decide routing — this table is the single source of
 * truth for intent → skill mapping.
 *
 * Three kinds of route:
 *
 *   - `md-driven` — a Skill directory under `skills/` whose body is executed
 *     by the md-driven runtime (#53/#55). 17 rows. Two of them
 *     (`title-generation`, `ranking-article-generation`) are already sliced
 *     onto the md-driven runtime and carry `migrated: true`; the remaining 15
 *     stay on the legacy executor path until the cutover ticket (#62).
 *   - `service` — a pure service/tool intent with no SKILL.md body (fact
 *     extraction, source discovery, claim parsing, claim review, geo review).
 *     5 rows.
 *   - `pause` — the single high-risk pause intent `publish.plan`, which has no
 *     executor body: the runtime writes an approval row and pauses. 1 row.
 *
 * `keywords` are **complete phrases** (not single tokens). Tier 1 of the router
 * matches them with substring `includes` against the lowercased user message.
 * `trigger` is the semantic description fed to Tier 2 (the LLM) when no phrase
 * hits. `preconditions` reuse the `allowedActionPolicy` expression vocabulary
 * and are evaluated inside `resolveWithPolicy`.
 */

import type {SkillRiskLevel} from './skillRegistry.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export type RouteKind = 'md-driven' | 'service' | 'pause';

/**
 * One row of the declarative routing table.
 *
 * `intent` is the stable dotted identifier (== SKILL_EXECUTORS key for service
 * intents, == skill directory name for md-driven intents, == `publish.plan`
 * for the pause intent). `skillDir` is the skills/ directory the row resolves
 * to (undefined for service/pause intents that have no SKILL.md).
 */
export interface SkillRoute {
  /** Stable dotted intent id, e.g. `fact.extract`, `ranking-article-generation`, `publish.plan`. */
  intent: string;
  /** skills/ directory name for md-driven intents; undefined for service/pause. */
  skillDir?: string;
  kind: RouteKind;
  /** Semantic description used by Tier 2 LLM matching. */
  trigger: string;
  /** Complete phrases; Tier 1 substring-matches the lowercased message. */
  keywords: string[];
  /** Precondition expressions (allowedActionPolicy vocabulary). */
  preconditions: string[];
  riskLevel: SkillRiskLevel;
  /**
   * Only meaningful for `md-driven` routes: `true` when the skill has been
   * sliced onto the md-driven runtime. The 2 slice skills
   * (`title-generation`, `ranking-article-generation`) are `true`; the other
   * 15 are `false` until the cutover ticket (#62). service/pause rows carry
   * `false` (the field is irrelevant for them).
   */
  migrated: boolean;
}

// ── Table (23 intents: 17 md-driven + 5 service + 1 pause) ───────────────────

export const SKILL_ROUTES: readonly SkillRoute[] = [
  // ── A-class: 17 md-driven skills ──────────────────────────────────────────
  // Slice skills (already on the md-driven runtime).
  {
    intent: 'title-generation',
    skillDir: 'title-generation',
    kind: 'md-driven',
    trigger: '基于目标问题和企业事实，生成 3–5 个面向生成式引擎的 GEO 标题候选并评分',
    keywords: ['生成标题', '标题候选', '标题生成', 'geo 标题', '文章标题', 'generate title'],
    preconditions: ['confirmed_facts_count > 0'],
    riskLevel: 'low',
    migrated: true,
  },
  {
    intent: 'ranking-article-generation',
    skillDir: 'ranking-article-generation',
    kind: 'md-driven',
    trigger: '基于排行榜主题、入选理由与 Evidence Pack，生成完整的 GEO 排行榜文章',
    keywords: ['生成排行榜文章', '排行榜文章生成', '写排行榜文章', 'ranking article'],
    preconditions: [
      'confirmed_facts_count > 0',
      'selected_question_exists',
      'ranking_theme_selected',
      'ranking_criteria_defined',
      'ranking_entries_count >= 2',
    ],
    riskLevel: 'low',
    migrated: true,
  },
  // Remaining 15 md-driven skills (legacy executor path until #62).
  {
    intent: 'claim-source-mapping',
    skillDir: 'claim-source-mapping',
    kind: 'md-driven',
    trigger: '为文章中指定的 Claim 从 Evidence Pack 中找出最相关的事实或文档片段来源并给出置信度',
    keywords: ['claim 来源映射', '断言来源', '证据映射', 'claim source mapping'],
    preconditions: ['claim_text_provided', 'evidence_pack_available'],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-citation-writer',
    skillDir: 'geo-citation-writer',
    kind: 'md-driven',
    trigger: '撰写 AI 高引用格式的内容资产（定义文章、FAQ 页面、对比指南、操作教程）提升被引用率',
    keywords: ['引用内容写作', '高引用文章', 'citation 内容', 'definition article', 'faq page'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-content-optimizer',
    skillDir: 'geo-content-optimizer',
    kind: 'md-driven',
    trigger: '审计并优化现有内容以最大化其在 AI 平台的被引用率，输出引用就绪度评分与改写建议',
    keywords: ['内容优化', 'geo 优化内容', '引用就绪度', 'content optimizer', '审计内容'],
    preconditions: ['article_outline_available'],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-fact-checker',
    skillDir: 'geo-fact-checker',
    kind: 'md-driven',
    trigger: '核查内容中的事实性断言（数字、日期、排名、引述统计）对照可靠来源验证真伪',
    keywords: ['事实核查', 'fact check', '核查断言', '验证事实', '事实性核查'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-local-optimizer',
    skillDir: 'geo-local-optimizer',
    kind: 'md-driven',
    trigger: '制定本地商户的 AI 本地搜索 GEO 优化方案，统筹门店页面、地图列表、评论问答',
    keywords: ['本地 geo 优化', '本地搜索优化', '门店优化', 'local seo', '本地商户优化'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-multilingual-optimizer',
    skillDir: 'geo-multilingual-optimizer',
    kind: 'md-driven',
    trigger: '适配 GEO 内容从源语言到多语言多市场，统一术语映射、页面结构与结构化数据',
    keywords: ['多语言 geo', '多语言优化', 'multilingual geo', '跨语言适配', '术语映射'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-schema-gen',
    skillDir: 'geo-schema-gen',
    kind: 'md-driven',
    trigger: '生成并校验符合 Schema.org 规范的 JSON-LD 结构化数据标记',
    keywords: ['schema 生成', 'json-ld', '结构化数据', 'schema.org', 'schema markup'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-sentiment-optimizer',
    skillDir: 'geo-sentiment-optimizer',
    kind: 'md-driven',
    trigger: '审计并优化品牌内容中的情感信号，识别负向风险与缺失的正向信号',
    keywords: ['情感优化', '品牌情感', 'sentiment 优化', '情感信号', '情感审计'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo-structured-writer',
    skillDir: 'geo-structured-writer',
    kind: 'md-driven',
    trigger: '重构非结构化文本为 AI 可引用的结构化内容，按六层结构栈补齐直接回答、H2/H3、表格、FAQ',
    keywords: ['结构化写作', '结构化内容', 'structured writer', '内容重构', 'geo 结构'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'ranking-article-planning',
    skillDir: 'ranking-article-planning',
    kind: 'md-driven',
    trigger: '基于已生成的排行榜入选数据，规划排行榜文章的 Markdown 大纲与章节结构',
    keywords: ['排行榜文章大纲', '排行榜文章规划', 'ranking outline', '排行榜大纲'],
    preconditions: ['selected_question_exists', 'ranking_entries_count >= 2', 'ranking_theme_selected'],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'ranking-criteria-generation',
    skillDir: 'ranking-criteria-generation',
    kind: 'md-driven',
    trigger: '为给定排行榜主题生成客观、可量化的评选标准列表（3–6 个维度，含名称、权重和描述）',
    keywords: ['排行榜评选标准', '评选标准生成', 'ranking criteria', '评选维度', '评分框架'],
    preconditions: ['ranking_theme_selected', 'evidence_pack_available'],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'ranking-reason-generation',
    skillDir: 'ranking-reason-generation',
    kind: 'md-driven',
    trigger: '根据排行榜主题、评选标准和企业事实，为各参与企业生成排名与入选理由',
    keywords: ['排名理由生成', '入选理由', 'ranking reason', '排名生成', '上榜理由'],
    preconditions: [
      'confirmed_facts_count > 0',
      'ranking_theme_selected',
      'ranking_criteria_defined',
    ],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'ranking-theme-selection',
    skillDir: 'ranking-theme-selection',
    kind: 'md-driven',
    trigger: '根据项目名称、目标问题和企业事实，确定最适合的排行榜主题、建议上榜企业数量和核心评选维度',
    keywords: ['排行榜主题选择', '排行榜主题', 'ranking theme', '主题选定', '排行主题'],
    preconditions: ['confirmed_facts_count > 0'],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'support-article-generation',
    skillDir: 'support-article-generation',
    kind: 'md-driven',
    trigger: '基于企业已确认事实与 Evidence Pack，生成面向 GEO 的支持类文章（企业简介、案例、问答）',
    keywords: ['支持类文章生成', '生成支持类文章', 'support article', '企业简介文章', '案例文章'],
    preconditions: [
      'confirmed_facts_count > 0',
      'selected_question_exists',
      'article_outline_available',
    ],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'support-article-planning',
    skillDir: 'support-article-planning',
    kind: 'md-driven',
    trigger: '在生成支持类文章前，分析企业事实与目标问题，制定文章大纲、核心要点和建议字数',
    keywords: ['支持类文章大纲', '支持文章规划', 'support article plan', '文章大纲制定'],
    preconditions: ['confirmed_facts_count > 0', 'selected_question_exists'],
    riskLevel: 'low',
    migrated: false,
  },

  // ── B-class: 5 service intents (no SKILL.md body) ─────────────────────────
  {
    intent: 'fact.extract',
    kind: 'service',
    trigger: '从企业资料/知识库中抽取结构化企业事实并入库，供后续文章生成与排行榜使用',
    keywords: ['抽取事实', '事实抽取', 'extract fact', '抽取企业事实', '事实提取'],
    preconditions: ['has_knowledge_entries'],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'source.discover',
    kind: 'service',
    trigger: '为目标问题发现并推荐外部参考信源，用于补充 Evidence Pack',
    keywords: ['信源发现', '发现信源', '推荐信源', 'source discover', '参考信源'],
    preconditions: ['selected_question_exists'],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'claim.parsing',
    kind: 'service',
    trigger: '从已生成的文章中解析出 Claim（断言）结构，供 Claim 审核与来源映射使用',
    keywords: ['claim 解析', '断言解析', 'claim parsing', '解析断言', '提取断言'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'claim.review',
    kind: 'service',
    trigger: '对文章中的 Claim（断言）进行审核，标注真伪/可信度并给出修正建议',
    keywords: ['claim 审核', '断言审核', '审核断言', 'claim review', 'claim 审查'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },
  {
    intent: 'geo.review',
    kind: 'service',
    trigger: '对生成内容进行 GEO 质量审核，评估引用就绪度、结构化与可被 AI 引用性',
    keywords: ['geo 审核', 'geo review', 'geo 优化审核', 'geo 质量审核', 'geo 审查'],
    preconditions: [],
    riskLevel: 'low',
    migrated: false,
  },

  // ── C-class: 1 pause intent ───────────────────────────────────────────────
  {
    intent: 'publish.plan',
    kind: 'pause',
    trigger: '准备发布计划，进入发布审批流程（高风险，需人工审批后方可继续）',
    keywords: ['发布计划', '准备发布', 'publish plan', 'publish.plan', '发布审批'],
    preconditions: ['has_approved_draft'],
    riskLevel: 'high',
    migrated: false,
  },
];

// ── Lookups ──────────────────────────────────────────────────────────────────

/**
 * Returns the route row for a given intent id, or undefined if not found.
 */
export function getRouteByIntent(intent: string): SkillRoute | undefined {
  return SKILL_ROUTES.find((r) => r.intent === intent);
}

/**
 * Returns the route row whose skillDir matches, or undefined. Useful for
 * mapping a skill directory resolved by Tier 1/Tier 2 back to its route row.
 */
export function getRouteBySkillDir(skillDir: string): SkillRoute | undefined {
  return SKILL_ROUTES.find((r) => r.skillDir === skillDir);
}
