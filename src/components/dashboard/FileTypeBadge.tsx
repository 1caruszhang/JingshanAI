/**
 * #104: Colored file-type badge for KB assets.
 *
 * Renders a shadcn Badge tinted per file type, with a matching lucide icon.
 * Used by the dashboard KbHealthPanel asset list and the KbIngestPanel entries
 * tab so the two surfaces stay visually aligned.
 *
 * Color mapping (spec #104):
 *   - pdf   → red
 *   - docx  → blue
 *   - image → purple
 *   - text  → gray (manual paste, Pencil icon)
 *   - unknown file extension → neutral gray "文件/File" badge
 */
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/use-theme';
import { FileText, FileType2, File as FileIcon, Image as ImageIcon, Pencil } from 'lucide-react';
import type { FileType } from '@/lib/fileType';

interface FileTypeBadgeProps {
  fileType?: FileType;
  sourceType?: 'text' | 'file';
}

type Bucket = FileType | 'unknown';

type StyleEntry = { light: string; dark: string; Icon: typeof FileText };

/**
 * Per-type class strings, split into light/dark halves so the active theme is
 * picked via `cls` — matching the codebase convention (AGENTS.md: "通过
 * useTheme 的 cls 处理亮暗模式").
 */
const TYPE_STYLES: Record<Bucket, StyleEntry> = {
  pdf: {
    light: 'bg-rose-50 text-rose-600 border-rose-200',
    dark: 'bg-rose-950/30 text-rose-400 border-rose-900/40',
    Icon: FileType2,
  },
  docx: {
    light: 'bg-blue-50 text-blue-600 border-blue-200',
    dark: 'bg-blue-950/30 text-blue-400 border-blue-900/40',
    Icon: FileText,
  },
  image: {
    light: 'bg-purple-50 text-purple-600 border-purple-200',
    dark: 'bg-purple-950/30 text-purple-400 border-purple-900/40',
    Icon: ImageIcon,
  },
  text: {
    light: 'bg-gray-100 text-gray-600 border-gray-200',
    dark: 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50',
    Icon: FileText,
  },
  unknown: {
    light: 'bg-gray-100 text-gray-500 border-gray-200',
    dark: 'bg-zinc-800/50 text-zinc-500 border-zinc-700/50',
    Icon: FileIcon,
  },
};

const LABEL_KEY: Record<Bucket, 'kbAssetTypePdf' | 'kbAssetTypeDocx' | 'kbAssetTypeImage' | 'kbAssetTypeText' | 'kbAssetTypeUnknown'> = {
  pdf: 'kbAssetTypePdf',
  docx: 'kbAssetTypeDocx',
  image: 'kbAssetTypeImage',
  text: 'kbAssetTypeText',
  unknown: 'kbAssetTypeUnknown',
};

/**
 * Badge for a single asset's type. A manually-pasted text entry
 * (`sourceType === 'text'`) always shows the gray "手动输入/Manual" badge with
 * a Pencil icon, regardless of `fileType`. File entries with an unknown/absent
 * extension render a neutral "文件/File" badge rather than being mislabeled as
 * text.
 */
export function FileTypeBadge({ fileType, sourceType }: FileTypeBadgeProps) {
  const { cls, t } = useTheme();

  if (sourceType === 'text') {
    const style = TYPE_STYLES.text;
    return (
      <Badge variant="outline" className={cn('text-[10px] gap-0.5 px-1.5', cls(style.light, style.dark))}>
        <Pencil className="w-2.5 h-2.5" />
        {t.kbAssetTypeManual}
      </Badge>
    );
  }

  const resolved: Bucket = fileType ?? 'unknown';
  const style = TYPE_STYLES[resolved];
  const Icon = style.Icon;
  return (
    <Badge variant="outline" className={cn('text-[10px] gap-0.5 px-1.5', cls(style.light, style.dark))}>
      <Icon className="w-2.5 h-2.5" />
      {t[LABEL_KEY[resolved]]}
    </Badge>
  );
}

export type { FileType };
