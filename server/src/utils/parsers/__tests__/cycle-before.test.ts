import { describe, expect, it } from "vitest";
import { generateAnnotations } from "../position-analysis.js";

// Utah 2026, GTO, first stops (from the live chart): #54 led, #9 second, #123 third. #37 stopped
// on lap 33, #54 on 34, #9 on 36, #123 on 39. #123 ran first on laps 37–39 only because the
// two cars ahead had already stopped, and was third again behind the same two afterwards.
const ORDER: [number, number[]][] = [
  [32, [54, 9, 123, 37]],
  [33, [54, 9, 123, 37]],
  [35, [9, 123, 54, 37]],
  [36, [9, 123, 54, 37]],
  [39, [123, 54, 9, 37]],
  [60, [54, 9, 123, 37]],
];
const PIT: Record<number, number> = { 37: 33, 54: 34, 9: 36, 123: 39 };
const orderAt = (L: number) => ORDER.find(([upTo]) => L <= upTo)![1];

function race() {
  const cars: Record<string, any> = {};
  for (const n of [54, 9, 123, 37]) {
    cars[String(n)] = {
      num: n,
      team: `T${n}`,
      cls: "GTO",
      finishPos: orderAt(60).indexOf(n) + 1,
      finishPosClass: orderAt(60).indexOf(n) + 1,
      laps: Array.from({ length: 60 }, (_, i) => {
        const l = i + 1;
        const p = orderAt(l).indexOf(n) + 1;
        const pit = PIT[n] === l ? 1 : 0;
        return { l, p, cp: p, lt: "", ltSec: pit ? 160 : 100 + (n % 7) / 10, flag: "GREEN", pit };
      }),
    };
  }
  return { maxLap: 60, totalCars: 4, greenPaceCutoff: 130, cars, fcy: [], classGroups: { GTO: [54, 9, 123, 37] }, classCarCounts: { GTO: 4 } };
}

describe("pit cycle places count from before the class cycle opened", () => {
  it("#123: third before the GTO stops, third after them — held, not 'lost 2'", () => {
    const ann = generateAnnotations(race() as any) as any;
    const s = ann["123"].settles.find((x: any) => x.l > 39);
    expect(s).toMatchObject({ cpBefore: 3, cpAfter: 3 });
    expect(s.su).toMatch(/^Was P3 · Held/);
    expect(ann["123"].reasons["39"]).toMatch(/^Pit stop — Held position in pit cycle/);
  });

  it("the notes say why: both places came from rivals' stops, and both went back in #123's own", () => {
    const r = (generateAnnotations(race() as any) as any)["123"].reasons;
    expect(r["34"]).toBe("Gained — passed #54 T54 pitted");
    // #9's pit flag is on lap 36; the place changes on lap 37.
    expect(r["37"]).toBe("Gained — passed #9 T9 pitted");
    expect(r["40"]).toMatch(/^Lost — #(9|54) T(9|54) \(this car pitted\); #(9|54) T(9|54) \(this car pitted\)$/);
  });
});
