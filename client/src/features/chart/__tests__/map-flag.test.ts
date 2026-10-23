import { describe, expect, it } from "vitest";
import { mapFlag } from "../flags";

describe("the track map's flag", () => {
  it("shows nothing under green", () => {
    expect(mapFlag("Green")).toBeNull();
    expect(mapFlag(null)).toBeNull();
    expect(mapFlag("Unknown")).toBeNull();
  });
  it("tints the track for a caution or a red flag, not for the white or checkered flag", () => {
    expect(mapFlag("Yellow")).toMatchObject({ label: "Full-course yellow", tint: true });
    expect(mapFlag("Code 35")).toMatchObject({ label: "Code 35", tint: true });
    expect(mapFlag("Red")).toMatchObject({ label: "Red flag · session stopped", tint: true });
    expect(mapFlag("White")).toMatchObject({ label: "White flag · last lap", tint: false });
    expect(mapFlag("Checkered")).toMatchObject({ checkered: true, tint: false });
  });
});
