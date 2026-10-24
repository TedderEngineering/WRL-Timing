import { describe, expect, it } from "vitest";
import { GHOST_KEY, ghostPlace } from "../pit-ghost";
import { leaderOrder, trackOrder } from "../LiveTrackOrder";

describe("the pit ghost", () => {
  // A 6000 m lap at 40 m/s; the focus car (246) is 3000 m past the line.
  it("is the lost time behind the focus car on the road, round the lap", () => {
    expect(ghostPlace(3000, 40, 65, 6000)).toBe(400);
    expect(ghostPlace(1000, 40, 65, 6000)).toBe(4400); // behind it across the line
  });

  it("takes its place in the Live Crossing Order among the cars it would come out with", () => {
    const places = [
      { key: 246, d: 3000, inPit: false },
      { key: 38, d: 420, inPit: false }, // 20 m ahead of the ghost
      { key: 5, d: 300, inPit: false }, // 100 m behind it
      { key: GHOST_KEY, d: ghostPlace(3000, 40, 65, 6000), inPit: false },
    ];
    const rows = trackOrder(places, 246, 6000, 40);
    expect(rows.map((r) => r.key)).toEqual([246, 38, GHOST_KEY, 5]);
    expect(rows.find((r) => r.key === GHOST_KEY)?.gapS).toBeCloseTo(65, 6);
    // From the leader, in its place on the road too.
    const fromLeader = leaderOrder(places, 246, () => 0, 6000, 40);
    expect(fromLeader.map((r) => r.key)).toEqual([246, 38, GHOST_KEY, 5]);
  });
});
