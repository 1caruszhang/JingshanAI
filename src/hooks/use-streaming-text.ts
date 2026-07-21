import { useCallback, useEffect, useRef, useState } from 'react';

interface UseStreamingTextOptions {
  /** 每次 tick 的间隔（毫秒），默认 16 */
  speedMs?: number;
  /** 最长揭示时间（毫秒），默认 3000 */
  maxDurationMs?: number;
}

interface UseStreamingTextReturn {
  displayText: string;
  isStreaming: boolean;
  start: (text: string, onComplete?: () => void) => void;
  stop: () => void;
  reset: () => void;
}

export function useStreamingText(options: UseStreamingTextOptions = {}): UseStreamingTextReturn {
  const { speedMs = 16, maxDurationMs = 3000 } = options;

  const [displayText, setDisplayText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const fullTextRef = useRef('');
  const positionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef<(() => void) | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(
    (text: string, onComplete?: () => void) => {
      clearTimer();
      fullTextRef.current = text ?? '';
      positionRef.current = 0;
      onCompleteRef.current = onComplete;
      setDisplayText('');

      if (!text) {
        setIsStreaming(false);
        onComplete?.();
        return;
      }

      setIsStreaming(true);

      const totalChars = text.length;
      const ticks = Math.max(1, Math.floor(maxDurationMs / speedMs));
      const charsPerTick = Math.max(1, Math.ceil(totalChars / ticks));

      timerRef.current = setInterval(() => {
        positionRef.current = Math.min(
          positionRef.current + charsPerTick,
          fullTextRef.current.length,
        );
        setDisplayText(fullTextRef.current.slice(0, positionRef.current));

        if (positionRef.current >= fullTextRef.current.length) {
          clearTimer();
          setIsStreaming(false);
          onCompleteRef.current?.();
        }
      }, speedMs);
    },
    [clearTimer, maxDurationMs, speedMs],
  );

  const stop = useCallback(() => {
    clearTimer();
    setDisplayText(fullTextRef.current);
    setIsStreaming(false);
    onCompleteRef.current?.();
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    fullTextRef.current = '';
    positionRef.current = 0;
    setDisplayText('');
    setIsStreaming(false);
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return { displayText, isStreaming, start, stop, reset };
}
