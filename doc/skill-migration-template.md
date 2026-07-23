# Skill 迁移模板（md-driven runtime）

本模板把切片 2（`title-generation` #57、`ranking-article-generation` #58/#60）的实际迁移经验固化为可复用资产，供剩余 15 个 md-driven skill 铺开时照搬。每一条检查项与「常见坑」都来自切片代码，非泛泛而谈。

> 适用范围：`SKILL_ROUTES` 中 `kind: 'md-driven'` 的 17 个 skill。其中 2 个已迁（`migrated: true`），15 个待迁（`migrated: false`）。B 类 `kind: 'service'`（`fact.extract` / `source.discover` / `claim.parsing` / `claim.review` / `geo.review`）与 C 类 `kind: 'pause'`（`publish.plan`）**不适用本模板**——它们没有 SKILL.md 正文执行路径，不迁 md-driven。

## 6 步骤

### 步骤 1：SKILL.md 重写

把旧 `SKILL.md`（legacy 字段 `domains` / `capabilities` / `preconditions` / `requires_confirmation`）重写为 md-driven runtime 期望的形态：frontmatter 用新字段（`needsKb` / `outputSchema` / `tools` / `examples` / `risk_level`），正文写工作流 / 硬约束 / 输入 / 输出格式 / 工具 / 样例。

参考切片：
- `skills/title-generation/SKILL.md` — 无 KB、无硬约束修正型、无工具的最简形态。
- `skills/ranking-article-generation/SKILL.md` — `needsKb: true` + 硬约束分型（修正型 / 拒绝型）+ `tools: llm` 的完整形态。

检查项：
- [ ] `frontmatter.name` 严格等于目录名（`skillRegistry.validateFrontmatter` 启动时会 `frontmatter.name !== dirName` 抛错，见 `electron/services/agent/skillRegistry.ts:259`）。
- [ ] `description` 以动词开头、50–150 字符、不含换行（`validateFrontmatter` 校验 `length < 10` 抛错）。
- [ ] `risk_level` ∈ `low | medium | high`。
- [ ] `needsKb` 按该 skill 是否需要 Evidence Pack 设置：写文章 / 排行榜类为 `true`；纯生成（标题）类为 `false`。
- [ ] `outputSchema` 字段名与 `index.ts` 的 Zod schema 字段名一字不差（`titleText` / `position` / `sourceFactIds` 等大小写与下划线都要对齐）。
- [ ] `## 硬约束` 段落中每条约束标注分型：**修正型**（validate 静默修正，如 ranking 的 `position` clamp 到 [2,5]）或 **拒绝型**（validate 直接 `ok:false`，如 `entries < 2` 由 Zod `min(2)` 覆盖）。
- [ ] `## 工具` 段落：无工具写「无」；有工具列明工具名与调用时机，专属工具的 JSON Schema 放到同目录 `tools.md`。
- [ ] 旧 legacy 字段（`domains` / `capabilities` / `preconditions` / `requires_confirmation`）如不再用可删除——`#55` 已把它们改为 optional，`validateFrontmatter` 不再强制。

### 步骤 2：index.ts 校验层

在 `skills/<skill>/index.ts` 新增 `export async function validate(rawOutput, ctx)`：接收 LLM 原始输出（字符串或已解析对象），经 JSON parse → Zod safeParse → 硬约束修正后返回 `{ok:true, data}` 或 `{ok:false, errors: string[]}`。这是 md-driven runtime 唯一调用的入口（`mdDrivenRunner.ts` 的 `SKILL_DIR_TO_VALIDATE` 查表）。

参考切片：
- `skills/title-generation/index.ts` 的 `validate` — 最简：JSON parse + Zod safeParse，无修正。
- `skills/ranking-article-generation/index.ts` 的 `validate` — 含 `position` clamp 修正型 + `entries.sort`。

