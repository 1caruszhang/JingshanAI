/**
 * #103: Knowledge base coverage health — weighted enterprise field coverage.
 *
 * Replaces the old "index success rate" metric with a weighted score based on
 * which enterprise fact types have at least one confirmed fact.
 *
 * Fact types are split into 3 tiers:
 *   - 高风险 (high-risk, ×2.0): 5 fields — factually sensitive claims
 *   - 推荐 (recommended, ×1.5): 5 fields — core business identity & marketing
 *   - 基础 (basic, ×1.0):    4 fields — supplementary identity & SEO
 *
 * Max score: 5×2.0 + 5×1.5 + 4×1.0 = 21.5
 */

import { FACT_TYPE_LABELS, HIGH_RISK_FACT_TYPES, type FactType } from './factTypes';

// ---------------------------------------------------------------------------
// Tier constants
// ---------------------------------------------------------------------------

export interface FactTierGroup {
  /** Display label for the tier (Chinese). */
  label: string;
  /** Display label for the tier (English). */
  labelEn: string;
  /** Score weight applied to each confirmed field in this tier. */
  weight: number;
  /** Fact types belonging to this tier. */
  fields: FactType[];
}

/**
 * 14 fact types organized into 3 tier groups with scoring weights.
 *
 * Tier assignments:
 *   高风险 (×2.0): contact, service_area, core_advantages, trust_backing, customer_cases
 *   推荐   (×1.5): full_name, industry, products_services, target_customers, pain_points
 *   基础   (×1.0): short_name, detailed_address, related_brands, derived_keywords
 */
export const FACT_TIER_GROUPS: readonly FactTierGroup[] = [
  {
    label: '高风险字段',
    labelEn: 'High-risk',
    weight: 2.0,
    fields: ['contact', 'service_area', 'core_advantages', 'trust_backing', 'customer_cases'],
  },
  {
    label: '推荐字段',
    labelEn: 'Recommended',
    weight: 1.5,
    fields: ['full_name', 'industry', 'products_services', 'target_customers', 'pain_points'],
  },
  {
    label: '基础字段',
    labelEn: 'Basic',
    weight: 1.0,
    fields: ['short_name', 'detailed_address', 'related_brands', 'derived_keywords'],
  },
] as const;

/** Maximum possible weighted score when all 14 fields are confirmed. */
export const KB_COVERAGE_MAX_SCORE = FACT_TIER_GROUPS.reduce(
  (sum, g) => sum + g.fields.length * g.weight,
  0,
); // 21.5

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-field coverage status within the coverage matrix. */
export interface FieldCoverage {
  factType: string;
  label: string;
  tier: 'high_risk' | 'recommended' | 'basic';
  weight: number;
  covered: boolean;
}

/** Result of the coverage health calculation. */
export interface KbCoverageHealth {
  /**
   * Weighted coverage percentage (0–100).
   * Sentinel value -1 means "N/A" — there are zero knowledge entries so
   * coverage cannot be computed.
   */
  coverage: number;
  /** Maximum possible weighted score. */
  maxScore: number;
  /** Number of knowledge entries in the project. */
  totalEntries: number;
  /** Set of fact types that have at least one confirmed fact. */
  confirmedFields: Set<string>;
  /**
   * 14-field coverage matrix — one entry per fact type, grouped by tier,
   * indicating whether each field is covered.
   */
  coverageMatrix: FieldCoverage[];
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

/**
 * Calculate weighted enterprise field coverage health.
 *
 * Pure function — no side effects, no database access.
 *
 * @param confirmedFacts  EnterpriseFact[] filtered to status === 'confirmed'.
 * @param totalEntries    Total number of KnowledgeEntry rows for the project.
 * @returns KbCoverageHealth with weighted coverage percentage.
 */
export function buildKbCoverageHealth(
  confirmedFacts: ReadonlyArray<{ fact_type: string; status: string }>,
  totalEntries: number,
): KbCoverageHealth {
  // Sentinels
  if (totalEntries === 0) {
    return {
      coverage: -1,
      maxScore: KB_COVERAGE_MAX_SCORE,
      totalEntries: 0,
      confirmedFields: new Set(),
      coverageMatrix: buildCoverageMatrix(new Set()),
    };
  }

  // Collect unique fact types that have at least one confirmed fact.
  const confirmedSet = new Set(
    confirmedFacts
      .filter((f) => f.status === 'confirmed')
      .map((f) => f.fact_type),
  );

  if (confirmedSet.size === 0) {
    return {
      coverage: 0,
      maxScore: KB_COVERAGE_MAX_SCORE,
      totalEntries,
      confirmedFields: new Set(),
      coverageMatrix: buildCoverageMatrix(new Set()),
    };
  }

  // Calculate weighted score.
  let score = 0;
  for (const group of FACT_TIER_GROUPS) {
    for (const ft of group.fields) {
      if (confirmedSet.has(ft)) {
        score += group.weight;
      }
    }
  }

  const coverage = Math.round((score / KB_COVERAGE_MAX_SCORE) * 100);

  return {
    coverage,
    maxScore: KB_COVERAGE_MAX_SCORE,
    totalEntries,
    confirmedFields: confirmedSet,
    coverageMatrix: buildCoverageMatrix(confirmedSet),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the 14-field coverage matrix ordered by tier. */
function buildCoverageMatrix(confirmedFields: Set<string>): FieldCoverage[] {
  const tierMap: Record<string, FieldCoverage['tier']> = {
    high_risk: 'high_risk',
    recommended: 'recommended',
    basic: 'basic',
  };

  const matrix: FieldCoverage[] = [];

  for (const group of FACT_TIER_GROUPS) {
    const tierKey = group.label === '高风险字段' ? 'high_risk' : group.label === '推荐字段' ? 'recommended' : 'basic';
    for (const ft of group.fields) {
      matrix.push({
        factType: ft,
        label: FACT_TYPE_LABELS[ft],
        tier: tierMap[tierKey],
        weight: group.weight,
        covered: confirmedFields.has(ft),
      });
    }
  }

  return matrix;
}

/**
 * Return a Tailwind text color class for a given coverage percentage.
 *
 * Thresholds (same as the existing KB health pattern):
 *   ≥80 → green/emerald
 *   ≥50 → amber
 *   <50 → red/rose
 *   <0  → gray (N/A sentinel)
 */
export function getCoverageColor(coverage: number): {
  text: string;
  bg: string;
  bar: string;
} {
  if (coverage < 0) {
    return {
      text: 'text-gray-400',
      bg: 'bg-gray-50 dark:bg-gray-950/20',
      bar: 'bg-gray-400',
    };
  }
  if (coverage >= 80) {
    return {
      text: 'text-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-950/20',
      bar: 'bg-emerald-500',
    };
  }
  if (coverage >= 50) {
    return {
      text: 'text-amber-500',
      bg: 'bg-amber-50 dark:bg-amber-950/20',
      bar: 'bg-amber-500',
    };
  }
  return {
    text: 'text-rose-500',
    bg: 'bg-rose-50 dark:bg-rose-950/20',
    bar: 'bg-rose-500',
  };
}
