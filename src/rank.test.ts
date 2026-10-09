import { describe, expect, it } from "vitest";
import type { ExchangeEvent } from "./events.js";
import { buildRanking, makeTimestampInterpolator, sortRows } from "./rank.js";

const A = "0x000000000000000000000000000000000000000a" as const;
const B = "0x000000000000000000000000000000000000000b" as const;
const PA = "0x00000000000000000000000000000000000000aa" as const;
const PB = "0x00000000000000000000000000000000000000bb" as const;

const events: ExchangeEvent[] = [
  { kind: "deposit", user: A, proxy: PA, amountUsdc: 1_000_000_000n, block: 100, txHash: "0x1", logIndex: 0 },
  { kind: "deposit", user: B, proxy: PB, amountUsdc: 5_000_000_000n, block: 110, txHash: "0x2", logIndex: 0 },
  { kind: "deposit", user: A, proxy: PA, amountUsdc: 3_000_000_000n, block: 120, txHash: "0x3", logIndex: 0 },
  { kind: "withdraw", user: B, amountUsdc: 4_500_000_000n, block: 130, txHash: "0x4", logIndex: 0 },
];

describe("buildRanking", () => {
  it("aggregates per user and ranks by total deposited", () => {
    const { rows, totals } = buildRanking(events, { names: new Map([[A, "alice"]]) });
    expect(rows.map((r) => [r.rank, r.address])).toEqual([[1, B], [2, A]]);
    const b = rows[0], a = rows[1];
    expect(b).toMatchObject({ depositedUsdc: "5000000000", withdrawnUsdc: "4500000000", netUsdc: "500000000", depositCount: 1, withdrawCount: 1, largestUsdc: "5000000000", firstBlock: 110, lastBlock: 110, name: null, proxy: PB });
    expect(a).toMatchObject({ depositedUsdc: "4000000000", withdrawnUsdc: "0", netUsdc: "4000000000", depositCount: 2, largestUsdc: "3000000000", firstBlock: 100, lastBlock: 120, name: "alice", proxy: PA });
    expect(totals).toEqual({ depositors: 2, deposits: 3, withdrawals: 1, depositedUsdc: "9000000000", withdrawnUsdc: "4500000000", netUsdc: "4500000000" });
  });

  it("sorts by net, count, latest and largest", () => {
    const { rows } = buildRanking(events);
    expect(sortRows(rows, "net").map((r) => r.address)).toEqual([A, B]);
    expect(sortRows(rows, "count").map((r) => r.address)).toEqual([A, B]);
    expect(sortRows(rows, "latest").map((r) => r.address)).toEqual([A, B]);
    expect(sortRows(rows, "largest").map((r) => r.address)).toEqual([B, A]);
    expect(sortRows(rows, "net")[0].rank).toBe(1);
  });

  it("breaks ties by earliest first deposit", () => {
    const tie: ExchangeEvent[] = [
      { kind: "deposit", user: B, proxy: PB, amountUsdc: 10n, block: 5, txHash: "0x1", logIndex: 0 },
      { kind: "deposit", user: A, proxy: PA, amountUsdc: 10n, block: 3, txHash: "0x2", logIndex: 0 },
    ];
    expect(buildRanking(tie).rows.map((r) => r.address)).toEqual([A, B]);
  });

  it("interpolates first/last timestamps from samples", () => {
    const tsOf = makeTimestampInterpolator([[100, 1000], [200, 1100]]);
    const { rows } = buildRanking(events, { tsOf });
    const a = rows.find((r) => r.address === A)!;
    expect(a.firstTs).toBe(1000);
    expect(a.lastTs).toBe(1020);
  });
});

describe("makeTimestampInterpolator", () => {
  it("clamps outside the sampled range and interpolates inside", () => {
    const f = makeTimestampInterpolator([[200, 2000], [100, 1000], [300, 4000]]);
    expect(f(50)).toBe(1000);
    expect(f(150)).toBe(1500);
    expect(f(250)).toBe(3000);
    expect(f(999)).toBe(4000);
  });
  it("returns null without samples", () => {
    expect(makeTimestampInterpolator([])(1)).toBeNull();
  });
});
