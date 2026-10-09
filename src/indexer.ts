// Scans Papertrade Exchange deposit/withdraw events on HyperEVM and writes the
// depositor ranking consumed by site/.
//
//   npx tsx src/depositors/indexer.ts [--from 47854413] [--to <block>] [--no-names]
//
// Resumable: data/depositors/checkpoint.json keeps every decoded event and the
// block scanned so far, so re-running only fetches new blocks.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EXCHANGE, ORIGIN, RPC_URL } from "./config.js";
import {
  DEPOSIT_TOPIC,
  WITHDRAW_TOPIC,
  decodeExchangeLog,
  deserializeEvent,
  eventKey,
  serializeEvent,
  type ExchangeEvent,
  type Hex,
  type RawLog,
} from "./events.js";
import { buildRanking, makeTimestampInterpolator } from "./rank.js";

/**
 * First HyperEVM block at or after the protocol genesis reported by
 * GET /query/protocol/summary (genesis = 1791326520000 ms, 2026-10-06 22:42:00 UTC).
 * Located by binary search over block timestamps on 2026-10-09.
 */
export const GENESIS_BLOCK = 47854413;

/** Public RPC rejects eth_getLogs ranges wider than 1000 blocks. */
export const MAX_LOG_RANGE = 1000;

export const CHECKPOINT_PATH = "data/depositors/checkpoint.json";
export const RANKING_PATH = "site/data/ranking.json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Endpoints are used round-robin; a rate-limited reply moves to the next one.
 * Override with PAPERTRADE_RPCS="https://a,https://b". Every endpoint must
 * serve chain 999 and accept 1000-block eth_getLogs ranges.
 */
export const RPC_ENDPOINTS: string[] = (process.env.PAPERTRADE_RPCS || `${RPC_URL},https://rpc.hypurrscan.io`).split(",").map((s) => s.trim()).filter(Boolean);
let rpcCursor = 0;

/** One block timestamp is sampled every TS_SAMPLE_WINDOWS windows for interpolation. */
export const TS_SAMPLE_WINDOWS = 5;

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2);
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  }
  return out;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = RPC_ENDPOINTS[rpcCursor++ % RPC_ENDPOINTS.length];
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).catch((e: Error) => e);
    if (res instanceof Error) {
      lastError = res.message;
    } else {
      const body = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
      if (body && body.result !== undefined) return body.result;
      lastError = body?.error?.message ?? `HTTP ${res.status}`;
      if (!/rate limit|429|timeout|busy/i.test(lastError) && res.status !== 429 && res.status < 500) {
        throw new Error(`${method}: ${lastError}`);
      }
    }
    // Try the next endpoint right away; back off only once every endpoint has refused.
    await sleep(attempt % RPC_ENDPOINTS.length === RPC_ENDPOINTS.length - 1 ? 1000 * (attempt + 1) : 100);
  }
  throw new Error(`${method}: gave up (${lastError})`);
}

export interface Checkpoint {
  version: 1;
  chainId: 999;
  exchange: Hex;
  fromBlock: number;
  /** Inclusive. */
  scannedThrough: number;
  events: ExchangeEvent[];
  /** Sampled [block, unix seconds] pairs used for interpolation. */
  blockTimestamps: [number, number][];
}

function loadCheckpoint(fromBlock: number): Checkpoint {
  if (existsSync(CHECKPOINT_PATH)) {
    const raw = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8"));
    if (raw.exchange === EXCHANGE && raw.fromBlock === fromBlock) {
      return { ...raw, events: raw.events.map(deserializeEvent) };
    }
    console.error(`checkpoint ignored: exchange/fromBlock differ (${raw.exchange}, ${raw.fromBlock})`);
  }
  return { version: 1, chainId: 999, exchange: EXCHANGE, fromBlock, scannedThrough: fromBlock - 1, events: [], blockTimestamps: [] };
}

function writeJsonAtomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  renameSync(tmp, path);
}

function saveCheckpoint(cp: Checkpoint) {
  writeJsonAtomic(CHECKPOINT_PATH, { ...cp, events: cp.events.map(serializeEvent) });
}

async function blockTimestamp(block: number): Promise<number> {
  const b = await rpc<{ timestamp: Hex }>("eth_getBlockByNumber", [`0x${block.toString(16)}`, false]);
  return Number(BigInt(b.timestamp));
}

/** Fetches display names from the official leaderboard. Fails soft. */
export async function fetchLeaderboardNames(): Promise<{ names: Map<string, string>; uniqueAccounts: number | null; trackedBalance: string | null }> {
  const names = new Map<string, string>();
  let uniqueAccounts: number | null = null;
  let trackedBalance: string | null = null;
  try {
    for (const pageSize of [200, 25]) {
      names.clear();
      let totalPages = 1;
      let ok = true;
      for (let page = 0; page < totalPages; page++) {
        // The server requires parameters sorted by name, each once.
        const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortDir: "desc", sortKey: "currentBalance", window: "all" });
        const res = await fetch(`${ORIGIN}/state/leaderboard/accounts?${q}`, { headers: { accept: "application/json" } });
        if (res.status === 429) {
          await sleep(Number(res.headers.get("retry-after") ?? "2") * 1000);
          page--;
          continue;
        }
        if (!res.ok) { ok = false; break; }
        const body = (await res.json()) as {
          ok: boolean;
          summary?: { uniqueAccounts: number; trackedBalance: string };
          accounts: { address: string; leaderboardName: string | null }[];
          pageInfo: { totalPages: number };
        };
        if (!body.ok) { ok = false; break; }
        uniqueAccounts = body.summary?.uniqueAccounts ?? uniqueAccounts;
        trackedBalance = body.summary?.trackedBalance ?? trackedBalance;
        totalPages = body.pageInfo.totalPages;
        for (const a of body.accounts) if (a.leaderboardName) names.set(a.address.toLowerCase(), a.leaderboardName);
        await sleep(120);
      }
      if (ok) break;
    }
  } catch (e) {
    console.error(`leaderboard names unavailable: ${(e as Error).message}`);
  }
  return { names, uniqueAccounts, trackedBalance };
}

