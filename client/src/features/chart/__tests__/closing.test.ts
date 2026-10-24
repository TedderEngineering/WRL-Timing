import { describe, expect, it } from "vitest";
import { closingOnFocus } from "../closing";

describe("cars catching the focus car within its next lap", () => {
  // A 6000 m lap. The focus car (246) laps in 150 s (40 m/s) and is 3000 m past the line.
  const pace = (k: number) => ({ 246: 150, 5: 120, 38: 140, 120: 151, 99: 149.5, 7: 120 })[k] ?? null;
  const places = [
    { key: 246, d: 3000, inPit: false },
    { key: 5, d: 2600, inPit: false }, // 400 m behind, 50 m/s: closes 10 m/s, there in 40 s
    { key: 38, d: 2900, inPit: false }, // 100 m behind, 42.86 m/s: closes 2.86 m/s, there in 35 s
    { key: 120, d: 2950, inPit: false }, // slower: never
    { key: 99, d: 1000, inPit: false }, // 2000 m behind, 0.5 s a lap quicker: not this lap
    { key: 7, d: 2990, inPit: true }, // in the pits
  ];

  it("lists the cars that get to it within its lap, soonest first, with when and where", () => {
    const c = closingOnFocus({ places, focusKey: 246, len: 6000, pace });
    expect(c.map((x) => x.key)).toEqual([38, 5]);
    expect(c[0].catchS).toBeCloseTo(100 / (6000 / 140 - 40), 6);
    expect(c[0].behindS).toBeCloseTo(2.5, 6);
    expect(c[0].quickerS).toBe(10);
    expect(c[1].catchS).toBeCloseTo(40, 6);
    // #5 gets there 40 s on, 1600 m further round: 4600 m past the line.
    expect(c[1].meetD).toBeCloseTo(4600, 6);
  });

  it("counts a car behind across the line, and a faster class lapping it", () => {
    const c = closingOnFocus({ places: [{ key: 246, d: 100, inPit: false }, { key: 5, d: 5800, inPit: false }], focusKey: 246, len: 6000, pace });
    expect(c.map((x) => x.key)).toEqual([5]);
    expect(c[0].catchS).toBeCloseTo(30, 6); // 300 m at 10 m/s
  });

  it("lists nothing under a caution, with the focus car in the pits, or without its pace", () => {
    expect(closingOnFocus({ places, focusKey: 246, len: 6000, pace, caution: true })).toEqual([]);
    expect(closingOnFocus({ places: places.map((p) => (p.key === 246 ? { ...p, inPit: true } : p)), focusKey: 246, len: 6000, pace })).toEqual([]);
    expect(closingOnFocus({ places, focusKey: 246, len: 6000, pace: (k) => (k === 246 ? null : pace(k)) })).toEqual([]);
  });
});
