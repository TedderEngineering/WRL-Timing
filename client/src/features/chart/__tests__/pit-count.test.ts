import { describe, expect, it } from "vitest";
import type { LapData } from "@shared/types";
import type { PitStop } from "../PitAnalysisTab";
import { pitRow, placesText, stopPlaces } from "../pit-view";
import { settleLabels } from "../pit-band";
import { carStops, pitCycleLine } from "../../dashboard/MyCarCard";

const stop = (pitLap: number, kind = "stop", extra: Partial<PitStop> = {}): PitStop =>
  ({ stopNumber: 0, pitLap, kind, condition: "Full green", localRef_s: 100, refSource: "Green pace", serviceTime_s: null, pitRoadTime_s: 60, timeLost_s: 70, ...extra }) as PitStop;

describe("one count of pit stops on every page", () => {
  it("counts every pit-lane visit in the Pit Stops tab, averaging over service stops", () => {
    const r = pitRow("6", "6", "LAP", "GS", 22, [stop(29), stop(40, "drive_through", { timeLost_s: 20 }), stop(62)]);
    expect(r.visits).toBe(3);
    expect(r.serviceStops).toBe(2);
    expect(r.avgLost).toBe(70);
  });

  it("takes the card's count from the server (every visit), else the stints or cycles of an older server", () => {
    expect(carStops({ stops: 3, pitCycles: [] }, null)).toBe(3);
    expect(carStops({ pitCycles: [{ cycle: 1, lap: 36, before: 27, after: 29, net: -2 }] }, null)).toBe(1);
  });
});

describe("a pit cycle that never closed", () => {
  it("is marked on the chart, the card and the Pit Stops tab", () => {
    const laps: LapData[] = [{ l: 70, p: 40, cp: 30, lt: "", ltSec: 90, flag: "GF", pit: 0 }];
    const [label] = settleLabels([{ l: 70, p: 40, lb: "Settled P40", su: "Was P35 · Lost 5", c: "#f87171", cpBefore: 27, cpAfter: 30, open: true }], laps, "", "GS");
    expect(label.sub).toBe("Was P27 · Lost 3 · not completed");
    expect(pitCycleLine({ cycle: 3, lap: 70, before: 27, after: 30, net: -3, stopLap: 66, open: true }, "GS")).toBe("Pit cycle 3 (stop on lap 66): P27 → P30 in GS, lost 3 (cycle not completed)");
    const p = stopPlaces(stop(66, "stop", { classPosBefore: 27, classPosAfter: 30, netClass: -3, placesOver: "cycle", cycleOpen: true }))!;
    expect(placesText(p)).toBe("Class P27 → P30 over the pit cycle: lost 3 (cycle not completed)");
  });
});
