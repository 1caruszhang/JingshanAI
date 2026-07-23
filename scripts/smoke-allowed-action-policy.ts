/**
 * Smoke test: allowedActionPolicy (Issue #27) + intentRouter auto-gating.
 * Run with: npx tsx scripts/smoke-allowed-action-policy.ts
 *
 * Manual verification aid. No real database required — the snapshot provider
 * is injected via `setSnapshotProviderForTests` so the evaluators run against
 * fixed snapshots. The intentRouter assertion exercises the default policy
 * hook wired in via 方案 A.
 */
import {join} from 'node:path';
import {
  evaluatePrecondition,
  checkSkillPreconditions,
  isActionAllowed,
  getAllowedActions,
  blockHookForRoute,
  setSnapshotProviderForTests,
  resetSnapshotProviderForTests,
  type ProjectStateSnapshot,
} from '../electron/services/agent/allowedActionPolicy.ts';
import {route, _resetRouteTable} from '../electron/services/agent/intentRouter.ts';
import {loadAllSkills, _resetCache} from '../electron/services/agent/skillRegistry.ts';

const skillsDir = join(process.cwd(), 'skills');

// ── Harness ──────────────────────────────────────────────────────────────────

let ok = 0;
function check(label: string, fn: () => void): void {
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

async function checkAsync(label: string, fn: () => Promise<void>): Promise<void> {
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

const EMPTY: ProjectStateSnapshot = {
  confirmedFactsCount: 0,
  hasSelectedQuestion: false,
  hasKnowledgeEntries: false,
  hasApprovedDraft: false,
};

const ALL_SATISFIED: ProjectStateSnapshot = {
  confirmedFactsCount: 5,
  hasSelectedQuestion: true,
  hasKnowledgeEntries: true,
  hasApprovedDraft: true,
};

/** Inject a fixed snapshot regardless of projectId, to drive the evaluators. */
function withSnapshot(snap: ProjectStateSnapshot, fn: () => void): void {
  setSnapshotProviderForTests(() => snap);
  try {
    fn();
  } finally {
    resetSnapshotProviderForTests();
  }
}

async function withSnapshotAsync<T>(
  snap: ProjectStateSnapshot,
  fn: () => Promise<T>,
): Promise<T> {
  setSnapshotProviderForTests(() => snap);
  try {
    return await fn();
  } finally {
    resetSnapshotProviderForTests();
  }
}

// ── Setup: fresh skill registry + route table ────────────────────────────────

_resetCache();
loadAllSkills({skillsDir});
_resetRouteTable();

const CONTEXT = {projectId: 1, projectDomain: 'local_service'};

console.log('\n── evaluatePrecondition (unit) ─────────────────────────────────');

check('#27 confirmed_facts_count > 0 satisfied returns null', () => {
  if (evaluatePrecondition('confirmed_facts_count > 0', ALL_SATISFIED) !== null) {
    throw new Error('expected null when count > 0');
  }
});

check('#27 confirmed_facts_count > 0 unsatisfied returns reason', () => {
  const reason = evaluatePrecondition('confirmed_facts_count > 0', EMPTY);
  if (reason === null || !reason.includes('已确认事实')) {
    throw new Error(`unexpected reason: ${reason}`);
  }
});

check('#27 selected_question_exists unsatisfied returns reason', () => {
  const snap: ProjectStateSnapshot = {...ALL_SATISFIED, hasSelectedQuestion: false};
  const reason = evaluatePrecondition('selected_question_exists', snap);
  if (reason === null || !reason.includes('目标问题')) {
    throw new Error(`unexpected reason: ${reason}`);
  }
});

check('#27 has_knowledge_entries unsatisfied returns reason', () => {
  const snap: ProjectStateSnapshot = {...ALL_SATISFIED, hasKnowledgeEntries: false};
  const reason = evaluatePrecondition('has_knowledge_entries', snap);
  if (reason === null || !reason.includes('知识库条目')) {
    throw new Error(`unexpected reason: ${reason}`);
  }
});

check('#27 has_approved_draft unsatisfied returns reason', () => {
  const snap: ProjectStateSnapshot = {...ALL_SATISFIED, hasApprovedDraft: false};
  const reason = evaluatePrecondition('has_approved_draft', snap);
  if (reason === null || !reason.includes('已审核通过')) {
    throw new Error(`unexpected reason: ${reason}`);
  }
});

check('#27 unknown precondition is fail-open (returns null)', () => {
  // evidence_pack_available is declared by support-article-generation but
  // intentionally not implemented in the initial policy — it must not block.
  if (evaluatePrecondition('evidence_pack_available', EMPTY) !== null) {
    throw new Error('unknown precondition should fail-open');
  }
  if (evaluatePrecondition('ranking_entries_count >= 2', EMPTY) !== null) {
    throw new Error('numeric precondition should fail-open in v1');
  }
});

console.log('\n── checkSkillPreconditions (skill-level) ──────────────────────');

check('#27 article-generation blocked when confirmed_facts_count = 0', () => {
  withSnapshot(EMPTY, () => {
    const reason = checkSkillPreconditions('support-article-generation', CONTEXT);
    if (reason === null || !reason.includes('已确认事实')) {
      throw new Error(`expected facts-block reason, got: ${reason}`);
    }
  });
});

check('#27 article-generation blocked when no selected question', () => {
  // facts satisfied, but no selected question — selected_question_exists fires.
  const snap: ProjectStateSnapshot = {...ALL_SATISFIED, hasSelectedQuestion: false};
  withSnapshot(snap, () => {
    const reason = checkSkillPreconditions('support-article-generation', CONTEXT);
    if (reason === null || !reason.includes('目标问题')) {
      throw new Error(`expected question-block reason, got: ${reason}`);
    }
  });
});

check('#27 support-article-generation allowed when all preconditions met', () => {
  withSnapshot(ALL_SATISFIED, () => {
    const reason = checkSkillPreconditions('support-article-generation', CONTEXT);
    if (reason !== null) {
      throw new Error(`expected null (allowed), got: ${reason}`);
    }
  });
});

check('#27 planning skills also gate on selected question', () => {
  const snap: ProjectStateSnapshot = {...ALL_SATISFIED, hasSelectedQuestion: false};
  withSnapshot(snap, () => {
    for (const name of [
      'support-article-planning',
      'ranking-article-generation',
      'ranking-article-planning',
    ]) {
      const reason = checkSkillPreconditions(name, CONTEXT);
      if (reason === null || !reason.includes('目标问题')) {
        throw new Error(`${name} should block on missing selected question, got: ${reason}`);
      }
    }
  });
});

check('#27 skill with empty preconditions is always allowed', () => {
  // geo-citation-writer declares preconditions: []
  withSnapshot(EMPTY, () => {
    if (checkSkillPreconditions('geo-citation-writer', CONTEXT) !== null) {
      throw new Error('geo-citation-writer should always be allowed');
    }
  });
});

check('#27 unknown skill name is fail-open', () => {
  withSnapshot(EMPTY, () => {
    if (checkSkillPreconditions('does-not-exist', CONTEXT) !== null) {
      throw new Error('unknown skill should fail-open');
    }
  });
});

console.log('\n── isActionAllowed (result shape) ─────────────────────────────');

check('#27 isActionAllowed returns {allowed:false, reason} when blocked', () => {
  withSnapshot(EMPTY, () => {
    const result = isActionAllowed('support-article-generation', CONTEXT);
    if (result.allowed || typeof result.reason !== 'string') {
      throw new Error(`unexpected result: ${JSON.stringify(result)}`);
    }
  });
});

check('#27 isActionAllowed returns {allowed:true} when ok', () => {
  withSnapshot(ALL_SATISFIED, () => {
    const result = isActionAllowed('support-article-generation', CONTEXT);
    if (!result.allowed || result.reason !== undefined) {
      throw new Error(`unexpected result: ${JSON.stringify(result)}`);
    }
  });
});

console.log('\n── getAllowedActions ─────────────────────────────────────────');

check('#27 getAllowedActions returns non-empty list when state satisfied', () => {
  withSnapshot(ALL_SATISFIED, () => {
    const allowed = getAllowedActions(CONTEXT);
    if (allowed.length === 0) {
      throw new Error('expected non-empty allowed list');
    }
    if (!allowed.includes('support-article-generation')) {
      throw new Error('support-article-generation should be allowed when all satisfied');
    }
  });
});

check('#27 getAllowedActions excludes article-generation when facts missing', () => {
  withSnapshot(EMPTY, () => {
    const allowed = getAllowedActions(CONTEXT);
    if (allowed.includes('support-article-generation')) {
      throw new Error('support-article-generation should be excluded');
    }
    // Skills with no preconditions should still be present.
    if (!allowed.includes('geo-citation-writer')) {
      throw new Error('geo-citation-writer (no preconditions) should always be allowed');
    }
  });
});

console.log('\n── blockHookForRoute + intentRouter integration (方案 A) ─────');

check('#27 blockHookForRoute produces a working BlockPolicyHook', () => {
  withSnapshot(EMPTY, () => {
    const hook = blockHookForRoute(CONTEXT);
    const reason = hook('support-article-generation', CONTEXT);
    if (reason === null || !reason.includes('已确认事实')) {
      throw new Error(`hook should block, got: ${reason}`);
    }
  });
  withSnapshot(ALL_SATISFIED, () => {
    const hook = blockHookForRoute(CONTEXT);
    if (hook('support-article-generation', CONTEXT) !== null) {
      throw new Error('hook should allow when all satisfied');
    }
  });
});

await checkAsync('#27 route() auto-blocks via default policy when no blockHook passed', async () => {
  // Route a clear article-generation request with zero confirmed facts and
  // NO explicit blockHook. 方案 A means the router falls back to the policy
  // and should return {type:'blocked'}.
  await withSnapshotAsync(EMPTY, async () => {
    _resetRouteTable();
    const result = await route('帮我生成支持类文章', CONTEXT);
    if (result.type !== 'blocked') {
      throw new Error(`expected blocked, got ${JSON.stringify(result)}`);
    }
    console.log(`    → blocked: ${result.skillName} / ${result.reason}`);
  });
});

await checkAsync('#27 route() emits skill when preconditions satisfied', async () => {
  await withSnapshotAsync(ALL_SATISFIED, async () => {
    _resetRouteTable();
    const result = await route('帮我生成支持类文章', CONTEXT);
    if (result.type !== 'skill') {
      throw new Error(`expected skill, got ${JSON.stringify(result)}`);
    }
    console.log(`    → routed: ${result.skillName} (conf ${result.confidence.toFixed(2)})`);
  });
});

await checkAsync('#27 route() explicit blockHook still takes precedence', async () => {
  // Caller-supplied hook must override the default policy hook.
  await withSnapshotAsync(ALL_SATISFIED, async () => {
    _resetRouteTable();
    const explicitHook = () => 'caller override reason';
    const result = await route('帮我生成支持类文章', CONTEXT, explicitHook);
    if (result.type !== 'blocked' || result.reason !== 'caller override reason') {
      throw new Error(`expected caller-override block, got ${JSON.stringify(result)}`);
    }
  });
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${ok} checks passed.`);
if (process.exitCode) {
  console.error('Some checks failed.');
} else {
  console.log('All checks passed.');
}
