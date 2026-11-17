// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// A protocol's "launch" is the token it may issue one day. The radar ranks pre-token protocols by
// the value that token may take IF the protocol's record stays as it is, and tells a reader how to
// farm each one. It never predicts whether or when a token is issued.
//
// The value model is derived from the snapshot's own figures, never a list of names:
//
//   multiple  = median (mcap / tvl) over the snapshot's live-token protocols in the same
//               category (a category with fewer than MIN_COMPARABLES live tokens falls back to
//               the global median). This is the market's own FDV/TVL multiple.
//   base      = tvl_usd x multiple                     what the TVL is worth at that multiple
//   growthScore = 0.85 + (clamp(change_7d,-60,120)+60)/180 x 0.50
//   ageScore    = 0.70 + clamp(age_days,0,1095)/1095 x 0.60 (unknown age: 365 days)
//   sizeScore   = clamp(1 + 0.05 x log10(max(TVL,1)/$100m), 0.90, 1.10)
//   implied     = round(TVL x median live mcap/TVL x growthScore x ageScore x sizeScore)
//
// Every protocol is scored by the same function. A protocol is pre-token when its record carries no
// token (no market cap, no CoinGecko id, no symbol); live-token protocols are kept apart and shown
// at the market's own value, never mixed into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  growth_score_floor: number;
  growth_score_range: number;
  age_score_floor: number;
  age_score_range: number;
  age_days_cap: number;
  unknown_age_days: number;
  size_reference_usd: number;
  size_log_weight: number;
  size_score_floor: number;
  size_score_cap: number;
  min_comparables: number;
  min_value: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -60,
  growth_cap: 120,
  growth_score_floor: 0.85,
  growth_score_range: 0.5,
  age_score_floor: 0.7,
  age_score_range: 0.6,
  age_days_cap: 1095,
  unknown_age_days: 365,
  size_reference_usd: 100_000_000,
  size_log_weight: 0.05,
  size_score_floor: 0.9,
  size_score_cap: 1.1,
  min_comparables: 5,
  min_value: 1,
};

/** The model's version label. */
export const MODEL_VERSION = 'radar-2-bounded-score';

/** The value equation printed by the entry point and dashboard. */
export const MODEL_FORMULA =
  'implied = round(TVL x category-median live mcap/TVL x growthScore x ageScore x sizeScore)';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    comparable_category: string;
    comparables: number;
    base_usd: number;
    growth_pct: number;
    growth_score: number;
    age_score: number;
    size_score: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  comparables: number;
  comparable_category: string;
  base_usd: number;
  growth_pct: number;
  growth_score: number;
  age_score: number;
  size_score: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  global_multiple: number;
  category_multiples: Record<string, { multiple: number; n: number }>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The market's own FDV/TVL multiple for each category, plus a global fallback. */
export function categoryMultiples(protocols: SnapshotProtocol[]): {
  global: number;
  byCategory: Record<string, { multiple: number; n: number }>;
} {
  const globalRatios: number[] = [];
  const byCategory: Record<string, number[]> = {};
  for (const p of protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    globalRatios.push(ratio);
    const cat = p.category ?? 'Uncategorized';
    (byCategory[cat] ??= []).push(ratio);
  }
  const global = median(globalRatios);
  const out: Record<string, { multiple: number; n: number }> = {};
  for (const [cat, ratios] of Object.entries(byCategory)) {
    out[cat] = { multiple: median(ratios), n: ratios.length };
  }
  return { global, byCategory: out };
}

