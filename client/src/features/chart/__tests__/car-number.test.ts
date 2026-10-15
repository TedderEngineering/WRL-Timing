import { describe, expect, it } from "vitest";
import { carKey, carNo } from "../car-number";

const data = { cars: { "7": { label: undefined }, "10000": { label: "007" }, "28": { label: "028" } } } as any;

describe("published car numbers", () => {
  it("shows the published number, never the stand-in key", () => {
    expect([carNo(data, 7), carNo(data, 10000), carNo(data, "28"), carNo(null, 5)]).toEqual(["7", "007", "028", "5"]);
  });
  it("finds the chart car for a number in reason text", () => {
    expect([carKey(data, "007"), carKey(data, "7"), carKey(data, "028"), carKey(data, "12"), carKey(data, "X")]).toEqual([10000, 7, 28, 12, null]);
  });
});
