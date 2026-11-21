// Yield Radar: a DeFi yield-lens token launch radar.
//
// The board ranks pre-token protocols by an implied launch value built only from the sealed
// snapshot's own figures. The lens is fee-revenue quality: markets pay more per TVL dollar for
// protocol families whose live tokens trade at a higher market-cap-to-TVL ratio, so each family
// carries the median mcap/TVL of the live-token protocols in that same family, computed from
// this snapshot at run time, never from a hand-kept list of names.
//
//   implied = TVL x feeMultiple x growthMult x maturityMult x chainMult
//
//   feeMultiple   median mcap/TVL of live-token protocols in the protocol's family
//                 (overall live median when the family has none), clamped to [0.05, 3.0]
//   growthMult    1 + 0.5 x clamp(change_7d, -25, +100) / 100   (no 7d figure: 1.0)
//   maturityMult  0.90 under 90 days listed, 1.00 under a year, 1.08 under two years,
//                 1.15 beyond; unlisted: 1.0. Older with no token = more pent-up value.
//   chainMult     1 + 0.04 x min(chains - 1, 5), capped at 1.20
//
// The board covers every slug on the snapshot's watchlist (the floor, never the ceiling) and
// adds the pre-token protocols in the yield families below the floor. Live-token protocols are
// never ranked: they are shown apart as the market's own comparables. Every farm plan has five
// steps, each carrying an estimated cost and a short risk note.

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

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'yield-quality-1';

/** The yield families: DefiLlama categories grouped by how the protocol earns its fees. */
export const FAMILIES: Record<string, string[]> = {
  Lending: ['Lending', 'CDP', 'Collateral Markets', 'Uncollateralized Lending', 'CDP Manager'],
  Yield: ['Yield', 'Yield Aggregator', 'Leveraged Farming', 'Farm', 'Liquidity Manager', 'Options Vault'],
  Trading: ['Dexs', 'Derivatives', 'Options', 'Synthetics', 'Basis Trading', 'Interest Rate Derivatives'],
  Vaults: ['Risk Curators', 'Onchain Capital Allocator', 'Staking Pool', 'Restaking'],
  StableRWA: ['RWA', 'Algo-Stables', 'Stablecoin Issuer', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Reserve Currency', 'CeDeFi'],
};

/** The family a category belongs to, or null when it is outside the yield lens. */
export function familyOf(category: string | null): string | null {
  if (category === null) return null;
  for (const [family, cats] of Object.entries(FAMILIES)) if (cats.includes(category)) return family;
  return null;
}

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  growth_weight: 0.5,
  growth_floor: -25,
  growth_cap: 100,
  multiple_floor: 0.05,
  multiple_cap: 3.0,
  chain_step: 0.04,
  chain_max_extra: 5,
};

