import {useState, useRef, useEffect, useCallback} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Progress} from '@/components/ui/progress';
import {dialogApi} from '@/lib/electron-api';
import {useTheme} from '@/hooks/use-theme';
import {useView} from '@/context/ViewContext';
import {useAppState} from '@/context/AppStateContext';
import {projectService} from '@/services/projectService';
import {knowledgeBaseService} from '@/services/knowledgeBaseService';
import {triggerAutoExtract} from '@/services/factAutoExtract';
import {toast} from '@/lib/toast';
import {cn} from '@/lib/utils';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {
  Upload,
  FileText,
  X,
  Sparkles,
  ArrowRight,
  Loader2,
  Building2,
  MapPin,
  Tag,
  Briefcase,
  Phone,
} from 'lucide-react';

interface SelectedFile {
  path: string;
  name: string;
}

const formFields = [
  {key: 'companyName', label: '公司名称', icon: Building2, placeholder: '如：阿里巴巴（中国）有限公司'},
  {key: 'industry', label: '所属行业', icon: Briefcase, placeholder: '如：电子商务、云计算、人工智能'},
  {key: 'mainBusiness', label: '主营业务', icon: Briefcase, placeholder: '如：电商平台、云服务、金融科技'},
  {key: 'address', label: '公司地址', icon: MapPin, placeholder: '如：杭州市余杭区文一西路969号'},
  {key: 'keywords', label: '关键词', icon: Tag, placeholder: '如：B2B、跨境电商、数字贸易'},
  {key: 'contact', label: '联系方式', icon: Phone, placeholder: '如：400-800-8888'},
];

