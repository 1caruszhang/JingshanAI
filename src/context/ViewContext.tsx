import { createContext, useContext, useMemo, useState } from 'react';
import type { View } from '../types/domain';

interface ViewContextValue {
  activeView: View;
  navigateTo: (view: View, params?: Record<string, unknown>) => void;
  viewParams: Record<string, unknown>;
}

const ViewContext = createContext<ViewContextValue | null>(null);

export function ViewProvider({ children }: { children: React.ReactNode }) {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [viewParams, setViewParams] = useState<Record<string, unknown>>({});

  const navigateTo = (view: View, params?: Record<string, unknown>) => {
    setActiveView(view);
    if (params) {
      setViewParams(params);
    }
  };

  const value = useMemo<ViewContextValue>(
    () => ({ activeView, navigateTo, viewParams }),
    [activeView, viewParams],
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView() {
  const ctx = useContext(ViewContext);
  if (!ctx) {
    throw new Error('useView must be used within ViewProvider');
  }
  return ctx;
}
