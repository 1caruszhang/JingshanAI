/**
 * geoAgentSystemPrompt.ts
 *
 * Builds the system prompt for the GEO Agent, with optional per-domain
 * customization driven by the `project.domain` field and the matching
 * SKILL.md body sections (see `## Domain 差异` in each skill).
 *
 * Three prompt tiers:
 *   - Global (no project)         → general-purpose GEO assistant prompt
 *   - Project, no domain          → project-aware prompt with generic guidelines
 *   - Project, with domain        → project-aware prompt + domain-specific
 *                                   guidelines extracted from SKILL.md bodies
 */

import {loadAllSkills, type LoadedSkill} from './skillRegistry';
import type {SkillDomain} from './skillRegistry';
import {loadPrompt} from '../../prompts/loader.ts';

export interface SystemPromptContext {
  projectId?: number;
  projectName?: string;
  projectDomain?: string | null;
}

// ── Domain-specific guideline extraction ─────────────────────────────────────

/**
 * Extracts the `## Domain 差异` section from a SKILL.md body.
 * Returns the trimmed section content (without the heading), or null if not found.
 */
function extractDomainSection(body: string): string | null {
  // Match `## Domain 差异` (or variants) up to the next `## ` heading or EOF
  const match = body.match(/^##\s+Domain[^\n]*\n([\s\S]*?)(?=^##\s|\s*$)/m);
  if (!match) return null;
  const content = match[1].trim();
  return content.length > 0 ? content : null;
}

/**
 * Collects domain-specific guidelines from all Skills relevant to `domain`.
 * Skills whose `domains` array is empty are considered "generic" and are not
 * included — only Skills that explicitly target the requested domain contribute
 * their special-case guidelines.
 */
function collectDomainGuidelines(domain: SkillDomain): string[] {
  let skills: LoadedSkill[] = [];
  try {
    skills = loadAllSkills();
  } catch (err) {
    console.warn('[geoAgentSystemPrompt] failed to load skills for domain guidelines:', err);
    return [];
  }

  const guidelines: string[] = [];
  for (const skill of skills) {
    const domains = skill.frontmatter.domains;
    if (!domains || domains.length === 0) continue;
    if (!domains.includes(domain)) continue;

    const section = extractDomainSection(skill.body);
    if (section) {
      guidelines.push(`### ${skill.dirName}\n\n${section}`);
    }
  }
  return guidelines;
}

// ── Hard-coded fallbacks for known domains ──────────────────────────────────

const DOMAIN_FALLBACK_GUIDELINES: Record<SkillDomain, string> = {
  local_service: `本地服务（local_service）GEO 优化要点：
- 重点关注 NAP（Name / Address / Phone）信息一致性、地图/点评平台资料完整性
- 本地意图查询 = 服务 + 地理 + 约束（如「望京 牙科」「国贸附近咖啡」）
- 优先输出 LocalBusiness / Restaurant / MedicalClinic 等 Schema.org 子类型
- 强调口碑、客户评价、案例故事`,
  saas: `SaaS（软件即服务）GEO 优化要点：
- 重点关注产品功能、集成生态、定价方案、技术信任背书
- 常用 Schema 类型：SoftwareApplication、Organization、FAQPage
- 内容形式偏向深度对比、操作教程、最佳实践、API/集成文档
- 强调 ROI、客户成功案例、行业评测`,
  ecommerce: `电商（ecommerce）GEO 优化要点：
- 重点关注产品规格、价格、库存、运输、退换政策
- 常用 Schema 类型：Product（含 offers、aggregateRating）、FAQPage
- 内容形式偏向产品对比、购买指南、使用教程、用户评价
- 强调信任信号：正品保障、退换货政策、客户评价`,
};

// ── Prompt builders ─────────────────────────────────────────────────────────

function buildGlobalPrompt(): string {
  const soul = loadPrompt('soul');
  return `${soul}

---

当前用户**未选择任何项目**，你处于 Global Chat 模式。

你可以做的事情：
- 回答用户关于 GEO、AI 搜索、内容优化的一般性问题。
- 解释产品使用方法、功能概念。
- 帮助用户规划 GEO 项目流程、建议需要准备哪些资料。
- 调用 project_list 查看已有项目。
- 调用 project_create 创建新项目。

你**不能**做的事情：
- 不要调用 kb_search、fact.extract、article.generate 等需要 project_id 的项目级工具。
- 不要基于某个具体企业的知识库回答问题。
- 如果用户提出需要项目资料的任务（如"帮我写篇文章""检索一下我们公司资料"），请引导用户选择已有项目或创建新项目。`;
}

function buildProjectPrompt(context: SystemPromptContext): string {
  const {projectId, projectName, projectDomain} = context;

  const domainSection = buildDomainSection(projectDomain);
  const soul = loadPrompt('soul');

  return `${soul}

---

当前已选择项目${projectName ? `「${projectName}」` : ''} (ID = ${projectId})${projectDomain ? `，domain = ${projectDomain}` : ''}，你处于 Project-aware GEO Agent 模式。

可用工具：
- kb_search：在项目知识库中检索相关资料片段。
- answer_user：基于项目知识库直接回答用户问题。
- question_generate：基于企业事实生成目标问题列表。
- source_discover：为目标问题推荐参考信源。
- fact_extract：从知识库中抽取企业事实。
- article_generate：基于已确认事实生成 GEO 文章。
- claim_review：审核文章中的 Claim（断言）是否有事实支持。
- geo_review：审核文章的 GEO 优化质量。
- project_list：列出所有项目（如需切换项目）。
- project_create：创建新项目。

工作原则：
1. 如果用户的问题可以在企业知识库内回答，优先调用 answer_user。
2. 如果用户只需要查找资料或你不确定答案，先调用 kb_search。
3. 写文章前先确认企业事实（fact_extract），再生成目标问题（question_generate），再写文章（article_generate），最后审核（claim_review + geo_review）。
4. 只使用工具返回的信息，不要编造。
5. 回答保持简洁、专业。
${domainSection}`;
}

function buildDomainSection(projectDomain?: string | null): string {
  if (!projectDomain) {
    return `\n通用 GEO 指南：未指定项目 domain，按跨行业通用最佳实践执行。`;
  }

  const domain = projectDomain as SkillDomain;
  const skillGuidelines = collectDomainGuidelines(domain);
  const fallback = DOMAIN_FALLBACK_GUIDELINES[domain];

  if (skillGuidelines.length === 0) {
    return `\n${fallback}`;
  }

  return `\n${fallback}\n\n来自 Skill 定义的 domain-specific 指南：\n\n${skillGuidelines.join('\n\n')}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds the system prompt for the GEO Agent based on the provided context.
 *
 * Replaces the previous placeholder stub.
 */
export function buildSystemPrompt(context: SystemPromptContext): string {
  if (!context.projectId) {
    return buildGlobalPrompt();
  }
  return buildProjectPrompt(context);
}

/**
 * Returns the fact_type subset relevant for a given project domain. Used by
 * `fact.extract` to narrow the ontology schema before calling the LLM.
 *
 * If the domain is unknown or null, returns the full FACT_TYPES list (the
 * caller should treat undefined as "use default").
 */
export function getFactTypesForDomain(domain: string | null | undefined): string[] | undefined {
  if (!domain) return undefined;

  switch (domain as SkillDomain) {
    case 'local_service':
      // 本地服务最关注地址、服务区域、联系方式、客户案例
      return [
        'full_name',
        'short_name',
        'detailed_address',
        'service_area',
        'industry',
        'products_services',
        'target_customers',
        'core_advantages',
        'trust_backing',
        'customer_cases',
        'contact',
      ];
    case 'saas':
      // SaaS 不太需要详细地址/服务区域
      return [
        'full_name',
        'short_name',
        'industry',
        'products_services',
        'related_brands',
        'target_customers',
        'core_advantages',
        'trust_backing',
        'pain_points',
        'customer_cases',
        'derived_keywords',
      ];
    case 'ecommerce':
      // 电商关注产品、客户痛点、案例，联系方式相对不重要
      return [
        'full_name',
        'short_name',
        'industry',
        'products_services',
        'related_brands',
        'target_customers',
        'core_advantages',
        'trust_backing',
        'pain_points',
        'customer_cases',
        'derived_keywords',
      ];
    default:
      return undefined;
  }
}
