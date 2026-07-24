/**
 * geoAgentDeepAgentRuntime.ts
 *
 * Wave 1 DeepAgents 底座接入（#75）+ CEO 直接兜底（#76）+ SubAgents（#78）+ HITL（#79）
 * + #81：IPC 事件流中间件接入，替代 SQLite 轮询。
 *
 * `agentTask:run` IPC 入口 → CEO DeepAgent（真实模型 + 只读工具 + 子 agent）→ 结果返回。
 *
 * CEO 负责：
 *   1. 调用 intent_router 识别用户意图
 *   2. skill 意图 → 通过 task 工具派发对应子 agent
 *   3. 简单 QA / 查询 → 直接用只读工具回答
 *   4. 子 agent 内部 interrupt → HITL 桥 → 等待用户在 UI 审批 → resume
 *
 * 子 agent：
 *   - KnowledgeAgent（#78）：fact.extract
 *   - FactAgent（#80）：question.generate + source.discover
 *   - 后续：Content / Review / Publish / GeneralPurpose
 *
 * #81：通过 createCeoEventMiddleware 将执行过程实时推送到 Renderer，
 * agentTask:event 事件流替代旧的 SQLite 轮询 + agentTask:interrupt-pending 单点推送。
 *
 * #88：最终回复改为 streamEvents v3 token 级流式（reply_delta 事件），
 * 中间推理（自我指令/规划/工具调用评估）分离到 thinkingTexts 折叠区。
 * 中间 tool_call 消息的 token 不推 reply_delta，避免推理泄漏到主回复。
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {BrowserWindow} from 'electron';
import {createDeepAgent} from 'deepagents';
import type {DeepAgent} from 'deepagents';
import {HumanMessage} from '@langchain/core/messages';
import {Command, isGraphInterrupt} from '@langchain/langgraph';
import {getDb} from '../../db/connection.ts';
import {getCheckpointer} from './checkpointer.ts';
import {loadSoulAndRule, stripFrontmatter} from '../../prompts/loader.ts';
import {createAgentModel} from './geoAgentModel.ts';
import {assembleConversationContext, getMemoryPreamble, maybeTriggerSummary} from './contextManager.ts';
import {
  createAnswerUserTool,
  createKbSearchTool,
  createProjectListTool,
  createProjectCreateTool,
} from './geoAgentFactory.ts';
import {
  intentRouterTool,
  projectDetailTool,
  factListTool,
  articleListTool,
  knowledgeListTool,
  taskHistoryTool,
} from './ceoTools.ts';
import {createKnowledgeAgent} from './knowledgeAgent.ts';
import {createFactAgent} from './factAgent.ts';
import {createContentAgent} from './contentAgent.ts';
import {createReviewAgent} from './reviewAgent.ts';
import {createCeoEventMiddleware} from './ceoEventMiddleware.ts';
import {separateThinkingFromReply, extractTextContent, extractReasoningContent} from './replyFilter.ts';
import {buildHumanContent} from './multipartMessage.ts';
import type {HumanContentBlock} from './multipartMessage.ts';
import type {AgentTask} from '@/types/domain';

export interface RunDeepAgentTaskOptions {
  projectId?: number;
  sessionId?: number;
  title?: string;
  /**
   * #77: resume 时传入的值，恢复被中断的 graph 执行。
   * 不传时 graph 从当前 checkpoint 继续（可能 re-trigger interrupt）。
   */
  resumeValue?: unknown;
  /**
   * #79: BrowserWindow 引用，用于在 GraphInterrupt 时实时推送
   * agentTask:interrupt-pending 事件到 Renderer。
   */
  mainWindow?: BrowserWindow | null;
  /**
   * #88: 若已预先创建 task 记录（fire-and-forget 模式），传入已有 taskId，
   * 跳过 insertTask。未传时 runtime 自行创建。
   */
  taskId?: number;
  /**
   * #91: 文件附件列表（从 Renderer 端 ChatInput FileReader 读取后，
   * 经 IPC 透传至此），用于构造 multipart HumanMessage。
   */
  files?: Array<{name: string; type: string; bytes: number; content?: string}>;
}

