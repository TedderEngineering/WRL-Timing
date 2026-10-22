import { describe, expect, it } from "vitest";
import { labelOn, mapClassColor } from "../TrackMap";

describe("the live map's class colours", () => {
  it("colours each class as the owner asked: GTU grey, GTO blue, GP1 red, GP2 green", () => {
    expect(mapClassColor("GTU")).toBe("#9ca3af");
    expect(mapClassColor("GTO")).toBe("#3b82f6");
    expect(mapClassColor("GP1")).toBe("#ef4444");
    expect(mapClassColor(" gp2 ")).toBe("#22c55e");
    // Any other class: one colour unlike the four.
    expect(mapClassColor("GP3")).toBe(mapClassColor(""));
    expect(["#9ca3af", "#3b82f6", "#ef4444", "#22c55e"]).not.toContain(mapClassColor("GP3"));
  });

  it("writes the car number dark on the light dots, white on the dark ones", () => {
    expect(labelOn(mapClassColor("GTU"))).toBe("#0b0b18");
    expect(labelOn(mapClassColor("GP2"))).toBe("#0b0b18");
    expect(labelOn(mapClassColor("GTO"))).toBe("#ffffff");
    expect(labelOn(mapClassColor("GP1"))).toBe("#ffffff");
  });
});
