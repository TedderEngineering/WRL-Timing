import { describe, expect, it, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import { groupCars, numberQuery, type CarEntryRow } from "../car-search.js";

const row = (carNumber: string, teamName: string, series: string, date: string, id: string, cls = "GS"): CarEntryRow => ({
  carNumber,
  teamName,
  carClass: cls,
  finishPos: 5,
  finishPosClass: 2,
  race: { id, name: `Race ${id}`, date: new Date(`${date}T12:00:00Z`), track: "VIRginia International Raceway", series, subSeries: null },
});

describe("car search", () => {
  it("reads a car number query", () => {
    expect(numberQuery("#67")).toBe("67");
    expect(numberQuery("4A")).toBe("4A");
    expect(numberQuery("blackdog")).toBeNull();
  });

  it("is one car per series, number and team; newest first", () => {
    const cars = groupCars([
      row("67", "Blackdog Racing (Ward / Gallagher)", "IMSA", "2026-10-10", "a", "GS"),
      row("067", "Blackdog Racing", "IMSA", "2026-05-02", "b", "TCR"),
      row("67", "Other Team", "WRL", "2026-09-01", "c"),
    ]);
    expect(cars.map((c) => [c.series, c.number, c.team, c.races.length])).toEqual([
      ["imsa", "67", "Blackdog Racing", 2],
      ["wrl", "67", "Other Team", 1],
    ]);
    expect(cars[0].carClass).toBe("GS"); // from its newest race
    expect(cars[0].races.map((r) => r.raceId)).toEqual(["a", "b"]);
  });
});
