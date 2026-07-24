'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/context/AppStateContext';
import { chatService } from '@/services/chatService';
import { projectService } from '@/services/projectService';
import { agentTaskApi } from '@/lib/electron-api';
import { handleIngestIntent, ingestUploadedFiles } from '@/services/agentKnowledgeIngestService';
import type { UploadedFile, ChatMessage as UiChatMessage } from '@/lib/file-upload';
import type { ChatSession } from '@/types/domain';
import WelcomeScreen from './WelcomeScreen';
import EmptyChatState from './EmptyChatState';
import ChatMessages from './ChatMessages';
import AgentTaskProgress from './AgentTaskProgress';
import ThinkingIndicator from './ThinkingIndicator';
import ChatInput from './ChatInput';
import ChatHistoryDrawer from './ChatHistoryDrawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Project } from '@/types/domain';
import { Plus, History } from 'lucide-react';

interface ChatInterfaceProps {
  uploadedFiles?: UploadedFile[];
  onRemoveFile?: (id: string) => void;
  onFileUpload?: (files: UploadedFile[]) => void;
  selectedProject?: string;
  onProjectChange?: (project: string) => void;
  projectList?: Project[];
  getProjectColor?: (name: string) => string;
  /** @deprecated Use selectedProject instead */
  selectedTeam?: string;
  /** @deprecated Use onProjectChange instead */
  onTeamChange?: (team: string) => void;
  /** @deprecated Use projectList instead */
  teamList?: string[];
  /** @deprecated Use getProjectColor instead */
  getTeamColor?: (name: string) => string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  modelList?: string[];
}