/** The multiple one protocol is scored against: its own category's, or the global one. */
function multipleFor(
  p: SnapshotProtocol,
  multiples: { global: number; byCategory: Record<string, { multiple: number; n: number }> },
  model: ModelConstants,
): { multiple: number; category: string; n: number } {
  const cat = p.category ?? 'Uncategorized';
  const own = multiples.byCategory[cat];
  if (own && own.n >= model.min_comparables && own.multiple > 0) {
    return { multiple: own.multiple, category: cat, n: own.n };
  }
  return { multiple: multiples.global, category: 'all categories (global)', n: multiples.byCategory[cat]?.n ?? 0 };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { global: number; byCategory: Record<string, { multiple: number; n: number }> },
): { implied: number; multiple: number; category: string; n: number; base: number; growthPct: number; growthScore: number; ageScore: number; sizeScore: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, category, n } = multipleFor(p, multiples, model);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthScore = model.growth_score_floor + ((growthPct - model.growth_floor) / (model.growth_cap - model.growth_floor)) * model.growth_score_range;
  const ageForModel = Math.min(Math.max(age ?? model.unknown_age_days, 0), model.age_days_cap);
  const ageScore = model.age_score_floor + (ageForModel / model.age_days_cap) * model.age_score_range;
  const rawSizeScore = 1 + Math.log10(Math.max(p.tvl_usd, 1) / model.size_reference_usd) * model.size_log_weight;
  const sizeScore = Math.min(model.size_score_cap, Math.max(model.size_score_floor, rawSizeScore));
  const base = p.tvl_usd * multiple;
  const implied = Math.max(model.min_value, Math.round(base * growthScore * ageScore * sizeScore));
  return { implied, multiple, category, n, base, growthPct, growthScore, ageScore, sizeScore, age };
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot.protocols);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is covered, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, ...v };
  });
  // Rank on the closed-form score before rounding; the slug settles an exact score tie.
  scored.sort((a, b) =>
    b.base * b.growthScore * b.ageScore * b.sizeScore - a.base * a.growthScore * a.ageScore * a.sizeScore ||
    (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  let previousValue = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    // Keep the printed values strictly descending; adjust only a rounded tie.
    implied_value_usd: (previousValue = Math.min(
      Math.round(s.base * s.growthScore * s.ageScore * s.sizeScore),
      i === 0 ? Number.POSITIVE_INFINITY : previousValue - 1,
    )),
    model: {
      multiple: s.multiple,
      comparable_category: s.category,
      comparables: s.n,
      base_usd: s.base,
      growth_pct: s.growthPct,
      growth_score: round6(s.growthScore),
      age_score: round6(s.ageScore),
      size_score: round6(s.sizeScore),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Then hold and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Position capital, scaled to the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  return Math.max(500, Math.min(25_000, Math.round(p.tvl_usd * 0.0005)));
}

/** Typical transaction gas by named ecosystem, used as an explicit planning estimate. */
function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('solana')) return 0.01;
  if (/arbitrum|optimism|base|polygon|zksync|starknet|scroll|linea|blast|mantle|mode|avax|bsc|bnb/.test(c)) return 0.3;
  return 12;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's concrete primary action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): FarmStep {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const cap = `$${capital}`;
  const gas = capital >= 150 ? 8 : 4;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) {
    return { text: `Provide ${cap} of liquidity to ${name}'s most-used pool on ${chain}, ideally the pool its own docs point new users to so your LP tokens sit in the deepest, most-rewarded market.`, cost: `${cap} split across the pool's two assets, plus about $${gas} of gas to mint and stake the LP`, time: '20 minutes to set up, then check the position weekly' };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) {
    return { text: `Supply ${cap} of a blue-chip asset (ETH, USDC or the chain's staked gas token) as collateral on ${name} on ${chain}, then borrow a small amount against it so the account shows real borrowing activity, not just idle supply.`, cost: `${cap} of collateral plus roughly $${gas} of gas for the supply and the borrow`, time: '25 minutes to set up, then repay and re-borrow once a week' };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return { text: `Stake ${cap} of the chain's native staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet; a receipt you hold is proof you used the product.`, cost: `${cap} of the staking asset plus about $${gas} of gas to stake and later to unstake`, time: '15 minutes to stake, then leave it for the full window' };
  }
  if (c.includes('bridge') || c.includes('canonical')) {
    return { text: `Bridge ${cap} of USDC from a major chain into ${chain} through ${name}, then actually use the bridged funds in one app on the destination so the flow is a real user flow, not a dead transfer.`, cost: `${cap} plus the bridge's own fee (often $1-$10) and about $${gas} of gas on each side`, time: '30 minutes including the destination-side swap' };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return { text: `Deposit ${cap} of USDC as margin on ${name} and open one small position, then close it; a closed trade still counts as usage and keeps the capital free for the next step.`, cost: `${cap} of margin plus about $${gas} of gas and one round of trading fees`, time: '20 minutes to deposit, trade and close' };
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) {
    return { text: `Deposit ${cap} into ${name}'s flagship vault on ${chain} and keep the receipt shares; pick the vault with the most deposits so your shares are in the protocol's lead product.`, cost: `${cap} plus about $${gas} of gas to deposit`, time: '15 minutes to deposit, then leave it for the window' };
  }
  if (c.includes('stable')) {
    return { text: `Mint or deposit ${cap} of the stable asset through ${name} on ${chain} and hold the resulting stable; holding the protocol's own output is direct usage of its core product.`, cost: `${cap} of the input asset plus about $${gas} of gas`, time: '20 minutes to mint, then hold' };
  }
  if (c.includes('rwa') || c.includes('real world') || c.includes('treasury')) {
    return { text: `Deposit ${cap} into ${name}'s tokenized yield product on ${chain} and hold the receipt token; RWA products usually snapshot holders, so stay in past the first snapshot.`, cost: `${cap} plus about $${gas} of gas`, time: '20 minutes to deposit, then hold for the window' };
  }
  if (c.includes('insurance') || c.includes('cover')) {
    return { text: `Buy ${Math.max(1, Math.round(capital / 10))} of cover from ${name} on ${chain} against a protocol you actually use, and keep the policy; cover buyers are a small, easily-counted set of users.`, cost: `about ${cap} of cover premium`, time: '15 minutes to buy, then hold the policy' };
  }
  if (c.includes('prediction') || c.includes('betting')) {
    return { text: `Fund ${cap} and place one market position on ${name}, then leave it to resolve; active positions and a history of resolved trades both count as usage.`, cost: `${cap} staked in the position plus about $${gas} of gas`, time: '15 minutes to place, then wait for resolution' };
  }
  return { text: `Deposit ${cap} of USDC into ${name}'s main product on ${chain} and keep the position open through the whole window so the address is counted in more than one snapshot.`, cost: `${cap} plus about $${gas} of gas`, time: '15 minutes to set up, then leave it for the window' };
}

