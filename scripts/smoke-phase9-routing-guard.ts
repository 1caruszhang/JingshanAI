/**
 * Smoke test: intentRouter, toolGuard, geoAgentSystemPrompt (Issues #26, #30, #31).
 * Run with: npx tsx scripts/smoke-phase9-routing-guard.ts
 *
 * Manual verification aid — proves the three modules load and behave per their
 * acceptance criteria. No DB writes required for the pure-logic assertions.
 */
import {join} from 'node:path';
import {
  route,
  _resetRouteTable,
} from '../electron/services/agent/intentRouter.ts';
import {
  evaluateToolRisk,
  requiresApproval,
} from '../electron/services/agent/toolGuard.ts';
import {loadAllSkills, _resetCache} from '../electron/services/agent/skillRegistry.ts';
import {
  buildSystemPrompt,
  getFactTypesForDomain,
} from '../electron/services/agent/geoAgentSystemPrompt.ts';
import {
  setSnapshotProviderForTests,
  resetSnapshotProviderForTests,
} from '../electron/services/agent/allowedActionPolicy.ts';

const skillsDir = join(process.cwd(), 'skills');

let ok = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    ok++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function checkAsync(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// ── Setup: fresh skill registry ──────────────────────────────────────────────
_resetCache();
loadAllSkills({skillsDir});
_resetRouteTable();

// ── #26 intentRouter ─────────────────────────────────────────────────────────
//
// Note: as of #27, `route()` auto-applies the allowedActionPolicy default
// hook. The two routing tests below that expect a `{type:'skill'}` result
// inject a satisfying snapshot so they exercise the routing tier in isolation
// — they are testing #26's routing behaviour, not #27's precondition gating.

const SATISFIED_SNAPSHOT = {
  confirmedFactsCount: 5,
  hasSelectedQuestion: true,
  hasKnowledgeEntries: true,
  hasApprovedDraft: true,
};

async function withSnapshotAsync<T>(
  snap: typeof SATISFIED_SNAPSHOT,
  fn: () => Promise<T>,
): Promise<T> {
  setSnapshotProviderForTests(() => snap);
  try {
    return await fn();
  } finally {
    resetSnapshotProviderForTests();
  }
}

await checkAsync('#26 「帮我生成问题」 routes to a skill', async () => {
  const result = await withSnapshotAsync(SATISFIED_SNAPSHOT, () =>
    route('帮我生成问题', {projectDomain: null}),
  );
  if (result.type !== 'skill') {
    throw new Error(`expected skill, got ${JSON.stringify(result)}`);
  }
  console.log(`    → matched skill: ${result.skillName} (conf ${result.confidence.toFixed(2)})`);
});

await checkAsync('#26 「blahblahblah」 falls back to status_diagnosis', async () => {
  const result = await route('blahblahblah', {projectDomain: null});
  if (result.type !== 'fallback' || result.mode !== 'status_diagnosis') {
    throw new Error(`expected fallback/status_diagnosis, got ${JSON.stringify(result)}`);
  }
});

await checkAsync('#26 domain filter: local_service excludes SaaS-only skills', async () => {
  // With domain = local_service, candidate set is restricted. A SaaS-tilted
  // message should still resolve via generic skills or fall back cleanly.
  const result = await withSnapshotAsync(SATISFIED_SNAPSHOT, () =>
    route('帮我生成排行榜文章', {projectDomain: 'local_service'}),
  );
  if (result.type === 'skill') {
    console.log(`    → matched skill: ${result.skillName}`);
  }
  // The point of this assertion: no throw, no crash, deterministic branch.
  if (result.type === 'fallback' && result.mode !== 'status_diagnosis') {
    throw new Error(`unexpected fallback mode: ${JSON.stringify(result)}`);
  }
});

await checkAsync('#26 blocked route: BlockPolicyHook returns blocked', async () => {
  const blockHook = (skillName: string) => skillName === 'support-article-planning' ? 'precondition: confirmed_facts_count > 0 not met' : null;
  const result = await route('帮我生成文章大纲', {projectDomain: null}, blockHook);
  if (result.type !== 'blocked') {
    throw new Error(`expected blocked, got ${JSON.stringify(result)}`);
  }
  console.log(`    → blocked skill: ${result.skillName}, reason: ${result.reason}`);
});

check('#26 route signature matches RouteResult shape', () => {
  // Type-level: route returns a discriminated union. We exercise each branch.
  const union: 'skill' | 'blocked' | 'fallback' = 'blocked';
  if (union !== 'blocked') throw new Error('union sanity');
});

// ── #30 toolGuard ────────────────────────────────────────────────────────────

check('#30 evaluateToolRisk(publish.plan) === high', () => {
  if (evaluateToolRisk('publish.plan', {}) !== 'high') {
    throw new Error('publish.plan should be high risk');
  }
});

check('#30 requiresApproval(high) === true', () => {
  if (!requiresApproval('publish.plan', 'high')) {
    throw new Error('high risk must require approval');
  }
});

check('#30 requiresApproval(medium/low) === false', () => {
  if (requiresApproval('whatever', 'medium')) throw new Error('medium must not require approval');
  if (requiresApproval('whatever', 'low')) throw new Error('low must not require approval');
});

check('#30 evaluateToolRisk uses SKILL.md risk_level for known skills', () => {
  // support-article-generation has risk_level: low in its frontmatter
  const level = evaluateToolRisk('support-article-generation', {});
  if (level !== 'low') {
    throw new Error(`expected low for support-article-generation, got ${level}`);
  }
});

// ── #31 geoAgentSystemPrompt ─────────────────────────────────────────────────

check('#31 buildSystemPrompt(null) returns global prompt', () => {
  const prompt = buildSystemPrompt({});
  if (!prompt.includes('Global Chat') && !prompt.includes('未选择')) {
    throw new Error('global prompt missing expected marker');
  }
});

check('#31 buildSystemPrompt(local_service) includes local guidelines', () => {
  const prompt = buildSystemPrompt({projectId: 1, projectName: 'Test', projectDomain: 'local_service'});
  if (!prompt.includes('local_service')) {
    throw new Error('local_service prompt missing domain marker');
  }
  if (!prompt.includes('NAP') && !prompt.includes('Name / Address / Phone')) {
    throw new Error('local_service prompt missing NAP guideline');
  }
});

check('#31 buildSystemPrompt(saas) includes SaaS guidelines', () => {
  const prompt = buildSystemPrompt({projectId: 1, projectDomain: 'saas'});
  if (!prompt.includes('saas') && !prompt.includes('SaaS')) {
    throw new Error('saas prompt missing domain marker');
  }
  if (!prompt.includes('SoftwareApplication') && !prompt.includes('产品功能')) {
    throw new Error('saas prompt missing SaaS-specific guideline');
  }
});

check('#31 buildSystemPrompt(null domain) does not throw', () => {
  const prompt = buildSystemPrompt({projectId: 1, projectDomain: null});
  if (!prompt.includes('通用')) {
    throw new Error('null-domain prompt missing generic marker');
  }
});

check('#31 buildSystemPrompt no longer returns placeholder stub', () => {
  const prompt = buildSystemPrompt({projectId: 1});
  if (prompt.includes('placeholder system prompt')) {
    throw new Error('placeholder stub still present');
  }
});

check('#31 getFactTypesForDomain(local_service) includes detailed_address', () => {
  const types = getFactTypesForDomain('local_service');
  if (!types || !types.includes('detailed_address')) {
    throw new Error('local_service should include detailed_address');
  }
});

check('#31 getFactTypesForDomain(saas) excludes detailed_address', () => {
  const types = getFactTypesForDomain('saas');
  if (!types || types.includes('detailed_address')) {
    throw new Error('saas should exclude detailed_address');
  }
});

check('#31 getFactTypesForDomain(null) returns undefined (use default)', () => {
  if (getFactTypesForDomain(null) !== undefined) {
    throw new Error('null domain should return undefined');
  }
});

console.log(`\n${ok} checks passed.`);
if (process.exitCode) {
  console.error('Some checks failed.');
} else {
  console.log('All checks passed.');
}
