/**
 * optimize_content.ts
 *
 * Optimize content for GEO (Generative Engine Optimization) citation readiness.
 * TypeScript port of geo_skills/geo-content-optimizer/scripts/optimize_content.py.
 *
 * The optimizer is diagnostic: it inspects the content, records change
 * recommendations, and returns the (currently unmodified) text alongside the
 * changelog. Pure and deterministic — no LLM calls, no I/O.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ContentType = 'article' | 'product' | 'faq' | 'landing' | 'about';

export interface GeoOptimizationResult {
  original: string;
  optimized: string;
  /** Human-readable change recommendations, prefixed by category ("Voice: ...") */
  changes: string[];
  wordCountOriginal: number;
  wordCountOptimized: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Python-style str.split(): split on whitespace runs, dropping empties. */
function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function countMatches(re: RegExp, text: string): number {
  return (text.match(re) ?? []).length;
}

// ── Optimizer ────────────────────────────────────────────────────────────────

/**
 * Inspects content and produces type-specific plus universal optimization
 * recommendations for AI citation readiness.
 */
export class ContentOptimizer {
  private readonly original: string;
  private readonly contentType: ContentType;
  private readonly changes: string[] = [];

  constructor(content: string, contentType: ContentType = 'article') {
    this.original = content;
    this.contentType = contentType;
  }

  optimize(): GeoOptimizationResult {
    let content = this.original;

    // Apply optimizations based on content type
    switch (this.contentType) {
      case 'article':
        content = this.optimizeArticle(content);
        break;
      case 'product':
        content = this.optimizeProduct(content);
        break;
      case 'faq':
        content = this.optimizeFaq(content);
        break;
      case 'landing':
        content = this.optimizeLanding(content);
        break;
      case 'about':
        content = this.optimizeAbout(content);
        break;
    }

    // Universal optimizations
    content = this.addStructure(content);
    content = this.improveScannability(content);
    content = this.removeHedging(content);

    return {
      original: this.original,
      optimized: content,
      changes: [...this.changes],
      wordCountOriginal: splitWords(this.original).length,
      wordCountOptimized: splitWords(content).length,
    };
  }

  /** Optimize article content. */
  private optimizeArticle(content: string): string {
    const lines = content.split('\n');
    if (lines.length > 0) {
      const firstLine = lines[0];
      if (!firstLine.startsWith('#')) {
        this.changes.push('Added H1 title placeholder - please customize');
      }
    }

    this.changes.push(
      'Article optimization: Ensure lead paragraph answers the core question directly',
    );
    this.changes.push('Article optimization: Add FAQ section with 3-5 questions if not present');

    return content;
  }

  /** Optimize product page content. */
  private optimizeProduct(content: string): string {
    this.changes.push('Product optimization: Lead with one-sentence product definition');
    this.changes.push('Product optimization: Include specifications in table format');
    this.changes.push('Product optimization: Add comparison with alternatives');
    return content;
  }

  /** Optimize FAQ content. */
  private optimizeFaq(content: string): string {
    this.changes.push('FAQ optimization: Ensure answers are comprehensive (50-150 words)');
    this.changes.push('FAQ optimization: Add data points to answers');
    return content;
  }

  /** Optimize landing page content. */
  private optimizeLanding(content: string): string {
    this.changes.push('Landing optimization: Lead with clear value proposition');
    this.changes.push('Landing optimization: Include specific benefits with data');
    this.changes.push('Landing optimization: Add social proof with names/companies');
    return content;
  }

  /** Optimize about page content. */
  private optimizeAbout(content: string): string {
    this.changes.push('About optimization: Include founding date and story');
    this.changes.push('About optimization: List key milestones with dates');
    this.changes.push('About optimization: Include customer names and metrics');
    return content;
  }

  /** Add/improve header structure. */
  private addStructure(content: string): string {
    const h2Count = countMatches(/^##\s+/gm, content);
    const words = splitWords(content).length;
    const expectedH2 = Math.max(2, Math.floor(words / 400));

    if (h2Count < expectedH2) {
      this.changes.push(`Structure: Consider adding ${expectedH2 - h2Count} more H2 headers`);
    }

    return content;
  }

  /** Improve formatting for scannability. */
  private improveScannability(content: string): string {
    // Check for long paragraphs
    const paragraphs = content.split('\n\n').filter((p) => p.trim().length > 0);
    const longParagraphs = paragraphs.filter((p) => splitWords(p).length > 100).length;

    if (longParagraphs > 0) {
      this.changes.push(`Scannability: Break up ${longParagraphs} long paragraphs (>100 words)`);
    }

    // Check for lists
    const bulletCount = countMatches(/^[\s]*[-*]\s+/gm, content);
    if (bulletCount < 3 && paragraphs.length > 5) {
      this.changes.push('Scannability: Convert related items to bullet lists');
    }

    return content;
  }

  /** Identify hedging language. */
  private removeHedging(content: string): string {
    const hedgingPatterns = [
      /\bmight be\b/gi,
      /\bcould be\b/gi,
      /\bprobably\b/gi,
      /\barguably\b/gi,
      /\bto some extent\b/gi,
      /\bin our opinion\b/gi,
    ];

    const found: string[] = [];
    for (const pattern of hedgingPatterns) {
      found.push(...(content.match(pattern) ?? []));
    }

    if (found.length > 0) {
      const unique = [...new Set(found)];
      this.changes.push(`Voice: Replace hedging language: ${unique.join(', ')}`);
    }

    return content;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Inspects content and returns optimization recommendations for the given
 * content type (default 'article').
 */
export function optimizeContent(
  content: string,
  contentType: ContentType = 'article',
): GeoOptimizationResult {
  return new ContentOptimizer(content, contentType).optimize();
}

/** Renders the change list as a Markdown changelog grouped by category. */
export function generateChangelog(changes: string[]): string {
  const lines: string[] = ['# Optimization Changelog\n'];

  const categories = new Map<string, string[]>();
  for (const change of changes) {
    const idx = change.indexOf(':');
    const cat = idx === -1 ? change : change.slice(0, idx);
    const item = idx === -1 ? change : change.slice(idx + 1).trim();
    if (!categories.has(cat)) {
      categories.set(cat, []);
    }
    categories.get(cat)!.push(item);
  }

  for (const [cat, items] of categories) {
    lines.push(`## ${cat}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