/**
 * A protocol's farm plan: six concrete steps, each with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const c = (p.category ?? '').toLowerCase();
  const act = c.includes('dex') || c.includes('amm') ? `Split $${capital.toLocaleString('en-US')} across the leading ${p.name} pool assets on ${chain} and add liquidity; keep the LP receipt.`
    : c.includes('lst') || c.includes('staking') || c.includes('restak') ? `Stake $${capital.toLocaleString('en-US')} of the chain's native asset through ${p.name} on ${chain}; retain the liquid staking receipt.`
    : c.includes('lend') || c.includes('cdp') || c.includes('borrow') ? `Supply $${capital.toLocaleString('en-US')} USDC to ${p.name} on ${chain}, then make a small borrow you can repay safely.`
    : c.includes('bridge') ? `Bridge $${capital.toLocaleString('en-US')} USDC through ${p.name} to ${chain}, then make a small destination-side swap.`
    : c.includes('oracle') ? `Use ${p.name} on ${chain} in a supported test or consumer app and keep the transaction receipt.`
    : c.includes('rwa') || c.includes('real world') || c.includes('treasury') ? `Allocate $${capital.toLocaleString('en-US')} to an available ${p.name} tokenized treasury product on ${chain} and retain its receipt.`
    : `Deposit $${capital.toLocaleString('en-US')} USDC into ${p.name}'s primary product on ${chain} and keep the position open.`;
  const cash = `$${capital.toLocaleString('en-US')}`;
  return [
    { text: `Fund a fresh wallet on ${chain} with ${cash} plus a small gas reserve; record the address so every qualifying action is easy to track.`, cost: `${cash} principal + $${gas.toFixed(2)} gas`, time: '8 minutes' },
    { text: act, cost: `${cash} reference deposit + $${(gas * 2).toFixed(2)} estimated transaction gas`, time: c.includes('bridge') ? '15 minutes + about 15 minutes for settlement' : '12 minutes' },
    { text: `Repeat one low-risk core action with ${p.name} each week (such as a swap, repay, rebalance or claim) and save each transaction in your activity log.`, cost: `$${(gas * (c.includes('dex') ? 2 : 1)).toFixed(2)} gas per weekly action`, time: '10 minutes per week' },
    { text: `Keep the ${cash} position active for ${hold} days, check fees and health weekly, and avoid borrowing or leverage you cannot repay.`, cost: `${cash} remains deployed; allow $${(gas * 2).toFixed(2)} for exit gas`, time: `${hold} days, with a 5 minute weekly check` },
    { text: `Before exiting, verify ${p.name}'s official rewards page, record eligibility rules, then withdraw or unstake and reconcile the wallet balance.`, cost: `$${gas.toFixed(2)} estimated exit gas; protocol fees vary`, time: '10 minutes plus transaction confirmation' },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: Math.round((p.mcap_usd! / p.tvl_usd) * 100) / 100,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    comparables: row.model.comparables,
    comparable_category: row.model.comparable_category,
    base_usd: row.model.base_usd,
    growth_pct: row.model.growth_pct,
    growth_score: row.model.growth_score,
    age_score: row.model.age_score,
    size_score: row.model.size_score,
    on_watchlist: onWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_total: snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX').length,
    global_multiple: Math.round(multiples.global * 100) / 100,
    category_multiples: Object.fromEntries(
      Object.entries(multiples.byCategory).map(([k, v]) => [k, { multiple: Math.round(v.multiple * 100) / 100, n: v.n }]),
    ),
    rows: board.map((r) => radarRow(r, watch.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
