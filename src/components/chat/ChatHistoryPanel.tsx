'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SheetClose } from '@/components/ui/sheet';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { History, Loader2, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react';
import type { ChatSession, ChatMessage } from '@/types/domain';
import { chatService } from '@/services/chatService';

interface ChatHistoryPanelProps {
  sessions: ChatSession[];
  currentSessionId?: number | null;
  onSelect: (session: ChatSession) => void;
  onNewChat: () => void;
  onDelete?: (sessionId: number) => void;
}

type GroupKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier';

function truncatePreview(text: string, max = 60): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function formatSessionDate(dateStr: string, lang: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default function ChatHistoryPanel({
  sessions,
  currentSessionId,
  onSelect,
  onNewChat,
  onDelete,
}: ChatHistoryPanelProps) {
  const { t, cls, lang } = useTheme();
  const [query, setQuery] = useState('');
  const [messagesMap, setMessagesMap] = useState<Record<number, ChatMessage[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (sessions.length === 0) {
      setMessagesMap({});
      return;
    }
    setLoading(true);
    Promise.all(
      sessions.map((s) =>
        chatService.getMessages(s.id).then((msgs): [number, ChatMessage[]] => [s.id, msgs])
      )
    )
      .then((entries) => {
        if (cancelled) return;
        const map: Record<number, ChatMessage[]> = {};
        entries.forEach(([id, msgs]) => {
          map[id] = msgs;
        });
        setMessagesMap(map);
      })
      .catch(() => {
        if (!cancelled) setMessagesMap({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  const { filteredSessions, previewMap, countMap } = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const filtered = sessions.filter((s) => {
      if (!lower) return true;
      const msgs = messagesMap[s.id] ?? [];
      const last = msgs[msgs.length - 1];
      return (
        (s.title ?? '').toLowerCase().includes(lower) ||
        (last?.content ?? '').toLowerCase().includes(lower)
      );
    });

    const previewMap: Record<number, string> = {};
    const countMap: Record<number, number> = {};
    filtered.forEach((s) => {
      const msgs = messagesMap[s.id] ?? [];
      countMap[s.id] = msgs.length;
      const last = msgs[msgs.length - 1];
      previewMap[s.id] = truncatePreview(last?.content ?? t.chatHistoryNoMessages);
    });
    return { filteredSessions: filtered, previewMap, countMap };
  }, [sessions, messagesMap, query, t.chatHistoryNoMessages]);

  const groups = useMemo(() => {
    const map: Record<GroupKey, ChatSession[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      thisMonth: [],
      earlier: [],
    };
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    filteredSessions.forEach((s) => {
      const d = new Date(s.created_at);
      if (d >= todayStart) map.today.push(s);
      else if (d >= yesterdayStart) map.yesterday.push(s);
      else if (d >= weekStart) map.thisWeek.push(s);
      else if (d >= monthStart) map.thisMonth.push(s);
      else map.earlier.push(s);
    });
    return map;
  }, [filteredSessions]);

  const groupLabels: Record<GroupKey, string> = {
    today: t.chatHistoryToday,
    yesterday: t.chatHistoryYesterday,
    thisWeek: t.chatHistoryThisWeek,
    thisMonth: t.chatHistoryThisMonth,
    earlier: t.chatHistoryEarlier,
  };

  const groupOrder: GroupKey[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier'];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between pb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <History className="w-5 h-5 text-primary" />
          {t.chatHistory}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onNewChat}
            className={cn('gap-1', cls('hover:bg-gray-100', 'hover:bg-zinc-800'))}
          >
            <Plus className="w-4 h-4" />
            {t.chatNewSession}
          </Button>
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', cls('hover:bg-gray-100', 'hover:bg-zinc-800'))}
              aria-label={t.closeMenu}
            >
              <X className="w-4 h-4" />
            </Button>
          </SheetClose>
        </div>
      </div>

      <div className={cn(
        'flex items-center gap-2 rounded-full h-10 px-3 mb-4',
        cls('bg-gray-100', 'bg-zinc-800')
      )}>
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <Input
          placeholder={t.chatHistorySearchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(
            'border-0 bg-transparent focus-visible:ring-0 h-full px-0 py-0 shadow-none',
            cls('placeholder:text-gray-500', 'placeholder:text-zinc-400')
          )}
        />
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-12 text-center">
          <p className={cn('text-sm', cls('text-gray-500', 'text-zinc-400'))}>
            {t.chatHistoryEmpty}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
          <div className="space-y-6">
            {loading && sessions.length > 0 && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {groupOrder.map((key) => {
              const list = groups[key];
              if (list.length === 0) return null;
              return (
                <div key={key}>
                  <h3
                    className={cn(
                      'text-xs font-medium mb-2 px-1',
                      cls('text-gray-500', 'text-zinc-400')
                    )}
                  >
                    {groupLabels[key]}
                  </h3>
                  <div className="space-y-2">
                    {list.map((session) => {
                      const isActive = session.id === currentSessionId;
                      return (
                        <div
                          key={session.id}
                          onClick={() => onSelect(session)}
                          className={cn(
                            'group flex flex-col gap-1.5 p-3 rounded-xl cursor-pointer transition-colors border',
                            isActive
                              ? 'bg-primary/10 border-primary/20'
                              : cls(
                                  'hover:bg-gray-100 border-transparent',
                                  'hover:bg-zinc-800 border-transparent'
                                )
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium truncate flex-1 min-w-0">
                              {session.title || t.chatNewSession}
                            </p>
                            <span
                              className={cn(
                                'text-xs shrink-0',
                                cls('text-gray-500', 'text-zinc-400')
                              )}
                            >
                              {formatSessionDate(session.created_at, lang)}
                            </span>
                          </div>
                          <p
                            className={cn(
                              'text-xs line-clamp-2',
                              cls('text-gray-500', 'text-zinc-400')
                            )}
                          >
                            {previewMap[session.id] || t.chatHistoryNoMessages}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MessageSquare className="w-3 h-3" />
                              <span>
                                {countMap[session.id] ?? 0}
                                {t.chatMessagesSuffix}
                              </span>
                            </div>
                            {onDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(session.id);
                                }}
                                className={cn(
                                  'h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity',
                                  'text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20'
                                )}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {groupOrder.every((k) => groups[k].length === 0) && !loading && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {t.chatHistoryEmpty}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
