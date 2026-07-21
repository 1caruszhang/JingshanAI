import {useCallback, useState} from 'react';
import {useTheme} from '../../hooks/use-theme';
import {useAppState} from '../../context/AppStateContext';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {cn} from '../../lib/utils';
import {factApi} from '../../lib/electron-api';
import {getFactTypeLabel} from '../../../electron/services/facts/factTypes';
import type {FactReviewIntent} from '../../types/domain';

export interface FactItem {
  id: number;
  fact_type: string;
  fact_key: string;
  fact_value: string | null;
  confidence: number;
  source_quote: string | null;
  status: string;
}

interface PendingFactChatCardProps {
  content?: string;
  facts: FactItem[];
  onPendingChange?: (facts: FactItem[]) => void;
}

export default function PendingFactChatCard({content, facts, onPendingChange}: PendingFactChatCardProps) {
  const {t, cls} = useTheme();
  const {currentProject} = useAppState();
  const [items, setItems] = useState(facts);
  const [intentText, setIntentText] = useState('');
  const [processing, setProcessing] = useState(false);

  const notifyChange = useCallback((next: FactItem[]) => {
    onPendingChange?.(next);
  }, [onPendingChange]);

  const reloadPending = async () => {
    if (!currentProject) return;
    const pending = await factApi.listPending({projectId: currentProject.id});
    const next = pending.slice(0, 20);
    setItems(next);
    notifyChange(next);
  };

  const handleConfirm = async (id: number) => {
    await factApi.confirm({factIds: [id]});
    const next = items.map((f) => (f.id === id ? {...f, status: 'confirmed'} : f));
    setItems(next);
    notifyChange(next);
  };

  const handleReject = async (id: number) => {
    await factApi.reject({factIds: [id]});
    const next = items.map((f) => (f.id === id ? {...f, status: 'rejected'} : f));
    setItems(next);
    notifyChange(next);
  };

  const handleIntentSubmit = async () => {
    if (!intentText.trim() || items.length === 0) return;
    setProcessing(true);
    try {
      const intent = await factApi.parseReviewIntent({
        text: intentText.trim(),
        facts: items.map((f, idx) => ({
          factId: f.id,
          displayIndex: idx + 1,
          factType: f.fact_type,
          factValue: f.fact_value ?? '',
        })),
      });
      await executeIntent(intent);
      await reloadPending();
    } finally {
      setProcessing(false);
      setIntentText('');
    }
  };

  const executeIntent = async (intent: FactReviewIntent) => {
    for (const action of intent.actions) {
      if (action.action === 'confirm') {
        await factApi.confirm({factIds: action.factIds});
      } else if (action.action === 'reject') {
        await factApi.reject({factIds: action.factIds});
      } else if (action.action === 'modify_and_confirm') {
        await factApi.modifyAndConfirm({
          factId: action.factId,
          newFactValue: action.newFactValue,
          newFactType: action.newFactType,
        });
      }
    }
  };

  return (
    <Card className={cn('w-full', cls('bg-white border-gray-200/60', 'bg-zinc-900/40 border-zinc-800'))}>
      <CardHeader className="pb-2">
        <CardTitle className={cn('text-sm font-semibold', cls('text-gray-900', 'text-white'))}>
          {content ?? t.factReviewPending}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((fact) => (
          <div
            key={fact.id}
            className={cn(
              'p-3 rounded-xl border',
              cls('bg-gray-50/70 border-gray-200/60', 'bg-zinc-800/40 border-zinc-700/50'),
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary">{getFactTypeLabel(fact.fact_type)}</Badge>
              <span className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                {Math.round(fact.confidence * 100)}%
              </span>
            </div>
            <p className={cn('text-sm mb-2', cls('text-gray-800', 'text-zinc-200'))}>
              {fact.fact_value}
            </p>
            {fact.source_quote && (
              <p className={cn('text-xs italic mb-2', cls('text-gray-500', 'text-zinc-400'))}>
                “{fact.source_quote}”
              </p>
            )}
            <div className="flex items-center gap-2">
              {fact.status === 'candidate' ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => handleConfirm(fact.id)}>
                    {t.factReviewConfirm}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cls('text-red-600 hover:text-red-700', 'text-red-400 hover:text-red-300')}
                    onClick={() => handleReject(fact.id)}
                  >
                    {t.factReviewReject}
                  </Button>
                </>
              ) : (
                <Badge variant={fact.status === 'confirmed' ? 'default' : 'destructive'}>
                  {fact.status === 'confirmed' ? t.factReviewConfirmed : t.factReviewRejected}
                </Badge>
              )}
            </div>
          </div>
        ))}

        {items.some((f) => f.status === 'candidate') && (
          <div className="flex items-center gap-2 pt-1">
            <Input
              placeholder={t.factReviewNaturalLanguageHint}
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleIntentSubmit();
              }}
              disabled={processing}
              className="text-sm"
            />
            <Button size="sm" onClick={handleIntentSubmit} disabled={processing}>
              {t.submit}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
