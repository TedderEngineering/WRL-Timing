import { describe, it, expect, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import {
  DAMPER_INPUTS,
  DAMPER_SCENARIO_COUNT,
  validateDamperTable,
  type DamperRow,
} from "../grip/damper.js";

/** A complete table with placeholder text. Real recommendations are never stored in the repository. */
function fullTable(): DamperRow[] {
  const rows: DamperRow[] = [];
  let n = 1;
  for (const adjustmentType of DAMPER_INPUTS.adjustmentType)
    for (const turnDirection of DAMPER_INPUTS.turnDirection)
      for (const overUnder of DAMPER_INPUTS.overUnder)
        for (const cornerSegment of DAMPER_INPUTS.cornerSegment)
          for (const cornerSpeed of DAMPER_INPUTS.cornerSpeed)
            rows.push({
              scenarioNumber: n++,
              adjustmentType,
              turnDirection,
              overUnder,
              cornerSegment,
              cornerSpeed,
              option1: "Placeholder A",
              option2: null,
              option3: null,
            });
  return rows;
}

describe("validateDamperTable", () => {
  it("has 96 input combinations", () => {
    expect(DAMPER_SCENARIO_COUNT).toBe(96);
    expect(fullTable()).toHaveLength(96);
  });

  it("accepts a complete table", () => {
    expect(validateDamperTable(fullTable())).toEqual([]);
  });

  it("reports a short table and the missing combinations", () => {
    const problems = validateDamperTable(fullTable().slice(0, 90));
    expect(problems).toContain("Expected 96 scenarios, received 90");
    expect(problems).toContain("6 input combination(s) have no scenario");
  });

  it("reports duplicate scenario numbers", () => {
    const rows = fullTable();
    rows[5] = { ...rows[5], scenarioNumber: 1 };
    expect(validateDamperTable(rows)).toContain("Scenario number 1 appears 2 times");
  });

  it("reports a duplicated input combination", () => {
    const rows = fullTable();
    rows[1] = { ...rows[0], scenarioNumber: 2 };
    const problems = validateDamperTable(rows);
    expect(problems.some((p) => p.includes("appears 2 times"))).toBe(true);
    expect(problems).toContain("1 input combination(s) have no scenario");
  });

  it("reports an option 3 without an option 2", () => {
    const rows = fullTable();
    rows[10] = { ...rows[10], option3: "Placeholder C" };
    expect(validateDamperTable(rows)).toContain(
      "Scenario 11 has an option 3 but no option 2"
    );
  });
});
