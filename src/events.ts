// Papertrade Exchange events relevant to deposits.
//
// The Exchange ABI is not published. The topic hashes below were observed on
// HyperEVM mainnet (2026-10-09) and confirmed to be PUSH32 constants in the
// Exchange implementation bytecode. Their field layout was read from live
// transaction receipts, not from a source file, so the names are descriptive
// labels rather than the contract's own event names.

export type Hex = `0x${string}`;

/**
 * Emitted by the Exchange when a deposit that arrived through the user's
 * DepositProxy is registered.
 *   topics[1] = user, topics[2] = proxy
 *   data      = (amount in USDC with 8 decimals, uint256 0 so far, block number)
 * The 8-decimal scale is HyperCore's USDC scale; it matches the official
 * leaderboard balances (18 decimals) exactly once rescaled.
 */
export const DEPOSIT_TOPIC: Hex = "0x02d61879cd72906e0951e3a96096407dd2b1f2cd2d063dae983bb20216cf3025";

/**
 * Emitted by the Exchange when a withdrawToCore is executed.
 *   topics[1] = user
 *   data      = (amount 18dp, amount in USDC with 8 decimals)
 * Both words carry the same amount at different scales.
 */
export const WITHDRAW_TOPIC: Hex = "0x95d1a93901f24eeaa294588802f66fa008f9f3741060c9f79e5dab4709de5e75";

export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}

export interface DepositEvent {
  kind: "deposit";
  user: Hex;
  proxy: Hex;
  /** USDC with 8 decimals (HyperCore scale), as emitted. */
  amountUsdc: bigint;
  block: number;
  txHash: Hex;
  logIndex: number;
}

export interface WithdrawEvent {
  kind: "withdraw";
  user: Hex;
  amountUsdc: bigint;
  block: number;
  txHash: Hex;
  logIndex: number;
}

export type ExchangeEvent = DepositEvent | WithdrawEvent;

export function topicToAddress(topic: Hex): Hex {
  return `0x${topic.slice(-40).toLowerCase()}` as Hex;
}

export function dataWords(data: Hex): bigint[] {
  const body = data.slice(2);
  const out: bigint[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(BigInt(`0x${body.slice(i, i + 64)}`));
  return out;
}

/** Returns null for logs that are not one of the two tracked events. */
export function decodeExchangeLog(log: RawLog): ExchangeEvent | null {
  const topic0 = log.topics[0]?.toLowerCase();
  const block = Number(BigInt(log.blockNumber));
  const logIndex = Number(BigInt(log.logIndex));
  const words = dataWords(log.data);
  if (topic0 === DEPOSIT_TOPIC && log.topics.length === 3 && words.length >= 1) {
    return {
      kind: "deposit",
      user: topicToAddress(log.topics[1]),
      proxy: topicToAddress(log.topics[2]),
      amountUsdc: words[0],
      block,
      txHash: log.transactionHash,
      logIndex,
    };
  }
  if (topic0 === WITHDRAW_TOPIC && log.topics.length === 2 && words.length >= 2) {
    return {
      kind: "withdraw",
      user: topicToAddress(log.topics[1]),
      amountUsdc: words[1],
      block,
      txHash: log.transactionHash,
      logIndex,
    };
  }
  return null;
}

export function eventKey(e: ExchangeEvent): string {
  return `${e.txHash}:${e.logIndex}`;
}

/** JSON helpers: bigint <-> decimal string. */
export function serializeEvent(e: ExchangeEvent): Record<string, unknown> {
  return { ...e, amountUsdc: e.amountUsdc.toString() };
}

export function deserializeEvent(o: Record<string, unknown>): ExchangeEvent {
  return { ...(o as object), amountUsdc: BigInt(o.amountUsdc as string) } as ExchangeEvent;
}
