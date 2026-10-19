import { describe, expect, it } from "vitest";
import { carHighlights, driverHighlights, racingLaps, strength } from "../highlights.js";
import { carFacts } from "../my-car.js";

// Five GS cars over 30 laps. #1: quickest laps (100 s), one stop (lap 15), leads from lap 2, wins.
// #2-#5 slower, two stops each (laps 10 and 20); #5 the slowest. Positions follow the order.
const lap = (l: number, p: number, cp: number, ltSec: number, pit = 0, flag = "GF") => ({ l, p, cp, ltSec, pit, flag, lt: "" });
function car(num: number, base: number, stops: number[], cpAt: (l: number) => number) {
  return {
    num, cls: "GS", team: `Team ${num}`, finishPos: cpAt(30), finishPosClass: cpAt(30),
    laps: Array.from({ length: 30 }, (_, i) => {
      const l = i + 1;
      const pit = stops.includes(l) ? 1 : 0;
      return lap(l, cpAt(l), cpAt(l), pit ? base + 60 : base + (l % 3) * 0.2, pit);
    }),
  };
}
const data: any = {
  maxLap: 30,
  classCarCounts: { GS: 5 },
  cars: {
    "1": car(1, 100, [15], (l) => (l === 1 ? 3 : 1)),
    "2": car(2, 101, [10, 20], (l) => (l === 1 ? 1 : 2)),
    "3": car(3, 101.5, [10, 20], (l) => (l === 1 ? 2 : 3)),
    "4": car(4, 102, [10, 20], () => 4),
    "5": car(5, 103, [10, 20], () => 5),
  },
};
const ann: any = {
  "1": { pits: [{ l: 15, inDriver: "Alex Rivera", outDriver: "Jamie Cole" }] },
  "2": { pits: [{ l: 10, inDriver: "Sam Hill", outDriver: "Pat Lee" }, { l: 20, inDriver: "Pat Lee", outDriver: "Sam Hill" }] },
  "3": { pits: [{ l: 10, inDriver: "Kim Ode", outDriver: "Lou Park" }, { l: 20, inDriver: "Lou Park", outDriver: "Kim Ode" }] },
};

describe("car highlights", () => {
  it("rank what went right: the win, the race pace, the fewest stops, laps led", () => {
    const f = carFacts(data, ann, "1")!;
    const h = f.highlights;
    expect(h[0]).toMatchObject({ kind: "result", text: "Won GS and the race overall" });
    const kinds = h.map((x) => x.kind);
    expect(kinds).toContain("race_pace");
    expect(kinds).toContain("fewest_stops");
    expect(kinds).toContain("laps_led");
    expect(h.find((x) => x.kind === "race_pace")!.text).toBe("Best race pace in GS");
    expect(h.find((x) => x.kind === "fewest_stops")!.text).toBe("1 pit stop, fewest in GS");
    expect(kinds.indexOf("race_pace")).toBeLessThan(kinds.indexOf("fastest_lap"));
    // Scores go down the list.
    expect(h.map((x) => x.score)).toEqual([...h.map((x) => x.score)].sort((a, b) => b - a));
  });

  it("never make a weak result a highlight", () => {
    const h = carFacts(data, ann, "5")!.highlights;
    expect(h.some((x) => x.kind === "race_pace" || x.kind === "fastest_lap" || x.kind === "result")).toBe(false);
  });

  it("measure the race pace on racing laps only, and weight ranks by the field", () => {
    expect(racingLaps(data.cars["1"].laps)).not.toContain(160);
    expect(strength(1, 16)).toBe(1);
    expect(strength(1, 3)).toBeLessThan(strength(1, 16));
    expect(strength(3, 16)).toBeLessThan(strength(1, 16));
    expect(carHighlights(data, ann, "nope", carFacts(data, ann, "1")!)).toEqual([]);
  });
});

describe("driver highlights", () => {
  const drivers = { "1": ["Alex Rivera", "Jamie Cole"], "2": ["Sam Hill", "Pat Lee"], "3": ["Kim Ode", "Lou Park"], "4": [], "5": [] };
  it("measure the driver against every driver in the class, and credit bringing the car home", () => {
    const f = carFacts(data, ann, "1")!;
    const cole = driverHighlights(data, ann, "1", "Jamie Cole", drivers, f);
    expect(cole[0]).toMatchObject({ kind: "brought_home", text: "Brought #1 home to the GS win" });
    expect(cole.map((x) => x.kind)).toContain("driver_laps_led");
    const rivera = driverHighlights(data, ann, "1", "Alex Rivera", drivers, f);
    expect(rivera.some((x) => x.kind === "brought_home")).toBe(false);
    expect(rivera.map((x) => x.kind)).toContain("driver_best_lap");
  });

  it("give nothing to a driver who isn't in the car", () => {
    expect(driverHighlights(data, ann, "1", "Sam Hill", drivers, carFacts(data, ann, "1"))).toEqual([]);
  });
});
