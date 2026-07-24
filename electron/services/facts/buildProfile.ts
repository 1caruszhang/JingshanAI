/**
 * #106: Build the enterprise profile from confirmed facts.
 *
 * Pure function — no side effects, no I/O. Given a list of facts (typically
 * the project's full fact list, including non-confirmed ones), it returns a
 * `Record<fact_type, value>` containing, for each fact_type, the value of the
 * most-recently-reviewed confirmed fact. This is used to auto-backfill the
 * "企业资料" form so users no longer have to copy values over from the
 * "事实审核" tab by hand.
 *
 * Resolution rules:
 *   1. Only facts with `status === 'confirmed'` are considered.
 *   2. Facts whose `fact_value` is null or empty-string are skipped — they do
 *      not contribute a value and do not block a null-reviewed_at fallback.
 *   3. When a fact_type has multiple confirmed facts, the one with the latest
 *      `reviewed_at` wins. A null `reviewed_at` is treated as the earliest
 *      possible time, so any concrete timestamp beats it. ISO-8601 timestamps
 *      compare correctly under plain string comparison (lexicographic order
 *      matches chronological order when timezones are normalized to Z).
 *   4. The input array is never mutated.
 */

/** Minimal fact shape consumed by buildProfileFromFacts. */
export interface ProfileFactInput {
  fact_type: string;
  status: string;
  fact_value: string | null;
  reviewed_at: string | null;
}

/**
 * Build `{ [fact_type]: value }` from confirmed facts, taking the latest
 * reviewed value per type.
 *
 * @param confirmedFacts  The project's facts (confirmed + others; non-confirmed
 *                        are filtered out internally).
 * @returns Record mapping each covered fact_type to its latest confirmed value.
 */
export function buildProfileFromFacts(
  confirmedFacts: ReadonlyArray<ProfileFactInput>,
): Record<string, string> {
  // Track the best (latest reviewed_at, non-empty value) seen per fact_type.
  // `reviewed_at` may be null; we normalize null to '' so it sorts before every
  // real ISO timestamp (which all start with a digit). '' < '2...' lexicographically.
  const bestByType = new Map<string, { value: string; reviewedAt: string }>();

  for (const f of confirmedFacts) {
    if (f.status !== 'confirmed') continue;
    if (f.fact_value == null || f.fact_value === '') continue;

    const reviewedAt = f.reviewed_at ?? '';
    const current = bestByType.get(f.fact_type);

    // First seen for this type, or strictly newer reviewed_at wins.
    // Using `>=` is unnecessary (no two confirmed facts share an identical
    // reviewed_at in practice) but `>` keeps input order as a stable tiebreak:
    // the first-encountered among equal timestamps is kept.
    if (!current || reviewedAt > current.reviewedAt) {
      bestByType.set(f.fact_type, { value: f.fact_value, reviewedAt });
    }
  }

  const result: Record<string, string> = {};
  for (const [type, entry] of bestByType) {
    result[type] = entry.value;
  }
  return result;
}