检查项：
- [ ] `validate` 是**纯函数**（除传入参数外无副作用，不读盘不调 DB 不调 LLM）——这是 baseline-diff 脚本和 node:test 能脱离 Electron/SQLite 跑全链路的前提。
- [ ] 接受 `string | unknown`（或 `string | Record<string, unknown>`），字符串先剥 ```` ```json ```` fence 再 `JSON.parse`。
- [ ] 用 Zod `safeParse`（**不要**用 `parse`），失败时返回 `errors: issues.map(i => \`${i.path.join('.')}: ${i.message}\`)`——这套错误文本会被 `mdDrivenRunner` 回灌给模型重试，格式必须可读。
- [ ] 修正型约束在 Zod 通过后**就地修改** `data` 再返回；拒绝型约束用 Zod（`min(2)` 等）覆盖，不要自己写 if-reject。
- [ ] 返回类型导出为 `ValidationResult`（`{ok:true; data} | {ok:false; errors}`），与 `mdDrivenRunner` 的 `ValidateFn` 形状一致。
- [ ] `ValidationContext` 接口保留 `evidencePack?` 等可选字段，即使当前不用也写到签名上——跨 skill 统一签名，便于 `mdDrivenRunner` 透传。

### 步骤 3：工具抽取（仅 needsKb 或有副作用的 skill）

如果 skill 需要副作用编排（写文章占位、finalize、保存排行榜条目、抽 Claim），把编排动作抽成工具执行器，让基座模型在 SKILL.md 工作流指引下自主调用，而不是写死在 service 里。

参考切片：
- `skills/ranking-article-generation/tools.md` — 声明 ranking 专属工具 `save_ranking_entries` 的 JSON Schema。
- `electron/services/agent/toolExecutors.ts` — 全局工具（`create_article_placeholder` / `finalize_article` / `parse_claims`）+ ranking 专属工具的执行器，统一 `(args, ctx) => Promise<ToolResult>` 签名，`ctx` 注入 DB 依赖。
- `electron/services/agent/toolCallLoop.ts` — tool_call 循环：模型发起 tool_call → 执行器分派 → 结果作 tool 消息回灌 → 直到无 tool_call 返回最终输出交 validate。

检查项：
- [ ] **通用工具归 runtime 全局**：`create_article_placeholder` / `finalize_article` / `parse_claims` 这类多 skill 共用的工具声明在 `toolExecutors.ts` 的 `GLOBAL_TOOL_SCHEMAS` 与 `TOOL_EXECUTORS`，**不要**复制到各 skill 的 `tools.md`。
- [ ] **skill 专属工具**才放该 skill 的 `tools.md`（如 ranking 的 `save_ranking_entries`），执行器仍注册在 `toolExecutors.ts` 的 `TOOL_EXECUTORS`（执行器统一分派，schema 分开放）。
- [ ] 执行器签名统一 `(args, ctx) => Promise<ToolResult>`，`ctx` 用 `ToolExecContext` 接口注入 DB 操作（`createArticle` / `finalizeArticle` / `createRankingArticleItems` / `parseClaims`），便于测试注入 mock。
- [ ] 执行器内部做入参校验（`Number.isFinite` / 必填字段），失败返回 `{success:false, error}` 而非抛异常——`toolCallLoop` 依赖此约定。
- [ ] 工具 JSON Schema 的 `parameters.required` 与执行器入参校验一致。

### 步骤 4：路由表加条目 / 翻 migrated 标志

该 skill 在 `electron/services/agent/skillRoutes.ts` 的 `SKILL_ROUTES` 中已有 `md-driven` 行（17 行都在）。迁移只做一件事：把该行的 `migrated` 从 `false` 改为 `true`。`intentRouter.route()` 会把 `migrated` 透传给 runtime，runtime 据此决定走 `runMdDrivenSkill` 还是旧 executor。

> 注意：本步骤属于 #62 big-bang cutover 范畴。本模板步骤 4 仅在「逐 skill 切片」时翻标志；全员铺开由 #62 统一接线。迁移模板的工作完成后，`migrated` 标志的翻转交给 #62。

检查项：
- [ ] 路由行的 `intent` 等于 `skillDir`（md-driven 约定）。
- [ ] `keywords` 是**完整短语**（如 `生成排行榜文章`），不是单词 token——Tier 1 用 `lowercased.includes(phrase)` 子串匹配，单字 token 会误命中。
- [ ] `preconditions` 用 `allowedActionPolicy` 表达式词汇（`confirmed_facts_count > 0` / `selected_question_exists` 等），**不**在路由表里塞 `needsKb`——`needsKb` 是 frontmatter 字段，由 `mdDrivenRunner` 读 `skillRegistry.getSkill(skillDir).frontmatter.needsKb` 决定是否注入 Evidence Pack。
- [ ] `trigger` 是给 Tier 2 语义匹配的语义描述，要写清「做什么」，不要只写关键词。

### 步骤 5：prompt 迁移

把旧 service 里硬编码的 `SYSTEM_PROMPT` 文本迁到 `SKILL.md` 正文（工作流 / 硬约束 / 输出格式段）。`mdDrivenRunner` 会把 `loadPromptBody('soul')` + `SKILL.md` 正文拼成 system 段，user 段由 `formatTaskText(taskArgs)` + 可选 `formatEvidence(evidencePack)` 组成。

参考切片：
- `skills/ranking-article-generation/index.ts` 旧 `SYSTEM_PROMPT` 的「核心规则」已迁到 `SKILL.md` 的 `## 硬约束` + `## 工作流`，旧 `SYSTEM_PROMPT` 常量保留但标 `TODO(#62): remove once cutover complete`。
- `mdDrivenRunner.ts:154-155` — `system = loadSoul() + '\n\n' + loadSkillBody(skillDir)`。

检查项：
- [ ] 用 `loadPromptBody`（剥离 frontmatter）**不要**用 `loadPrompt`（含 frontmatter）注入 system 段——frontmatter 进 system 段是噪声。见 `electron/prompts/loader.ts:125`。
- [ ] soul 身份文本用 `loadPrompt('soul')`（soul.md 无 frontmatter，两者等价；但 SKILL.md 有 frontmatter，必须 `loadPromptBody` 或直接读 `skillRegistry.getSkill(dir).body`）。`mdDrivenRunner` 默认用 `getSkill(skillDir).body`，已天然剥 frontmatter。
- [ ] 旧 service 的 `SYSTEM_PROMPT` 常量在 cutover 前保留（标 `TODO(#62)`），因为旧生成路径仍在跑；cutover 后由 #62 删除。
- [ ] user 段的 Evidence Pack 格式化**统一用 `ragService.formatEvidence`**，不要在 skill 内重复实现（见常见坑 1）。

### 步骤 6：加测试

为 `validate` 纯函数加 node:test 单测，覆盖：合法输出通过 / JSON parse 失败拒绝 / Zod 失败拒绝 / 修正型约束被修正 / 拒绝型约束被拒绝。`mdDrivenRunner` 全链路用注入 mock chat 跑集成测试（mock chat 返回 canned JSON），不依赖 Electron/SQLite。

参考切片：
- `skills/ranking-article-generation/index.ts` 同目录的测试覆盖了 `position` 越界 clamp、`entries < 2` 拒绝、合法通过三条路径。
- `mdDrivenRunner.ts` 的 `MdDrivenRunOptions` 全依赖可注入（`chatFn` / `buildEvidencePack` / `validateFn` / `loadSkillBody` / `loadSoul`），测试用 mock 跑 3 次重试上限。

检查项：
- [ ] `validate` 单测覆盖：合法通过、JSON parse 失败、Zod 失败、每条修正型约束、每条拒绝型约束。
- [ ] 全链路集成测试用 `node --import tsx --test`（见 `package.json` 的 `test:unit`），mock `chatFn` 返回 canned JSON，验证 `runMdDrivenSkill` 的 `ok:true/data` 与重试 `ok:false/errors` 两条路径。
- [ ] 测试**不**调真实 LLM、**不**开 SQLite——纯函数 + mock 注入。
- [ ] `npm run lint`（`tsc --noEmit`）通过。

## 常见坑（来自切片经验）

### 坑 1：formatEvidence 各 skill 重复实现——统一用 ragService 版

`skills/ranking-article-generation/index.ts:141` 的 `formatEvidence` 是 `ragService.formatEvidence`（`electron/services/ragService.ts:230`）的重复实现，标了 `TODO(#62): remove once cutover complete (duplicate of ragService.formatEvidence)`。迁移新 skill 时**不要**再复制一份——`mdDrivenRunner` 已经 import 并调用 `ragService.formatEvidence`，skill 内不应有自己的版本。

### 坑 2：loadPrompt 返回含 frontmatter，需用 loadPromptBody

`loadPrompt`（`electron/prompts/loader.ts:81`）原样返回文件全文，SKILL.md 的 YAML frontmatter 会进 system 段成为噪声。md-driven runtime 用 `loadPromptBody`（`loader.ts:125`）剥离 frontmatter 只取正文；或直接用 `skillRegistry.getSkill(skillDir).body`（`skillRegistry.ts` 已在 `parseSkillMd` 里拆好 body）。`mdDrivenRunner` 默认走后者。**不要**用 `loadPrompt` 读 SKILL.md 注入 system。

### 坑 3：共用 executor 拆工具后，通用工具归 runtime 全局

`create_article_placeholder` / `finalize_article` / `parse_claims` 这类多 skill 共用的副作用动作，统一声明在 `toolExecutors.ts` 的 `GLOBAL_TOOL_SCHEMAS` + `TOOL_EXECUTORS`。**不要**在每个 skill 的 `tools.md` 里重复声明全局工具——`tools.md` 只放该 skill 专属工具（如 ranking 的 `save_ranking_entries`）。执行器一律注册在 `toolExecutors.ts`，`toolCallLoop` 按 `tool_call.name` 查 `TOOL_EXECUTORS` 分派。

### 坑 4：needsKb 不在路由表，归 SKILL.md frontmatter

`needsKb` 是 frontmatter 字段（`SKILL.md` 顶部 YAML），不是 `SKILL_ROUTES` 路由行字段。`mdDrivenRunner.ts:151` 读 `getSkill(skillDir).frontmatter.needsKb` 决定是否 `buildEvidencePack` + `formatEvidence` 注入 user 段。路由表的 `preconditions` 是**前置状态门控**（`confirmed_facts_count > 0` 等），与 `needsKb` 是两件事——别把 `needsKb` 塞进 `preconditions`。

### 坑 5：B 类 service 不迁 md-driven

`SKILL_ROUTES` 里 `kind: 'service'` 的 5 个意图（`fact.extract` / `source.discover` / `claim.parsing` / `claim.review` / `geo.review`）和 `kind: 'pause'` 的 `publish.plan`，**没有 SKILL.md 正文执行路径**，不适用本模板。它们走 service executor / pause 审批，不要给它们写 `validate` 函数或翻 `migrated` 标志。本模板只覆盖 17 个 `kind: 'md-driven'`。

### 坑 6：旧生成路径在 cutover 前必须保留并标 TODO(#62)

`skills/title-generation/index.ts:71` 与 `skills/ranking-article-generation/index.ts:129` 的注释明确：旧 `generateTitles` / `generateRankingArticle` / `SYSTEM_PROMPT` / `formatEvidence` 因为 `handlers.ts` / `articleGenerationService.ts` 仍 import，在 #62 big-bang cutover 前必须保留。新 `validate` 函数独立存在、可单测、不依赖这些旧代码。迁移新 skill 时同样：新 `validate` 与旧生成函数并存，旧函数标 `TODO(#62): remove once cutover complete`，等 #62 统一删除。

## 剩余 15 skill 铺开指引

17 个 md-driven skill 已迁 2 个（`title-generation`、`ranking-article-generation`），剩 15 个。按形态分三批，从最简形态开始铺：

**批次 A — 无 KB / 无工具 / 纯生成（照搬 title-generation 模板）**：
- `ranking-theme-selection`、`ranking-criteria-generation`、`ranking-reason-generation` — 输出是结构化数据（主题 / 标准列表 / 入选理由），`needsKb` 可能为 `true`（需 Evidence Pack）但无副作用工具，validate 层只做 Zod + 硬约束。

**批次 B — 有 KB / 有硬约束修正型（照搬 ranking-article-generation 模板）**：
- `ranking-article-planning`、`support-article-generation`、`support-article-planning` — 文章类，`needsKb: true`，可能有 `position` / `字数` / `章节数` 范围约束（修正型 clamp 或拒绝型 min）。

**批次 C — GEO 优化工具族（多无 KB，输出结构差异大）**：
- `geo-citation-writer`、`geo-content-optimizer`、`geo-fact-checker`、`geo-local-optimizer`、`geo-multilingual-optimizer`、`geo-schema-gen`、`geo-sentiment-optimizer`、`geo-structured-writer`、`claim-source-mapping` — 这批 skill 旧代码在 `skills/<skill>/scripts/*.ts`（见 `scripts/smoke-geo-skills.ts` 的 import），迁移时把脚本里的 `analyzeContent` / `optimizeContent` / `extractCandidateClaims` 等纯函数逻辑迁到 `index.ts` 的 `validate` + 工具执行器，`SKILL.md` 重写工作流。

每个 skill 迁移完跑 `npm run validate:skills`（frontmatter 校验）+ `npm run lint`（tsc）+ 该 skill 的 `validate` 单测。全员迁完由 #62 翻 `migrated` 标志、删旧代码、接线 runtime。

### baseline 对照

迁移前后用 `scripts/baseline-diff.mjs` 跑结构契约 baseline：用固定 fixture（canned LLM JSON）过 `validate` 层，记录字段齐全 / 类型对 / 硬约束满足 / entries 数量 / position 范围。big-bang 前留 baseline，big-bang 后跑对比。详见脚本头注释。
