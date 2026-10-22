import { describe, expect, it } from "vitest";
import { isPenalty } from "../RaceControl";

describe("race control actions", () => {
  it("marks a penalty, not a no-action or a warning", () => {
    expect(isPenalty("Drive Through")).toBe(true);
    expect(isPenalty("Stop + 60")).toBe(true);
    expect(isPenalty("No Penalty")).toBe(false);
    expect(isPenalty("No Action Needed")).toBe(false);
    expect(isPenalty("Warning")).toBe(false);
    expect(isPenalty(null)).toBe(false);
  });
});
