'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/context/AppStateContext';
import { useStreamingText } from '@/hooks/use-streaming-text';
import { chatService } from '@/services/chatService';
import { projectService } from '@/services/projectService';
import { agentTaskApi } from '@/lib/electron-api';
import { handleIngestIntent } from '@/services/agentKnowledgeIngestService';
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

  const { displayText, isStreaming: isRevealing, start, stop: stopReveal, reset } = useStreamingText();

  useEffect(() => {
    if (!streamingMessageId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === streamingMessageId ? { ...m, content: displayText } : m,
      ),
    );
  }, [displayText, streamingMessageId]);

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
          return {
            id: `msg_${m.id}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            type: render?.type === 'fact_review' ? 'fact_review' : undefined,
            facts: render?.type === 'fact_review' ? (render.facts as UiChatMessage['facts']) : undefined,
            sources: undefined,
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
    ) => {
      await chatService.addMessage({
        session_id: sessionId,
        project_id: currentProject?.id ?? null,
        role,
        content,
        model: model ?? null,
        render_json: renderJson ? JSON.stringify(renderJson) : null,
      });
    },
    [currentProject],
  );

  const generateResponse = useCallback(
    async (sessionId: number, userContent: string) => {
      setIsLoading(true);
      setActiveTaskId(null);
      reset();

      const assistantId = `assistant_${Date.now()}`;
      const assistantMessage: UiChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingMessageId(assistantId);

      let answer = 'Agent 未返回有效回答';
      let taskId: number | null = null;

      try {
        const task = await agentTaskApi.run({
          sessionId: sessionId,
          projectId: currentProject?.id,
          title: userContent.slice(0, 80),
          userGoal: userContent,
        });

        taskId = task.id;
        setActiveTaskId(taskId);

        if (task.status === 'completed') {
          const artifacts = await agentTaskApi.artifacts(task.id);
          const responseArtifact = (artifacts as Array<{ artifact_type: string; content: string }>).find(
            (a) => a.artifact_type === 'agent_response',
          );
          answer = responseArtifact?.content ?? answer;
        } else if (task.status === 'failed') {
          answer = task.current_objective ?? '任务执行失败';
        }

        start(answer, async () => {
          await saveMessage(sessionId, 'assistant', answer);
          setIsLoading(false);
          setStreamingMessageId(null);
          setActiveTaskId(null);
        });
      } catch {
        answer = '请求失败，请稍后重试';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: answer } : m,
          ),
        );
        await saveMessage(sessionId, 'assistant', answer);
        setIsLoading(false);
        setStreamingMessageId(null);
        setActiveTaskId(null);
      }
    },
    [currentProject, saveMessage, start, reset],
  );

  const finalizeStreaming = useCallback(async () => {
    stopReveal();
    setIsLoading(false);
    setStreamingMessageId(null);
    setActiveTaskId(null);

    if (!currentChatSession) return;
    const assistantMessage = messages.find(
      (m) => m.id === streamingMessageId,
    );
    if (assistantMessage?.content) {
      await saveMessage(currentChatSession.id, 'assistant', assistantMessage.content);
    }
  }, [currentChatSession, messages, saveMessage, stopReveal, streamingMessageId]);

  const handleSubmit = useCallback(
    async (message: { text: string; files: unknown[] }) => {
      const text = message.text.trim();
      if (!text && uploadedFiles.length === 0) return;

      const userMsg: UiChatMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputText('');

      if (onFileUpload) {
        onFileUpload([]);
      } else {
        setInternalFiles([]);
      }

      skipLoadRef.current = true;
      const session = await ensureSession(text);
      await saveMessage(session.id, 'user', text);
      skipLoadRef.current = false;

      // 优先识别“录入资料”意图
      if (currentProject) {
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

      await generateResponse(session.id, text);
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
              <ChatMessages messages={messages} />
            )}
            {isLoading && !isRevealing && <ThinkingIndicator />}
            {activeTaskId && (
              <AgentTaskProgress
                taskId={activeTaskId}
                onDone={() => setActiveTaskId(null)}
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
            isStreaming={isRevealing}
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
