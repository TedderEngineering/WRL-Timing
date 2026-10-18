import { describe, expect, it } from "vitest";
import { PitLearner, lapMedian, pitForAt, pitLearnerFor, pitSinceNow } from "../pits.js";
import { IN_PIT, type CarPlace } from "../track.js";

const LEN = 5734;

describe("where the pit lane is, from the pit flags", () => {
  it("learns pit in, pit out and the limiter speed from flags coming on and clearing (Sebring, Sunday)", () => {
    const p = new PitLearner();
    const read = (cars: CarPlace[]) => p.take(cars);
    read([["119", 5597, 36, 0], ["120", 5430, 76, 0]]);
    read([["119", 5684, 35, IN_PIT], ["120", 5565, 36, 0]]);
    read([["119", 5, 18, IN_PIT], ["120", 5724, 35, IN_PIT]]);
    read([["119", 832, 90, 0], ["120", 25, 1, IN_PIT]]);
    expect(p.lane(LEN)).toEqual({ in: 5724, out: 832, mph: 35, n: 2 });
  });

  it("knows nothing before a pit entry, and does not count a car already in the pits at the first reading", () => {
    const p = new PitLearner();
    p.take([["87", 439, 0, IN_PIT]]);
    p.take([["87", 439, 0, IN_PIT]]);
    expect(p.lane(LEN)).toBeNull();
  });

  it("keeps a speed that is not a pit-lane speed out of the limiter", () => {
    const p = new PitLearner();
    p.take([["1", 5600, 120, 0]]);
    p.take([["1", 5700, 120, IN_PIT]]);
    expect(p.lane(LEN)).toMatchObject({ in: 5700, mph: null });
  });

  it("takes the middle of places across the line without splitting them", () => {
    expect(lapMedian([5720, 10, 5730], LEN)).toBe(5730);
    expect(lapMedian([20, 5725, 30], LEN)).toBe(20);
    expect(lapMedian([], LEN)).toBeNull();
  });

  it("is shared by a track's sessions", () => {
    expect(pitLearnerFor("Sebring International Raceway")).toBe(pitLearnerFor(" sebring international raceway "));
  });
});

describe("how long each car has been in the pits", () => {
  const at = (t: number, cars: CarPlace[]) => ({ t, cars });
  it("times a car from the read its flag came on, while it stays in", () => {
    const seen = new Set<string>();
    let since = pitSinceNow(new Map(), seen, at(1000, [["48", 5600, 80, 0]]));
    since = pitSinceNow(since, seen, at(6000, [["48", 5700, 35, IN_PIT]]));
    since = pitSinceNow(since, seen, at(50_000, [["48", 20, 0, IN_PIT]]));
    expect(pitForAt(since, 50_000)).toEqual({ "48": 44_000 });
  });
  it("leaves out a car already in the pits when first seen (in before the server was watching), and drops a car once out", () => {
    const seen = new Set<string>();
    let since = pitSinceNow(new Map(), seen, at(1000, [["97", 20, 0, IN_PIT], ["48", 20, 0, IN_PIT]]));
    expect(pitForAt(since, 9000)).toEqual({});
    since = pitSinceNow(since, seen, at(6000, [["97", 20, 0, IN_PIT], ["48", 900, 80, 0]]));
    expect([...since.keys()]).toEqual(["97"]);
  });
});
