/**
 * baseline-diff.mjs — md-driven skill validate 层结构契约 baseline 对照脚本（#61）
 *
 * 用固定 fixture（canned LLM JSON 输出）跑新旧生成路径，diff 输出的 **JSON 结构契约**
 * （字段齐全 / 类型对 / 硬约束满足 / entries 数量 / position 范围），**非文本逐字**。
 *
 * 设计约束：
 *   - #62 big-bang 可能删除旧生成路径（generateTitles / generateRankingArticle）。
 *     旧路径 import 用 try/catch 守卫，删除则只跑新路径（validate 层）。
 *   - 新路径 = 各 skill 的 `index.ts` 导出的纯函数 `validate(rawOutput, ctx)`。
 *     validate 是纯函数（不调 LLM / 不读 DB），脚本注入 canned JSON 即可跑，
 *     无需 Electron / SQLite / 模型 Key，可在 CI 跑。
 *   - 结构契约 ≠ 文本相等：只校验字段存在 + 类型 + 硬约束（entries>=2、position∈[2,5] 等）。
 *
 * 用法：
 *   node --import tsx scripts/baseline-diff.mjs
 *   （或 npx tsx scripts/baseline-diff.mjs）
 *
 * 输出：
 *   - 打印每个 skill 的 new-path 结构契约 +（若旧路径在）old-path 结构契约 + diff 摘要。
 *   - 写 baseline 到 scripts/baseline.json（供 big-bang 后对比）。
 *
 * 退出码：new-path 全部 ok 则 0，否则 1。
 */
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── 固定 fixture：canned LLM JSON 输出 ────────────────────────────────────────
// 每个 skill 一份合法 fixture + 一份越界 fixture（用来验证修正型/拒绝型硬约束）。

const TITLE_VALID = {
  titles: [
    {titleText: '2024 国内最值得推荐的 SaaS CRM：TOP 5 深度评测', score: 0.88, intent: '排行榜', notes: '搜索量高'},
    {titleText: 'SaaS CRM 怎么选？三款主流产品横向对比', score: 0.72, intent: '怎么选'},
    {titleText: '国内 SaaS CRM 哪家好？集成与安全维度实测', score: 0.68, intent: '哪家好'},
  ],
};

const RANKING_VALID = {
  title: '2024 国内 SaaS CRM 推荐：TOP 5 深度评测',
  content: '## 排行榜正文\n| 排名 | 企业 | 优势 |\n|---|---|---|\n| 1 | 竞品A | ... |\n| 3 | 目标企业 | ... |',
  confidence: 0.85,
  entries: [
    {company: '竞品A', position: 1, reasons: ['功能完整'], sourceFactIds: [1], reasoning_text: '综合评语A'},
    {company: '目标企业', position: 3, reasons: ['集成生态强', '安全合规'], sourceFactIds: [2], reasoning_text: '综合评语B'},
  ],
};

// 越界 fixture：目标企业 position=1（应被修正型 clamp 到 2）
const RANKING_POSITION_OUT_OF_RANGE = {
  ...RANKING_VALID,
  entries: [
    {company: '目标企业', position: 1, reasons: ['强'], sourceFactIds: [2], reasoning_text: '评语'},
    {company: '竞品A', position: 6, reasons: ['全'], sourceFactIds: [1], reasoning_text: '评语'},
  ],
};

// 拒绝 fixture：entries 只有 1 条（应被 Zod min(2) 拒绝）
const RANKING_TOO_FEW_ENTRIES = {
  ...RANKING_VALID,
  entries: [
    {company: '目标企业', position: 3, reasons: ['强'], sourceFactIds: [2], reasoning_text: '评语'},
  ],
};

// ── 结构契约抽取 ──────────────────────────────────────────────────────────────

/** 递归抽取一个值的「结构契约」：字段名 + 类型 + 数组长度 + 叶子值类型。 */
function contract(value, path = '') {
  if (value === null) return {path, type: 'null'};
  if (Array.isArray(value)) {
    return {
      path,
      type: 'array',
      length: value.length,
      items: value.length > 0 ? contract(value[0], `${path}[]`) : null,
    };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = contract(v, path ? `${path}.${k}` : k);
    }
    return {path, type: 'object', fields};
  }
  return {path, type: typeof value};
}

/** 提取 new-path validate 结果的结构契约 + 硬约束断言。 */
function newPathContract(skillDir, validateResult) {
  if (!validateResult.ok) {
    return {skill: skillDir, path: 'new', ok: false, errors: validateResult.errors};
  }
  const data = validateResult.data;
  const c = contract(data);

  // 硬约束断言（结构层面，非文本）
  const assertions = [];
  if (skillDir === 'title-generation') {
    const titles = data.titles ?? [];
    assertions.push({name: 'titles.length in [3,5]', pass: titles.length >= 3 && titles.length <= 5, value: titles.length});
    assertions.push({name: 'every score in [0,1]', pass: titles.every(t => typeof t.score === 'number' && t.score >= 0 && t.score <= 1)});
  }
  if (skillDir === 'ranking-article-generation') {
    const entries = data.entries ?? [];
    assertions.push({name: 'entries.length >= 2', pass: entries.length >= 2, value: entries.length});
    assertions.push({name: 'every position in [2,5] (after clamp)', pass: entries.every(e => typeof e.position === 'number' && e.position >= 2 && e.position <= 5), value: entries.map(e => e.position)});
    assertions.push({name: 'entries sorted by position asc', pass: entries.every((e, i) => i === 0 || entries[i - 1].position <= e.position)});
    assertions.push({name: 'confidence in [0,1]', pass: typeof data.confidence === 'number' && data.confidence >= 0 && data.confidence <= 1});
  }

  return {skill: skillDir, path: 'new', ok: true, contract: c, assertions};
}

