import { Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../hooks/use-theme';
import { useAppState } from '../../context/AppStateContext';

interface HeaderProps {
  onOpenMobileMenu: () => void;
}

export default function Header({ onOpenMobileMenu }: HeaderProps) {
  const { cls, t } = useTheme();
  const { currentProject } = useAppState();

  return (
    <header className="flex justify-between items-center mb-6 shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={onOpenMobileMenu}
          aria-label={t.openMenu ?? 'Open menu'}
          className={cn(
            'xl:hidden p-2 rounded-lg',
            cls('hover:bg-gray-100 text-gray-600', 'hover:bg-[#3f3f46] text-gray-300')
          )}
        >
          <Menu className="w-6 h-6" />
        </button>
        {currentProject && (
          <span className="text-xs text-muted-foreground">
            {currentProject.name}
          </span>
        )}
      </div>
    </header>
  );
}