/**
 * 加载 CEO 系统 prompt：soul.md（身份） + rule.md（硬约束） + CEO AGENT.md body（角色/决策流程/工具白名单）。
 *
 * CEO AGENT.md 的 YAML frontmatter（工具声明/权限等元数据）被剥离，仅注入正文指令。
 */
function loadCeoSystemPrompt(): string {
  const soulAndRule = loadSoulAndRule();
  const ceoPath = join(process.cwd(), 'agents', 'ceo', 'AGENT.md');
  const raw = readFileSync(ceoPath, 'utf8');
  const body = stripFrontmatter(raw);
  return `${soulAndRule}\n\n${body}`;
}

/**
 * CEO DeepAgent 入口（#75 底座 + #76 真实模型 + #77 SqliteSaver + #78 SubAgents + #79 HITL）。
 *
 * 当前阶段：
 *   - model：createAgentModel() → ChatOpenAI（DeepSeek API）
 *   - systemPrompt：soul + rule + CEO AGENT.md body
 *   - tools：10 个 CEO 直接工具（只读查询 + project_create + intent_router）
 *   - subagents：KnowledgeAgent（#78）+ 后续更多（#80+）
 *   - checkpointer：SqliteSaver（#77，checkpoint 落 nai-agent.db）
 *   - interrupt：捕获 GraphInterrupt，存 interrupt_data_json，实时推送 Renderer 审批卡片
 *
 * 仍写入 agent_tasks 表以保持与 Renderer 的契约兼容。
 */
