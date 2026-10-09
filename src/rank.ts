// Pure aggregation: Exchange events -> depositor ranking rows.

import type { ExchangeEvent, Hex } from "./events.js";

export type SortKey = "deposited" | "net" | "count" | "latest" | "largest";

export interface DepositorRow {
  rank: number;
  address: Hex;
  proxy: Hex | null;
  /** Display name on the Papertrade leaderboard. */
  name: string | null;
  /** Display name on the Hyperliquid leaderboard, when the wallet has one. */
  hlName: string | null;
  depositedUsdc: string;
  withdrawnUsdc: string;
  netUsdc: string;
  depositCount: number;
  withdrawCount: number;
  largestUsdc: string;
  firstBlock: number;
  lastBlock: number;
  /** Unix seconds, interpolated from sampled block timestamps. */
  firstTs: number | null;
  lastTs: number | null;
  /** Transaction hashes of the largest, first and last deposit. */
  largestTx: Hex | null;
  firstTx: Hex | null;
  lastTx: Hex | null;
}

export interface RankingTotals {
  depositors: number;
  deposits: number;
  withdrawals: number;
  depositedUsdc: string;
  withdrawnUsdc: string;
  netUsdc: string;
}

interface Agg {
  address: Hex;
  proxy: Hex | null;
  deposited: bigint;
  withdrawn: bigint;
  depositCount: number;
  withdrawCount: number;
  largest: bigint;
  firstBlock: number;
  lastBlock: number;
  largestTx: Hex | null;
  firstTx: Hex | null;
  lastTx: Hex | null;
}

export function aggregate(events: Iterable<ExchangeEvent>): Map<Hex, Agg> {
  const m = new Map<Hex, Agg>();
  for (const e of events) {
    let a = m.get(e.user);
    if (!a) {
      a = { address: e.user, proxy: null, deposited: 0n, withdrawn: 0n, depositCount: 0, withdrawCount: 0, largest: 0n, firstBlock: Infinity, lastBlock: -Infinity, largestTx: null, firstTx: null, lastTx: null };
      m.set(e.user, a);
    }
    if (e.kind === "deposit") {
      a.proxy ??= e.proxy;
      a.deposited += e.amountUsdc;
      a.depositCount += 1;
      if (e.amountUsdc > a.largest) { a.largest = e.amountUsdc; a.largestTx = e.txHash; }
      if (e.block < a.firstBlock) { a.firstBlock = e.block; a.firstTx = e.txHash; }
      if (e.block >= a.lastBlock) { a.lastBlock = e.block; a.lastTx = e.txHash; }
    } else {
      a.withdrawn += e.amountUsdc;
      a.withdrawCount += 1;
    }
  }
  return m;
}

function cmpBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortRows(rows: DepositorRow[], key: SortKey): DepositorRow[] {
  const by: Record<SortKey, (a: DepositorRow, b: DepositorRow) => number> = {
    deposited: (a, b) => cmpBig(BigInt(b.depositedUsdc), BigInt(a.depositedUsdc)),
    net: (a, b) => cmpBig(BigInt(b.netUsdc), BigInt(a.netUsdc)),
    count: (a, b) => b.depositCount - a.depositCount,
    latest: (a, b) => b.lastBlock - a.lastBlock,
    largest: (a, b) => cmpBig(BigInt(b.largestUsdc), BigInt(a.largestUsdc)),
  };
  const sorted = [...rows].sort((a, b) => by[key](a, b) || a.firstBlock - b.firstBlock || a.address.localeCompare(b.address));
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface BuildOptions {
  sortBy?: SortKey;
  tsOf?: (block: number) => number | null;
  names?: ReadonlyMap<string, string>;
  hlNames?: ReadonlyMap<string, string>;
}

export function buildRanking(events: Iterable<ExchangeEvent>, opts: BuildOptions = {}): { rows: DepositorRow[]; totals: RankingTotals } {
  const tsOf = opts.tsOf ?? (() => null);
  const rows: DepositorRow[] = [];
  let deposited = 0n, withdrawn = 0n, deposits = 0, withdrawals = 0;
  for (const a of aggregate(events).values()) {
    deposited += a.deposited;
    withdrawn += a.withdrawn;
    deposits += a.depositCount;
    withdrawals += a.withdrawCount;
    if (a.depositCount === 0) continue; // withdraw-only rows cannot exist on-chain, but keep the ranking to depositors
    rows.push({
      rank: 0,
      address: a.address,
      proxy: a.proxy,
      name: opts.names?.get(a.address) ?? null,
      hlName: opts.hlNames?.get(a.address) ?? null,
      depositedUsdc: a.deposited.toString(),
      withdrawnUsdc: a.withdrawn.toString(),
      netUsdc: (a.deposited - a.withdrawn).toString(),
      depositCount: a.depositCount,
      withdrawCount: a.withdrawCount,
      largestUsdc: a.largest.toString(),
      firstBlock: a.firstBlock,
      lastBlock: a.lastBlock,
      firstTs: tsOf(a.firstBlock),
      lastTs: tsOf(a.lastBlock),
      largestTx: a.largestTx,
      firstTx: a.firstTx,
      lastTx: a.lastTx,
    });
  }
  return {
    rows: sortRows(rows, opts.sortBy ?? "deposited"),
    totals: {
      depositors: rows.length,
      deposits,
      withdrawals,
      depositedUsdc: deposited.toString(),
      withdrawnUsdc: withdrawn.toString(),
      netUsdc: (deposited - withdrawn).toString(),
    },
  };
}

/**
 * Linear interpolation over sampled (block, unix seconds) pairs. Blocks outside
 * the sampled range clamp to the nearest sample. Returns null with no samples.
 */
export function makeTimestampInterpolator(samples: ReadonlyArray<readonly [number, number]>): (block: number) => number | null {
  const s = [...samples].sort((a, b) => a[0] - b[0]);
  if (s.length === 0) return () => null;
  return (block) => {
    if (block <= s[0][0]) return s[0][1];
    if (block >= s[s.length - 1][0]) return s[s.length - 1][1];
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid][0] <= block) lo = mid; else hi = mid;
    }
    const [b0, t0] = s[lo], [b1, t1] = s[hi];
    if (b1 === b0) return t0;
    return Math.round(t0 + ((t1 - t0) * (block - b0)) / (b1 - b0));
  };
}
