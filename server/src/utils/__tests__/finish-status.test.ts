import { describe, expect, it } from "vitest";
import { normalizeFinishStatus } from "../finish-status.js";

describe("finish status from results files", () => {
  it("maps the spellings the timing sites use", () => {
    expect(normalizeFinishStatus("Classified")).toBe("classified");
    expect(normalizeFinishStatus("Running")).toBe("classified");
    expect(normalizeFinishStatus("DSQ")).toBe("dsq");
    expect(normalizeFinishStatus("Disqualified")).toBe("dsq");
    expect(normalizeFinishStatus("Excluded")).toBe("dsq");
    expect(normalizeFinishStatus("Not classified")).toBe("nc");
    expect(normalizeFinishStatus("NC")).toBe("nc");
    expect(normalizeFinishStatus("Retired")).toBe("dnf");
    expect(normalizeFinishStatus("DNF")).toBe("dnf");
    expect(normalizeFinishStatus("DNS")).toBe("dns");
    expect(normalizeFinishStatus("Did not start")).toBe("dns");
    expect(normalizeFinishStatus("")).toBeNull();
    expect(normalizeFinishStatus("something odd")).toBeNull();
  });
});
