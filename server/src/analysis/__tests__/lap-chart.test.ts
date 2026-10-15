import { describe, expect, it } from "vitest";
import { checkLapChart } from "../engine/lap-chart.js";

const rows = (car: string, pos: number[]) => pos.map((p, i) => ({ car, lap: i + 1, pos: p })) as any[];
const file = (doc: unknown) => [{ fileId: "f3", role: "lap_chart", name: "12_Lap Chart_Race.JSON", text: JSON.stringify(doc) }] as any[];

describe("A-LC lap chart cross-check", () => {
  const laps = { "23": rows("23", [1, 1, 2]), "46": rows("46", [2, 2, 1]) };

  it("says nothing when the chart and the crossings agree", () => {
    const issues: any[] = [];
    const doc = { laps: [1, 2, 3].map((L) => ({ lap_number: L, positions: [{ position: laps["23"][L - 1].pos, number: "23" }, { position: laps["46"][L - 1].pos, number: "46" }] })) };
    expect(checkLapChart(file(doc), laps, issues)).toEqual({ compared: 6, differing: 0, unmatched: 0 });
    expect(issues).toEqual([]);
  });

  it("warns with examples where they disagree, and notes cars it cannot place", () => {
    const issues: any[] = [];
    const doc = { laps: [{ lap_number: 3, positions: [{ position: 1, number: "23" }, { position: 2, number: "46" }, { position: 3, number: "99" }] }] };
    expect(checkLapChart(file(doc), laps, issues)).toEqual({ compared: 2, differing: 2, unmatched: 1 });
    expect(issues.map((i) => [i.severity, i.code])).toEqual([["warning", "LAP-CHART-MISMATCH"], ["note", "LAP-CHART-UNMATCHED"]]);
    expect(issues[0].message).toContain("#23 lap 3: chart P1, crossings P2");
  });

  it("is skipped without a lap chart, and noted when it cannot be read", () => {
    const issues: any[] = [];
    expect(checkLapChart([], laps, issues)).toBeNull();
    expect(checkLapChart([{ fileId: "f3", role: "lap_chart", name: "x.json", text: "{" }] as any, laps, issues)).toBeNull();
    expect(issues[0].code).toBe("LAP-CHART-UNREAD");
  });
});
