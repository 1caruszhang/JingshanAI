import {
  FileText,
  FileSpreadsheet,
  Presentation,
  PenLine,
  Image as ImageIcon,
  File as FileIcon,
} from 'lucide-react';

export interface UploadedFile {
  id: string;
  name: string;
  size: string;
  type: string;
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'fact_review' | 'text';
  facts?: Array<{
    id: number;
    fact_type: string;
    fact_key: string;
    fact_value: string | null;
    confidence: number;
    source_quote: string | null;
    status: string;
  }>;
  sources?: Array<{
    chunkId: number;
    entryId: number;
    entryTitle: string;
    chunkText: string;
    chunkIndex: number;
    sourceType: string | null;
    sourceFilePath: string | null;
  }>;
}

/**
 * 根据文件名和 MIME 类型返回对应的图标组件、图标颜色以及背景/边框样式。
 * @param fileName - 文件名（含扩展名）
 * @param fileType - MIME 类型
 * @param cls - 主题切换辅助函数
 */
export function getFileIconAndColor(
  fileName: string,
  fileType: string,
  cls: (light: string, dark: string) => string
) {
  const ext = fileName.split('.').pop()?.toLowerCase();

  // PDF
  if (ext === 'pdf' || fileType === 'application/pdf') {
    return {
      Icon: FileText,
      iconColor: 'text-rose-500 dark:text-rose-400',
      bgColor: cls('bg-rose-50/70 border-rose-100/70', 'bg-rose-500/10 border-rose-500/20'),
    };
  }

  // Word
  if (
    ext === 'doc' ||
    ext === 'docx' ||
    fileType === 'application/msword' ||
    fileType.includes('word') ||
    fileType.includes('officedocument.wordprocessingml')
  ) {
    return {
      Icon: FileText,
      iconColor: 'text-blue-500 dark:text-blue-400',
      bgColor: cls('bg-blue-50/70 border-blue-100/70', 'bg-blue-500/10 border-blue-500/20'),
    };
  }

  // Excel
  if (
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv' ||
    fileType.includes('excel') ||
    fileType.includes('spreadsheet') ||
    fileType.includes('csv') ||
    fileType.includes('officedocument.spreadsheetml')
  ) {
    return {
      Icon: FileSpreadsheet,
      iconColor: 'text-emerald-500 dark:text-emerald-400',
      bgColor: cls('bg-emerald-50/70 border-emerald-100/70', 'bg-emerald-500/10 border-emerald-500/20'),
    };
  }

  // PPT
  if (
    ext === 'ppt' ||
    ext === 'pptx' ||
    fileType.includes('powerpoint') ||
    fileType.includes('presentation') ||
    fileType.includes('officedocument.presentationml')
  ) {
    return {
      Icon: Presentation,
      iconColor: 'text-amber-500 dark:text-amber-400',
      bgColor: cls('bg-amber-50/70 border-amber-100/70', 'bg-amber-500/10 border-amber-500/20'),
    };
  }

  // Markdown
  if (
    ext === 'md' ||
    ext === 'markdown' ||
    fileType === 'text/markdown' ||
    fileType === 'text/x-markdown'
  ) {
    return {
      Icon: PenLine,
      iconColor: 'text-purple-500 dark:text-purple-400',
      bgColor: cls('bg-purple-50/70 border-purple-100/70', 'bg-purple-500/10 border-purple-500/20'),
    };
  }

  // Image
  if (fileType.startsWith('image/')) {
    return {
      Icon: ImageIcon,
      iconColor: 'text-teal-500 dark:text-[#27DAB7]',
      bgColor: cls('bg-teal-50/70 border-teal-100/70', 'bg-[#27DAB7]/10 border-[#27DAB7]/20'),
    };
  }

  // Default
  return {
    Icon: FileIcon,
    iconColor: 'text-gray-500 dark:text-gray-400',
    bgColor: cls('bg-gray-50/70 border-gray-100/70', 'bg-white/5 border-white/5'),
  };
}

/**
 * 将文件大小（字节）格式化为人类可读字符串。
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