export async function runDeepAgentTask(
  userGoal: string,
  options: RunDeepAgentTaskOptions = {},
): Promise<AgentTask> {
  const db = getDb();

  const isResume = options.resumeValue !== undefined;

  // 1. 创建任务记录（保持与旧 runtime 的契约兼容）
  //    #88: 若调用方已预先创建 task（fire-and-forget 模式），直接复用 taskId
  let taskId: number;
  if (options.taskId !== undefined) {
    taskId = options.taskId;
  } else {
    const insertTask = db.prepare(
      `INSERT INTO agent_tasks (
         session_id, project_id, title, user_goal, status,
         current_objective, last_action, risk_level,
         failure_count, loop_count, max_loop_count,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'running', ?, ?, 'low', 0, 0, 12, datetime('now'), datetime('now'))`,
    );

    const taskResult = insertTask.run(
      options.sessionId ?? null,
      options.projectId ?? null,
      options.title ?? userGoal.slice(0, 80),
      userGoal,
      'CEO 分析用户意图',
      null,
    );
    taskId = Number(taskResult.lastInsertRowid);
  }

  // #94: threadId 从 taskId 派生（唯一标识每个任务），Checkpointer 仅用于 HITL 中断恢复
  const threadId = `task-${taskId}`;

  try {
    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} starting (resume=${isResume}, thread=${threadId})`);
    // 2. 真实模型（#76 切换：DeepSeek via ChatOpenAI）
    const model = createAgentModel();
    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} model created`);

    // 3. 构建 CEO system prompt
    const systemPrompt = loadCeoSystemPrompt();
    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} system prompt loaded (${systemPrompt.length} chars)`);

    // 4. 组装 CEO 工具集（只读查询 + project_create，通过 task 工具派发子 agent）
    const tools: any[] = [
      intentRouterTool,
      createAnswerUserTool(model),
      createProjectListTool(),
      createProjectCreateTool(),
      projectDetailTool,
      factListTool,
      articleListTool,
      knowledgeListTool,
      taskHistoryTool,
    ];

    // 仅在已选择项目时注入 kb_search（需要 projectId 的向量检索）
    if (options.projectId) {
      tools.push(createKbSearchTool());
    }

    // 5. 子 agent 列表（#78+ #80+ #82+ #83+ #84+ #85 逐步接入）
    const subagents = [
      createKnowledgeAgent(),
      createFactAgent(),
      createContentAgent(),
      createReviewAgent(),
      // 后续：PublishAgent、GeneralPurposeAgent
    ];

    // 6. 创建 CEO DeepAgent
    //    #77：接入 SqliteSaver；#78：接入 SubAgents
    //    #81：接入 IPC 事件流中间件 + contextSchema
    const eventMiddleware = createCeoEventMiddleware({
      taskId,
      mainWindow: options.mainWindow ?? null,
    });

    const agent: DeepAgent = createDeepAgent({
      name: 'ceo-agent',
      model,
      tools,
      systemPrompt,
      checkpointer: getCheckpointer(),
      subagents,
      middleware: [eventMiddleware],
      contextSchema: z.object({
        taskId: z.number(),
        projectId: z.number().optional(),
      }),
    });

    // 7. 流式执行（#88: streamEvents v3 — token 级流式 + 中间推理分离）
    //    - run.messages 逐条产出 ChatModelStream（每条 AI 消息生命周期）
    //    - 对每条消息：先 await msg.output 检查 tool_calls，仅最终回复消息回放 text token
    //    - middleware wrapToolCall 照常 emit plan_created/subagent_dispatched/aggregating
    //    - afterAgent 在 agent node 完成后 emit completed（含 finalReply + thinkingTexts）
    //
    //    #88: contextSchema 校验需要 config.context（非 configurable），
    //    传入 taskId + projectId 供 middleware / 子 agent 读取。
    //
    //    #94: 注入会话历史上下文（SlidingWindowStrategy 裁剪后前缀到 user message）
    //    #96: SummaryWindowStrategy — 先注入 episodic memory 摘要，再拼滑动窗口历史

    const memoryPreamble = getMemoryPreamble(options.sessionId, db);
    const history = assembleConversationContext(options.sessionId, userGoal, db);
    const historyPrefix = history.length > 0
      ? `<conversation_history>\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}\n</conversation_history>\n\n`
      : '';
    const preambleText = memoryPreamble + historyPrefix;

    // #91 fix: buildHumanContent 有文件时返回 content block 数组（含图片 image_url），
    // 无文件时返回纯字符串。必须区分处理——不能对数组用 + 拼接，
    // 否则数组被 toString() 转成 "[object Object],..."，文件内容全部丢失。
    const built = buildHumanContent(userGoal, options.files);
    const humanContent: string | HumanContentBlock[] = Array.isArray(built)
      ? (preambleText ? [{type: 'text', text: preambleText}, ...built] : built)
      : preambleText + built;
    if (process.env.NODE_ENV !== 'production') {
      const filesInfo = options.files?.length
        ? `${options.files.length} 个文件`
        : '无文件';
      if (Array.isArray(humanContent)) {
        const textBlock = humanContent.find((b) => b.type === 'text');
        console.log(`[geoAgentDeepAgentRuntime] task ${taskId} HumanMessage 构造完成: ${filesInfo}, ${humanContent.length} 个 content block, 文本块长度=${textBlock?.text.length ?? 0} 字符, 前 200 字: ${textBlock?.text.slice(0, 200) ?? ''}`);
      } else {
        console.log(`[geoAgentDeepAgentRuntime] task ${taskId} HumanMessage 构造完成: ${filesInfo}, 总长度=${humanContent.length} 字符, 前 200 字: ${humanContent.slice(0, 200)}`);
      }
    }

    const streamConfig = {
      configurable: {thread_id: threadId},
      context: {taskId, projectId: options.projectId},
      version: 'v3' as const,
    };
    const streamInput = isResume
      ? new Command({resume: options.resumeValue})
      : {messages: [new HumanMessage(humanContent)]};

    /** #88: 安全推送 reply_delta 到 Renderer */
    const emitDelta = (delta: string) => {
      if (!delta || !options.mainWindow || options.mainWindow.isDestroyed()) return;
      try {
        options.mainWindow.webContents.send('agentTask:event', {
          taskId,
          type: 'reply_delta',
          timestamp: new Date().toISOString(),
          data: {delta},
        });
      } catch {
        // 窗口可能正在销毁中，静默忽略
      }
    };

    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} calling streamEvents v3...`);
    const run = await agent.streamEvents(streamInput, streamConfig);
    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} streamEvents returned, iterating messages...`);

    // 消费流：逐条 AI 消息，过滤中间 tool_call 消息，只流式最终回复。
    // #88: 先 await msg.output（消息组装完成）再检查 tool_calls，
    // 避免 tool_call 消息的早期 text token 作为 reply_delta 泄漏到主回复。
    // .text 基于 ReplayBuffer，可在 output 解析后回放 token，保留流式渐进体验。
    let msgCount = 0;
    for await (const msg of run.messages) {
      msgCount++;
      console.log(`[geoAgentDeepAgentRuntime] task ${taskId} message #${msgCount} arrived, awaiting output...`);
      // 等待该消息完整生成（text + toolCalls 都到齐）
      const finalMsg = await msg.output;
      const rawToolCalls = (finalMsg as unknown as Record<string, unknown>).tool_calls;
      const hasToolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0;
      console.log(`[geoAgentDeepAgentRuntime] task ${taskId} message #${msgCount} output resolved, hasToolCalls=${hasToolCalls}`);

      // 仅当该消息无 tool_calls（是最终回复）时，回放其 text token
      if (!hasToolCalls) {
        let tokenCount = 0;
        for await (const token of msg.text) {
          emitDelta(token);
          tokenCount++;
        }
        console.log(`[geoAgentDeepAgentRuntime] task ${taskId} message #${msgCount} replayed ${tokenCount} text tokens`);
      }
    }
    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} stream loop done (${msgCount} messages)`);

    // 流结束，取最终 state
    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} awaiting run.output...`);
    const result = await run.output;
    console.log(`[geoAgentDeepAgentRuntime] task ${taskId} run.output resolved, ${result.messages?.length ?? 0} messages in final state`);

    // 8. 提取回复文本（#88: 分离最终回复与中间推理，取最后一条无 tool_calls 的 AIMessage）
    //    #fix: 同时收集 thinkingTexts，供 completed 事件携带——middleware 的 afterAgent
    //    在 fallback summary 之前触发，其 finalReply/thinkingTexts 可能不完整/为空，
    //    因此改由 runtime 在最终回复确定后统一 emit completed（见第 12 步）。
    let replyText = '';
    const thinkingTexts: string[] = [];
    const msgs = result.messages ?? [];
    let finalReplyIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      const msgType = (msg as Record<string, unknown>).type as string | undefined;
      if (msgType === 'ai') {
        const rawToolCalls = (msg as Record<string, unknown>).tool_calls;
        const hasToolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0;
        if (!hasToolCalls) {
          finalReplyIndex = i;
          break;
        }
      }
    }
    if (finalReplyIndex >= 0) {
      // 收集 finalReply 之前的 AIMessage content 作为 thinkingTexts
      for (let i = 0; i < finalReplyIndex; i++) {
        const msg = msgs[i] as Record<string, unknown>;
        if (msg.type === 'ai') {
          const textContent = extractTextContent(msg.content);
          const reasoningContent = extractReasoningContent(msg.content);
          if (textContent) thinkingTexts.push(textContent);
          if (reasoningContent) thinkingTexts.push(reasoningContent);
        }
      }
      const finalMsg = msgs[finalReplyIndex] as Record<string, unknown>;
      const rawReply = extractTextContent(finalMsg.content);
      const finalReasoning = extractReasoningContent(finalMsg.content);
      if (finalReasoning) thinkingTexts.push(finalReasoning);
      const separated = separateThinkingFromReply(rawReply);
      replyText = separated.reply;
      if (separated.thinking.length > 0) thinkingTexts.push(...separated.thinking);
    } else if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1] as Record<string, unknown>;
      const rawReply = extractTextContent(lastMsg.content);
      const finalReasoning = extractReasoningContent(lastMsg.content);
      if (finalReasoning) thinkingTexts.push(finalReasoning);
      const separated = separateThinkingFromReply(rawReply);
      replyText = separated.reply;
      if (separated.thinking.length > 0) thinkingTexts.push(...separated.thinking);
    }

    // #95: 空回复兜底 — agent 只做了 tool call 但没有最终文本回复时，
    // 用累积的 messages state 调用一次轻量 completion 生成可读总结。
    if (!replyText.trim()) {
      console.log(
        `[geoAgentDeepAgentRuntime] task ${taskId} replyText empty, generating fallback summary...`,
      );
      try {
        const msgsForSummary = msgs.slice(-20);
        const summaryPrompt = [
          {
            role: 'system' as const,
            content:
              '你是任务总结助手。根据以下 agent 执行记录，用中文生成一段简洁的任务完成总结。只需输出总结文本，不要加前缀或自我描述。',
          },
          {
            role: 'user' as const,
            content: `Agent 任务执行完毕，以下为执行日志。请总结任务完成情况：\n\n${JSON.stringify(
              msgsForSummary.map((m) => ({
                type: (m as Record<string, unknown>).type,
                content:
                  typeof (m as Record<string, unknown>).content === 'string'
                    ? String((m as Record<string, unknown>).content).slice(0, 500)
                    : '[non-text content]',
                hasToolCalls: Array.isArray(
                  (m as Record<string, unknown>).tool_calls,
                ),
              })),
              null,
              2,
            )}`,
          },
        ];
        const summaryResp = await model.invoke(summaryPrompt);
        replyText =
          typeof summaryResp.content === 'string'
            ? summaryResp.content.trim()
            : '任务已完成。';
        console.log(
          `[geoAgentDeepAgentRuntime] task ${taskId} fallback summary generated (${replyText.length} chars)`,
        );
      } catch (fallbackErr) {
        const fbMsg =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error(
          `[geoAgentDeepAgentRuntime] task ${taskId} fallback summary FAILED:`,
          fbMsg,
        );
        db.prepare(
          `UPDATE agent_tasks SET status = 'failed', current_objective = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(`兜底回复生成失败：${fbMsg}`, taskId);

        // 推送 error 事件
        if (options.mainWindow && !options.mainWindow.isDestroyed()) {
          try {
            options.mainWindow.webContents.send('agentTask:event', {
              taskId,
              type: 'error',
              timestamp: new Date().toISOString(),
              data: {error: `空回复兜底失败：${fbMsg}`},
            });
          } catch {
            // 窗口销毁中，静默忽略
          }
        }
        throw fallbackErr;
      }
    }

    // 9. 写入 agent response artifact（保持兼容）
    db.prepare(
      `INSERT INTO agent_artifacts (
         task_id, project_id, artifact_type, title, content, status, created_at, updated_at
       ) VALUES (?, ?, 'agent_response', ?, ?, 'completed', datetime('now'), datetime('now'))`,
    ).run(taskId, options.projectId ?? null, 'Agent 回答', replyText);

    // 10. 写入 step 记录
    db.prepare(
      `INSERT INTO agent_task_steps (
         task_id, step_type, action_name, status,
         input_json, output_json, attempt_count, max_attempts,
         started_at, completed_at, created_at
       ) VALUES (?, 'plan', 'ceo_agent_invoke', 'completed', ?, ?, 1, 1, datetime('now'), datetime('now'), datetime('now'))`,
    ).run(taskId, JSON.stringify({userGoal}), JSON.stringify({reply: replyText.slice(0, 500)}));

    // 11. 如果有关联 session，写入 chat_messages
    if (options.sessionId) {
      db.prepare(
        `INSERT INTO chat_messages (session_id, project_id, role, content, created_at)
         VALUES (?, ?, 'assistant', ?, datetime('now'))`,
      ).run(options.sessionId, options.projectId ?? null, replyText);

      //     #96: 异步触发摘要生成（fire-and-forget，不阻塞 agent 回复）
      maybeTriggerSummary(options.sessionId, db, options.projectId, taskId);
    }

    // 12. 清除 interrupt 数据 + 更新任务为 completed
    db.prepare(
      `UPDATE agent_tasks SET status = 'completed',
       current_objective = 'CEO 已完成',
       last_action = 'ceo_agent_invoke',
       interrupt_data_json = NULL,
       completed_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`,
    ).run(taskId);

    // 13. #fix: 统一由 runtime emit completed 事件（携带最终 replyText + thinkingTexts）。
    //    不依赖 middleware afterAgent——后者在 fallback summary 之前触发，
    //    纯 tool call 场景下 finalReply 为空，导致 Renderer 收到空回复后卸载组件、UI 空白。
    //    现在在 replyText（含 fallback）确定 + DB 落盘之后才发送，保证 Renderer 拿到完整回复。
    if (options.mainWindow && !options.mainWindow.isDestroyed()) {
      try {
        options.mainWindow.webContents.send('agentTask:event', {
          taskId,
          type: 'completed',
          timestamp: new Date().toISOString(),
          data: {
            finalReply: replyText,
            thinkingTexts: thinkingTexts.length > 0 ? thinkingTexts : undefined,
          },
        });
        console.log(
          `[geoAgentDeepAgentRuntime] task ${taskId} emitted completed event (${replyText.length} chars reply, ${thinkingTexts.length} thinking texts)`,
        );
      } catch {
        // 窗口销毁中，静默忽略
      }
    }
  } catch (error) {
    console.error(`[geoAgentDeepAgentRuntime] task ${taskId} CAUGHT ERROR:`, error);
    // #77 + #79 + #81: 检查是否为 GraphInterrupt（LangGraph 中断信号）
    if (isGraphInterrupt(error)) {
      const interrupts = (error as import('@langchain/langgraph').GraphInterrupt).interrupts;
      const interruptData = JSON.stringify(interrupts.map((i) => i.value));

      console.log(
        `[geoAgentDeepAgentRuntime] task ${taskId} interrupted (thread: ${threadId})`,
      );

      // #79: 将中断信息写入 tool_approvals 审计表
      for (const ir of interrupts) {
        const irValue = ir.value as Record<string, unknown> | undefined;
        const toolName = (irValue?.toolName ?? irValue?.tool_name ?? 'unknown') as string;

        try {
          db.prepare(
            `INSERT INTO tool_approvals (tool_call_id, requested_by, approval_type, status, requested_at)
             VALUES (?, 'agent', ?, 'requested', datetime('now'))`,
          ).run(taskId, toolName);
        } catch (auditErr) {
          console.warn('[geoAgentDeepAgentRuntime] failed to write tool_approvals audit:', auditErr);
        }
      }

      db.prepare(
        `UPDATE agent_tasks SET status = 'waiting_user_input',
         current_objective = '等待用户审批以继续',
         last_action = 'graph_interrupted',
         interrupt_data_json = ?,
         updated_at = datetime('now') WHERE id = ?`,
      ).run(interruptData, taskId);

      db.prepare(
        `INSERT INTO agent_task_steps (
           task_id, step_type, action_name, status,
           input_json, output_json, attempt_count, max_attempts,
           started_at, completed_at, created_at
         ) VALUES (?, 'approval_request', 'graph_interrupted', 'pending', ?, ?, 1, 1, datetime('now'), datetime('now'), datetime('now'))`,
      ).run(taskId, JSON.stringify({userGoal}), JSON.stringify({interrupted: true, threadId}));

      // #81: 推送 unified interrupted 事件到 Renderer（替代旧的 agentTask:interrupt-pending）
      if (options.mainWindow && !options.mainWindow.isDestroyed()) {
        try {
          options.mainWindow.webContents.send('agentTask:event', {
            taskId,
            type: 'interrupted',
            timestamp: new Date().toISOString(),
            data: {interrupt: interrupts.map((i) => i.value)},
          });
          console.log(
            `[geoAgentDeepAgentRuntime] pushed interrupted event to renderer for task ${taskId}`,
          );
        } catch (pushErr) {
          console.warn('[geoAgentDeepAgentRuntime] failed to push interrupted event:', pushErr);
        }
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[geoAgentDeepAgentRuntime] task ${taskId} failed:`, error);

      db.prepare(
        `UPDATE agent_tasks SET status = 'failed',
         current_objective = ?,
         interrupt_data_json = NULL,
         updated_at = datetime('now') WHERE id = ?`,
      ).run(`失败：${message}`, taskId);

      db.prepare(
        `INSERT INTO agent_task_steps (
           task_id, step_type, action_name, status,
           input_json, output_json, attempt_count, max_attempts,
           started_at, completed_at, created_at
         ) VALUES (?, 'plan', 'ceo_agent_invoke', 'failed', ?, ?, 1, 1, datetime('now'), datetime('now'), datetime('now'))`,
      ).run(taskId, JSON.stringify({userGoal}), JSON.stringify({error: message}));

      // #81: 推送 error 事件到 Renderer
      if (options.mainWindow && !options.mainWindow.isDestroyed()) {
        try {
          options.mainWindow.webContents.send('agentTask:event', {
            taskId,
            type: 'error',
            timestamp: new Date().toISOString(),
            data: {error: message},
          });
        } catch (pushErr) {
          console.warn('[geoAgentDeepAgentRuntime] failed to push error event:', pushErr);
        }
      }
    }
  }

  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as AgentTask;
}
