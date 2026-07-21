import { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../hooks/use-theme';
import { useView } from '../../context/ViewContext';
import Sidebar from './Sidebar';
import Header from './Header';
import TitleBar from './TitleBar';
import { Menu } from 'lucide-react';

interface LayoutShellProps {
  children: React.ReactNode;
}

export default function LayoutShell({ children }: LayoutShellProps) {
  const { cls } = useTheme();
  const { activeView, navigateTo } = useView();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAiAgent = activeView === 'aiAgent';
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAiAgent && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [isAiAgent]);

  return (
    <div className={cn('h-[100dvh] w-full flex flex-col transition-colors duration-300', cls('bg-[#f4f4f5] text-[#191c1e]', 'bg-[#09090b] text-white'))}>
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeView={activeView}
          onNavigate={navigateTo}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div
          ref={contentRef}
          className={cn(
            'flex-1 flex flex-col relative w-full min-w-0 transition-colors',
            isAiAgent
              ? 'overflow-hidden pl-2 lg:pl-4 pr-0 pt-0 pb-5 lg:pb-8'
              : 'overflow-y-auto px-6 lg:px-12 pt-4 lg:pt-6 pb-6 lg:pb-12',
            cls('bg-white', 'bg-[#131316]'),
          )}
        >
          {isAiAgent ? (
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="打开菜单"
              className={cn(
                'xl:hidden absolute top-2 right-2 z-20 p-2 rounded-lg',
                cls('hover:bg-gray-100 text-gray-600', 'hover:bg-[#3f3f46] text-gray-300'),
              )}
            >
              <Menu className="w-6 h-6" />
            </button>
          ) : (
            <Header onOpenMobileMenu={() => setMobileOpen(true)} />
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
