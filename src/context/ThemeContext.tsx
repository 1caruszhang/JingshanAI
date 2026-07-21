import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { i18n, type Lang } from '../lib/i18n';

interface ThemeContextValue {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: typeof i18n.zh;
  cls: (light: string, dark: string) => string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [lang, setLang] = useState<Lang>('zh');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDarkMode,
      toggleDarkMode: () => setIsDarkMode((v) => !v),
      lang,
      setLang,
      t: i18n[lang],
      cls: (light: string, dark: string) => (isDarkMode ? dark : light),
    }),
    [isDarkMode, lang],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
  return ctx;
}