/** Display names from the Hyperliquid leaderboard (public JSON, ~40 MB). Fails soft. */
export async function fetchHyperliquidNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const res = await fetch("https://stats-data.hyperliquid.xyz/Mainnet/leaderboard", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { leaderboardRows?: { ethAddress: string; displayName: string | null }[] };
    for (const r of body.leaderboardRows ?? []) if (r.displayName) names.set(r.ethAddress.toLowerCase(), r.displayName);
  } catch (e) {
    console.error(`hyperliquid names unavailable: ${(e as Error).message}`);
  }
  return names;
}

async function fetchProtocolTvl(): Promise<string | null> {
  try {
    const res = await fetch(`${ORIGIN}/query/protocol/summary`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: boolean; balances?: { tvl: string } };
    return body.ok ? body.balances?.tvl ?? null : null;
  } catch {
    return null;
  }
}

export interface IndexOptions {
  fromBlock?: number;
  toBlock?: number;
  withNames?: boolean;
  log?: (line: string) => void;
}

export async function runIndexer(opts: IndexOptions = {}): Promise<{ scannedThrough: number; depositors: number }> {
  const log = opts.log ?? ((l: string) => console.error(l));
  const fromBlock = opts.fromBlock ?? GENESIS_BLOCK;
  const cp = loadCheckpoint(fromBlock);
  const head = opts.toBlock ?? Number(BigInt(await rpc<Hex>("eth_blockNumber", [])));
  const known = new Set(cp.events.map(eventKey));

  if (cp.blockTimestamps.length === 0) cp.blockTimestamps.push([fromBlock, await blockTimestamp(fromBlock)]);

  let start = cp.scannedThrough + 1;
  let windows = 0;
  log(`scan ${start} -> ${head} (${Math.max(0, head - start + 1)} blocks)`);
  while (start <= head) {
    const end = Math.min(start + MAX_LOG_RANGE - 1, head);
    const logs = await rpc<RawLog[]>("eth_getLogs", [
      { address: EXCHANGE, topics: [[DEPOSIT_TOPIC, WITHDRAW_TOPIC]], fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` },
    ]);
    let added = 0;
    for (const raw of logs) {
      const e = decodeExchangeLog(raw);
      if (!e) continue;
      const k = eventKey(e);
      if (known.has(k)) continue;
      known.add(k);
      cp.events.push(e);
      added++;
    }
    windows++;
    if (windows % TS_SAMPLE_WINDOWS === 0 || end === head) cp.blockTimestamps.push([end, await blockTimestamp(end)]);
    cp.scannedThrough = end;
    if (windows % 10 === 0 || end === head) {
      saveCheckpoint(cp);
      log(`through ${end}: +${added} events this window, ${cp.events.length} total`);
    }
    start = end + 1;
    await sleep(60);
  }
  cp.events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  saveCheckpoint(cp);

  const enrichment = opts.withNames === false ? { names: new Map<string, string>(), uniqueAccounts: null, trackedBalance: null } : await fetchLeaderboardNames();
  const tvl = await fetchProtocolTvl();
  const hlNames = opts.withNames === false ? new Map<string, string>() : await fetchHyperliquidNames();
  const tsOf = makeTimestampInterpolator(cp.blockTimestamps);
  const { rows, totals } = buildRanking(cp.events, { tsOf, names: enrichment.names, hlNames });
  const toTs = cp.blockTimestamps.length ? cp.blockTimestamps[cp.blockTimestamps.length - 1][1] : null;
  writeJsonAtomic(RANKING_PATH, {
    generatedAt: new Date().toISOString(),
    chainId: 999,
    exchange: EXCHANGE,
    explorer: "https://hyperevmscan.io",
    fromBlock,
    toBlock: cp.scannedThrough,
    toBlockTs: toTs,
    totals,
    crossCheck: {
      /** 18-decimal strings from the official API, for comparison with totals.netUsdc (8 decimals). */
      apiTvl18: tvl,
      apiTrackedBalance18: enrichment.trackedBalance,
      apiUniqueAccounts: enrichment.uniqueAccounts,
    },
    rows,
  });
  log(`ranking written: ${rows.length} depositors, ${totals.deposits} deposits, net ${totals.netUsdc} (8dp)`);
  return { scannedThrough: cp.scannedThrough, depositors: rows.length };
}

const isMain = process.argv[1] && /indexer\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  runIndexer({
    fromBlock: args.from ? Number(args.from) : undefined,
    toBlock: args.to ? Number(args.to) : undefined,
    withNames: args["no-names"] !== "true",
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
