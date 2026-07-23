/**
 * analyze_content.ts
 *
 * Analyze content for GEO (Generative Engine Optimization) citation readiness.
 * TypeScript port of geo_skills/geo-content-optimizer/scripts/analyze_content.py.
 *
 * Pure, deterministic, rule-based analysis — no LLM calls, no I/O.
 * Imported and called from the Electron main process.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeoDimensionScores {
  directAnswer: number;
  entityRich: number;
  structuredFormat: number;
  factDense: number;
  faqFormatted: number;
  definitionClarity: number;
  authoritativeVoice: number;
  scannable: number;
}

export type GeoGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface GeoAnalysisReport {
  overallScore: number;
  maxScore: number;
  /** 0–100 citation-readiness percentage */
  percentage: number;
  grade: GeoGrade;
  dimensionScores: GeoDimensionScores;
  wordCount: number;
  issues: string[];
  suggestions: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Python-style str.split(): split on whitespace runs, dropping empties. */
function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function countMatches(re: RegExp, text: string): number {
  return (text.match(re) ?? []).length;
}

function toGrade(score: number, maxScore: number): GeoGrade {
  const pct = score / maxScore;
  if (pct >= 0.9) return 'A+';
  if (pct >= 0.8) return 'A';
  if (pct >= 0.7) return 'B';
  if (pct >= 0.6) return 'C';
  if (pct >= 0.5) return 'D';
  return 'F';
}

// ── Analyzer ─────────────────────────────────────────────────────────────────

/**
 * Rule-based analyzer that scores content on the 8 GEO citation signals
 * (direct answer, entity richness, structure, fact density, FAQ format,
 * definition clarity, authoritative voice, scannability).
 */
export class ContentAnalyzer {
  private readonly content: string;
  private readonly textOnly: string;
  private readonly words: string[];
  private readonly sentences: string[];

  private readonly scores: GeoDimensionScores = {
    directAnswer: 0,
    entityRich: 0,
    structuredFormat: 0,
    factDense: 0,
    faqFormatted: 0,
    definitionClarity: 0,
    authoritativeVoice: 0,
    scannable: 0,
  };

  private readonly issues: string[] = [];
  private readonly suggestions: string[] = [];

  constructor(content: string) {
    this.content = content;
    this.textOnly = content.replace(/<[^>]+>/g, '');
    this.words = splitWords(this.textOnly);
    this.sentences = this.textOnly.split(/[.!?]+/);
  }

  analyze(): GeoAnalysisReport {
    this.checkDirectAnswer();
    this.checkEntityRich();
    this.checkStructuredFormat();
    this.checkFactDense();
    this.checkFaqFormatted();
    this.checkDefinitionClarity();
    this.checkAuthoritativeVoice();
    this.checkScannable();

    const overallScore = Object.values(this.scores).reduce((a, b) => a + b, 0);
    const maxScore = Object.keys(this.scores).length * 10;

    return {
      overallScore,
      maxScore,
      percentage: Math.round((overallScore / maxScore) * 100),
      grade: toGrade(overallScore, maxScore),
      dimensionScores: {...this.scores},
      wordCount: this.words.length,
      issues: [...this.issues],
      suggestions: [...this.suggestions],
    };
  }

  /** Check if content leads with a direct answer. */
  private checkDirectAnswer(): void {
    if (this.sentences.length < 2) {
      this.issues.push('Content too short to analyze');
      return;
    }

    const firstSentence = this.sentences[0].trim();
    const firstLower = firstSentence.toLowerCase();

    // Check for throat-clearing phrases
    const weakOpeners = ['in', 'as', 'while', 'although', 'today', 'recently', 'many', 'some'];
    if (weakOpeners.some((w) => firstLower.startsWith(w))) {
      this.issues.push('Weak opening - starts with filler phrase');
      this.suggestions.push("Start with direct answer, not 'In today's world...'");
      this.scores.directAnswer = 3;
      return;
    }

    // Check for definition or direct statement
    if (
      firstSentence.includes(' is ') ||
      firstSentence.includes(' are ') ||
      firstSentence.includes(' means ')
    ) {
      this.scores.directAnswer = 8;
    } else {
      this.scores.directAnswer = 5;
      this.suggestions.push('First sentence should define or directly answer the topic');
    }
  }

