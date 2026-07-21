'use client';

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/file-upload';
import { FileText } from 'lucide-react';
import type { Components } from 'streamdown';
import PendingFactChatCard from '../facts/PendingFactChatCard';

interface ChatMessagesProps {
  messages: ChatMessage[];
}

const markdownComponents: Components = {
  ul: ({ children }) => (
    <ul className="list-disc marker:text-muted-foreground pl-5 space-y-1">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal marker:text-muted-foreground pl-5 space-y-1">
      {children}
    </ol>
  ),
};

export default function ChatMessages({ messages }: ChatMessagesProps) {
  const { cls, t } = useTheme();

  return (
    <div className="flex flex-col gap-9 w-full">
      {messages
        .filter((message) => !(message.role === 'assistant' && message.content.trim() === ''))
        .map((message) => {
        const isUser = message.role === 'user';

        return (
          <Message
            key={message.id}
            from={message.role}
            className="max-w-[88%] md:max-w-[78%]"
          >
            <MessageContent
              className={cn(
                'text-[15px] leading-relaxed px-4 py-3',
                isUser
                  ? 'bg-primary text-white rounded-2xl rounded-tr-sm'
                  : cls(
                      'bg-zinc-50/80 border border-zinc-100 text-gray-900 rounded-2xl rounded-tl-sm',
                      'bg-zinc-900/40 border-white/[0.06] text-zinc-100 rounded-2xl rounded-tl-sm',
                    ),
              )}
            >
              {isUser ? (
                <div className="whitespace-pre-wrap">{message.content}</div>
              ) : message.type === 'fact_review' && message.facts ? (
                <PendingFactChatCard content={message.content} facts={message.facts} />
              ) : (
                <>
                  <MessageResponse components={markdownComponents}>
                    {message.content}
                  </MessageResponse>

                  {!isUser && message.sources && message.sources.length > 0 && (
                    <Sources>
                      <SourcesTrigger count={message.sources.length}>
                        {t.chatSources}（{message.sources.length}）
                      </SourcesTrigger>
                      <SourcesContent>
                        <div className="mt-2 space-y-1">
                          {message.sources.map((source, idx) => (
                            <div
                              key={source.chunkId}
                              className={cn(
                                'flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg border',
                                cls(
                                  'bg-white border-gray-100 text-gray-600',
                                  'bg-zinc-800/50 border-zinc-700/50 text-zinc-400',
                                ),
                              )}
                            >
                              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <span className="font-medium">
                                  [{idx + 1}] {source.entryTitle}
                                </span>
                                <p className="truncate">{source.chunkText}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </SourcesContent>
                    </Sources>
                  )}
                </>
              )}
            </MessageContent>
          </Message>
        );
      })}
    </div>
  );
}
