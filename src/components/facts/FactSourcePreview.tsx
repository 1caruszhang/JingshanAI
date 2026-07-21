import {useTheme} from '../../hooks/use-theme';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {cn} from '../../lib/utils';
import type {EnterpriseFact} from '../../types/domain';

interface FactSourcePreviewProps {
  fact: EnterpriseFact;
  chunkText: string | null;
  typeLabel: string;
}

export default function FactSourcePreview({fact, chunkText, typeLabel}: FactSourcePreviewProps) {
  const {t, cls} = useTheme();

  const highlighted = chunkText
    ? highlightQuote(chunkText, fact.source_quote)
    : fact.source_quote ?? t.factReviewNoSource;

  return (
    <Card className={cls('border-0 shadow-none', 'bg-transparent')}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{t.factReviewSource}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{typeLabel}</Badge>
          {fact.source_chunk_id && (
            <Badge variant="outline">chunk #{fact.source_chunk_id}</Badge>
          )}
        </div>
        <div
          className={cn(
            'text-sm leading-relaxed whitespace-pre-wrap p-3 rounded-xl',
            cls('bg-white border border-gray-200/60 text-gray-700', 'bg-zinc-900/40 border-zinc-800 text-zinc-300'),
          )}
          dangerouslySetInnerHTML={{__html: highlighted}}
        />
      </CardContent>
    </Card>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightQuote(chunkText: string, quote: string | null): string {
  const escaped = escapeHtml(chunkText);
  if (!quote) return escaped;
  const escapedQuote = escapeHtml(quote);
  const idx = escaped.indexOf(escapedQuote);
  if (idx === -1) return escaped;
  return (
    escaped.slice(0, idx) +
    `&lt;mark class="bg-primary/20 text-inherit rounded px-0.5"&gt;${escapedQuote}&lt;/mark&gt;` +
    escaped.slice(idx + escapedQuote.length)
  );
}
