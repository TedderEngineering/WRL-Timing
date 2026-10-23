import { describe, expect, it } from "vitest";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { CAUTION_SHARE, liveStrategy, markSplashes, passLane, STINT_SLACK, type Stop } from "../live-strategy";

/**
 * A class of cars at `pace` s/lap with a stop (a 100 s longer in-lap) at each lap in `stops`.
 * The car's laps run to `laps`.
 */
function car(num: number, laps: number, pace: number, stops: number[], cls = "GTO", startLoss = 0) {
  return {
    num,
    team: `Team ${num}`,
    cls,
    finishPos: 0,
    finishPosClass: 0,
    laps: Array.from({ length: laps }, (_, i) => {
      const l = i + 1;
      const pit = stops.includes(l) ? 1 : 0;
      const ltSec = pace + (pit ? 100 : 0) + (stops.includes(l - 1) ? 10 : 0) + (l === 1 ? startLoss : 0);
      return { l, p: 0, cp: 0, lt: "", ltSec, flag: "GREEN", pit };
    }),
  };
}

function race(cars: ReturnType<typeof car>[], fcy: [number, number][] = []): { data: RaceChartData; annotations: AnnotationData } {
  const data = {
    maxLap: Math.max(...cars.map((c) => c.laps.length)),
    totalCars: cars.length,
    greenPaceCutoff: 200,
    cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
    fcy,
    classGroups: { GTO: cars.map((c) => c.num) },
    classCarCounts: { GTO: cars.length },
  } as unknown as RaceChartData;
  const annotations = Object.fromEntries(
    cars.map((c) => [
      String(c.num),
      {
        reasons: {},
        pits: c.laps
          .filter((l) => l.pit)
          .map((l) => ({ l: l.l, lb: "", c: "", yo: 0, da: 0, pitTiming: { totalPitLoss: 110, context: "green" } })),
        settles: [],
      },
    ])
  ) as unknown as AnnotationData;
  return { data, annotations };
}

