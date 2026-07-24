import {app, ipcMain, dialog, BrowserWindow} from 'electron';
import {getDb} from '../db/connection.ts';
import {runMigrations} from '../db/migrations.ts';
import {
  AgentTaskCreateSchema,
  AgentTaskIdSchema,
  AgentTaskListSchema,
  AgentTaskResumeSchema,
  AgentTaskInterruptRespondSchema,
  AgentTaskRunSchema,
  AppPathSchema,
  ArticleGenerateRankingSchema,
  ArticleGenerateSchema,
  ArticleIdSchema,
  ArticleStatusSchema,
  ArticleUpdateContentSchema,
  AssistantHistorySchema,
  AssistantQueueListSchema,
  AssistantQueueUpdateSchema,
  AssistantStreamCancelSchema,
  AssistantStreamStartSchema,
  DbExecSchema,
  DbQuerySchema,
  DraftGetSchema,
  DraftListSchema,
  DraftReviewSchema,
  DraftUpdateSchema,
  FactConfirmSchema,
  QuestionGenerateSchema,
  QuestionListSchema,
  QuestionRejectSchema,
  QuestionSelectSchema,
  SourceDiscoverSchema,
  SourceAdoptSchema,
  SourceSkipSchema,
  SourceListDecisionsSchema,
  SourceClearDecisionsSchema,
  SourceRemoveDecisionSchema,
  TitleGenerateSchema,
  FactExtractSchema,
  FactListPendingSchema,
  FactListSchema,
  FactMissingFieldsSchema,
  FactModifyAndConfirmSchema,
  FactParseReviewIntentSchema,
  FactRejectSchema,
  KbFactsUpdateSchema,
  KbIndexEntrySchema,
  KbIngestFileSchema,
  KbIngestTextSchema,
  KbSearchSchema,
  OpenFileSchema,
  ProjectCreateSchema,
  ProjectIdSchema,
  ProjectUpdateSchema,
  PublishApproveSchema,
  PublishPlanSchema,
  PublishStatusSchema,
  RagAskSchema,
  ReflectionIdSchema,
  ReflectionListSchema,
  SettingsUpdateSchema,
  ToolApprovalRespondSchema,
  VectorSearchSchema,
  VisibilityCheckSchema,
} from './schemas.ts';
import {indexEntry} from '../services/indexingService.ts';
import {embedText} from '../services/embedding.ts';
import {searchSimilarChunks} from '../services/vectorStore.ts';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  countProjectArtifacts,
} from '../services/projectService.ts';
import {askQuestion} from '../services/ragService.ts';
import {
  discoverSources,
  upsertSourceDecision,
  listSourceDecisions,
  clearSourceDecisions,
  removeSourceDecision,
} from '../services/article/sourceDiscoveryService.ts';
import {runMdDrivenSkill} from '../services/agent/mdDrivenRunner.ts';
import {runDeepAgentTask} from '../services/agent/geoAgentDeepAgentRuntime.ts';
import {hasPendingInterrupt} from '../services/agent/checkpointer.ts';
import {extractFacts} from '../services/facts/factExtractionService.ts';
import {runFactOntologySkill} from '../services/facts/factOntologySkill.ts';
import {confirmFacts, rejectFacts, modifyAndConfirm} from '../services/facts/factReviewService.ts';
import {parseReviewIntent} from '../services/facts/factReviewIntentParser.ts';
import {
  getMissingFieldsAndWarnings,
  getPendingReviewSession,
} from '../services/facts/pendingFactReviewService.ts';
import {listFacts} from '../services/facts/factRepository.ts';
import {generateArticle, generateRankingArticleEntry} from '../services/article/articleGenerationService.ts';
import {reviewClaims} from '../services/article/claimReviewService.ts';
import {reviewGeo} from '../services/article/geoReviewService.ts';
import {generateQuestions, selectQuestion, rejectQuestion, listQuestions} from '../services/article/questionPoolService.ts';
import {
  listArticlesByProject,
  getArtifactById,
  getArticleMetaByArtifactId,
  getClaimsWithSources,
  getReviewsByArtifactId,
  updateArticleStatus,
  updateArticleContent,
} from '../services/article/articleRepository.ts';
import {startRun, cancelRun, resolveToolApproval} from '../services/assistant/assistantRuntime.ts';
import {getUserSettings, updateUserSettings} from '../services/settingsService.ts';
import type {IpcChannels} from './channels.ts';
import type {
  AgentArtifact,
  AgentTask,
  PublishRecord,
  SourceRecommendation,
  TitleCandidate,
} from '@/types/domain';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win;
}

