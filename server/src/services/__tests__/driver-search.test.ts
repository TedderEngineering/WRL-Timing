import { describe, expect, it } from "vitest";
import { displayName, groupDrivers, nameMatches } from "../driver-search.js";
import { uniqueDrivers, driverKey } from "../../utils/driverNames.js";

const row = (id: string, date: string, car: string, drivers: string, extra: Partial<{ finishPosClass: number }> = {}) => ({
  carNumber: car,
  teamName: "CSM (Zach Veach / Morgan Burkhard)",
  carClass: "GS",
  finishPos: 5,
  finishPosClass: extra.finishPosClass ?? 2,
  driverNames: drivers,
  race: { id, name: `Race ${id}`, date: new Date(`${date}T12:00:00Z`), track: "Michelin Raceway Road Atlanta", series: "IMSA" },
});

describe("driver search", () => {
  it("matches every query word to the start of a name word, ignoring case and accents", () => {
    expect(nameMatches("Marvin Kirchhöfer", "kirchhofer")).toBe(true);
    expect(nameMatches("Zach Veach", "zach vea")).toBe(true);
    expect(nameMatches("Zach Veach", "ach")).toBe(false);
    expect(nameMatches("Zach Veach", "")).toBe(false);
  });

  it("keeps one name per driver and tidies all-caps spellings", () => {
    expect(uniqueDrivers(["Zach Veach", "ZACH VEACH", " ", "TBD", "Morgan  Burkhard"])).toEqual(["Zach Veach", "Morgan Burkhard"]);
    expect(driverKey("KIRCHHOFER Marvin")).toBe(driverKey("Marvin Kirchhöfer"));
    expect(displayName("Zach VEACH")).toBe("Zach Veach");
    expect(displayName("Ryan De Phillippi")).toBe("Ryan De Phillippi");
  });

  it("groups a driver's races across spellings, newest first, team without the driver list", () => {
    const out = groupDrivers(
      [
        row("a", "2026-06-12", "2", "Zach Veach; Morgan Burkhard"),
        row("b", "2026-10-02", "2", "Zach VEACH; Morgan BURKHARD"),
        row("c", "2026-10-02", "2", "Zach Veach; Morgan Burkhard"),
      ],
      "veach"
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Zach Veach");
    expect(out[0].races.map((r) => r.raceId)).toEqual(["b", "c", "a"]);
    expect(out[0].races[0]).toMatchObject({ carNumber: "2", teamName: "CSM", carClass: "GS", finishPosClass: 2, track: expect.any(String) });
  });
});
