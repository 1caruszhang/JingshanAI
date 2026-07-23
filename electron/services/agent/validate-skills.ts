/**
 * validate-skills.ts
 *
 * Self-contained script: validates all SKILL.md files in skills/.
 * Run with: npx tsx electron/services/agent/validate-skills.ts
 *
 * Exit code 0 = all valid; exit code 1 = at least one error.
 */
import {join} from 'node:path';
import {loadAllSkills, _resetCache} from './skillRegistry.ts';

const skillsDir = join(process.cwd(), 'skills');

_resetCache();

let passed = 0;
let failed = 0;

const failures: Array<{skill: string; error: string}> = [];

// ── Individual skill tests ────────────────────────────────────────────────────

function test(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
    failures.push({skill: label, error: (err as Error).message});
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// ── Load all skills ───────────────────────────────────────────────────────────

console.log('\n[validate-skills] Loading skills from:', skillsDir);

let skills;
try {
  skills = loadAllSkills({skillsDir});
  console.log(`[validate-skills] Loaded ${skills.length} skill(s)\n`);
} catch (err) {
  console.error('[validate-skills] Fatal error during load:', (err as Error).message);
  process.exit(1);
}

// ── Per-skill assertions ──────────────────────────────────────────────────────

const EXPECTED_SKILLS = [
  'support-article-generation',
  'support-article-planning',
  'ranking-article-generation',
  'ranking-article-planning',
  'ranking-criteria-generation',
  'ranking-reason-generation',
  'ranking-theme-selection',
  'title-generation',
  'claim-source-mapping',
  // Migrated geo_skills (Issue #25)
  'geo-content-optimizer',
  'geo-fact-checker',
  'geo-structured-writer',
  'geo-citation-writer',
  'geo-schema-gen',
  'geo-sentiment-optimizer',
  'geo-local-optimizer',
  'geo-multilingual-optimizer',
];

console.log('── Coverage check ───────────────────────────────────────────────');

for (const expected of EXPECTED_SKILLS) {
  test(`skill '${expected}' is present`, () => {
    const found = skills.find((s) => s.dirName === expected);
    assert(found !== undefined, `Missing SKILL.md for '${expected}'`);
  });
}

console.log('\n── Per-skill validation ─────────────────────────────────────────');

for (const skill of skills) {
  const {dirName: name, frontmatter: fm} = skill;
  const prefix = `[${name}]`;

  test(`${prefix} name matches directory`, () => {
    assert(fm.name === name, `name '${fm.name}' does not match dir '${name}'`);
  });

  test(`${prefix} description is non-empty`, () => {
    assert(typeof fm.description === 'string' && fm.description.length >= 10,
      `description too short or missing (${fm.description?.length ?? 0} chars)`);
  });

  test(`${prefix} domains are valid enum values`, () => {
    const valid = new Set(['local_service', 'saas', 'ecommerce']);
    for (const d of fm.domains) {
      assert(valid.has(d), `invalid domain '${d}'`);
    }
  });

  test(`${prefix} capabilities has at least 1 entry`, () => {
    assert(Array.isArray(fm.capabilities) && fm.capabilities.length >= 1,
      'capabilities must have at least 1 intent identifier');
  });

  test(`${prefix} capabilities are non-empty strings`, () => {
    for (const c of fm.capabilities) {
      assert(typeof c === 'string' && c.trim().length > 0,
        `capability '${c}' must be a non-empty string`);
    }
  });

  test(`${prefix} preconditions is an array`, () => {
    assert(Array.isArray(fm.preconditions), 'preconditions must be an array');
  });

  test(`${prefix} risk_level is valid`, () => {
    assert(['low', 'medium', 'high'].includes(fm.risk_level),
      `invalid risk_level '${fm.risk_level}'`);
  });

  test(`${prefix} requires_confirmation is boolean`, () => {
    assert(typeof fm.requires_confirmation === 'boolean',
      `requires_confirmation must be boolean, got ${typeof fm.requires_confirmation}`);
  });
}

// ── Issue #25 acceptance: geo-local-optimizer is local_service only ──────────

console.log('\n── Issue #25 acceptance checks ──────────────────────────────────');

test(`[geo-local-optimizer] domains is exactly ['local_service']`, () => {
  const skill = skills.find((s) => s.dirName === 'geo-local-optimizer');
  assert(skill !== undefined, 'geo-local-optimizer not loaded');
  const domains = skill!.frontmatter.domains;
  assert(
    domains.length === 1 && domains[0] === 'local_service',
    `expected domains ['local_service'], got ${JSON.stringify(domains)}`,
  );
});

// Migrated geo skills must carry T2-schema descriptions suitable for semantic
// routing (schema doc recommends 50–150 chars). Derived from EXPECTED_SKILLS.
const GEO_SKILLS = EXPECTED_SKILLS.filter((name) => name.startsWith('geo-'));

for (const name of GEO_SKILLS) {
  test(`[${name}] description length within 50–150 chars`, () => {
    const skill = skills.find((s) => s.dirName === name);
    assert(skill !== undefined, `${name} not loaded`);
    const len = skill!.frontmatter.description.length;
    assert(len >= 50 && len <= 150, `description is ${len} chars (expected 50–150)`);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── Summary ──────────────────────────────────────────────────────');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  console.error('\nFailed checks:');
  for (const f of failures) {
    console.error(`  • ${f.skill}: ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('\n✓ All skills valid\n');
  process.exit(0);
}
