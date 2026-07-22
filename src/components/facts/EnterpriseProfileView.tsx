/**
 * EnterpriseProfileView.tsx
 * Enterprise profile form (Phase 6).
 * Users fill in 14 fact fields, select a project, then submit to trigger
 * ontology fact extraction, navigating to FactReviewView on success.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '../../lib/utils';
import { useTheme } from '../../hooks/use-theme';
import { useAppState } from '../../context/AppStateContext';
import { useView } from '../../context/ViewContext';
import { toast } from '../../lib/toast';
import { factApi } from '../../lib/electron-api';
import { projectService } from '../../services/projectService';
import {
  FACT_TYPES,
  FACT_TYPE_LABELS,
  HIGH_RISK_FACT_TYPES,
  REQUIRED_FACT_TYPES_FOR_ARTICLE,
} from '../../types/domain';
import type { Project } from '../../types/domain';

export default function EnterpriseProfileView() {
  const { t, cls } = useTheme();
  const { currentProject, setCurrentProject } = useAppState();
  const { navigateTo } = useView();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    currentProject ? String(currentProject.id) : ''
  );
  const [formValues, setFormValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FACT_TYPES.map((ft) => [ft, '']))
  );
  const [loading, setLoading] = useState(false);

  // Load projects list
  useEffect(() => {
    projectService.getAll().then((data) => {
      setProjects(data);
    });
  }, []);

  // Keep selectedProjectId in sync when currentProject changes externally
  useEffect(() => {
    if (currentProject && !selectedProjectId) {
      setSelectedProjectId(String(currentProject.id));
    }
  }, [currentProject, selectedProjectId]);

  const handleFieldChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleProjectChange = (value: string) => {
    setSelectedProjectId(value);
    const project = projects.find((p) => String(p.id) === value) ?? null;
    setCurrentProject(project);
  };

  const handleSubmit = async () => {
    if (!selectedProjectId) {
      toast.error(t.enterpriseProfileNoProject ?? '请先选择一个企业项目');
      return;
    }

    // Collect non-empty fields
    const formInputs: Record<string, string> = {};
    for (const ft of FACT_TYPES) {
      const val = formValues[ft]?.trim();
      if (val) {
        formInputs[ft] = val;
      }
    }

    setLoading(true);
    try {
      const result = await factApi.extract({
        projectId: Number(selectedProjectId),
        mode: 'ontology',
        formInputs,
      });

      if (result.warnings && result.warnings.length > 0) {
        toast.error(
          (t.enterpriseProfileWarnings ?? '部分字段存在风险提示') +
            ': ' +
            result.warnings.join('；')
        );
      }

      navigateTo('factReview', { projectId: Number(selectedProjectId) });
    } catch (err) {
      toast.error(
        t.enterpriseProfileSubmitError ?? '提交失败',
        err instanceof Error ? err.message : undefined
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Page header */}
        <div>
          <h1 className={cn('text-xl font-bold', cls('text-gray-900', 'text-white'))}>
            {t.enterpriseProfile ?? '企业资料'}
          </h1>
          <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
            {t.enterpriseProfileSubtitle ?? '填写企业基础信息，提交后将自动生成结构化事实，并进入事实审核页面。'}
          </p>
        </div>

        {/* Project selector */}
        <Card className={cls('border-gray-200/60', 'border-zinc-800')}>
          <CardHeader className="pb-3">
            <CardTitle className={cn('text-sm font-semibold', cls('text-gray-700', 'text-zinc-300'))}>
              {t.enterpriseProfileSelectProject ?? '选择企业项目'}{' '}
              <span className="text-red-500 ml-0.5">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedProjectId} onValueChange={handleProjectChange}>
              <SelectTrigger
                className={cn(
                  'w-full',
                  cls('border-gray-200', 'border-zinc-700 bg-zinc-800/50')
                )}
              >
                <SelectValue
                  placeholder={t.chatProjectSelector ?? '选择项目'}
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Fact fields */}
        <Card className={cls('border-gray-200/60', 'border-zinc-800')}>
          <CardHeader className="pb-3">
            <CardTitle className={cn('text-sm font-semibold', cls('text-gray-700', 'text-zinc-300'))}>
              {t.enterpriseProfileFields ?? '企业信息字段'}
            </CardTitle>
            <p className={cn('text-xs mt-1', cls('text-gray-400', 'text-zinc-500'))}>
              {t.enterpriseProfileFieldsHint ?? '带 * 为推荐填写字段；带 ⚠ 的高风险字段，AI 补全时请仔细核实。'}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {FACT_TYPES.map((ft) => {
              const isRequired = (REQUIRED_FACT_TYPES_FOR_ARTICLE as string[]).includes(ft);
              const isHighRisk = HIGH_RISK_FACT_TYPES.has(ft);
              const label = FACT_TYPE_LABELS[ft];

              return (
                <div key={ft} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`field-${ft}`}
                      className={cn(
                        'text-sm font-medium',
                        cls('text-gray-700', 'text-zinc-300')
                      )}
                    >
                      {label}
                      {isRequired && (
                        <span className="text-red-500 ml-0.5">*</span>
                      )}
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
                    id={`field-${ft}`}
                    value={formValues[ft] ?? ''}
                    onChange={(e) => handleFieldChange(ft, e.target.value)}
                    placeholder={`请输入${label}...`}
                    className={cn(
                      cls('border-gray-200', 'border-zinc-700 bg-zinc-800/50')
                    )}
                    disabled={loading}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Submit button */}
        <div className="flex justify-end pb-8">
          <Button
            onClick={handleSubmit}
            disabled={loading || !selectedProjectId}
            className="min-w-[120px]"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner className="w-4 h-4" />
                {t.enterpriseProfileSubmitting ?? '提交中…'}
              </span>
            ) : (
              (t.enterpriseProfileSubmit ?? '提交并抽取事实')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
