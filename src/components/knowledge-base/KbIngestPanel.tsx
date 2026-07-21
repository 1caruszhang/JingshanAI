import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { knowledgeBaseService } from '@/services/knowledgeBaseService';
import { projectService } from '@/services/projectService';
import { dialogApi } from '@/lib/electron-api';
import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/context/AppStateContext';
import { cn } from '@/lib/utils';
import type { Project, KnowledgeEntry, KnowledgeEntryStatus } from '@/types/domain';
import { Trash2, FileText, RefreshCw } from 'lucide-react';

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

export default function KbIngestPanel({ projectId }: KbIngestPanelProps) {
  const { cls, t } = useTheme();
  const { setCurrentProject } = useAppState();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'text' | 'file'>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [filePath, setFilePath] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'ingesting' | 'success' | 'error'>('idle');

  const canSubmitText = title.trim() && content.trim() && status !== 'ingesting';
  const canSubmitFile = title.trim() && filePath && status !== 'ingesting';

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
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
      }
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-2xl font-bold">{project?.name ?? '知识库'}</h1>
          {project?.description && (
            <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
              {project.description}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ingest Panel */}
        <Card className={cn('p-5', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <h2 className="text-lg font-bold mb-4">{t.ingestTitle}</h2>
          <div className="mb-4">
            <label className="text-sm font-medium mb-1.5 block">{t.entryTitle}</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.entryTitle}
            />
          </div>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'text' | 'file')}>
            <TabsList className="mb-4">
              <TabsTrigger value="text">{t.ingestTextTab}</TabsTrigger>
              <TabsTrigger value="file">{t.ingestFileTab}</TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="space-y-4">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t.ingestTextPlaceholder}
                rows={8}
              />
              <Button onClick={handleTextSubmit} disabled={!canSubmitText} className="w-full">
                {status === 'ingesting' ? t.ingestProgress : t.ingestSubmit}
              </Button>
            </TabsContent>
            <TabsContent value="file" className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  value={filePath}
                  readOnly
                  placeholder={t.ingestFileSelect}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleFileSelect}>
                  {t.ingestFileSelect}
                </Button>
              </div>
              <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                {t.ingestFileTypes}
              </p>
              <Button onClick={handleFileSubmit} disabled={!canSubmitFile} className="w-full">
                {status === 'ingesting' ? t.ingestProgress : t.ingestSubmit}
              </Button>
            </TabsContent>
          </Tabs>
          {status === 'ingesting' && <Progress value={progress} className="mt-4" />}
          {status === 'success' && (
            <p className="mt-4 text-sm text-emerald-500">{t.ingestSuccess}</p>
          )}
          {status === 'error' && (
            <p className="mt-4 text-sm text-red-500">{t.ingestError}</p>
          )}
        </Card>

        {/* Entries List */}
        <Card className={cn('p-5', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <h2 className="text-lg font-bold mb-4">{t.entriesTitle} ({entries.length})</h2>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {entries.length === 0 ? (
              <div className="text-center py-8">
                <FileText className={cn('w-12 h-12 mx-auto mb-3', cls('text-gray-300', 'text-zinc-600'))} />
                <p className={cn('text-sm', cls('text-gray-500', 'text-zinc-400'))}>
                  暂无资料，请在左侧录入
                </p>
              </div>
            ) : (
              entries.map((entry) => {
                const statusInfo = statusBadgeMap[entry.status] ?? {
                  label: entry.status,
                  variant: 'secondary',
                };
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteEntry(entry)}
                      className="shrink-0"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
