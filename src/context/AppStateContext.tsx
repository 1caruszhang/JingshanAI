import { createContext, useContext, useMemo, useState } from 'react';
import type {
  AgentTask,
  ChatSession,
  Project,
} from '../types/domain';

interface AppStateContextValue {
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  currentAgentTask: AgentTask | null;
  setCurrentAgentTask: (task: AgentTask | null) => void;
  currentChatSession: ChatSession | null;
  setCurrentChatSession: (session: ChatSession | null) => void;
  refreshProjects: number;
  triggerRefreshProjects: () => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [currentAgentTask, setCurrentAgentTask] = useState<AgentTask | null>(null);
  const [currentChatSession, setCurrentChatSession] =
    useState<ChatSession | null>(null);
  const [refreshProjects, setRefreshProjects] = useState(0);

  const value = useMemo<AppStateContextValue>(
    () => ({
      currentProject,
      setCurrentProject,
      currentAgentTask,
      setCurrentAgentTask,
      currentChatSession,
      setCurrentChatSession,
      refreshProjects,
      triggerRefreshProjects: () => setRefreshProjects((v) => v + 1),
    }),
    [currentProject, currentAgentTask, currentChatSession, refreshProjects],
  );

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return ctx;
}