  /** Check for named entities (simplified: capitalized words). */
  private checkEntityRich(): void {
    const capitalized = this.textOnly.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? [];
    const entities = capitalized.filter((e) => e.length > 2);

    const entityDensity = this.words.length > 0 ? entities.length / this.words.length : 0;

    if (entityDensity >= 0.02) {
      // 1 entity per 50 words
      this.scores.entityRich = 9;
    } else if (entityDensity >= 0.01) {
      this.scores.entityRich = 6;
      this.suggestions.push(
        `Add more named entities (brands, products, people). Current density: ${(entityDensity * 100).toFixed(1)}%`,
      );
    } else {
      this.scores.entityRich = 3;
      this.issues.push('Too few named entities');
      this.suggestions.push('Include specific brand names, products, and people in your content');
    }
  }

  /** Check for headers and structure. */
  private checkStructuredFormat(): void {
    const h2Count = countMatches(/^##\s+/gm, this.content);
    const h3Count = countMatches(/^###\s+/gm, this.content);

    // Expected headers for content length
    const expectedH2 = Math.max(2, Math.floor(this.words.length / 400));

    if (h2Count >= expectedH2) {
      this.scores.structuredFormat = 9;
    } else if (h2Count >= Math.floor(expectedH2 / 2)) {
      this.scores.structuredFormat = 6;
      this.suggestions.push(`Add more H2 headers. Target: ${expectedH2}, Current: ${h2Count}`);
    } else {
      this.scores.structuredFormat = 3;
      this.issues.push('Insufficient header structure');
      this.suggestions.push('Use H2 headers every 300-400 words to break up content');
    }

    if (h3Count < h2Count && h2Count > 3) {
      this.suggestions.push('Consider adding H3 subsections for better hierarchy');
    }
  }

  /** Check for data points and statistics. */
  private checkFactDense(): void {
    const percentages = countMatches(/\d+%/g, this.content);
    const years = countMatches(/20\d{2}/g, this.content);
    const currency = countMatches(/\$[\d,]+/g, this.content);
    const largeNumbers = countMatches(/\d{3,}/g, this.content);

    const dataPoints = percentages + years + Math.min(currency, 5) + Math.min(Math.floor(largeNumbers / 2), 5);

    // Target: 3-5 data points per 500 words
    const target = (this.words.length / 500) * 4;

    if (dataPoints >= target) {
      this.scores.factDense = 9;
    } else if (dataPoints >= target / 2) {
      this.scores.factDense = 6;
      this.suggestions.push(
        `Add more data points (percentages, dates, statistics). Target: ${Math.floor(target)}, Current: ${dataPoints}`,
      );
    } else {
      this.scores.factDense = 3;
      this.issues.push('Content lacks data density');
      this.suggestions.push('Include specific numbers, dates, and statistics to support claims');
    }
  }

  /** Check for FAQ format. */
  private checkFaqFormatted(): void {
    const faqPatterns = [
      /\*\*Q:\s*/gi, // **Q: format
      /\*\*Question:\s*/gi, // **Question: format
      /^\*\*[^*]+\?\*\*/gim, // **Question?** format
      /##\s*Frequently Asked/gi, // FAQ section
      /##\s*FAQ/gi, // FAQ section
    ];

    let faqCount = 0;
    for (const pattern of faqPatterns) {
      faqCount += countMatches(pattern, this.content);
    }

    if (faqCount >= 3) {
      this.scores.faqFormatted = 10;
    } else if (faqCount >= 1) {
      this.scores.faqFormatted = 6;
      this.suggestions.push('Add more FAQ-formatted Q&A blocks (target: 3-5)');
    } else {
      this.scores.faqFormatted = 2;
      this.issues.push('No FAQ format detected');
      this.suggestions.push('Convert key points to FAQ format with explicit Q&A');
    }
  }

  /** Check for definition blocks. */
  private checkDefinitionClarity(): void {
    const definitionPatterns = [
      /\*\*[^*]+\*\*:\s*[^*]+is/g, // **Term**: ... is
      /\*\*[^*]+\*\*\s*refers to/g, // **Term** refers to
      /\*\*[^*]+\*\*\s*means/g, // **Term** means
    ];

    let definitions = 0;
    for (const pattern of definitionPatterns) {
      definitions += countMatches(pattern, this.content);
    }

    if (definitions >= 2) {
      this.scores.definitionClarity = 9;
    } else if (definitions >= 1) {
      this.scores.definitionClarity = 6;
      this.suggestions.push('Add more definition blocks for key terms');
    } else {
      this.scores.definitionClarity = 3;
      this.issues.push('No definition blocks found');
      this.suggestions.push('Define key terms on first use using **Term**: Definition format');
    }
  }

  /** Check for hedging language. */
  private checkAuthoritativeVoice(): void {
    const hedgingPhrases = [
      'might be',
      'could be',
      'may be',
      'possibly',
      'probably',
      'some experts',
      'it seems',
      'arguably',
      'to some extent',
      'in our opinion',
      'we believe',
      'we think',
    ];

    const contentLower = this.textOnly.toLowerCase();
    let hedgingCount = 0;
    for (const phrase of hedgingPhrases) {
      hedgingCount += contentLower.split(phrase).length - 1;
    }

    // Normalize by word count
    const hedgingRate = this.words.length > 0 ? hedgingCount / this.words.length : 0;

    if (hedgingRate < 0.001) {
      // Less than 1 per 1000 words
      this.scores.authoritativeVoice = 9;
    } else if (hedgingRate < 0.003) {
      this.scores.authoritativeVoice = 6;
      this.suggestions.push("Reduce hedging language ('might', 'could', 'probably')");
    } else {
      this.scores.authoritativeVoice = 3;
      this.issues.push('Too much hedging language');
      this.suggestions.push("Use declarative statements. Replace 'might be' with 'is'");
    }
  }

  /** Check for scannable formatting. */
  private checkScannable(): void {
    const bulletLists = countMatches(/^[\s]*[-*]\s+/gm, this.content);
    const numberedLists = countMatches(/^[\s]*\d+\.\s+/gm, this.content);
    const tables = countMatches(/\|.*\|.*\|/g, this.content);

    // Paragraph length check
    const paragraphs = this.content.split('\n\n').filter((p) => p.trim().length > 0);
    const longParagraphs = paragraphs.filter((p) => splitWords(p).length > 100).length;

    const scannableElements = bulletLists + numberedLists + tables * 3;

    if (scannableElements >= 5 && longParagraphs === 0) {
      this.scores.scannable = 9;
    } else if (scannableElements >= 3) {
      this.scores.scannable = 6;
      if (longParagraphs > 0) {
        this.suggestions.push(`Break up ${longParagraphs} long paragraphs (>100 words)`);
      }
    } else {
      this.scores.scannable = 3;
      this.issues.push('Content not scannable');
      this.suggestions.push('Use bullet lists, numbered lists, and tables to break up text');
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyzes Markdown content for GEO citation readiness.
 * Returns a structured report with per-dimension scores, issues and suggestions.
 */
export function analyzeContent(content: string): GeoAnalysisReport {
  return new ContentAnalyzer(content).analyze();
}

/** Renders an analysis report as a Markdown document. */
export function formatAnalysisMarkdown(report: GeoAnalysisReport): string {
  const lines: string[] = [
    '# GEO Content Analysis Report\n',
    `**Overall Score**: ${report.overallScore}/${report.maxScore} (${report.grade})\n`,
    `**Word Count**: ${report.wordCount}\n`,
    '## Dimension Scores\n',
  ];

  for (const [dim, score] of Object.entries(report.dimensionScores)) {
    const bar = '█'.repeat(Math.floor(score / 2)) + '░'.repeat(5 - Math.floor(score / 2));
    const label = dim
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
    lines.push(`- **${label}**: ${score}/10 ${bar}`);
  }

  if (report.issues.length > 0) {
    lines.push('\n## Issues\n');
    for (const issue of report.issues) {
      lines.push(`- ❌ ${issue}`);
    }
  }

  if (report.suggestions.length > 0) {
    lines.push('\n## Suggestions\n');
    for (const suggestion of report.suggestions) {
      lines.push(`- 💡 ${suggestion}`);
    }
  }

  return lines.join('\n');
}
