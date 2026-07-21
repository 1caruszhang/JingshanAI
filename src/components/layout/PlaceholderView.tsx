import { FolderOpen } from 'lucide-react';
import { useTheme } from '../../hooks/use-theme';
import { EmptyState } from '../ui/empty-state';

export default function PlaceholderView() {
  const { t } = useTheme();
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <EmptyState icon={<FolderOpen className="w-10 h-10" />} title={t.emptyTitle} description={t.emptyDesc} />
    </div>
  );
}
