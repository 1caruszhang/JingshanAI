'use client';

import { motion } from 'motion/react';
import { useTheme } from '@/hooks/use-theme';

export default function ThinkingIndicator() {
  const { t } = useTheme();

  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <span>{t.chatThinking}</span>
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1 h-1 rounded-full bg-muted-foreground"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1.2,
              repeat: Number.POSITIVE_INFINITY,
              delay: i * 0.2,
            }}
          />
        ))}
      </span>
    </div>
  );
}
