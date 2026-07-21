'use client';

import { MessageSquarePlus } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

export default function EmptyChatState() {
  const { t, cls } = useTheme();

  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
        <MessageSquarePlus className="w-6 h-6" strokeWidth={1.8} />
      </div>
      <h3 className={cn('text-base font-semibold mb-1', cls('text-gray-900', 'text-white'))}>
        {t.chatEmptyTitle}
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        {t.chatEmptyDesc}
      </p>
    </div>
  );
}
