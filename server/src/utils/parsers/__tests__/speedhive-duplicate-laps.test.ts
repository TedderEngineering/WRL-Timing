import { describe, expect, it } from "vitest";
import { speedhiveParser } from "../speedhive.js";

// WRL Watkins Glen 2026 Saturday (RedMist event 376 / session 87) was refused with
// "cars.53.laps.1.cp: Number must be greater than 0": the laps file listed a lap twice.
describe("Speedhive/RedMist laps file with a repeated lap row", () => {
  it("keeps one row per car and lap, so every lap gets a class position", async () => {
    const summary = "Position,Start Number,Name,Class,Position In Class,Status\n1,53,Team A,GP2,1,Running\n2,7,Team B,GP2,2,Running\n";
    const laps = [
      "Start Number,Lap Number,Lap Time,Field Position,Status,Team/Name,Class",
      "53,1,2:10.000,1,Green,Team A,GP2",
      "7,1,2:11.000,2,Green,Team B,GP2",
      "53,1,2:10.000,1,Green,Team A,GP2",
      "53,2,2:09.000,1,Green,Team A,GP2",
      "7,2,2:12.000,2,Green,Team B,GP2",
    ].join("\n");
    const flags = "Flag,Start,End\nGreen,2026-08-29 10:00:00,2026-08-29 18:00:00\n";
    const control = "Time,Car,Note\n";
    const r = await speedhiveParser.parse({ summaryCsv: summary, lapsCsv: laps, flagsCsv: flags, controlLogCsv: control });
    const car = r.data.cars["53"];
    expect(car.laps.map((l) => l.l)).toEqual([1, 2]);
    expect(car.laps.every((l) => l.cp > 0)).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/1 repeated lap row/);
  });
});