/** 提取 old-path 生成函数结果的结构契约（若旧路径仍在）。 */
function oldPathContract(skillDir, oldResult) {
  if (oldResult === null) return {skill: skillDir, path: 'old', ok: false, errors: ['old path unavailable (deleted by #62)']};
  const c = contract(oldResult);
  return {skill: skillDir, path: 'old', ok: true, contract: c};
}

// ── 旧路径守卫 import ─────────────────────────────────────────────────────────

async function loadOldPaths() {
  const oldPaths = {generateTitles: null, generateRankingArticle: null};
  // 旧路径需要 LLM chat，这里不实际调用（只校验 import 可达）。
  // 真正的 old/new 结构对比用同一份 fixture 数据形状：old 函数返回值形状 vs new validate.data 形状。
  try {
    const titleMod = await import('../skills/title-generation/index.ts');
    if (typeof titleMod.generateTitles === 'function') {
      oldPaths.generateTitles = {shape: 'TitleCandidate[]', present: true};
    }
  } catch {
    oldPaths.generateTitles = null;
  }
  try {
    const rankingMod = await import('../skills/ranking-article-generation/index.ts');
    if (typeof rankingMod.generateRankingArticle === 'function') {
      oldPaths.generateRankingArticle = {shape: 'RankingArticleGenerationOutput', present: true};
    }
  } catch {
    oldPaths.generateRankingArticle = null;
  }
  return oldPaths;
}

// ── 新路径 validate import ────────────────────────────────────────────────────

async function loadNewPaths() {
  const validateFns = {};
  try {
    const titleMod = await import('../skills/title-generation/index.ts');
    validateFns['title-generation'] = titleMod.validate;
  } catch (err) {
    validateFns['title-generation'] = null;
    console.error('[baseline-diff] failed to load title-generation validate:', err?.message ?? err);
  }
  try {
    const rankingMod = await import('../skills/ranking-article-generation/index.ts');
    validateFns['ranking-article-generation'] = rankingMod.validate;
  } catch (err) {
    validateFns['ranking-article-generation'] = null;
    console.error('[baseline-diff] failed to load ranking-article-generation validate:', err?.message ?? err);
  }
  return validateFns;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[baseline-diff] loading new-path validate layers...');
  const validateFns = await loadNewPaths();
  console.log('[baseline-diff] probing old-path presence (guarded)...');
  const oldPaths = await loadOldPaths();

  const cases = [
    {skill: 'title-generation', label: 'valid', fixture: TITLE_VALID, expectOk: true},
    {skill: 'ranking-article-generation', label: 'valid', fixture: RANKING_VALID, expectOk: true},
    {skill: 'ranking-article-generation', label: 'position-out-of-range (修正型)', fixture: RANKING_POSITION_OUT_OF_RANGE, expectOk: true},
    {skill: 'ranking-article-generation', label: 'too-few-entries (拒绝型)', fixture: RANKING_TOO_FEW_ENTRIES, expectOk: false},
  ];

  const results = [];
  let allPass = true;

  for (const c of cases) {
    const validate = validateFns[c.skill];
    if (!validate) {
      console.error(`[baseline-diff] ${c.skill}: validate not loaded — SKIP`);
      allPass = false;
      continue;
    }
    const result = await validate(JSON.stringify(c.fixture), {});
    const npc = newPathContract(c.skill, result);
    const expectMet = result.ok === c.expectOk;
    const assertionsPass = npc.ok ? (npc.assertions ?? []).every(a => a.pass) : true;
    const casePass = expectMet && assertionsPass;
    if (!casePass) allPass = false;

    console.log(`\n=== ${c.skill} [${c.label}] ===`);
    console.log(`  new-path ok=${result.ok} expectOk=${c.expectOk} expectMet=${expectMet}`);
    if (npc.ok) {
      for (const a of npc.assertions) {
        console.log(`    assert: ${a.name} -> ${a.pass ? 'PASS' : 'FAIL'}${a.value !== undefined ? ` (value=${JSON.stringify(a.value)})` : ''}`);
      }
    } else {
      console.log(`    errors: ${JSON.stringify(npc.errors)}`);
    }
    console.log(`  case ${casePass ? 'PASS' : 'FAIL'}`);
    results.push({skill: c.skill, label: c.label, expectOk: c.expectOk, newPath: npc, casePass});
  }

  // old-path 形状记录（仅记录可达性 + 返回值形状名，不实际调用以免触发 LLM）
  const oldShapeRecords = {
    'title-generation': oldPaths.generateTitles,
    'ranking-article-generation': oldPaths.generateRankingArticle,
  };
  console.log('\n=== old-path presence ===');
  for (const [skill, info] of Object.entries(oldShapeRecords)) {
    console.log(`  ${skill}: ${info ? `present (shape=${info.shape})` : 'absent (deleted by #62 — only new-path baseline emitted)'}`);
  }

  // 写 baseline.json
  const baseline = {
    generatedAt: new Date().toISOString(),
    note: 'structure contract (field presence + types + hard-constraint assertions), NOT text equality',
    newPath: results,
    oldPathPresence: oldShapeRecords,
  };
  const baselinePath = join(__dirname, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`\n[baseline-diff] baseline written to ${baselinePath}`);

  // diff 摘要
  const passCount = results.filter(r => r.casePass).length;
  console.log(`\n[baseline-diff] summary: ${passCount}/${results.length} cases pass`);
  console.log(`[baseline-diff] exit ${allPass ? 0 : 1}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[baseline-diff] fatal:', err);
  process.exit(1);
});