function createHandler<T extends keyof IpcChannels>(
  channel: T,
  handler: (
    ...args: Parameters<IpcChannels[T]>
  ) =>
    | Promise<ReturnType<IpcChannels[T]>>
    | ReturnType<IpcChannels[T]>,
) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await handler(...(args as Parameters<IpcChannels[T]>));
    } catch (error) {
      console.error(`IPC error on ${channel}:`, error);
      throw error;
    }
  });
}

export function registerIpcHandlers() {
  const db = getDb();

  createHandler('ping', () => 'pong');

  createHandler('db:query', (sql, params) => {
    const validated = DbQuerySchema.parse({sql, params});
    return db.prepare(validated.sql).all(...(validated.params ?? []));
  });

  createHandler('db:exec', (sql, params) => {
    const validated = DbExecSchema.parse({sql, params});
    return db.prepare(validated.sql).run(...(validated.params ?? []));
  });

  createHandler('db:migrate', () => {
    return runMigrations(db);
  });

  createHandler('db:vectorSearch', (params) => {
    const validated = VectorSearchSchema.parse(params);
    const stmt = db.prepare(
      `SELECT rowid, distance FROM ${validated.table} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
    );
    return stmt.all(
      JSON.stringify(validated.queryVector),
      validated.limit,
    ) as Array<{rowid: number; distance: number}>;
  });

  createHandler('dialog:openFile', (options) => {
    const validated = OpenFileSchema.parse(options ?? {});
    const result = dialog.showOpenDialogSync({
      properties: validated.multiple
        ? ['openFile', 'multiSelections']
        : ['openFile'],
      filters: validated.filters as Electron.FileFilter[] | undefined,
    });
    return result ?? [];
  });

  createHandler('app:getPath', (name) => {
    const validated = AppPathSchema.parse(name);
    return app.getPath(validated);
  });

  // 项目
  createHandler('project:create', (data) => {
    const validated = ProjectCreateSchema.parse(data);
    return createProject({ ...validated, status: 'active' } as { name: string; description?: string; industry?: string; region?: string; status?: string });
  });

  createHandler('project:list', () => listProjects());

  createHandler('project:get', (id) => {
    const validated = ProjectIdSchema.parse(id);
    return getProject(validated);
  });

  createHandler('project:update', (id, data) => {
    const validatedId = ProjectIdSchema.parse(id);
    ProjectUpdateSchema.parse({ id: validatedId, data });
    updateProject(validatedId, data);
  });

  createHandler('project:delete', (id) => {
    const validated = ProjectIdSchema.parse(id);
    deleteProject(validated);
  });

  createHandler('project:artifactCount', (projectId) => {
    const validated = ProjectIdSchema.parse(projectId);
    return countProjectArtifacts(validated);
  });

  // 知识库
  createHandler('kb:ingestText', async (params) => {
    const validated = KbIngestTextSchema.parse(params);
    const result = db
      .prepare(
        "INSERT INTO knowledge_entries (project_id, title, content, source_type, source_file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      )
      .run(validated.projectId, validated.title, validated.content, 'text', null, 'pending');
    const entryId = Number(result.lastInsertRowid);
    return indexEntry(entryId);
  });

  createHandler('kb:ingestFile', async (params) => {
    const validated = KbIngestFileSchema.parse(params);
    const result = db
      .prepare(
        "INSERT INTO knowledge_entries (project_id, title, content, source_type, source_file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      )
      .run(validated.projectId, validated.title, null, 'file', validated.filePath, 'pending');
    const entryId = Number(result.lastInsertRowid);
    return indexEntry(entryId);
  });

  createHandler('kb:indexEntry', async (params) => {
    const validated = KbIndexEntrySchema.parse(params);
    return indexEntry(validated.entryId);
  });

  createHandler('kb:search', async (params) => {
    const validated = KbSearchSchema.parse(params);
    const queryVector = await embedText(validated.query);
    return searchSimilarChunks(
      validated.projectId,
      queryVector,
      validated.limit ?? 5,
    );
  });

  createHandler('kb:facts', (projectId) => {
    const validated = ProjectIdSchema.parse(projectId);
    return db
      .prepare('SELECT * FROM enterprise_facts WHERE project_id = ? ORDER BY created_at DESC')
      .all(validated);
  });

  createHandler('kb:factsUpdate', (id, status) => {
    const validated = KbFactsUpdateSchema.parse({id, status});
    db.prepare('UPDATE enterprise_facts SET status = ? WHERE id = ?').run(
      validated.status,
      validated.id,
    );
  });

  // 事实抽取与审核
  createHandler('fact:extract', async (params) => {
    const validated = FactExtractSchema.parse(params);
    if (validated.mode === 'ontology') {
      if (!validated.formInputs) {
        throw new Error("mode 'ontology' 需要提供 formInputs，但未收到该字段");
      }
      return runFactOntologySkill({
        projectId: validated.projectId,
        formInputs: validated.formInputs,
        entryId: validated.entryId,
        chunkIds: validated.chunkIds,
      });
    }
    // mode === 'free' or undefined — existing behaviour
    return extractFacts({
      projectId: validated.projectId,
      entryId: validated.entryId,
      chunkIds: validated.chunkIds,
    });
  });

  createHandler('fact:list', (params) => {
    const validated = FactListSchema.parse(params);
    return listFacts({
      projectId: validated.projectId,
      status: validated.status,
      factType: validated.factType,
      limit: validated.limit,
      offset: validated.offset,
    });
  });

  createHandler('fact:listPending', (params) => {
    const validated = FactListPendingSchema.parse(params);
    return getPendingReviewSession(validated.projectId).facts;
  });

  createHandler('fact:confirm', (params) => {
    const validated = FactConfirmSchema.parse(params);
    return confirmFacts(validated.factIds, {reviewerNote: validated.reviewerNote});
  });

  createHandler('fact:reject', (params) => {
    const validated = FactRejectSchema.parse(params);
    return rejectFacts(validated.factIds, {reviewerNote: validated.reviewerNote});
  });

  createHandler('fact:modifyAndConfirm', (params) => {
    const validated = FactModifyAndConfirmSchema.parse(params);
    return modifyAndConfirm(validated.factId, validated.newFactValue, {
      newFactType: validated.newFactType,
      reviewMessageId: validated.reviewMessageId,
    }).fact;
  });

  createHandler('fact:missingFields', (projectId) => {
    const validated = FactMissingFieldsSchema.parse(projectId);
    return getMissingFieldsAndWarnings(validated);
  });

  createHandler('fact:parseReviewIntent', (params) => {
    const validated = FactParseReviewIntentSchema.parse(params);
    return parseReviewIntent({
      text: validated.text,
      facts: validated.facts as Array<{
        factId: number;
        displayIndex: number;
        factType: string;
        factValue: string;
      }>,
    });
  });

  createHandler('rag:ask', async (params) => {
    const validated = RagAskSchema.parse(params);
    return askQuestion(validated.projectId, validated.query, validated.limit ?? 5);
  });

  // Assistant Runtime — true streaming via AssistantRuntime
  createHandler('assistant:streamStart', async (params) => {
    const validated = AssistantStreamStartSchema.parse(params);
    return startRun(
      {
        sessionId: validated.sessionId,
        projectId: validated.projectId,
        requestId: validated.requestId,
        runType: validated.runType,
      },
      mainWindow,
    );
  });

  createHandler('assistant:streamCancel', (requestId) => {
    const validated = AssistantStreamCancelSchema.parse(requestId);
    cancelRun(validated);
  });

  createHandler('assistant:history', (sessionId, limit) => {
    const validated = AssistantHistorySchema.parse({sessionId, limit});
    return db
      .prepare(
        'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(validated.sessionId, validated.limit ?? 50);
  });

  createHandler('assistant:queueList', (runId) => {
    const validated = AssistantQueueListSchema.parse(runId);
    return db
      .prepare('SELECT * FROM assistant_queue_items WHERE run_id = ? ORDER BY order_index ASC')
      .all(validated);
  });

  createHandler('assistant:queueUpdate', (itemId, status, metadata) => {
    const validated = AssistantQueueUpdateSchema.parse({itemId, status, metadata});
    db.prepare(
      'UPDATE assistant_queue_items SET status = ?, metadata_json = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(
      validated.status,
      metadata ? JSON.stringify(metadata) : null,
      validated.itemId,
    );
  });

  // 工具审批
  createHandler('toolApproval:respond', (approvalId, approved, note) => {
    const validated = ToolApprovalRespondSchema.parse({approvalId, approved, note});
    db.prepare(
      "UPDATE tool_approvals SET status = ?, reviewer_note = ?, reviewed_at = datetime('now') WHERE id = ?",
    ).run(
      validated.approved ? 'approved' : 'rejected',
      validated.note ?? null,
      validated.approvalId,
    );
    // Resume the suspended generator in AssistantRuntime (Ticket 3)
    resolveToolApproval(validated.approvalId, validated.approved);
  });

  createHandler('toolApproval:listPending', () => {
    return db
      .prepare("SELECT * FROM tool_approvals WHERE status = 'requested' ORDER BY requested_at DESC")
      .all();
  });

  // Agent Task Runtime（骨架）
  createHandler('agentTask:create', (params) => {
    const validated = AgentTaskCreateSchema.parse(params);
    const result = db
      .prepare(
        `INSERT INTO agent_tasks (
           session_id, project_id, title, user_goal, status,
           risk_level, failure_count, loop_count, max_loop_count,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'created', 'low', 0, 0, 12, datetime('now'), datetime('now'))`,
      )
      .run(
        validated.sessionId ?? null,
        validated.projectId ?? null,
        validated.title ?? null,
        validated.userGoal,
      );
    return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(Number(result.lastInsertRowid));
  });

  createHandler('agentTask:run', (params) => {
    const validated = AgentTaskRunSchema.parse(params);
    // #88: fire-and-forget — 先同步创建 task 记录并返回（renderer 立即拿到 taskId
    // 订阅 agentTask:event），再在后台异步执行流式 CEO agent。
    // 这样 reply_delta / plan_created 等事件能在 task 执行期间实时推到 renderer。
    const created = db
      .prepare(
        `INSERT INTO agent_tasks (
           session_id, project_id, title, user_goal, status,
           current_objective, last_action, risk_level,
           failure_count, loop_count, max_loop_count,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'running', ?, ?, 'low', 0, 0, 12, datetime('now'), datetime('now'))`,
      )
      .run(
        validated.sessionId ?? null,
        validated.projectId ?? null,
        validated.title ?? validated.userGoal.slice(0, 80),
        validated.userGoal,
        'CEO 分析用户意图',
        null,
      );
    const taskId = Number(created.lastInsertRowid);
    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId);

    // 后台异步执行（不 await）—— 事件通过 mainWindow.webContents.send 实时推送
    void runDeepAgentTask(validated.userGoal, {
      sessionId: validated.sessionId,
      projectId: validated.projectId,
      title: validated.title,
      files: validated.files as
        | Array<{name: string; type: string; bytes: number; content?: string}>
        | undefined,
      mainWindow,
      taskId,
    }).catch((err) => {
      console.error(`[agentTask:run] background execution failed for task ${taskId}:`, err);
    });

    return taskRow;
  });

  createHandler('agentTask:get', (id) => {
    const validated = AgentTaskIdSchema.parse(id);
    return (
      (db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(validated) as
        | AgentTask
        | undefined) ?? null
    );
  });

  createHandler('agentTask:list', (filters) => {
    const validated = AgentTaskListSchema.parse(filters ?? {});
    let sql = 'SELECT * FROM agent_tasks WHERE 1=1';
    const params: unknown[] = [];
    if (validated.projectId !== undefined) {
      sql += ' AND project_id = ?';
      params.push(validated.projectId);
    }
    if (validated.status !== undefined) {
      sql += ' AND status = ?';
      params.push(validated.status);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(validated.limit ?? 50);
    return db.prepare(sql).all(...params);
  });

  // #77: resume 实现 — 传递 resumeValue 给 runDeepAgentTask
  // #88: fire-and-forget（与 agentTask:run 一致），事件实时推送
  createHandler('agentTask:resume', (params) => {
    const validated = AgentTaskResumeSchema.parse(params);
    const task = db
      .prepare('SELECT * FROM agent_tasks WHERE id = ?')
      .get(validated.taskId) as AgentTask | undefined;
    if (!task) throw new Error(`Task ${validated.taskId} not found`);

    db.prepare(
      `UPDATE agent_tasks SET status = 'running', updated_at = datetime('now') WHERE id = ?`,
    ).run(validated.taskId);

    void runDeepAgentTask(task.user_goal, {
      sessionId: task.session_id ?? undefined,
      projectId: task.project_id ?? undefined,
      title: task.title ?? undefined,
      resumeValue: validated.resumeValue,
      mainWindow,
      taskId: validated.taskId,
    }).catch((err) => {
      console.error(`[agentTask:resume] background execution failed for task ${validated.taskId}:`, err);
    });

    return task;
  });

  // #79: HITL interrupt response — 用户审批中断工具后恢复执行
  // #88: fire-and-forget（与 agentTask:run 一致），事件实时推送
  createHandler('agentTask:respondInterrupt', (params) => {
    const validated = AgentTaskInterruptRespondSchema.parse(params);
    const task = db
      .prepare('SELECT * FROM agent_tasks WHERE id = ?')
      .get(validated.taskId) as AgentTask | undefined;
    if (!task) throw new Error(`Task ${validated.taskId} not found`);

    // 更新 tool_approvals 审计表
    for (const decision of validated.decisions) {
      try {
        const newStatus = decision.decision === 'approve' ? 'approved' : 'rejected';
        db.prepare(
          `UPDATE tool_approvals SET
             status = ?,
             reviewer_note = ?,
             reviewed_at = datetime('now')
           WHERE tool_call_id = ? AND approval_type = ? AND status = 'requested'`,
        ).run(newStatus, decision.reason ?? null, validated.taskId, decision.toolName);
      } catch (auditErr) {
        console.warn('[handlers] failed to update tool_approvals:', auditErr);
      }
    }

    db.prepare(
      `UPDATE agent_tasks SET status = 'running', updated_at = datetime('now') WHERE id = ?`,
    ).run(validated.taskId);

    // 将 decisions 封装为 resumeValue 传给 LangGraph Command({resume: ...})
    void runDeepAgentTask(task.user_goal, {
      sessionId: task.session_id ?? undefined,
      projectId: task.project_id ?? undefined,
      title: task.title ?? undefined,
      resumeValue: {decisions: validated.decisions},
      mainWindow,
      taskId: validated.taskId,
    }).catch((err) => {
      console.error(`[agentTask:respondInterrupt] background execution failed for task ${validated.taskId}:`, err);
    });

    return task;
  });

  createHandler('agentTask:pause', (id) => {
    const validated = AgentTaskIdSchema.parse(id);
    db.prepare("UPDATE agent_tasks SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(validated);
  });

  createHandler('agentTask:cancel', (id) => {
    const validated = AgentTaskIdSchema.parse(id);
    db.prepare("UPDATE agent_tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(validated);
  });

  createHandler('agentTask:retry', (id) => {
    const validated = AgentTaskIdSchema.parse(id);
    db.prepare(
      "UPDATE agent_tasks SET status = 'retrying', failure_count = failure_count + 1, updated_at = datetime('now') WHERE id = ?",
    ).run(validated);
  });

  createHandler('agentTask:timeline', (id) => {
    const validated = AgentTaskIdSchema.parse(id);
    return db
      .prepare('SELECT * FROM agent_task_steps WHERE task_id = ? ORDER BY created_at ASC')
      .all(validated);
  });

  createHandler('agentTask:artifacts', (id) => {
    const validated = AgentTaskIdSchema.parse(id);
    return db
      .prepare('SELECT * FROM agent_artifacts WHERE task_id = ? ORDER BY created_at DESC')
      .all(validated);
  });

  // 草稿 / 产物
  createHandler('draft:list', (projectId) => {
    const validated = DraftListSchema.parse(projectId);
    return db
      .prepare('SELECT * FROM agent_artifacts WHERE project_id = ? ORDER BY created_at DESC')
      .all(validated);
  });

  createHandler('draft:get', (id) => {
    const validated = DraftGetSchema.parse(id);
    return (
      (db.prepare('SELECT * FROM agent_artifacts WHERE id = ?').get(validated) as
        | AgentArtifact
        | undefined) ?? null
    );
  });

  createHandler('draft:update', (id, content, status) => {
    const validated = DraftUpdateSchema.parse({id, content, status});
    db.prepare(
      "UPDATE agent_artifacts SET content = ?, status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?",
    ).run(validated.content, validated.status ?? null, validated.id);
  });

  createHandler('draft:review', (id, approved, note) => {
    const validated = DraftReviewSchema.parse({id, approved, note});
    const status = validated.approved ? 'approved' : 'rejected';
    db.prepare(
      "UPDATE agent_artifacts SET status = ?, metadata_json = json_patch(COALESCE(metadata_json, '{}'), json_object('reviewNote', ?)), updated_at = datetime('now') WHERE id = ?",
    ).run(status, validated.note ?? null, validated.id);
  });

  // 发布
  createHandler('publish:plan', (params) => {
    const validated = PublishPlanSchema.parse(params);
    const insert = db.prepare(
      `INSERT INTO publish_records (
         artifact_id, project_id, platform, channel_name, channel_type,
         status, created_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    );
    const records: PublishRecord[] = [];
    for (const channel of validated.channels) {
      const result = insert.run(
        validated.artifactId,
        validated.projectId,
        channel.platform,
        channel.name,
        channel.channelType ?? null,
      );
      records.push(
        db
          .prepare('SELECT * FROM publish_records WHERE id = ?')
          .get(Number(result.lastInsertRowid)) as PublishRecord,
      );
    }
    return records;
  });

  createHandler('publish:approve', (params) => {
    const validated = PublishApproveSchema.parse(params);
    const update = db.prepare('UPDATE publish_records SET status = ? WHERE id = ?');
    const status = validated.approved ? 'pending' : 'rejected';
    for (const id of validated.publishRecordIds) {
      update.run(status, id);
    }
  });

  createHandler('publish:status', (publishRecordId) => {
    const validated = PublishStatusSchema.parse(publishRecordId);
    return (
      (db.prepare('SELECT * FROM publish_records WHERE id = ?').get(validated) as
        | PublishRecord
        | undefined) ?? null
    );
  });

  // 可见性
  createHandler('visibility:check', (params) => {
    const validated = VisibilityCheckSchema.parse(params);
    const publishRecord = db
      .prepare('SELECT * FROM publish_records WHERE id = ?')
      .get(validated.publishRecordId) as
      | {project_id: number; published_url: string | null; channel_name: string}
      | undefined;
    const projectId = publishRecord?.project_id ?? 0;
    const query = validated.query ?? publishRecord?.channel_name ?? '';
    const result = db
      .prepare(
        `INSERT INTO visibility_checks (
           publish_record_id, project_id, query, published_url,
           checked_at
         ) VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        validated.publishRecordId,
        projectId,
        query,
        publishRecord?.published_url ?? null,
      );
    return db
      .prepare('SELECT * FROM visibility_checks WHERE id = ?')
      .get(Number(result.lastInsertRowid));
  });

  // 反思假设
  createHandler('reflection:list', (filters) => {
    const validated = ReflectionListSchema.parse(filters ?? {});
    let sql = 'SELECT * FROM reflection_hypotheses WHERE 1=1';
    const params: unknown[] = [];
    if (validated.status !== undefined) {
      sql += ' AND status = ?';
      params.push(validated.status);
    }
    if (validated.scope !== undefined) {
      sql += ' AND scope = ?';
      params.push(validated.scope);
    }
    sql += ' ORDER BY created_at DESC';
    return db.prepare(sql).all(...params);
  });

  createHandler('reflection:approve', (id) => {
    const validated = ReflectionIdSchema.parse(id);
    db.prepare(
      "UPDATE reflection_hypotheses SET status = 'active', updated_at = datetime('now') WHERE id = ?",
    ).run(validated);
  });

  createHandler('reflection:reject', (id) => {
    const validated = ReflectionIdSchema.parse(id);
    db.prepare(
      "UPDATE reflection_hypotheses SET status = 'rejected', updated_at = datetime('now') WHERE id = ?",
    ).run(validated);
  });

  createHandler('reflection:archive', (id) => {
    const validated = ReflectionIdSchema.parse(id);
    db.prepare(
      "UPDATE reflection_hypotheses SET status = 'archived', updated_at = datetime('now') WHERE id = ?",
    ).run(validated);
  });

  // 文章生成
  createHandler('article:generate', async (params) => {
    const validated = ArticleGenerateSchema.parse(params);
    return generateArticle({
      projectId: validated.projectId,
      strategy: validated.strategy,
      supportArticleType: validated.supportArticleType as
        | 'enterprise_profile'
        | undefined,
      targetQuestion: validated.targetQuestion,
      title: validated.title,
      adoptedSources: validated.adoptedSources as SourceRecommendation[] | undefined,
    });
  });

  createHandler('article:list', (projectId) => {
    const validated = ArticleIdSchema.parse(projectId);
    return listArticlesByProject(validated);
  });

  createHandler('article:get', (artifactId) => {
    const validated = ArticleIdSchema.parse(artifactId);
    const artifact = getArtifactById(validated);
    const meta = getArticleMetaByArtifactId(validated);
    if (!artifact || !meta) {
      throw new Error(`Article ${validated} not found`);
    }
    return {
      artifact,
      meta,
      claims: getClaimsWithSources(validated),
      reviews: getReviewsByArtifactId(validated),
    };
  });

  createHandler('article:claimReview', async (artifactId) => {
    const validated = ArticleIdSchema.parse(artifactId);
    return reviewClaims(validated);
  });

  createHandler('article:geoReview', async (artifactId) => {
    const validated = ArticleIdSchema.parse(artifactId);
    return reviewGeo(validated);
  });

  createHandler('article:updateStatus', (artifactId, status) => {
    const validatedId = ArticleIdSchema.parse(artifactId);
    const validatedStatus = ArticleStatusSchema.parse(status);
    updateArticleStatus(validatedId, validatedStatus);
  });

  createHandler('article:updateContent', (artifactId, content) => {
    const validated = ArticleUpdateContentSchema.parse({artifactId, content});
    updateArticleContent(validated.artifactId, validated.content);
  });

  // Phase 7：问题池、信源发现、标题生成、排行榜文章
  createHandler('question:generate', async (projectId) => {
    const validated = QuestionGenerateSchema.parse(projectId);
    return generateQuestions(validated);
  });

  createHandler('question:list', (projectId) => {
    const validated = QuestionListSchema.parse(projectId);
    return listQuestions(validated);
  });

  createHandler('question:select', (id) => {
    const validated = QuestionSelectSchema.parse(id);
    selectQuestion(validated);
  });

  createHandler('question:reject', (id) => {
    const validated = QuestionRejectSchema.parse(id);
    rejectQuestion(validated);
  });

  createHandler('source:discover', async (projectId, targetQuestion) => {
    const validated = SourceDiscoverSchema.parse({projectId, targetQuestion});
    return discoverSources(validated.projectId, validated.targetQuestion);
  });

  createHandler('source:adopt', (projectId, targetQuestion, source) => {
    const validated = SourceAdoptSchema.parse({projectId, targetQuestion, source});
    upsertSourceDecision(validated.projectId, validated.targetQuestion, validated.source as SourceRecommendation, 'adopted');
  });

  createHandler('source:skip', (projectId, targetQuestion, source) => {
    const validated = SourceSkipSchema.parse({projectId, targetQuestion, source});
    upsertSourceDecision(validated.projectId, validated.targetQuestion, validated.source as SourceRecommendation, 'skipped');
  });

  createHandler('source:listDecisions', (projectId, targetQuestion) => {
    const validated = SourceListDecisionsSchema.parse({projectId, targetQuestion});
    return listSourceDecisions(validated.projectId, validated.targetQuestion);
  });

  createHandler('source:clearDecisions', (projectId, targetQuestion) => {
    const validated = SourceClearDecisionsSchema.parse({projectId, targetQuestion});
    clearSourceDecisions(validated.projectId, validated.targetQuestion);
  });

  createHandler('source:removeDecision', (projectId, targetQuestion, url) => {
    const validated = SourceRemoveDecisionSchema.parse({projectId, targetQuestion, url});
    removeSourceDecision(validated.projectId, validated.targetQuestion, validated.url);
  });

  createHandler('title:generate', async (projectId, targetQuestion) => {
    const validated = TitleGenerateSchema.parse({projectId, targetQuestion});
    const project = getProject(validated.projectId);
    if (!project) throw new Error(`Project ${validated.projectId} not found`);
    // #64: title IPC 迁移到 md-driven 框架。title-generation 无工具，
    // runMdDrivenSkill 单次生成即正确。返回 {ok:true, data:{titles:[...]}}，
    // 这里映射 data.titles → TitleCandidate[]（两者结构一致），保持 IPC 返回契约不变。
    const result = await runMdDrivenSkill('title-generation', {
      projectId: validated.projectId,
      taskArgs: {
        projectName: project.name,
        targetQuestion: validated.targetQuestion,
      },
      userMessage: validated.targetQuestion,
    });
    if (result.ok !== true) {
      throw new Error(`标题生成失败：${result.errors.join('; ')}`);
    }
    const data = result.data as {titles: Array<{titleText: string; score: number; intent: string; notes?: string}>};
    return data.titles as TitleCandidate[];
  });

  createHandler('article:generateRanking', async (params) => {
    const validated = ArticleGenerateRankingSchema.parse(params);
    return generateRankingArticleEntry({
      projectId: validated.projectId,
      competitors: validated.competitors,
      targetQuestion: validated.targetQuestion,
    });
  });

  // 窗口
  createHandler('window:minimize', () => {
    mainWindow?.minimize();
  });

  createHandler('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  createHandler('window:unmaximize', () => {
    mainWindow?.unmaximize();
  });

  createHandler('window:close', () => {
    mainWindow?.close();
  });

  createHandler('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  createHandler('window:platform', () => {
    return process.platform;
  });

  // 用户设置（#37 登录信息进设置）
  createHandler('settings:get', () => {
    return getUserSettings();
  });

  createHandler('settings:set', (patch) => {
    const validated = SettingsUpdateSchema.parse(patch);
    return updateUserSettings(validated);
  });
}

/**
 * #77 启动时扫描未完成任务中的 pending interrupt。
 *
 * 遍历 status IN ('running', 'waiting_user_input', 'waiting_approval') 的
 * agent_tasks，通过 thread_id 检查 checkpoints 表中是否存在 __interrupt__ 通道，
 * 若有则通过 IPC 事件推送给 Renderer 以提示用户恢复。
 */
export function scanPendingInterrupts(db: ReturnType<typeof getDb>, win: BrowserWindow | null) {
  if (!win) return;

  try {
    const tasks = db
      .prepare(
        `SELECT id, user_goal, status, interrupt_data_json
         FROM agent_tasks
         WHERE status IN ('running', 'waiting_user_input', 'waiting_approval')
         ORDER BY created_at DESC`,
      )
      .all() as Array<{
      id: number;
      user_goal: string;
      status: string;
      interrupt_data_json: string | null;
    }>;

    for (const task of tasks) {
      const threadId = `task-${task.user_goal.slice(0, 20).replace(/\s+/g, '_')}`;
      if (hasPendingInterrupt(threadId)) {
        console.log(
          `[handlers] scanPendingInterrupts: task ${task.id} has pending interrupt (thread: ${threadId})`,
        );
        win.webContents.send('agentTask:interrupt-pending', {
          taskId: task.id,
          status: task.status,
          interruptData: task.interrupt_data_json
            ? JSON.parse(task.interrupt_data_json)
            : null,
        });
      }
    }
  } catch (err) {
    console.error('[handlers] scanPendingInterrupts error:', err);
  }
}
