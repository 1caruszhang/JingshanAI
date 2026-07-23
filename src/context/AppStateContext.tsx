import {createContext, useContext, useEffect, useMemo, useState} from 'react';
import type {
  AgentTask,
  ChatSession,
  Project,
  UserSettings,
} from '../types/domain';
import {settingsService} from '../services/settingsService';

interface AppStateContextValue {
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  currentAgentTask: AgentTask | null;
  setCurrentAgentTask: (task: AgentTask | null) => void;
  currentChatSession: ChatSession | null;
  setCurrentChatSession: (session: ChatSession | null) => void;
  refreshProjects: number;
  triggerRefreshProjects: () => void;
  currentUser: UserSettings | null;
  refreshCurrentUser: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [currentAgentTask, setCurrentAgentTask] = useState<AgentTask | null>(null);
  const [currentChatSession, setCurrentChatSession] =
    useState<ChatSession | null>(null);
  const [refreshProjects, setRefreshProjects] = useState(0);
  const [currentUser, setCurrentUser] = useState<UserSettings | null>(null);

  const refreshCurrentUser = async () => {
    try {
      const settings = await settingsService.get();
      setCurrentUser(settings);
    } catch (err) {
      console.error('[AppState] load user settings failed:', err);
    }
  };

  useEffect(() => {
    refreshCurrentUser();
  }, []);

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
      currentUser,
      refreshCurrentUser,
    }),
    [currentProject, currentAgentTask, currentChatSession, refreshProjects, currentUser],
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
