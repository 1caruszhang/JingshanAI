'use client';

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import type { ChatSession } from '@/types/domain';
import ChatHistoryPanel from './ChatHistoryPanel';

interface ChatHistoryDrawerProps {
  sessions: ChatSession[];
  currentSessionId?: number | null;
  onSelect: (session: ChatSession) => void;
  onNewChat: () => void;
  onDelete?: (sessionId: number) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export default function ChatHistoryDrawer({
  sessions,
  currentSessionId,
  onSelect,
  onNewChat,
  onDelete,
  open,
  onOpenChange,
  children,
}: ChatHistoryDrawerProps) {
  const { t, cls } = useTheme();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent
        showCloseButton={false}
        className={cn(
          'w-[360px] sm:w-[400px] p-6',
          cls('bg-white', 'bg-[#1c1c1f]')
        )}
      >
        <SheetTitle className="sr-only">{t.chatHistory}</SheetTitle>
        <ChatHistoryPanel
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={onSelect}
          onNewChat={onNewChat}
          onDelete={onDelete}
        />
      </SheetContent>
    </Sheet>
  );
}
