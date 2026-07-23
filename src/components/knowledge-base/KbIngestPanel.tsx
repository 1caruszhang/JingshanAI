import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { knowledgeBaseService } from '@/services/knowledgeBaseService';
import { projectService } from '@/services/projectService';
import { factService } from '@/services/factService';
import { dialogApi, factApi, dbApi } from '@/lib/electron-api';
import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/context/AppStateContext';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { Project, KnowledgeEntry, KnowledgeEntryStatus, EnterpriseFact, FactStatus } from '@/types/domain';
import {
  FACT_TYPES,
  FACT_TYPE_LABELS,
  HIGH_RISK_FACT_TYPES,
  REQUIRED_FACT_TYPES_FOR_ARTICLE,
} from '@/types/domain';
import { getFactTypeLabel } from '../../../electron/services/facts/factTypes';
import FactCard from '@/components/facts/FactCard';
import FactSourcePreview from '@/components/facts/FactSourcePreview';
import { Trash2, FileText, RefreshCw, Pencil, Check, X, AlertTriangle, Building2, Database, Upload } from 'lucide-react';

interface KbIngestPanelProps {
  projectId: number;
}

const statusBadgeMap: Record<
  KnowledgeEntryStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  pending: { label: '待处理', variant: 'secondary' },
  indexed: { label: '已索引', variant: 'default' },
  failed: { label: '失败', variant: 'destructive' },
};

const FACT_STATUS_OPTIONS: FactStatus[] = ['candidate', 'confirmed', 'rejected', 'deprecated'];

type TabValue = 'profile' | 'entries' | 'facts';

function factStatusLabel(t: Record<string, string>, status: FactStatus): string {
  const map: Record<FactStatus, string> = {
    candidate: t.factReviewPending as string,
    confirmed: t.factReviewConfirmed as string,
    rejected: t.factReviewRejected as string,
    deprecated: t.factReviewDeprecated as string,
  };
  return map[status] ?? status;
}

