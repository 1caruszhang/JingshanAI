/**
 * skillRegistry.ts
 *
 * Loads and validates SKILL.md frontmatter for all skills in the skills/ directory.
 * Called at Agent startup to ensure all Skill definitions are well-formed.
 *
 * Acceptance criterion: "启动时能用 YAML 解析器读取所有 frontmatter 且不报错"
 */

import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {parse as parseYaml} from 'yaml';

// ── Schema types ────────────────────────────────────────────────────────────

export type SkillDomain = 'local_service' | 'saas' | 'ecommerce';
export type SkillRiskLevel = 'low' | 'medium' | 'high';

export interface SkillFrontmatter {
  name: string;
  description: string;
  /** Legacy (#43 schema will phase out). Optional so existing SKILL.md still load. */
  domains?: SkillDomain[];
  /** Legacy (#43 schema will phase out). Optional so existing SKILL.md still load. */
  capabilities?: string[];
  /** Legacy (#43 schema will phase out). Optional so existing SKILL.md still load. */
  preconditions?: string[];
  risk_level: SkillRiskLevel;
  /** Legacy (#43 schema will phase out). Optional so existing SKILL.md still load. */
  requires_confirmation?: boolean;
  // ── New frontmatter fields (expand phase — all optional) ──
  /** Whether this skill requires knowledge-base context to run. */
  needsKb?: boolean;
  /** Structured output schema (e.g. JSON Schema) describing the skill's output. */
  outputSchema?: string;
  /** Comma-separated list of tools the skill is allowed to invoke. */
  tools?: string;
  /** Few-shot examples guiding the skill's invocation. */
  examples?: string;
}

export interface LoadedSkill {
  /** Directory name (same as frontmatter.name) */
  dirName: string;
  /** Absolute path to SKILL.md */
  skillMdPath: string;
  /** Parsed and validated frontmatter */
  frontmatter: SkillFrontmatter;
  /** Raw body Markdown after the closing --- delimiter */
  body: string;
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_DOMAINS = new Set<string>(['local_service', 'saas', 'ecommerce']);
const VALID_RISK_LEVELS = new Set<string>(['low', 'medium', 'high']);

export function validateFrontmatter(
  raw: unknown,
  filePath: string,
): SkillFrontmatter {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`[skillRegistry] ${filePath}: frontmatter is not an object`);
  }

  const fm = raw as Record<string, unknown>;

  // name (required)
  if (typeof fm.name !== 'string' || fm.name.trim() === '') {
    throw new Error(`[skillRegistry] ${filePath}: 'name' must be a non-empty string`);
  }

  // description (required)
  if (typeof fm.description !== 'string' || fm.description.trim() === '') {
    throw new Error(`[skillRegistry] ${filePath}: 'description' must be a non-empty string`);
  }
  if (fm.description.length < 10) {
    throw new Error(
      `[skillRegistry] ${filePath}: 'description' is too short (${fm.description.length} chars, min 10)`,
    );
  }

  // risk_level (required)
  if (!VALID_RISK_LEVELS.has(fm.risk_level as string)) {
    throw new Error(
      `[skillRegistry] ${filePath}: invalid risk_level '${fm.risk_level}'. Allowed: ${[...VALID_RISK_LEVELS].join(', ')}`,
    );
  }

  // ── Legacy fields (now optional; validated only when present) ──
  // domains
  let domains: SkillDomain[] | undefined;
  if (fm.domains !== undefined) {
    if (!Array.isArray(fm.domains)) {
      throw new Error(`[skillRegistry] ${filePath}: 'domains' must be an array`);
    }
    for (const d of fm.domains) {
      if (!VALID_DOMAINS.has(d as string)) {
        throw new Error(
          `[skillRegistry] ${filePath}: invalid domain '${d}'. Allowed: ${[...VALID_DOMAINS].join(', ')}`,
        );
      }
    }
    domains = (fm.domains as unknown[]).filter(
      (d): d is SkillDomain => VALID_DOMAINS.has(d as string),
    );
  }

  // capabilities
  let capabilities: string[] | undefined;
  if (fm.capabilities !== undefined) {
    if (!Array.isArray(fm.capabilities) || fm.capabilities.length === 0) {
      throw new Error(
        `[skillRegistry] ${filePath}: 'capabilities' must be a non-empty array`,
      );
    }
    for (const c of fm.capabilities) {
      if (typeof c !== 'string' || c.trim() === '') {
        throw new Error(`[skillRegistry] ${filePath}: each capability must be a non-empty string`);
      }
    }
    capabilities = (fm.capabilities as unknown[]).filter(
      (c): c is string => typeof c === 'string',
    );
  }

  // preconditions
  let preconditions: string[] | undefined;
  if (fm.preconditions !== undefined) {
    if (!Array.isArray(fm.preconditions)) {
      throw new Error(`[skillRegistry] ${filePath}: 'preconditions' must be an array`);
    }
    preconditions = (fm.preconditions as unknown[]).filter(
      (p): p is string => typeof p === 'string',
    );
  }

  // requires_confirmation
  let requiresConfirmation: boolean | undefined;
  if (fm.requires_confirmation !== undefined) {
    if (typeof fm.requires_confirmation !== 'boolean') {
      throw new Error(
        `[skillRegistry] ${filePath}: 'requires_confirmation' must be a boolean`,
      );
    }
    requiresConfirmation = fm.requires_confirmation;
  }

  // ── New optional fields (no validation beyond type; skip when absent) ──
  const needsKb = fm.needsKb === undefined ? undefined : Boolean(fm.needsKb);
  const outputSchema =
    fm.outputSchema === undefined ? undefined : String(fm.outputSchema);
  const tools = fm.tools === undefined ? undefined : String(fm.tools);
  const examples = fm.examples === undefined ? undefined : String(fm.examples);

  return {
    name: fm.name as string,
    description: fm.description as string,
    domains,
    capabilities,
    preconditions,
    risk_level: fm.risk_level as SkillRiskLevel,
    requires_confirmation: requiresConfirmation,
    needsKb,
    outputSchema,
    tools,
    examples,
  };
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Splits a SKILL.md file into frontmatter YAML and body Markdown.
 * The file must start with `---` and have a closing `---` after the YAML block.
 */
