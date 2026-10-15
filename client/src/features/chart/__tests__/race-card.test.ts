import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { raceCardText } from "../raceCard";

describe("race share card text", () => {
  it("names the car and the race with its date", () => {
    const data = { cars: { "67": { num: 67, team: "Blackdog Racing", cls: "GS", finishPos: 1, finishPosClass: 1, laps: [] } } } as unknown as RaceChartData;
    expect(raceCardText(data, 67, { id: "r", name: "Pilot Challenge — VIR", track: "VIR", date: "2026-08-22T00:00:00.000Z" })).toEqual({
      title: "#67 Blackdog Racing",
      subtitle: "Pilot Challenge — VIR · Aug 22, 2026",
    });
  });
});
