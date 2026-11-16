/** Minimal row shape required by local radar enrichment helpers. */
export type RadarRow = {
  slug: string;
  name: string;
  tvl_usd: number;
  change_7d: number;
  age_days: number | null;
  implied_value_usd: number;
  chains?: string[];
};

export type TieredRadarRow = RadarRow & { tier: 'core' | 'emerging' | 'early' };

/** Adds a TVL tier to each row, returning an empty list for non-array input. */
export function withTier(rows: RadarRow[]): TieredRadarRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row) => {
    const tvl = Number.isFinite(row.tvl_usd) && row.tvl_usd > 0 ? row.tvl_usd : 0;
    const tier = tvl >= 100_000_000 ? 'core' : tvl >= 10_000_000 ? 'emerging' : 'early';
    return { ...row, tier };
  });
}

/** Keeps rows meeting the TVL floor; invalid floors leave the input unchanged by value. */
export function filterMinTvl(rows: RadarRow[], min: number): RadarRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const floor = Number.isFinite(min) ? min : 0;
  return rows.filter((row) => Number.isFinite(row.tvl_usd) && row.tvl_usd >= floor);
}

/** Selects rows on a chain without regard to letter case. */
export function filterChains(rows: RadarRow[], chain: string): RadarRow[] {
  if (!Array.isArray(rows) || rows.length === 0 || typeof chain !== 'string' || chain.trim() === '') return [];
  const wanted = chain.trim().toLocaleLowerCase();
  return rows.filter((row) => Array.isArray(row.chains) && row.chains.some((value) =>
    typeof value === 'string' && value.toLocaleLowerCase() === wanted));
}

/** Returns up to n rows by descending implied value, preserving input order for ties. */
export function topByImplied(rows: RadarRow[], n: number): RadarRow[] {
  if (!Array.isArray(rows) || rows.length === 0 || !Number.isFinite(n) || n <= 0) return [];
  const count = Math.floor(n);
  if (count === 0) return [];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = Number.isFinite(a.row.implied_value_usd) ? a.row.implied_value_usd : -Infinity;
      const bv = Number.isFinite(b.row.implied_value_usd) ? b.row.implied_value_usd : -Infinity;
      return bv - av || a.index - b.index;
    })
    .slice(0, count)
    .map(({ row }) => row);
}

/** Describes the row count and highest implied value in one readable sentence. */
export function headline(rows: RadarRow[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return 'Radar found 0 protocols; no top protocol is available.';
  const top = rows.reduce((best, row) => {
    const value = Number.isFinite(row.implied_value_usd) ? row.implied_value_usd : -Infinity;
    const bestValue = Number.isFinite(best.implied_value_usd) ? best.implied_value_usd : -Infinity;
    return value > bestValue ? row : best;
  });
  const implied = Number.isFinite(top.implied_value_usd) ? top.implied_value_usd : 0;
  return `Radar found ${rows.length} protocols; top is ${top.slug} at $${implied.toLocaleString('en-US')} implied value.`;
}