describe("liveStrategy", () => {
  // Three cars on lap 100 with 70 laps of race left. A and B run 40-lap stints (stops on laps 40
  // and 80, 20 laps into the next); C stops every 30 laps (laps 30, 60, 90; 10 laps in).
  const A = car(1, 100, 100, [40, 80]);
  const B = car(2, 100, 100.5, [40, 80]);
  // C is 140 s behind A on the road, but it has made a stop more: it owes one fewer.
  const C = car(3, 100, 100, [30, 60, 90], "GTO", 30);
  const { data, annotations } = race([A, B, C]);
  const TTG = 70 * 100;
  const s = liveStrategy({ data, annotations, focusNum: 2, flag: "Green", timeToGoS: TTG })!;
  const byNum = (n: number) => s.cars.find((c) => c.num === n)!;

  it("finds the class's stint length and each car's stops to go", () => {
    expect(s.stintLength).toBe(40);
    expect(s.greenStopS).toBe(110);
    // A: 20 laps into its stint + 70 to go = 90; a stint reaches 40 × 1.15 = 46 → two more stops.
    expect(byNum(1).stopsToGo).toBe(2);
    // C: 10 + 70 = 80 → one more.
    expect(byNum(3).stopsToGo).toBe(1);
  });

  it("orders the class after the stops each car owes, and at the flag", () => {
    expect(s.cars.map((c) => c.num)).toEqual([1, 2, 3]); // now: by laps, then time
    expect(byNum(2).gapS).toBeCloseTo(50);
    expect(byNum(3).gapS).toBeCloseTo(140);
    // C owes a stop fewer: 140 − 110 = 30 s behind A once all have stopped, ahead of B (50 s).
    expect(byNum(3).netGapS).toBeCloseTo(30);
    expect(byNum(3).netPos).toBe(2);
    expect(byNum(2).netPos).toBe(3);
    expect(byNum(1).projPos).toBe(1);
  });

  it("gives the focus car's pit window and where it rejoins if it stops now", () => {
    const f = s.focus!;
    // Last stop on lap 80; the stint reaches lap 80 + floor(40 × 1.15) = 126. The flag falls near
    // lap 100 + 7000 / 100.5 = 169.7: two stops to go, and any lap from now keeps it at two.
    expect(f.window).toEqual({ from: 101, to: 80 + Math.floor(40 * (1 + STINT_SLACK)), stopsToGo: 2 });
    expect(f.pitNow).toMatchObject({ lostS: 110, caution: false, savesS: null, measured: true });
    // B is 50 s behind A: a 110 s stop puts it behind C too (140 s behind A, under 50 + 110).
    expect(f.pitNow!.rejoinPos).toBe(3);
  });

  it("under a caution, a stop costs a share of a green one until one is measured", () => {
    const y = liveStrategy({ data, annotations, focusNum: 2, flag: "Code 35", timeToGoS: TTG })!;
    expect(y.caution).toBe(true);
    expect(y.focus!.pitNow).toMatchObject({ caution: true, lostS: 110 * CAUTION_SHARE, savesS: 110 * (1 - CAUTION_SHARE), measured: false });
    // 50 + 38.5 s: still ahead of C (140 s).
    expect(y.focus!.pitNow!.rejoinPos).toBe(2);
  });

  it("waits for enough long stints before saying stops to go", () => {
    const early = race([car(1, 30, 100, []), car(2, 30, 100, [])]);
    const e = liveStrategy({ ...early, focusNum: 1, flag: "Green", timeToGoS: 10000 })!;
    expect(e.stintLength).toBeNull();
    expect(e.cars.every((c) => c.stopsToGo === null && c.projPos === null)).toBe(true);
    expect(e.focus!.window).toBeNull();
  });

  it("a car that stopped crossing the line is left out of the projection", () => {
    const parked = race([A, B, car(3, 60, 100, [40])]);
    const p = liveStrategy({ ...parked, focusNum: 1, flag: "Green", timeToGoS: 5000 })!;
    const c = p.cars.find((x) => x.num === 3)!;
    expect(c.stopped).toBe(true);
    expect(c.projPos).toBeNull();
  });

  it("a car out on a longer stint now lengthens the class's stint", () => {
    const r = race([A, B, car(3, 100, 100, [30, 60]), car(4, 100, 100, [45])]);
    // Completed: 40, 40, 40, 40, 30, 30, 45; car 4 is 55 laps into its stint and still running.
    expect(liveStrategy({ ...r, focusNum: 1, flag: "Green", timeToGoS: TTG })!.stintLength).toBe(55);
  });

  it("a pit-lane start on lap 1 is not a stop", () => {
    const r = race([car(1, 10, 100, [1]), car(2, 10, 100, [])]);
    const x = liveStrategy({ ...r, focusNum: 1, flag: "Green", timeToGoS: 1000 })!;
    expect(x.cars.find((c) => c.num === 1)!.stops).toEqual([]);
  });
});

describe("a short visit late in a stint is a splash of fuel", () => {
  const stop = (lap: number, kind: "stop" | "drive_through", laneS: number | null = null, short = kind === "drive_through") => ({ lap, lostS: kind === "stop" ? 100 : 30, caution: false, kind, laneS, ...(short ? { short } : {}) });
  // GTO stints of about 27 laps; #119 comes in for 40 s, 27 laps into a stint (Sebring 2026, lap 170).
  const stopsBy = new Map<string, Stop[]>([
    ["119", [stop(27, "stop", 60), stop(54, "stop", 60), stop(81, "drive_through", 41)]],
    ["120", [stop(11, "drive_through", 11), stop(28, "stop", 60), stop(55, "stop", 60)]],
    ["678", [stop(26, "stop", 60), stop(53, "stop", 60), stop(80, "drive_through", 13)]],
  ]);

  it("makes a stop of a short visit late in the stint, and keeps an early one a drive-through", () => {
    const m = markSplashes(stopsBy, ["119", "120", "678"]);
    expect(m.get("119")![2]).toMatchObject({ kind: "stop", splash: true });
    expect(m.get("120")![0].kind).toBe("drive_through");
  });

  it("needs time stopped in the pit lane when the race's passes give the time to pass through it", () => {
    const pass = passLane(stopsBy);
    expect(pass).toBe(13);
    const m = markSplashes(stopsBy, ["119", "120", "678"], pass);
    expect(m.get("119")![2].kind).toBe("stop"); // 41 s in the lane: stopped for fuel
    expect(m.get("678")![2].kind).toBe("drive_through"); // 13 s: passed through
  });

  it("leaves a drive-through the timing named one", () => {
    const named = new Map(stopsBy);
    named.set("119", [stop(27, "stop"), stop(54, "stop"), stop(81, "drive_through", null, false)]);
    expect(markSplashes(named, ["119", "120", "678"]).get("119")![2].kind).toBe("drive_through");
  });
});