/** How many live-token protocols the comparables table carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fee_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  family: string | null;
  chains: number;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl: number;
}

/** One family multiple: the median mcap/TVL of its live tokens, as the dashboard shows it. */
export interface FamilyMultiple {
  family: string;
  multiple: number;
  live_n: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  formula: string;
  families: FamilyMultiple[];
  overall_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
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
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
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

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank below the floor: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The fee-revenue multiple of one family: the median mcap/TVL of its live tokens, clamped. */
export function familyMultiple(family: string, snapshot: Snapshot): { multiple: number; live_n: number } {
  const ratios = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX' && familyOf(p.category) === family)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  if (ratios.length === 0) return { multiple: MODEL.multiple_floor, live_n: 0 };
  return { multiple: round4(clamp(median(ratios), MODEL.multiple_floor, MODEL.multiple_cap)), live_n: ratios.length };
}

/** The overall live median mcap/TVL across the yield families: the fallback multiple. */
export function overallMultiple(snapshot: Snapshot): number {
  const ratios = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX' && familyOf(p.category) !== null)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  if (ratios.length === 0) return MODEL.multiple_floor;
  return round4(clamp(median(ratios), MODEL.multiple_floor, MODEL.multiple_cap));
}

/** The four multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, number>,
  fallback: number,
): { implied: number; fee: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const fam = familyOf(protocol.category);
  const fee = fam !== null && multiples.has(fam) ? multiples.get(fam)! : fallback;
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, MODEL.growth_floor, MODEL.growth_cap);
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const maturityMult = age === null ? 1.0 : age < 90 ? 0.9 : age < 365 ? 1.0 : age < 730 ? 1.08 : 1.15;
  const chainMult = 1 + MODEL.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), MODEL.chain_max_extra);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * fee * growthMult * maturityMult * chainMult));
  return { implied, fee, growthPct, growthMult: round4(growthMult), maturityMult, chainMult: round4(chainMult), age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The core farming action for one protocol's family: what to do with the capital. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): { action: string; risk: string } {
  const fam = familyOf(p.category);
  const name = p.name;
  if (fam === 'Lending') {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain} and borrow up to half of it in a stablecoin; keep the borrow open so the position counts.`,
      risk: `Liquidation if the collateral falls — keep the health factor above 2 and never borrow to the limit.`,
    };
  }
  if (fam === 'Yield') {
    return {
      action: `Deposit $${capital} of USDC into ${name}'s largest vault on ${chain} and hold the vault receipt token in the same wallet.`,
      risk: `Smart-contract and strategy risk — the vault's yield falls as more TVL chases the same strategy.`,
    };
  }
  if (fam === 'Trading') {
    if (p.category === 'Dexs') {
      return {
        action: `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} in a tight range and keep the position open.`,
        risk: `Impermanent loss if the price leaves your range — a narrow range earns more fees but goes out of range faster.`,
      };
    }
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position at 2x leverage or less.`,
      risk: `Liquidation on a sharp move and funding-rate bleed — size small and keep most of the margin untouched.`,
    };
  }
  if (fam === 'Vaults') {
    return {
      action: `Deposit $${capital} of USDC into a ${name} curated vault on ${chain} and hold the vault shares in the same wallet.`,
      risk: `Curator and strategy risk — a vault can cap deposits or change strategy, so check its page before adding more.`,
    };
  }
  if (fam === 'StableRWA') {
    return {
      action: `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet without moving it.`,
      risk: `Depeg and issuer risk — redemptions can be gated, so never put in money you need back on short notice.`,
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open.`,
    risk: `Smart-contract risk — a newer protocol can hold bugs, so farm only with money you can afford to lose.`,
  };
}

/**
 * A protocol's farm plan: five steps, each an action with an estimated cost and a risk note.
 * Derived from the protocol's own record (family, chains, TVL, age), never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const core = coreAction(p, capital, chain);
  const steps = [
    `Open a fresh wallet just for farming ${p.name}; write its seed phrase on paper and store it offline, never in a screenshot or chat. Cost: no cost to create the wallet; about $1-$3 of gas for the first transaction on ${chain}. Risk: losing the seed phrase loses the wallet, and anyone who sees it can drain it, so keep it offline.`,
    `${core.action} Cost: $${capital} supplied plus about $2-$6 of gas on ${chain}. Risk: ${core.risk}`,
    `Do one qualifying action every week on ${p.name} — a deposit, a swap, a vote or a re-stake — so the activity spans several snapshots. Cost: about $1-$3 of gas per week on ${chain}. Risk: missing weeks can drop you from a snapshot, and gas spikes on ${chain} can make small actions cost more than they are worth.`,
    `Hold the position for at least ${hold} days without withdrawing, so the activity is counted in more than one snapshot window. Cost: the $${capital} stays locked in the position; the cost is the yield you could earn elsewhere. Risk: yield decay and TVL flight while you wait — check the vault's TVL weekly and leave if it drains fast.`,
    `Before you exit, open ${p.name}'s own points or rewards page from its official site and claim only from the link it publishes. Cost: no fee to check; about $1-$5 of gas to exit on ${chain}. Risk: phishing claim sites are the most common loss — never connect your wallet from a DM, a search ad or a copied link.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = new Map<string, number>();
  for (const family of Object.keys(FAMILIES)) multiples.set(family, familyMultiple(family, snapshot).multiple);
  const fallback = overallMultiple(snapshot);

  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && familyOf(p.category) !== null) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, multiples, fallback) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    family: familyOf(s.p.category),
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fee_multiple: s.fee,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token comparables, by market cap, for the dashboard's live table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX' && familyOf(p.category) !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      family: familyOf(p.category),
      chains: p.chains.length,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const families: FamilyMultiple[] = Object.keys(FAMILIES).map((family) => {
    const { multiple, live_n } = familyMultiple(family, snapshot);
    return { family, multiple, live_n };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    formula: 'implied = TVL x feeMultiple x growthMult x maturityMult x chainMult',
    families,
    overall_multiple: overallMultiple(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board,
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