export default function KbCreateView() {
  const {cls, t} = useTheme();
  const {navigateTo, viewParams} = useView();
  const {setCurrentProject, triggerRefreshProjects} = useAppState();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resetRef = useRef(false);

  const [step, setStep] = useState<1 | 2>(1);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [domain, setDomain] = useState<'local_service' | 'saas' | 'ecommerce' | ''>('');
  const [textContent, setTextContent] = useState('');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 新建项目时重置为初始状态
  useEffect(() => {
    if (viewParams.reset === true && !resetRef.current) {
      resetRef.current = true;
      setStep(1);
      setFiles([]);
      setFormData({});
      setDomain('');
      setTextContent('');
      setProgress(0);
      setStatusMessage('');
      setError(null);
      navigateTo('kbCreate', {reset: false});
    }
  }, [viewParams.reset, navigateTo]);

  // 记录 reset 参数已被消费，避免非 reset 场景重复触发
  useEffect(() => {
    if (viewParams.reset !== true) {
      resetRef.current = false;
    }
  }, [viewParams.reset]);

  const projectName = formData.companyName?.trim() || '未命名项目';
  const projectDescription = [formData.industry, formData.mainBusiness]
    .filter(Boolean)
    .join(' · ') || null;

  const hasInput =
    files.length > 0 ||
    textContent.trim().length > 0 ||
    Object.values(formData).some((v) => v?.trim());

  const handleFileSelect = async () => {
    const paths = await dialogApi.openFile({
      multiple: true,
      filters: [
        {name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt', 'md', 'markdown']},
        {name: 'All files', extensions: ['*']},
      ],
    });
    if (!paths) return;
    const newFiles = paths.map((path) => ({
      path,
      name: path.split(/[\\/]/).pop() ?? path,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleInputChange = (key: string, value: string) => {
    setFormData((prev) => ({...prev, [key]: value}));
  };

  const runIngestion = useCallback(async () => {
    setStep(2);
    setProgress(10);
    setStatusMessage('正在创建项目...');
    setError(null);

    try {
      const projectId = await projectService.create({
        name: projectName,
        description: projectDescription,
        domain: domain || null,
      });
      setProgress(20);

      const entries: {title: string; type: 'text' | 'file'; value: string}[] = [];

      // Ingest form fields as text entries
      for (const {key, label} of formFields) {
        const value = formData[key]?.trim();
        if (value) {
          entries.push({title: label, type: 'text', value});
        }
      }

      if (textContent.trim()) {
        entries.push({title: '补充文本资料', type: 'text', value: textContent.trim()});
      }

      for (const file of files) {
        entries.push({title: file.name, type: 'file', value: file.path});
      }

      const total = entries.length;
      let completed = 0;

      for (const entry of entries) {
        setStatusMessage(`正在录入：${entry.title}...`);
        if (entry.type === 'text') {
          await knowledgeBaseService.ingestText(projectId, entry.title, entry.value);
        } else {
          await knowledgeBaseService.ingestFile(projectId, entry.title, entry.value);
        }
        completed++;
        setProgress(20 + Math.round((completed / total) * 70));
      }

      setProgress(100);

      // 激活项目并直接进入知识库（事实审核归入 kbIngest）
      await projectService.update(projectId, {status: 'active'});
      const project = await projectService.getById(projectId);
      if (project) {
        setCurrentProject(project);
      }
      triggerRefreshProjects();

      // #105: 所有条目索引完成后、导航前，自动触发一次全量事实抽取。
      // 抽取失败不影响上传结果——只通过 toast 提示可手动重试。
      setStatusMessage(t.kbAutoExtracting ?? '正在自动抽取企业事实...');
      await triggerAutoExtract(projectId, {
        onFailure: (message) => toast.error(t.kbAutoExtractFailed ?? message),
      });

      navigateTo('kbIngest', {projectId});
    } catch (err) {
      console.error('Ingestion failed:', err);
      setError(err instanceof Error ? err.message : '创建失败');
      setStep(1);
    }
  }, [domain, formData, files, navigateTo, projectDescription, projectName, setCurrentProject, t, textContent, triggerRefreshProjects]);

  const renderStep1 = () => (
    <div className="space-y-6">
      <Card className={cn('p-6', cls('bg-white', 'bg-[#1c1c1f]'))}>
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          企业基础信息
          <span className={cn('text-xs font-normal', cls('text-gray-500', 'text-zinc-400'))}>（至少填写公司名称）</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {formFields.map(({key, label, icon: Icon, placeholder}) => (
            <div key={key}>
              <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {label}
              </label>
              <Input
                value={formData[key] ?? ''}
                onChange={(e) => handleInputChange(key, e.target.value)}
                placeholder={placeholder}
              />
            </div>
          ))}
          <div>
            <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5" />
              业务领域
              <span className={cn('text-xs font-normal', cls('text-gray-400', 'text-zinc-500'))}>(可选)</span>
            </label>
            <Select value={domain} onValueChange={(v) => setDomain(v as typeof domain)}>
              <SelectTrigger>
                <SelectValue placeholder="未设置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">未设置</SelectItem>
                <SelectItem value="local_service">本地服务</SelectItem>
                <SelectItem value="saas">SaaS</SelectItem>
                <SelectItem value="ecommerce">电商</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className={cn('p-6', cls('bg-white', 'bg-[#1c1c1f]'))}>
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary" />
          上传企业资料
        </h3>
        <div
          onClick={handleFileSelect}
          className={cn(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
            cls(
              'border-gray-200 hover:border-primary bg-gray-50/50',
              'border-zinc-700 hover:border-primary bg-zinc-800/30'
            ),
          )}
        >
          <Upload className={cn('w-10 h-10 mx-auto mb-3', cls('text-gray-400', 'text-zinc-500'))} />
          <p className="text-sm font-medium">点击上传附件</p>
          <p className={cn('text-xs mt-1', cls('text-gray-500', 'text-zinc-400'))}>
            支持 PDF、Word、TXT、Markdown，可多选
          </p>
        </div>

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map((file, index) => (
              <div
                key={index}
                className={cn(
                  'flex items-center justify-between p-3 rounded-lg border',
                  cls('bg-gray-50 border-gray-100', 'bg-zinc-800/50 border-zinc-700/50'),
                )}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-sm truncate max-w-[300px]">{file.name}</span>
                </div>
                <button
                  onClick={() => handleRemoveFile(index)}
                  className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  <X className="w-4 h-4 text-red-500" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className={cn('p-6', cls('bg-white', 'bg-[#1c1c1f]'))}>
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          补充文本资料
        </h3>
        <Textarea
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          placeholder="在此粘贴企业介绍、产品说明、FAQ 等文本..."
          rows={6}
        />
      </Card>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={runIngestion}
          disabled={!hasInput || !formData.companyName?.trim()}
          className="gap-2"
        >
          <Sparkles className="w-4 h-4" />
          创建项目并录入
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <Card className={cn('p-12 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
      <h3 className="text-xl font-bold mb-2">正在创建企业知识库</h3>
      <p className={cn('text-sm mb-6', cls('text-gray-500', 'text-zinc-400'))}>
        {statusMessage}
      </p>
      <div className="max-w-md mx-auto">
        <Progress value={progress} className="mb-2" />
        <p className="text-sm font-medium">{progress}%</p>
      </div>
    </Card>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">创建企业知识库</h1>
        <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
          填写企业信息并上传资料，系统将自动建立项目与知识库，完成后进入知识库审核。
        </p>
      </div>

      <div className="flex items-center gap-2 mb-8">
        {[
          {num: 1, label: '填写资料'},
          {num: 2, label: '创建录入'},
        ].map((s) => (
          <div key={s.num} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                step >= s.num
                  ? 'bg-primary/10 text-primary'
                  : cls('bg-gray-100 text-gray-500', 'bg-zinc-800 text-zinc-500'),
              )}
            >
              <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
                {s.num}
              </span>
              {s.label}
            </div>
            {s.num < 2 && <ArrowRight className="w-4 h-4 text-gray-300 dark:text-zinc-700" />}
          </div>
        ))}
      </div>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
    </div>
  );
}
