import {useEffect, useState, useCallback} from 'react';
import {useTheme} from '../../hooks/use-theme';
import {useAppState} from '../../context/AppStateContext';
import {factApi, dbApi} from '../../lib/electron-api';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {cn} from '../../lib/utils';
import {Spinner} from '@/components/ui/spinner';
import type {EnterpriseFact, FactStatus} from '../../types/domain';
import {getFactTypeLabel} from '../../../electron/services/facts/factTypes';
import FactCard from './FactCard';
import FactSourcePreview from './FactSourcePreview';

const STATUS_OPTIONS: FactStatus[] = ['candidate', 'confirmed', 'rejected', 'deprecated'];

export default function FactReviewView() {
  const {t, cls} = useTheme();
  const {currentProject} = useAppState();
  const [facts, setFacts] = useState<EnterpriseFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FactStatus | 'all'>('candidate');
  const [selectedFact, setSelectedFact] = useState<EnterpriseFact | null>(null);
  const [sourceChunkText, setSourceChunkText] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [riskWarnings, setRiskWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const result = await factApi.list({
        projectId: currentProject.id,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 200,
      });
      setFacts(result.facts);
      const health = await factApi.missingFields(currentProject.id);
      setMissingFields(health.missing);
      setRiskWarnings(health.riskWarnings);
    } finally {
      setLoading(false);
    }
  }, [currentProject, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    async function fetchChunk() {
      if (!selectedFact?.source_chunk_id) {
        setSourceChunkText(null);
        return;
      }
      const rows = (await dbApi.query('SELECT chunk_text FROM knowledge_chunks WHERE id = ?', [
        selectedFact.source_chunk_id,
      ])) as Array<{chunk_text: string}>;
      setSourceChunkText(rows[0]?.chunk_text ?? null);
    }
    fetchChunk();
  }, [selectedFact]);

  const handleExtract = async () => {
    if (!currentProject) return;
    setExtracting(true);
    try {
      await factApi.extract({projectId: currentProject.id});
      await load();
    } finally {
      setExtracting(false);
    }
  };

  const handleConfirm = async (fact: EnterpriseFact) => {
    await factApi.confirm({factIds: [fact.id]});
    await load();
  };

  const handleReject = async (fact: EnterpriseFact) => {
    await factApi.reject({factIds: [fact.id]});
    await load();
  };

  const handleModify = async (fact: EnterpriseFact, newValue: string) => {
    await factApi.modifyAndConfirm({factId: fact.id, newFactValue: newValue});
    await load();
  };

  if (!currentProject) {
    return (
      <div className={cn('p-8', cls('text-gray-900', 'text-white'))}>
        <h1 className="text-2xl font-bold mb-2">{t.factReviewTitle}</h1>
        <p className={cls('text-gray-500', 'text-zinc-400')}>{t.noProjectsDesc}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className={cn('px-6 py-5 border-b', cls('border-gray-200/60', 'border-zinc-800'))}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className={cn('text-xl font-bold', cls('text-gray-900', 'text-white'))}>
              {t.factReviewTitle}
            </h1>
            <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
              {currentProject.name}
            </p>
          </div>
          <Button onClick={handleExtract} disabled={extracting}>
            {extracting ? t.factReviewExtracting : t.factReviewExtract}
          </Button>
        </div>

        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as FactStatus | 'all')}
        >
          <TabsList className="flex-wrap">
            <TabsTrigger value="all">{t.factReviewAll}</TabsTrigger>
            {STATUS_OPTIONS.map((s) => (
              <TabsTrigger key={s} value={s}>{statusLabel(t, s)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : facts.length === 0 ? (
            <div className={cn('text-center py-16', cls('text-gray-500', 'text-zinc-400'))}>
              <p className="text-lg font-medium">{t.factReviewEmpty}</p>
              <p className="text-sm mt-1">{t.factReviewEmptyDesc}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {facts.map((fact) => (
                <FactCard
                  key={fact.id}
                  fact={fact}
                  typeLabel={getFactTypeLabel(fact.fact_type)}
                  selected={selectedFact?.id === fact.id}
                  onSelect={() => setSelectedFact(fact)}
                  onConfirm={() => handleConfirm(fact)}
                  onReject={() => handleReject(fact)}
                  onModify={(value) => handleModify(fact, value)}
                />
              ))}
            </div>
          )}
        </div>

        <div
          className={cn(
            'w-[380px] border-l overflow-y-auto p-4',
            cls('border-gray-200/60 bg-gray-50/50', 'border-zinc-800 bg-zinc-900/20'),
          )}
        >
          <div className="space-y-4">
            <Card className={cls('border-0 shadow-none', 'bg-transparent')}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t.factReviewMissingFields}</CardTitle>
              </CardHeader>
              <CardContent>
                {missingFields.length === 0 ? (
                  <p className={cn('text-sm', cls('text-gray-500', 'text-zinc-400'))}>无</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {missingFields.map((f) => (
                      <Badge key={f} variant="outline">{getFactTypeLabel(f)}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={cls('border-0 shadow-none', 'bg-transparent')}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t.factReviewRiskWarnings}</CardTitle>
              </CardHeader>
              <CardContent>
                {riskWarnings.length === 0 ? (
                  <p className={cn('text-sm', cls('text-gray-500', 'text-zinc-400'))}>无</p>
                ) : (
                  <ul className="space-y-2">
                    {riskWarnings.map((w, i) => (
                      <li
                        key={i}
                        className={cn('text-sm', cls('text-amber-600', 'text-amber-400'))}
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {selectedFact && (
              <FactSourcePreview
                fact={selectedFact}
                chunkText={sourceChunkText}
                typeLabel={getFactTypeLabel(selectedFact.fact_type)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function statusLabel(t: Record<string, string>, status: FactStatus): string {
  const map: Record<FactStatus, string> = {
    candidate: t.factReviewPending as string,
    confirmed: t.factReviewConfirmed as string,
    rejected: t.factReviewRejected as string,
    deprecated: t.factReviewDeprecated as string,
  };
  return map[status] ?? status;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