export default function KbIngestPanel({ projectId }: KbIngestPanelProps) {
  const { cls, t } = useTheme();
  const { setCurrentProject } = useAppState();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [facts, setFacts] = useState<EnterpriseFact[]>([]);
  const [loading, setLoading] = useState(true);

  // Ingest form state
  const [activeIngestTab, setActiveIngestTab] = useState<'text' | 'file'>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [filePath, setFilePath] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'ingesting' | 'success' | 'error'>('idle');

  // Domain editing
  const [editingDomain, setEditingDomain] = useState(false);
  const [pendingDomain, setPendingDomain] = useState<'local_service' | 'saas' | 'ecommerce' | ''>('');

  // Enterprise profile form (ontology extraction)
  const [profileValues, setProfileValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FACT_TYPES.map((ft) => [ft, '']))
  );
  const [extracting, setExtracting] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [riskWarnings, setRiskWarnings] = useState<string[]>([]);

  // Fact review state
  const [activeTab, setActiveTab] = useState<TabValue>('profile');
  const [factStatusFilter, setFactStatusFilter] = useState<FactStatus | 'all'>('candidate');
  const [selectedFact, setSelectedFact] = useState<EnterpriseFact | null>(null);
  const [sourceChunkText, setSourceChunkText] = useState<string | null>(null);

  const canSubmitText = title.trim() && content.trim() && status !== 'ingesting';
  const canSubmitFile = title.trim() && filePath && status !== 'ingesting';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectData, entriesData] = await Promise.all([
        projectService.getById(projectId),
        knowledgeBaseService.getEntriesByProject(projectId),
      ]);
      setProject(projectData ?? null);
      setEntries(entriesData);
      if (projectData) {
        setCurrentProject(projectData);
        setPendingDomain((projectData.domain ?? '') as typeof pendingDomain);
      }
      // Facts + health
      try {
        const factResult = await factApi.list({ projectId, limit: 200 });
        setFacts(factResult.facts);
      } catch {
        setFacts([]);
      }
      try {
        const health = await factApi.missingFields(projectId);
        setMissingFields(health.missing);
        setRiskWarnings(health.riskWarnings);
      } catch {
        setMissingFields([]);
        setRiskWarnings([]);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, setCurrentProject]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetch source chunk when selecting a fact
  useEffect(() => {
    async function fetchChunk() {
      if (!selectedFact?.source_chunk_id) {
        setSourceChunkText(null);
        return;
      }
      try {
        const rows = (await dbApi.query('SELECT chunk_text FROM knowledge_chunks WHERE id = ?', [
          selectedFact.source_chunk_id,
        ])) as Array<{ chunk_text: string }>;
        setSourceChunkText(rows[0]?.chunk_text ?? null);
      } catch {
        setSourceChunkText(null);
      }
    }
    fetchChunk();
  }, [selectedFact]);

  const handleTextSubmit = async () => {
    if (!canSubmitText) return;
    setStatus('ingesting');
    setProgress(30);
    try {
      await knowledgeBaseService.ingestText(projectId, title.trim(), content.trim());
      setProgress(100);
      setStatus('success');
      setTitle('');
      setContent('');
      loadData();
    } catch {
      setStatus('error');
    }
  };

  const handleFileSelect = async () => {
    const paths = await dialogApi.openFile({
      multiple: false,
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt', 'md', 'markdown'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (paths && paths.length > 0) setFilePath(paths[0]);
  };

  const handleFileSubmit = async () => {
    if (!canSubmitFile) return;
    setStatus('ingesting');
    setProgress(20);
    try {
      await knowledgeBaseService.ingestFile(projectId, title.trim(), filePath);
      setProgress(100);
      setStatus('success');
      setTitle('');
      setFilePath('');
      loadData();
    } catch {
      setStatus('error');
    }
  };

  const handleDeleteEntry = async (entry: KnowledgeEntry) => {
    if (!confirm(t.entryDeleteConfirm)) return;
    await knowledgeBaseService.deleteEntry(entry.id);
    loadData();
  };

  const domainLabel = (d: string | null | undefined) => {
    if (!d) return '未设置';
    if (d === 'local_service') return '本地服务';
    if (d === 'saas') return 'SaaS';
    if (d === 'ecommerce') return '电商';
    return d;
  };

  const handleSaveDomain = async () => {
    if (!project) return;
    await projectService.update(project.id, { domain: pendingDomain || null });
    setProject((prev) => (prev ? { ...prev, domain: pendingDomain || null } : prev));
    setEditingDomain(false);
  };

  const handleCancelDomain = () => {
    setPendingDomain((project?.domain ?? '') as typeof pendingDomain);
    setEditingDomain(false);
  };

  const handleProfileFieldChange = (field: string, value: string) => {
    setProfileValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleProfileSubmit = async () => {
    const formInputs: Record<string, string> = {};
    for (const ft of FACT_TYPES) {
      const val = profileValues[ft]?.trim();
      if (val) formInputs[ft] = val;
    }
    setExtracting(true);
    try {
      const result = await factApi.extract({ projectId, mode: 'ontology', formInputs });
      if (result.warnings && result.warnings.length > 0) {
        toast.error(
          (t.enterpriseProfileWarnings ?? '部分字段存在风险提示') + ': ' + result.warnings.join('；')
        );
      }
      await loadData();
      setActiveTab('facts');
    } catch (err) {
      toast.error(
        t.enterpriseProfileSubmitError ?? '提交失败',
        err instanceof Error ? err.message : undefined
      );
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractAuto = async () => {
    setExtracting(true);
    try {
      await factApi.extract({ projectId });
      await loadData();
    } finally {
      setExtracting(false);
    }
  };

  const handleConfirmFact = async (fact: EnterpriseFact) => {
    await factApi.confirm({ factIds: [fact.id] });
    await loadData();
  };

  const handleRejectFact = async (fact: EnterpriseFact) => {
    await factApi.reject({ factIds: [fact.id] });
    await loadData();
  };

  const handleModifyFact = async (fact: EnterpriseFact, newValue: string) => {
    await factApi.modifyAndConfirm({ factId: fact.id, newFactValue: newValue });
    await loadData();
  };

  // KB health summary
  const indexedCount = entries.filter((e) => e.status === 'indexed').length;
  const pendingCount = entries.filter((e) => e.status === 'pending').length;
  const health = entries.length === 0 ? 0 : Math.round((indexedCount / entries.length) * 100);
  const healthColor = health >= 80 ? 'text-emerald-500' : health >= 50 ? 'text-amber-500' : 'text-rose-500';

  const filteredFacts = factStatusFilter === 'all'
    ? facts
    : facts.filter((f) => f.status === factStatusFilter);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Project Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project?.name ?? t.knowledgeBaseTitle}</h1>
          {project?.description && (
            <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
              {project.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className={cn('text-xs font-medium', cls('text-gray-400', 'text-zinc-500'))}>业务领域：</span>
            {editingDomain ? (
              <div className="flex items-center gap-1">
                <Select value={pendingDomain} onValueChange={(v) => setPendingDomain(v as typeof pendingDomain)}>
                  <SelectTrigger className="h-7 text-xs w-32">
                    <SelectValue placeholder="未设置" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">未设置</SelectItem>
                    <SelectItem value="local_service">本地服务</SelectItem>
                    <SelectItem value="saas">SaaS</SelectItem>
                    <SelectItem value="ecommerce">电商</SelectItem>
                  </SelectContent>
                </Select>
                <button onClick={handleSaveDomain} className="p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-500">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleCancelDomain} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingDomain(true)}
                className={cn(
                  'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors',
                  project?.domain
                    ? cls('border-primary/30 text-primary bg-primary/5 hover:bg-primary/10', 'border-primary/30 text-primary bg-primary/10 hover:bg-primary/20')
                    : cls('border-gray-200 text-gray-400 hover:border-gray-300', 'border-zinc-700 text-zinc-500 hover:border-zinc-600'),
                )}
              >
                {domainLabel(project?.domain)}
                <Pencil className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          刷新
        </Button>
      </div>

      {/* KB Health Summary (always-on) */}
      <Card className={cn('p-5', cls('bg-white', 'bg-[#1c1c1f]'))}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            {t.kbHealthTitle ?? '知识库健康度'}
          </h3>
          <div className="flex items-center gap-4 text-xs">
            <span className={cn('font-bold', healthColor)}>{health}</span>
            <span className={cls('text-gray-500', 'text-zinc-400')}>
              {indexedCount} {t.kbHealthIndexed ?? '已索引'} / {pendingCount} {t.kbHealthPending ?? '待处理'}
            </span>
            <span className={cls('text-gray-400', 'text-zinc-500')}>
              {facts.length} 条事实
            </span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              health >= 80 ? 'bg-emerald-500' : health >= 50 ? 'bg-amber-500' : 'bg-rose-500'
            )}
            style={{ width: `${health}%` }}
          />
        </div>
      </Card>

      {/* Tabs: 资料录入 / 知识条目 / 事实审核 */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="profile">{t.enterpriseProfile ?? '企业资料'}</TabsTrigger>
          <TabsTrigger value="entries">{t.entriesTitle}</TabsTrigger>
          <TabsTrigger value="facts">{t.factReview ?? '事实审核'}</TabsTrigger>
        </TabsList>

        {/* Tab 1: 资料录入 (企业资料补抽 + 文本/文件录入) */}
        <TabsContent value="profile" className="space-y-6">
          {/* Enterprise profile form (ontology extraction) */}
          <Card className={cn('p-5', cls('bg-white', 'bg-[#1c1c1f]'))}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                {t.enterpriseProfileFields ?? '企业信息字段'}
              </h3>
              <Button variant="outline" size="sm" onClick={handleExtractAuto} disabled={extracting}>
                {extracting ? <Spinner className="w-4 h-4" /> : null}
                {t.factReviewExtract ?? '抽取事实'}
              </Button>
            </div>
            <p className={cn('text-xs mb-4', cls('text-gray-400', 'text-zinc-500'))}>
              {t.enterpriseProfileFieldsHint ?? '带 * 为推荐填写字段；带 ⚠ 的高风险字段，AI 补全时请仔细核实。'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {FACT_TYPES.map((ft) => {
                const isRequired = (REQUIRED_FACT_TYPES_FOR_ARTICLE as string[]).includes(ft);
                const isHighRisk = HIGH_RISK_FACT_TYPES.has(ft);
                const label = FACT_TYPE_LABELS[ft];
                return (
                  <div key={ft} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <label className={cn('text-sm font-medium', cls('text-gray-700', 'text-zinc-300'))}>
                        {label}
                        {isRequired && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      {isHighRisk && (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] py-0 px-1.5 h-5 gap-1 border-amber-400/50',
                            cls('text-amber-600 bg-amber-50', 'text-amber-400 bg-amber-950/20')
                          )}
                        >
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {t.enterpriseProfileHighRisk ?? 'AI 补全时请仔细核实'}
                        </Badge>
                      )}
                    </div>
                    <Input
                      value={profileValues[ft] ?? ''}
                      onChange={(e) => handleProfileFieldChange(ft, e.target.value)}
                      placeholder={`请输入${label}...`}
                      disabled={extracting}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={handleProfileSubmit} disabled={extracting} className="min-w-[120px]">
                {extracting ? (
                  <span className="flex items-center gap-2">
                    <Spinner className="w-4 h-4" />
                    {t.enterpriseProfileSubmitting ?? '提交中…'}
                  </span>
                ) : (
                  t.enterpriseProfileSubmit ?? '提交并抽取事实'
                )}
              </Button>
            </div>
          </Card>

          {/* Ingest (text/file) */}
          <Card className={cn('p-5', cls('bg-white', 'bg-[#1c1c1f]'))}>
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              {t.ingestTitle}
            </h3>
            <div className="mb-4">
              <label className="text-sm font-medium mb-1.5 block">{t.entryTitle}</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.entryTitle} />
            </div>
            <Tabs value={activeIngestTab} onValueChange={(v) => setActiveIngestTab(v as 'text' | 'file')}>
              <TabsList className="mb-4">
                <TabsTrigger value="text">{t.ingestTextTab}</TabsTrigger>
                <TabsTrigger value="file">{t.ingestFileTab}</TabsTrigger>
              </TabsList>
              <TabsContent value="text" className="space-y-4">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t.ingestTextPlaceholder}
                  rows={6}
                />
                <Button onClick={handleTextSubmit} disabled={!canSubmitText} className="w-full">
                  {status === 'ingesting' ? t.ingestProgress : t.ingestSubmit}
                </Button>
              </TabsContent>
              <TabsContent value="file" className="space-y-4">
                <div className="flex items-center gap-2">
                  <Input value={filePath} readOnly placeholder={t.ingestFileSelect} className="flex-1" />
                  <Button type="button" variant="outline" onClick={handleFileSelect}>
                    {t.ingestFileSelect}
                  </Button>
                </div>
                <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>{t.ingestFileTypes}</p>
                <Button onClick={handleFileSubmit} disabled={!canSubmitFile} className="w-full">
                  {status === 'ingesting' ? t.ingestProgress : t.ingestSubmit}
                </Button>
              </TabsContent>
            </Tabs>
            {status === 'ingesting' && <Progress value={progress} className="mt-4" />}
            {status === 'success' && <p className="mt-4 text-sm text-emerald-500">{t.ingestSuccess}</p>}
            {status === 'error' && <p className="mt-4 text-sm text-red-500">{t.ingestError}</p>}
          </Card>
        </TabsContent>

        {/* Tab 2: 知识条目 */}
        <TabsContent value="entries">
          <Card className={cn('p-5', cls('bg-white', 'bg-[#1c1c1f]'))}>
            <h2 className="text-lg font-bold mb-4">{t.entriesTitle} ({entries.length})</h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {entries.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className={cn('w-12 h-12 mx-auto mb-3', cls('text-gray-300', 'text-zinc-600'))} />
                  <p className={cn('text-sm', cls('text-gray-500', 'text-zinc-400'))}>
                    暂无资料，请在「{t.enterpriseProfile ?? '企业资料'}」中录入
                  </p>
                </div>
              ) : (
                entries.map((entry) => {
                  const statusInfo = statusBadgeMap[entry.status] ?? { label: entry.status, variant: 'secondary' as const };
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        'p-3 rounded-lg border flex items-start justify-between',
                        cls('bg-gray-50 border-gray-100', 'bg-zinc-800/50 border-zinc-700/50'),
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-sm truncate">{entry.title}</h3>
                          <Badge variant={statusInfo.variant} className="text-xs">
                            {statusInfo.label}
                          </Badge>
                        </div>
                        <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                          {entry.source_type === 'text' ? '文本' : `文件: ${entry.source_file_path?.split('/').pop()}`}
                          {' · '}
                          {entry.created_at}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteEntry(entry)} className="shrink-0">
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Tab 3: 事实审核 */}
        <TabsContent value="facts">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Tabs value={factStatusFilter} onValueChange={(v) => setFactStatusFilter(v as FactStatus | 'all')}>
                <TabsList className="flex-wrap">
                  <TabsTrigger value="all">{t.factReviewAll}</TabsTrigger>
                  {FACT_STATUS_OPTIONS.map((s) => (
                    <TabsTrigger key={s} value={s}>{factStatusLabel(t, s)}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" onClick={handleExtractAuto} disabled={extracting}>
                {extracting ? t.factReviewExtracting : t.factReviewExtract}
              </Button>
            </div>

            {missingFields.length > 0 || riskWarnings.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className={cn('p-4', cls('bg-white', 'bg-[#1c1c1f]'))}>
                  <CardHeader className="pb-2 p-0">
                    <CardTitle className="text-sm font-semibold">{t.factReviewMissingFields}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 pt-2">
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
                <Card className={cn('p-4', cls('bg-white', 'bg-[#1c1c1f]'))}>
                  <CardHeader className="pb-2 p-0">
                    <CardTitle className="text-sm font-semibold">{t.factReviewRiskWarnings}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 pt-2">
                    {riskWarnings.length === 0 ? (
                      <p className={cn('text-sm', cls('text-gray-500', 'text-zinc-400'))}>无</p>
                    ) : (
                      <ul className="space-y-2">
                        {riskWarnings.map((w, i) => (
                          <li key={i} className={cn('text-sm', cls('text-amber-600', 'text-amber-400'))}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {extracting ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : filteredFacts.length === 0 ? (
              <div className={cn('text-center py-16', cls('text-gray-500', 'text-zinc-400'))}>
                <p className="text-lg font-medium">{t.factReviewEmpty}</p>
                <p className="text-sm mt-1">{t.factReviewEmptyDesc}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
                <div className="space-y-3">
                  {filteredFacts.map((fact) => (
                    <FactCard
                      key={fact.id}
                      fact={fact}
                      typeLabel={getFactTypeLabel(fact.fact_type)}
                      selected={selectedFact?.id === fact.id}
                      onSelect={() => setSelectedFact(fact)}
                      onConfirm={() => handleConfirmFact(fact)}
                      onReject={() => handleRejectFact(fact)}
                      onModify={(value) => handleModifyFact(fact, value)}
                    />
                  ))}
                </div>
                <div>
                  {selectedFact ? (
                    <FactSourcePreview
                      fact={selectedFact}
                      chunkText={sourceChunkText}
                      typeLabel={getFactTypeLabel(selectedFact.fact_type)}
                    />
                  ) : (
                    <Card className={cn('p-6 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
                      <p className={cn('text-sm', cls('text-gray-500', 'text-zinc-400'))}>
                        选择左侧事实查看来源片段
                      </p>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
