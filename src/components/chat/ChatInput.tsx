'use client';

import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '@/hooks/use-theme';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  X,
  Send,
  FolderOpen,
  ChevronDown,
} from 'lucide-react';
import type { UploadedFile } from '@/lib/file-upload';
import { getFileIconAndColor, formatFileSize } from '@/lib/file-upload';
import type { Project } from '@/types/domain';
import { toast } from '@/lib/toast';

/** #92: 文件大小限制（字节） */
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB

/** #92: Chat 附件支持的 MIME 类型 */
function isSupportedFileType(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  if (file.type === 'text/plain') return true;
  if (file.type === 'text/markdown' || file.type === 'text/x-markdown') return true;
  // 无 MIME 的文件（例如 .md 在某些系统上）通过扩展名判断
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return true;
  return false;
}

interface ChatInputProps {
  inputText: string;
  onInputChange: (value: string) => void;
  onSubmit: (message: { text: string; files: unknown[] }) => void;
  uploadedFiles: UploadedFile[];
  onFileUpload: (files: UploadedFile[]) => void;
  onRemoveFile: (id: string) => void;
  isLoading: boolean;
  isStreaming?: boolean;
  onStop: () => void;
  selectedProject?: string;
  onProjectChange?: (project: string) => void;
  projectList?: Project[];
  getProjectColor?: (name: string) => string;
  /** @deprecated Use selectedProject instead */
  selectedTeam?: string;
  /** @deprecated Use onProjectChange instead */
  onTeamChange?: (team: string) => void;
  /** @deprecated Use projectList instead */
  teamList?: string[];
  /** @deprecated Use getProjectColor instead */
  getTeamColor?: (name: string) => string;
  selectedModel: string;
  onModelChange: (model: string) => void;
  modelList: string[];
}

