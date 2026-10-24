import { describe, expect, it } from "vitest";
import { ghostTraffic } from "../ghost-traffic";

describe("traffic around the pit ghost", () => {
  // A 6000 m lap. The ghost is at 1000 m going 40 m/s (150 s laps); a 3 s window is 120 m.
  const len = 6000;

  it("lists the cars it would come out among, nearest first: − ahead of it, + behind", () => {
    const t = ghostTraffic({
      cars: [
        { key: 62, d: 1080, v: 36 }, // 80 m ahead: −2.0 s
        { key: 64, d: 960, v: 36 }, // 40 m behind: +1.0 s
        { key: 5, d: 1500, v: 36 }, // 500 m ahead: not near
      ],
      ghostD: 1000,
      ghostV: 40,
      len,
      windowS: 3,
    });
    expect(t.near).toEqual([
      { key: 64, gapS: 1 },
      { key: 62, gapS: -2 },
    ]);
    expect(t.clearInS).toBeGreaterThan(0);
  });

  it("says when the ghost comes out clear: once past a slower pack, until it reaches the next", () => {
    // A pack just ahead going 4 m/s slower: the ghost is clear of it once 120 m past #62 (80 m
    // ahead now): (80 + 120) / 4 = 50 s. The next car, 1210 m ahead at 36 m/s, is within 120 m
    // after (1210 − 120) / 4 = 272.5 s: clear from 50 s to 273 s, 223 s.
    const t = ghostTraffic({
      cars: [
        { key: 62, d: 1080, v: 36 },
        { key: 64, d: 1040, v: 36 },
        { key: 7, d: 2210, v: 36 },
      ],
      ghostD: 1000,
      ghostV: 40,
      len,
      windowS: 3,
    });
    expect(t.clearInS).toBe(50);
    expect(t.clearForS).toBe(223);
  });

  it("is clear now with no one within the window, and gives no clear-in under a caution", () => {
    expect(ghostTraffic({ cars: [{ key: 5, d: 3000, v: 40 }], ghostD: 1000, ghostV: 40, len, windowS: 3 })).toMatchObject({ near: [], clearInS: 0 });
    const c = ghostTraffic({ cars: [{ key: 62, d: 1040, v: 36 }], ghostD: 1000, ghostV: 40, len, windowS: 3, caution: true });
    expect(c.near.map((n) => n.key)).toEqual([62]);
    expect(c.clearInS).toBeNull();
  });
});
