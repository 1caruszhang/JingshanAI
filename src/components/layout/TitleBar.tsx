import { useEffect, useState } from 'react';
import { Minus, Square, Maximize2, X } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

function usePlatform() {
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    window.electron?.windowControls?.platform().then(setPlatform);
  }, []);

  return platform;
}

export default function TitleBar() {
  const { cls } = useTheme();
  const platform = usePlatform();
  const isMac = platform === 'darwin';
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (isMac || !window.electron?.windowControls) return;

    const ctrl = window.electron.windowControls;
    ctrl.isMaximized().then(setIsMaximized);
    const unsubscribe = ctrl.onMaximizedChange(setIsMaximized);
    return () => unsubscribe?.();
  }, [isMac]);

  const handleMinimize = () => window.electron?.windowControls?.minimize();
  const handleMaximize = () => {
    if (isMaximized) {
      window.electron?.windowControls?.unmaximize();
    } else {
      window.electron?.windowControls?.maximize();
    }
  };
  const handleClose = () => window.electron?.windowControls?.close();

  if (isMac) {
    return (
      <div
        className={cn(
          'h-10 w-full flex items-center px-4 select-none app-drag-region',
          cls('bg-[#f5f6f8]', 'bg-[#18181c]')
        )}
      >
        <div className="flex items-center gap-2" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'h-10 w-full flex items-center justify-between select-none app-drag-region',
        cls('bg-[#f5f6f8]', 'bg-[#18181c]')
      )}
    >
      <div className="flex items-center gap-2 px-3" />

      <div className="flex items-center h-full app-no-drag-region">
        <button
          onClick={handleMinimize}
          className={cn(
            'h-full px-4 flex items-center justify-center transition-colors',
            cls('hover:bg-gray-200/60 text-gray-600', 'hover:bg-white/10 text-gray-300')
          )}
          aria-label="Minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={handleMaximize}
          className={cn(
            'h-full px-4 flex items-center justify-center transition-colors',
            cls('hover:bg-gray-200/60 text-gray-600', 'hover:bg-white/10 text-gray-300')
          )}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Square className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="h-full px-4 flex items-center justify-center transition-colors hover:bg-red-500 hover:text-white text-gray-500"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
