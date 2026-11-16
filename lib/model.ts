// Snapshot scoring and board construction for the token radar.
// The watchlist is always retained; early candidates fill the board to 200 rows.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-1';
export const BOARD_ROWS = 200;
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
  tier: 'watchlist' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  tier: 'watchlist' | 'early';
  model: BoardRow['model'];
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

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
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bySlug = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
  a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Whole elapsed days since listing, clamped at zero; absent or invalid dates remain unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** Score one protocol using TVL, clamped seven-day growth, and capped listing maturity. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const boundedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (boundedAge / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

export function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

/** Exclude exchange records and named version pools from the early-discovery cohort. */
export function isRankable(protocol: SnapshotProtocol): boolean {
  return isPreToken(protocol) && protocol.category !== 'CEX' && !VERSIONED.test(protocol.name);
}

export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

const scoreCompare = (a: { implied: number; p: SnapshotProtocol }, b: { implied: number; p: SnapshotProtocol }): number =>
  b.implied - a.implied || bySlug(a.p, b.p);

/** Build a 200-row board: every watchlist record plus the strongest below-floor early candidates. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((protocol) => [protocol.slug, protocol]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined && isPreToken(protocol)) chosen.set(slug, protocol);
  }

  const early = snapshot.protocols
    .filter((protocol) =>
      !chosen.has(protocol.slug) &&
      isRankable(protocol) &&
      protocol.tvl_usd < snapshot.floor_usd,
    )
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a, b))
    .slice(0, Math.max(0, BOARD_ROWS - chosen.size));
  for (const protocol of early) chosen.set(protocol.slug, protocol);

  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((protocol) => ({
    p: protocol,
    ...impliedValue(protocol, snapshot.as_of, model),
  }));
  scored.sort(scoreCompare);

  return scored.map((item, index) => ({
    rank: index + 1,
    slug: item.p.slug,
    name: item.p.name,
    category: item.p.category,
    chains: item.p.chains,
    tvl_usd: item.p.tvl_usd,
    change_7d: item.p.change_7d,
    mcap_usd: item.p.mcap_usd,
    listed_at: item.p.listed_at,
    gecko_id: item.p.gecko_id,
    symbol: item.p.symbol,
    token_status: 'pre-token',
    tier: watchlist.has(item.p.slug) ? 'watchlist' : 'early',
    age_days: item.age,
    implied_value_usd: item.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: item.growthPct,
      growth_multiplier: round4(item.growthMult),
      maturity_multiplier: round4(item.maturityMult),
      age_days: item.age,
    },
    farm_steps: farmSteps(item.p, item.age).map(stepText),
  }));
}

/** Format a farm action as one readable string with explicit cost and duration. */
export function stepText(step: FarmStep): string {
  const text = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (text.length <= 600) return text.length >= 20 ? text : `${text} Review the position daily.`;
  const suffix = ` Cost: ${step.cost}. Time: ${step.time}.`;
  const room = Math.max(1, 600 - suffix.length);
  return `${step.text.slice(0, room).trimEnd()}${suffix}`;
}

function chainOf(protocol: SnapshotProtocol): string {
  return protocol.chains[0] ?? 'its main chain';
}

function capitalFor(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 5_000_000_000) return 250;
  if (protocol.tvl_usd >= 1_000_000_000) return 150;
  if (protocol.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(protocol: SnapshotProtocol, capital: number, chain: string): string {
  const category = (protocol.category ?? '').toLowerCase();
  const name = protocol.name;
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and leave the position open.`;
  }
  if (category.includes('dex') || category.includes('yield') || category.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to a ${name} pool on ${chain} and keep the pool receipt.`;
  }
  if (category.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the funds in its app.`;
  }
  if (category.includes('staking') || category.includes('restak')) {
    return `Stake $${capital} of the chain asset through ${name} on ${chain} and retain the receipt.`;
  }
  if (category.includes('perpetual') || category.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge.`;
  }
  if (category.includes('prediction')) {
    return `Fund ${name} with $${capital} on ${chain} and place one small market position.`;
  }
  if (category.includes('curator') || category.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and retain the vault shares.`;
  }
  if (category.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (category.includes('rwa')) {
    return `Acquire $${capital} of ${name}'s yield asset on ${chain} and record the position.`;
  }
  if (category.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy record.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** Six concrete actions derived from each protocol's category, deployment, TVL, and age. */
export function farmSteps(protocol: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(protocol);
  const capital = capitalFor(protocol);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Create a separate wallet for ${protocol.name} on ${chain}; write down its address and keep the recovery phrase offline.`,
      cost: 'under $3 for the first network transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(protocol, capital, chain),
      cost: `$${capital} of capital plus about $${capital >= 150 ? 8 : 4} in network fees`,
      time: '15 minutes to set up',
    },
    {
      text: `Once each week, repeat a qualifying ${protocol.category ?? 'protocol'} action and save its transaction link.`,
      cost: 'about $2 in network fees each week',
      time: '10 minutes per week',
    },
    {
      text: `Keep the position active for at least ${hold} days; for this ${age === null ? 'unknown-age' : `${age}-day-old`} protocol, check whether its campaign has a longer window.`,
      cost: `the $${capital} remains committed while the position is open`,
      time: `${hold} days, then review`,
    },
    {
      text: `Open ${protocol.name}'s official rewards page from its verified project site and check eligibility before claiming.`,
      cost: 'no payment to check eligibility; claim fees depend on the chain',
      time: '10 minutes to review',
    },
    {
      text: `Log the wallet, ${chain} transactions, dates, and fees; compare the receipts before adding more capital or exiting.`,
      cost: 'no additional cost for the activity log',
      time: '5 minutes to record',
    },
  ];
}

/** Live-token protocols stay outside the implied-value ranking. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((protocol) => !isPreToken(protocol) && protocol.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlug(a, b))
    .slice(0, LIVE_ROWS)
    .map((protocol) => ({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd,
      change_7d: protocol.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    tier: row.tier,
    model: row.model,
    farm_steps: row.farm_steps,
  };
}

/** Construct the exact dashboard payload from the same ranked rows written to board.json. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const earlySize = board.filter((row) => !snapshot.watchlist.includes(row.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Parse and normalize the sealed snapshot while rejecting malformed required fields. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json must contain an object');
  }
  const object = raw as Record<string, unknown>;
  if (typeof object.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(object.as_of)) {
    throw new SnapshotError('snapshot.json has no valid as_of date');
  }
  if (typeof object.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof object.floor_usd !== 'number' || !Number.isSafeInteger(object.floor_usd) || object.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no positive integer floor_usd');
  }
  if (!Array.isArray(object.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(object.watchlist) || object.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }

  const protocols = object.protocols.map((value, index): SnapshotProtocol => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapshotError(`snapshot.json protocol ${index} is not an object`);
    }
    const protocol = value as Record<string, unknown>;
    if (typeof protocol.slug !== 'string' || protocol.slug.length === 0 || typeof protocol.name !== 'string' ||
        protocol.name.length === 0 || typeof protocol.tvl_usd !== 'number' || !Number.isFinite(protocol.tvl_usd) ||
        protocol.tvl_usd < 0) {
      throw new SnapshotError(`snapshot.json protocol ${index} lacks a valid slug, name, or TVL`);
    }
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: typeof protocol.category === 'string' ? protocol.category : null,
      chains: Array.isArray(protocol.chains) ? protocol.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: protocol.tvl_usd,
      change_7d: typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : null,
      mcap_usd: typeof protocol.mcap_usd === 'number' && Number.isFinite(protocol.mcap_usd) ? protocol.mcap_usd : null,
      listed_at: typeof protocol.listed_at === 'string' ? protocol.listed_at : null,
      gecko_id: typeof protocol.gecko_id === 'string' ? protocol.gecko_id : null,
      symbol: typeof protocol.symbol === 'string' ? protocol.symbol : null,
    };
  });

  return {
    as_of: object.as_of,
    source: object.source,
    floor_usd: object.floor_usd,
    protocols,
    watchlist: object.watchlist as string[],
  };
}

/** Return a readable reason when the generated board violates row, ranking, or farm-plan rules. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length !== BOARD_ROWS) return `the board has ${board.length} rows; it must have ${BOARD_ROWS}`;
  const slugs = new Set(board.map((row) => row.slug));
  if (slugs.size !== board.length) return 'the board contains duplicate protocol slugs';
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  if (snapshot.watchlist.length !== new Set(snapshot.watchlist).size) return 'the watchlist contains duplicate slugs';

  for (let index = 0; index < board.length; index++) {
    const row = board[index]!;
    if (row.rank !== index + 1) return `row ${index + 1} has rank ${row.rank}`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has invalid implied value ${row.implied_value_usd}`;
    }
    if (index > 0 && row.implied_value_usd > board[index - 1]!.implied_value_usd) {
      return `row ${index + 1} rises above row ${index} on implied value`;
    }
    if (row.token_status !== 'pre-token' || !isPreToken(row)) return `${row.slug} is not pre-token`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps?.length ?? 0} farm steps`;
    }
    for (const step of row.farm_steps) {
      if (typeof step !== 'string' || step.length < 20 || step.length > 600 || !/\bCost: .+\. Time: .+\.$/.test(step)) {
        return `${row.slug} has a farm step without a valid cost, time, or length`;
      }
    }
  }
  return null;
}

/** Serialize dashboard data as a no-fetch JavaScript assignment. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// Stable slug tie-breaking keeps equal-value ranks reproducible between builds.
