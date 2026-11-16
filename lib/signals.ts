/** Minimal protocol shape used by radar signal calculations. */
type Protocol = {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

/** Minimal radar row shape used by the exported signal functions. */
export type RadarRow = {
  slug: string;
  tvl_usd: number;
  change_7d: number;
  age_days: number | null;
  implied_value_usd: number;
};

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Maps signed seven-day percentage growth through a bounded logistic score. */
export function momentum(row: RadarRow | null | undefined): number {
  const change = row && typeof row.change_7d === 'number' && Number.isFinite(row.change_7d)
    ? row.change_7d
    : 0;
  if (change < 0) return 0;
  const score = 1 / (1 + Math.exp(-Math.max(-1000, Math.min(1000, change)) / 25));
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0.5;
}

/** Scores momentum per day, using a one-day floor and zero for unknown age. */
export function acceleration(row: RadarRow | null | undefined): number {
  if (!row || typeof row.age_days !== 'number' || !Number.isFinite(row.age_days) || row.age_days < 0) return 0;
  return momentum(row) / Math.max(1, row.age_days);
}

/** Combines logarithmic TVL scale with momentum into a bounded conviction score. */
export function conviction(row: RadarRow | null | undefined): number {
  if (!row) return 0;
  const tvlScore = Math.min(1, Math.log1p(finiteNonNegative(row.tvl_usd)) / Math.log1p(100_000_000));
  const score = Math.sqrt(tvlScore * momentum(row));
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

/** Applies a 180-day half-life freshness weight; unknown age stays fully fresh. */
export function decay(age_days: number | null | undefined): number {
  if (age_days === null || age_days === undefined) return 1;
  const age = typeof age_days === 'number' && Number.isFinite(age_days) ? Math.max(0, age_days) : 0;
  const weight = Math.exp((-Math.LN2 * age) / 180);
  return Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 1;
}

/** Labels scores as hot at 0.7+, warm at 0.4+, and cool below 0.4. */
export function label(score: number | null | undefined): 'hot' | 'warm' | 'cool' {
  const safeScore = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, score) : 0;
  if (safeScore >= 0.7) return 'hot';
  if (safeScore >= 0.4) return 'warm';
  return 'cool';
}

/** Assigns a TVL size tier: core at $100M+, emerging at $10M+, early below. */
export function tier(row: RadarRow | null | undefined): 'core' | 'emerging' | 'early' {
  const tvl = row ? finiteNonNegative(row.tvl_usd) : 0;
  if (tvl >= 100_000_000) return 'core';
  if (tvl >= 10_000_000) return 'emerging';
  return 'early';
}

/** Counts score labels and returns the median conviction, or zero when empty. */
export function summarize(rows: RadarRow[]): { hot: number; warm: number; cool: number; medianConviction: number } {
  const counts = { hot: 0, warm: 0, cool: 0 };
  const scores: number[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const score = conviction(row);
    counts[label(score)] += 1;
    scores.push(score);
  }
  scores.sort((a, b) => a - b);
  const middle = Math.floor(scores.length / 2);
  const medianConviction = scores.length === 0
    ? 0
    : scores.length % 2 === 1
      ? scores[middle]
      : (scores[middle - 1] + scores[middle]) / 2;
  return { ...counts, medianConviction };
}

/** Encodes row labels as H/W/C, truncating long log output to 59 chars plus an ellipsis. */
export function heatmap(rows: RadarRow[]): string {
  const chars = (Array.isArray(rows) ? rows : []).map((row) => {
    const rowLabel = label(conviction(row));
    return rowLabel === 'hot' ? 'H' : rowLabel === 'warm' ? 'W' : 'C';
  }).join('');
  return chars.length > 60 ? `${chars.slice(0, 59)}…` : chars;
}