export default function ChatInterface({
  uploadedFiles: externalFiles,
  onRemoveFile,
  onFileUpload,
  selectedProject: externalSelectedProject,
  onProjectChange: externalOnProjectChange,
  projectList: externalProjectList,
  getProjectColor: externalGetProjectColor,
  selectedTeam: externalSelectedTeam,
  onTeamChange: externalOnTeamChange,
  teamList: externalTeamList,
  getTeamColor: externalGetTeamColor,
  selectedModel: externalSelectedModel,
  onModelChange,
  modelList = ['豆包2.0', 'DeepSeek', 'Qwen3.5'],
}: ChatInterfaceProps) {
  const { lang, t, cls } = useTheme();
  const { currentProject, setCurrentProject, currentChatSession, setCurrentChatSession, refreshProjects } = useAppState();
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // #88: CEO agent task refs（替代 Assistant Runtime 的 requestId/unsubscribe）
  const activeTaskIdRef = useRef<number | null>(null);
  /** #88: 当前 CEO task 关联的 session，供 onCompleted 持久化 assistant 消息 */
  const activeSessionIdRef = useRef<number | null>(null);

  const [internalFiles, setInternalFiles] = useState<UploadedFile[]>([]);
  const [internalProject, setInternalProject] = useState('');
  const [internalModel, setInternalModel] = useState('豆包2.0');
  const [internalProjectList, setInternalProjectList] = useState<Project[]>([]);

  const effectiveSelectedProject = externalSelectedProject ?? externalSelectedTeam ?? internalProject;
  const effectiveOnProjectChange = externalOnProjectChange ?? externalOnTeamChange;
  const effectiveGetProjectColor = externalGetProjectColor ?? externalGetTeamColor ?? (() => '#0070F3');
  const effectiveProjectList =
    externalProjectList ??
    externalTeamList?.map((name, idx) => ({
      id: -idx,
      name,
      description: null,
      created_at: '',
      updated_at: '',
    })) ??
    internalProjectList;

  const uploadedFiles = externalFiles ?? internalFiles;
  const selectedProject = effectiveSelectedProject;
  const selectedModel = externalSelectedModel ?? internalModel;
  const projectList = effectiveProjectList;

  const getProjectColor = effectiveGetProjectColor;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const skipLoadRef = useRef(false);

  const loadSessions = useCallback(async () => {
    try {
      const data = await chatService.getSessions();
      setSessions(data);
    } catch {
      setSessions([]);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: number) => {
    if (skipLoadRef.current) return;
    try {
      const data = await chatService.getMessages(sessionId);
      setMessages(
        data.map((m) => {
          let render: {type?: string; facts?: unknown} | undefined;
          if (m.render_json) {
            try {
              render = JSON.parse(m.render_json) as {type?: string; facts?: unknown};
            } catch {
              render = undefined;
            }
          }
          // #92: 解析 metadata_json 恢复附件 chips 展示
          let attachments: UiChatMessage['attachments'] | undefined;
          if (m.metadata_json) {
            try {
              const meta = JSON.parse(m.metadata_json) as {attachments?: Array<{name: string; type: string; bytes: number}>};
              if (meta.attachments && meta.attachments.length > 0) {
                attachments = meta.attachments;
              }
            } catch {
              // metadata_json 格式异常，静默忽略
            }
          }
          return {
            id: `msg_${m.id}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            type: render?.type === 'fact_review' ? 'fact_review' : undefined,
            facts: render?.type === 'fact_review' ? (render.facts as UiChatMessage['facts']) : undefined,
            sources: undefined,
            attachments,
          };
        }),
      );
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    projectService.getAll().then((projects) => {
      setInternalProjectList(projects);
    }).catch(() => {
      setInternalProjectList([]);
    });
    loadSessions();
  }, [loadSessions, refreshProjects]);

  useEffect(() => {
    if (currentProject) {
      setInternalProject(currentProject.name);
    }
  }, [currentProject]);

  useEffect(() => {
    if (currentChatSession) {
      loadMessages(currentChatSession.id);
    } else {
      setMessages([]);
    }
  }, [currentChatSession, loadMessages]);

  const ensureSession = useCallback(
    async (firstMessageText: string): Promise<ChatSession> => {
      if (currentChatSession) return currentChatSession;
      const title = firstMessageText.slice(0, 30) || t.chatNewSession;
      const id = await chatService.createSession(title);
      const session: ChatSession = {
        id,
        title,
        session_type: 'public',
        created_at: new Date().toISOString(),
      };
      setCurrentChatSession(session);
      await loadSessions();
      return session;
    },
    [currentChatSession, loadSessions, setCurrentChatSession, t.chatNewSession],
  );

  const saveMessage = useCallback(
    async (
      sessionId: number,
      role: 'user' | 'assistant',
      content: string,
      model?: string,
      renderJson?: object,
      /** #92: 附件元数据（仅存储 name/type/bytes，不存文件内容） */
      metadataJson?: object,
    ) => {
      await chatService.addMessage({
        session_id: sessionId,
        project_id: currentProject?.id ?? null,
        role,
        content,
        model: model ?? null,
        render_json: renderJson ? JSON.stringify(renderJson) : null,
        metadata_json: metadataJson ? JSON.stringify(metadataJson) : null,
      });
    },
    [currentProject],
  );

  const generateResponse = useCallback(
    async (
      sessionId: number,
      userContent: string,
      files?: Array<{name: string; type: string; bytes: number; content?: string}>,
    ) => {
      setIsLoading(true);
      setActiveTaskId(null);

      // #88: 走 CEO Agent Runtime（agentTask:run），替代 Assistant Runtime 流式路径。
      // CEO runtime 用 DeepSeek + intent_router + 子 agent 编排，最终回复 token 级流式
      // 推到 renderer（reply_delta 事件），中间推理分离到 thinkingTexts 折叠区。
      // AgentTaskProgress 组件订阅 agentTask:event 并负责全部渲染（进度/流式回复/HITL）。
      // #91: 提取文件内容，随 agentTaskApi.run 一起发送到 Agent Runtime，
      // 最终以 multipart content blocks 格式拼入 HumanMessage。
      const filesForIpc =
        files && files.length > 0
          ? files.map((f) => ({
              name: f.name,
              type: f.type,
              bytes: f.bytes,
              content: f.content,
            }))
          : undefined;

      try {
        const task = await agentTaskApi.run({
          sessionId,
          projectId: currentProject?.id,
          userGoal: userContent,
          title: userContent.slice(0, 80),
          files: filesForIpc,
        });
        activeTaskIdRef.current = task.id;
        activeSessionIdRef.current = sessionId;
        setActiveTaskId(task.id);
      } catch {
        const errMsg: UiChatMessage = {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          content: '请求失败，请稍后重试',
        };
        setMessages((prev) => [...prev, errMsg]);
        setIsLoading(false);
        setActiveTaskId(null);
      }
    },
    [currentProject],
  );

  const finalizeStreaming = useCallback(async () => {
    // #88: 取消在途的 CEO agent task（替代 Assistant Runtime streamCancel）
    if (activeTaskIdRef.current) {
      try {
        await agentTaskApi.cancel(activeTaskIdRef.current);
      } catch {
        // ignore
      }
      activeTaskIdRef.current = null;
    }
    setIsLoading(false);
    setStreamingMessageId(null);
    setActiveTaskId(null);
  }, []);

  /** #88: CEO task 完成时同步最终回复到 UI 消息列表（DB 已由 runtime 持久化） */
  const handleTaskCompleted = useCallback((reply: string) => {
    // #fix: 防重复调用 — 轮询 onDone 和事件流 onCompleted 可能先后触发
    if (!activeTaskIdRef.current) return;
    // #fix: 空回复兜底——即便 runtime 已写 DB，事件流/轮询仍可能传回空字符串。
    // 若直接 return 会残留 loading 状态 + AgentTaskProgress 组件，UI 卡在
    // "CEO 正在汇总结果..."。改为显示占位回复并正常收尾。
    const content = reply?.trim()
      ? reply
      : '任务已完成（未生成文本回复，可在历史记录中查看详情）。';
    const replyMsg: UiChatMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content,
    };
    setMessages((prev) => [...prev, replyMsg]);
    setIsLoading(false);
    // 卸载 AgentTaskProgress（回复已进入消息流，避免重复显示）
    activeTaskIdRef.current = null;
    activeSessionIdRef.current = null;
    setActiveTaskId(null);
  }, []);

  const handleSubmit = useCallback(
    async (message: { text: string; files: unknown[] }) => {
      const text = message.text.trim();
      if (!text && uploadedFiles.length === 0) return;

      // #91 fix: 在清空 uploadedFiles 前先快照附件数据，
      // 避免 generateResponse 读取时 uploadedFiles 已被清空。
      const filesSnapshot = uploadedFiles.length > 0
        ? uploadedFiles.map((f) => ({name: f.name, type: f.type, bytes: f.bytes, content: f.content}))
        : undefined;

      const userMsg: UiChatMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
        attachments:
          filesSnapshot
            ? filesSnapshot.map((f) => ({name: f.name, type: f.type, bytes: f.bytes}))
            : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputText('');

      // 清空 UI 状态（附件 chips 消失），但 filesSnapshot 保留了数据给 generateResponse 用
      if (onFileUpload) {
        onFileUpload([]);
      } else {
        setInternalFiles([]);
      }

      skipLoadRef.current = true;
      const session = await ensureSession(text);
      // #92: 持久化附件元数据到 chat_messages.metadata_json（仅 name/type/bytes）
      const attachmentMeta =
        filesSnapshot
          ? {attachments: filesSnapshot.map((f) => ({name: f.name, type: f.type, bytes: f.bytes}))}
          : undefined;
      await saveMessage(session.id, 'user', text, undefined, undefined, attachmentMeta);
      skipLoadRef.current = false;

      // #91: 上传的文本类文件（txt/md）自动录入知识库 → 抽取事实，
      // 让后续 CEO 子 agent（contentAgent 等）能通过 knowledge_entries 读到内容。
      // 入库后不阻断流程——继续走 generateResponse。
      let filesIngested = false;
      if (currentProject && filesSnapshot) {
        const textFiles = filesSnapshot.filter(
          (f) => !f.type.startsWith('image/') && f.content,
        );
        if (textFiles.length > 0) {
          try {
            const ingestResult = await ingestUploadedFiles(textFiles, currentProject.id);
            if (ingestResult && ingestResult.extractedCount > 0) {
              // 入库并抽到事实 → 先展示事实审批卡片，再继续生成
              const reviewMsg: UiChatMessage = {
                id: `assistant_${Date.now()}`,
                role: 'assistant',
                content: `已将你上传的 ${ingestResult.entryCount} 份文档录入知识库，并抽取到 ${ingestResult.extractedCount} 条企业事实，请确认：`,
                type: 'fact_review',
                facts: ingestResult.facts,
              };
              await saveMessage(session.id, 'assistant', reviewMsg.content, undefined, {
                type: reviewMsg.type,
                facts: reviewMsg.facts,
              });
              setMessages((prev) => [...prev, reviewMsg]);
              filesIngested = true;
            } else if (ingestResult) {
              // 入库成功但没抽到事实
              const noticeMsg: UiChatMessage = {
                id: `assistant_${Date.now()}`,
                role: 'assistant',
                content: `已将你上传的 ${ingestResult.entryCount} 份文档录入知识库。`,
              };
              await saveMessage(session.id, 'assistant', noticeMsg.content);
              setMessages((prev) => [...prev, noticeMsg]);
              filesIngested = true;
            }
          } catch {
            // 入库失败不阻断主流程，CEO 仍能看到文件原文（通过 HumanMessage）
          }
        }
      }

      // 文件已自动入库时，跳过文本意图识别（避免把用户消息文本当资料重复入库）
      if (!filesIngested && currentProject) {
        const ingestResult = await handleIngestIntent(text, currentProject.id);
        if (ingestResult?.handled) {
          const reply: UiChatMessage = {
            id: `assistant_${Date.now()}`,
            role: 'assistant',
            content: ingestResult.content,
            type: ingestResult.type,
            facts: ingestResult.facts,
          };
          await saveMessage(session.id, 'assistant', reply.content, undefined, {
            type: reply.type,
            facts: reply.facts,
          });
          setMessages((prev) => [...prev, reply]);
          return;
        }
      }

      await generateResponse(session.id, text, filesSnapshot);
    },
    [uploadedFiles.length, ensureSession, generateResponse, onFileUpload, saveMessage, currentProject],
  );

  const handleFileUpload = useCallback(
    (newFiles: UploadedFile[]) => {
      newFiles.forEach((file) => {
        if (file.url) objectUrlsRef.current.add(file.url);
      });
      if (onFileUpload) {
        onFileUpload([...uploadedFiles, ...newFiles]);
      } else {
        setInternalFiles((prev) => [...prev, ...newFiles]);
      }
    },
    [onFileUpload, uploadedFiles],
  );

  const handleRemoveFile = useCallback(
    (id: string) => {
      const fileToRemove = uploadedFiles.find((f) => f.id === id);
      if (fileToRemove?.url) {
        URL.revokeObjectURL(fileToRemove.url);
        objectUrlsRef.current.delete(fileToRemove.url);
      }
      if (onRemoveFile) {
        onRemoveFile(id);
      } else {
        setInternalFiles((prev) => prev.filter((f) => f.id !== id));
      }
    },
    [onRemoveFile, uploadedFiles],
  );

  const handleProjectChange = useCallback(
    (projectName: string) => {
      if (effectiveOnProjectChange) {
        effectiveOnProjectChange(projectName);
      } else {
        setInternalProject(projectName);
      }
      const project = projectList.find((p) => p.name === projectName);
      if (project) {
        setCurrentProject(project);
      }
    },
    [effectiveOnProjectChange, projectList, setCurrentProject],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (onModelChange) onModelChange(model);
      else setInternalModel(model);
    },
    [onModelChange],
  );

  const handleNewChat = useCallback(() => {
    setCurrentChatSession(null);
    setMessages([]);
    setInputText('');
    setHistoryOpen(false);
  }, [setCurrentChatSession]);

  const handleSelectSession = useCallback(
    (session: ChatSession) => {
      setCurrentChatSession(session);
      setHistoryOpen(false);
    },
    [setCurrentChatSession],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: number) => {
      await chatService.deleteSession(sessionId);
      if (currentChatSession?.id === sessionId) {
        setCurrentChatSession(null);
        setMessages([]);
      }
      await loadSessions();
    },
    [currentChatSession, loadSessions, setCurrentChatSession],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  const handleSuggestionSelect = useCallback(
    (text: string) => {
      setInputText(text);
    },
    [],
  );

  const showWelcome = messages.length === 0 && !isLoading;

  return (
    <div className="relative flex flex-col h-full w-full">
      <div className="absolute top-4 left-2 z-20 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          className={cn('gap-1', cls('hover:bg-gray-100', 'hover:bg-zinc-800'))}
        >
          <Plus className="w-4 h-4" />
          {t.chatNewSession}
        </Button>
        <ChatHistoryDrawer
          sessions={sessions}
          currentSessionId={currentChatSession?.id}
          onSelect={handleSelectSession}
          onNewChat={handleNewChat}
          onDelete={handleDeleteSession}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        >
          <Button
            variant="ghost"
            size="sm"
            className={cn('gap-1', cls('hover:bg-gray-100', 'hover:bg-zinc-800'))}
          >
            <History className="w-4 h-4" />
            {t.chatHistory}
          </Button>
        </ChatHistoryDrawer>
      </div>
      <div className="flex flex-col flex-1 min-h-0 w-full">
        <Conversation className="w-full">
          <ConversationContent className="w-full max-w-3xl mx-auto gap-4 pt-12 px-2 lg:px-4">
            {showWelcome ? (
              <WelcomeScreen onSuggestionSelect={handleSuggestionSelect} />
            ) : messages.length === 0 ? (
              <EmptyChatState />
            ) : (
              <ChatMessages
                messages={messages}
                onApprovalRespond={(approvalId, approved) => {
                  // Update the approval card status in-place
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.approvalRequest?.approvalId === approvalId
                        ? {
                            ...m,
                            approvalRequest: {
                              ...m.approvalRequest!,
                              status: approved ? 'approved' : 'rejected',
                            },
                          }
                        : m,
                    ),
                  );
                }}
              />
            )}
            {isLoading && !streamingMessageId && !activeTaskId && <ThinkingIndicator />}
            {activeTaskId && (
              <AgentTaskProgress
                taskId={activeTaskId}
                onCompleted={handleTaskCompleted}
                onDone={() => {
                  // #fix: 轮询先于 IPC 事件流检测到终态时，
                  // 确保始终清理 loading 状态（有回复时由 handleTaskCompleted 处理）
                  setIsLoading(false);
                  setActiveTaskId(null);
                }}
              />
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="w-full max-w-3xl mx-auto shrink-0 pt-6 pb-3">
          <ChatInput
            inputText={inputText}
            onInputChange={setInputText}
            onSubmit={handleSubmit}
            uploadedFiles={uploadedFiles}
            onFileUpload={handleFileUpload}
            onRemoveFile={handleRemoveFile}
            isLoading={isLoading}
            isStreaming={isLoading}
            onStop={finalizeStreaming}
            selectedProject={selectedProject}
            onProjectChange={handleProjectChange}
            projectList={projectList}
            getProjectColor={getProjectColor}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            modelList={modelList}
          />
        </div>
      </div>
    </div>
  );
}
