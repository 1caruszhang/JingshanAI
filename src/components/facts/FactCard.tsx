import {useState} from 'react';
import {useTheme} from '../../hooks/use-theme';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '../../lib/utils';
import type {EnterpriseFact} from '../../types/domain';

interface FactCardProps {
  fact: EnterpriseFact;
  typeLabel: string;
  selected: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onModify: (newValue: string) => void;
}

export default function FactCard({
  fact,
  typeLabel,
  selected,
  onSelect,
  onConfirm,
  onReject,
  onModify,
}: FactCardProps) {
  const {t, cls} = useTheme();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(fact.fact_value ?? '');

  const handleSave = () => {
    if (editValue.trim() === '') return;
    onModify(editValue.trim());
    setEditing(false);
  };

  const statusVariant =
    fact.status === 'confirmed'
      ? 'default'
      : fact.status === 'rejected'
        ? 'destructive'
        : fact.status === 'deprecated'
          ? 'secondary'
          : 'outline';

  return (
    <Card
      onClick={onSelect}
      className={cn(
        'cursor-pointer transition-colors',
        selected
          ? cls('border-primary bg-white', 'border-primary bg-zinc-900/40')
          : cls('border-gray-200/60 bg-white', 'border-zinc-800 bg-zinc-900/20'),
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Badge variant={statusVariant}>{statusLabel(t, fact.status)}</Badge>
          <Badge variant="secondary">{typeLabel}</Badge>
          <div className={cn('ml-auto text-xs', cls('text-gray-400', 'text-zinc-500'))}>
            {t.factReviewConfidence}: {Math.round(fact.confidence * 100)}%
          </div>
        </div>

        <div className="mt-3">
          {editing ? (
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[80px]"
              autoFocus
            />
          ) : (
            <p className={cn('text-sm leading-relaxed', cls('text-gray-800', 'text-zinc-200'))}>
              {fact.fact_value}
            </p>
          )}
        </div>

        {fact.source_quote && (
          <blockquote
            className={cn(
              'mt-3 text-xs border-l-2 pl-3 italic',
              cls('border-gray-300 text-gray-500', 'border-zinc-700 text-zinc-400'),
            )}
          >
            {fact.source_quote}
          </blockquote>
        )}

        <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <>
              <Button size="sm" onClick={handleSave}>{t.factReviewSave}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t.factReviewCancel}
              </Button>
            </>
          ) : (
            <>
              {fact.status === 'candidate' && (
                <>
                  <Button size="sm" onClick={onConfirm}>{t.factReviewConfirm}</Button>
                  <Button size="sm" variant="outline" onClick={onReject}>
                    {t.factReviewReject}
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t.factReviewEdit}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function statusLabel(t: Record<string, string>, status: EnterpriseFact['status']): string {
  const map: Record<EnterpriseFact['status'], string> = {
    candidate: t.factReviewPending as string,
    confirmed: t.factReviewConfirmed as string,
    rejected: t.factReviewRejected as string,
    deprecated: t.factReviewDeprecated as string,
  };
  return map[status] ?? status;
}