export default function ChatInput({
  inputText,
  onInputChange,
  onSubmit,
  uploadedFiles,
  onFileUpload,
  onRemoveFile,
  isLoading,
  isStreaming,
  onStop,
  selectedProject,
  onProjectChange,
  projectList,
  getProjectColor,
  selectedTeam,
  onTeamChange,
  teamList,
  getTeamColor,
  selectedModel,
  onModelChange,
  modelList,
}: ChatInputProps) {
  const { t, cls } = useTheme();

  const effectiveSelectedProject = selectedProject || selectedTeam || '';
  const effectiveOnProjectChange = onProjectChange || onTeamChange;
  const effectiveProjectList =
    projectList && projectList.length > 0
      ? projectList
      : (teamList?.map((name, idx) => ({
          id: -idx,
          name,
          description: null,
          created_at: '',
          updated_at: '',
        })) ?? []);
  const effectiveGetProjectColor = getProjectColor || getTeamColor || (() => '#0070F3');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasContent = inputText.trim().length > 0 || uploadedFiles.length > 0;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        140,
      )}px`;
    }
  }, [inputText]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const fileList = Array.from(files);

    // #92: 过滤不支持的文件类型
    const unsupportedFiles = fileList.filter((f) => !isSupportedFileType(f));
    for (const f of unsupportedFiles) {
      toast.warning(t.chatFileTypeUnsupported);
    }
    const supportedFiles = fileList.filter((f) => isSupportedFileType(f));

    // #92: 单文件大小限制（> 10MB 跳过）
    const oversizedFiles = supportedFiles.filter((f) => f.size > MAX_SINGLE_FILE_BYTES);
    for (const f of oversizedFiles) {
      toast.warning(t.chatFileTooLarge.replace('{name}', f.name));
    }
    const sizeOkFiles = supportedFiles.filter((f) => f.size <= MAX_SINGLE_FILE_BYTES);

    // #92: 总大小限制（> 20MB 时只保留前 N 个不超出限制的文件）
    let totalBytes = 0;
    const withinTotalFiles: File[] = [];
    for (const f of sizeOkFiles) {
      if (totalBytes + f.size > MAX_TOTAL_BYTES) {
        toast.warning(t.chatFilesTotalTooLarge);
        break;
      }
      totalBytes += f.size;
      withinTotalFiles.push(f);
    }

    if (withinTotalFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // #91: 用 FileReader 读取每个文件为 base64 data URL，填入 UploadedFile.content，
    // 为后续 IPC 透传 → multipart HumanMessage 全链路做准备。
    const newFiles: UploadedFile[] = await Promise.all(
      withinTotalFiles.map(
        (file) =>
          new Promise<UploadedFile>((resolve, reject) => {
            const isImage = file.type.startsWith('image/');
            const url = isImage ? URL.createObjectURL(file) : undefined;
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: Math.random().toString(36).substring(2, 9),
                name: file.name,
                bytes: file.size,
                type: file.type,
                url,
                content: reader.result as string,
              });
            };
            reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
            reader.readAsDataURL(file);
          }),
      ),
    );

    onFileUpload(newFiles);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`
      w-full rounded-3xl border p-3 md:p-4 flex flex-col gap-2.5
      transition-colors duration-200
      ${cls(
        'bg-transparent border-gray-200/60 focus-within:border-primary/40',
        'bg-transparent border-white/[0.08] focus-within:border-primary/40'
      )}
    `}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        onChange={handleFileChange}
      />

      {uploadedFiles.length > 0 && (
        <motion.div layout className="flex flex-wrap gap-2 px-0.5">
          <AnimatePresence>
            {uploadedFiles.map((file) => {
              const isImage = file.type.startsWith('image/');
              const fileStyle = getFileIconAndColor(file.name, file.type, cls);
              return (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, scale: 0.9, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className={`
                    flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl text-xs
                    border transition-colors
                    ${fileStyle.bgColor}
                    ${cls('text-gray-800', 'text-gray-200')}
                  `}
                >
                  {isImage && file.url ? (
                    <img
                      src={file.url}
                      alt={file.name}
                      className="w-7 h-7 rounded-lg object-cover bg-gray-200 shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/60 dark:bg-black/20 shrink-0">
                      <fileStyle.Icon className={`w-3.5 h-3.5 ${fileStyle.iconColor}`} />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-[11px] font-semibold leading-tight max-w-[120px] sm:max-w-[180px]">
                      {file.name}
                    </span>
                    <span className="text-[9px] opacity-50 font-normal leading-tight">{formatFileSize(file.bytes)}</span>
                  </div>
                  <button
                    onClick={() => onRemoveFile(file.id)}
                    className="p-1 rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-current"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}

      <PromptInput
        onSubmit={onSubmit}
        className="w-full"
        inputGroupClassName="border-0 !bg-transparent dark:!bg-transparent shadow-none rounded-none has-[[data-slot=input-group-control]:focus-visible]:ring-0"
      >
        <PromptInputTextarea
          placeholder={t.chatPlaceholder}
          value={inputText}
          onChange={(e) => onInputChange(e.currentTarget.value)}
          ref={textareaRef}
          className="min-h-[44px] max-h-[140px] px-1 py-2 text-[15px] leading-relaxed !bg-transparent dark:!bg-transparent border-0 focus-visible:ring-0 placeholder:text-muted-foreground/50 resize-none"
        />

        <PromptInputFooter className="justify-between items-center pt-2">
          <PromptInputTools className="items-center gap-1">
            <PromptInputButton
              type="button"
              tooltip={t.addFiles}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full size-10 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground transition-colors"
            >
              <Plus className="w-5 h-5 shrink-0" strokeWidth={1.8} />
            </PromptInputButton>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <PromptInputButton
                  type="button"
                  tooltip={t.chatProjectSelector}
                  className="rounded-full h-9 px-3 gap-2 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground transition-colors"
                >
                  <FolderOpen className="w-4 h-4 shrink-0 text-primary" strokeWidth={1.8} />
                  <span className="text-sm font-medium max-w-[100px] truncate">
                    {effectiveSelectedProject || t.chatCurrentProject}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" strokeWidth={2} />
                </PromptInputButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-64 rounded-2xl p-2 max-h-[300px] overflow-y-auto">
                {effectiveProjectList.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => effectiveOnProjectChange?.(project.name)}
                    className="rounded-xl px-3 py-2.5 gap-3 cursor-pointer"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: effectiveGetProjectColor(project.name) }}
                    />
                    <span className="text-sm font-medium flex-1 truncate">{project.name}</span>
                    {effectiveSelectedProject === project.name && (
                      <span className="text-xs text-primary font-semibold">✓</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </PromptInputTools>

          <PromptInputTools className="items-center gap-1.5">
            <div className="rounded-full h-9 px-3 flex items-center gap-2 text-sm font-medium text-muted-foreground select-none">
              Auto
            </div>

            <PromptInputSubmit
              status={isStreaming ? 'streaming' : isLoading ? 'submitted' : 'ready'}
              onStop={onStop}
              disabled={!hasContent && !isLoading && !isStreaming}
              className={`
                rounded-full size-10 transition-all duration-200
                ${hasContent || isLoading || isStreaming
                  ? 'bg-primary text-white hover:bg-primary/90 shadow-sm'
                  : 'bg-transparent text-muted-foreground'}
              `}
            >
              <Send className="w-5 h-5" strokeWidth={1.8} />
            </PromptInputSubmit>
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