function parseSkillMd(content: string, filePath: string): {yaml: string; body: string} {
  const normalised = content.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    throw new Error(
      `[skillRegistry] ${filePath}: file must begin with YAML frontmatter (---\\n)`,
    );
  }
  const closingIdx = normalised.indexOf('\n---\n', 4);
  if (closingIdx === -1) {
    throw new Error(
      `[skillRegistry] ${filePath}: YAML frontmatter closing delimiter not found`,
    );
  }
  const yaml = normalised.slice(4, closingIdx);
  const body = normalised.slice(closingIdx + 5);
  return {yaml, body};
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolves the absolute path to the skills/ directory.
 *
 * In development the CWD is the repo root; in packaged builds the skills/
 * directory is bundled alongside resources.
 */
function resolveSkillsDir(): string {
  const candidate = join(process.cwd(), 'skills');
  if (existsSync(candidate)) return candidate;

  // Packaged build: skills/ is copied to resourcesPath
  if (typeof process.resourcesPath === 'string') {
    const packed = join(process.resourcesPath, 'skills');
    if (existsSync(packed)) return packed;
  }

  throw new Error(`[skillRegistry] Cannot locate skills/ directory (cwd: ${process.cwd()})`);
}

let _cachedSkills: LoadedSkill[] | null = null;
let _cachedSkillsDir: string | null = null;

/**
 * Loads and validates all SKILL.md files under skills/.
 *
 * Results are cached keyed by the resolved skillsDir path. Pass a different
 * skillsDir to bypass the cache (useful in tests).
 *
 * Throws on the first validation error encountered so that agent startup
 * fails fast with a clear message.
 */
export function loadAllSkills(opts: {skillsDir?: string} = {}): LoadedSkill[] {
  const skillsDir = opts.skillsDir ?? resolveSkillsDir();
  if (_cachedSkills && _cachedSkillsDir === skillsDir) return _cachedSkills;

  const entries = readdirSync(skillsDir, {withFileTypes: true})
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const loaded: LoadedSkill[] = [];

  for (const dirName of entries) {
    const skillMdPath = join(skillsDir, dirName, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      console.warn(`[skillRegistry] Missing SKILL.md in skills/${dirName} — skipping`);
      continue;
    }

    const content = readFileSync(skillMdPath, 'utf-8');
    const {yaml, body} = parseSkillMd(content, skillMdPath);

    let rawFm: unknown;
    try {
      rawFm = parseYaml(yaml);
    } catch (err) {
      throw new Error(
        `[skillRegistry] ${skillMdPath}: YAML parse error — ${(err as Error).message}`,
      );
    }

    const frontmatter = validateFrontmatter(rawFm, skillMdPath);

    if (frontmatter.name !== dirName) {
      throw new Error(
        `[skillRegistry] ${skillMdPath}: frontmatter 'name' ("${frontmatter.name}") must match directory name ("${dirName}")`,
      );
    }

    loaded.push({dirName, skillMdPath, frontmatter, body});
  }

  _cachedSkills = loaded;
  _cachedSkillsDir = skillsDir;
  return loaded;
}

/**
 * Retrieves a single skill by its name (= directory name).
 * Returns undefined if not found.
 */
export function getSkill(name: string): LoadedSkill | undefined {
  return loadAllSkills().find((s) => s.dirName === name);
}

/**
 * Returns the list of capability intent identifiers for all loaded skills.
 * Used by the routing layer to match user messages.
 */
export function getAllCapabilities(): string[] {
  return loadAllSkills().flatMap((s) => s.frontmatter.capabilities ?? []);
}

/**
 * Clears the in-memory cache. Intended for tests only.
 */
export function _resetCache(): void {
  _cachedSkills = null;
  _cachedSkillsDir = null;
}
