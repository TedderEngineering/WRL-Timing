import { describe, expect, it } from "vitest";
import { gateObject, gateTarget, liveName } from "../gate";

describe("the sign-in gate names what the link opens", () => {
  it("reads race, live and list links", () => {
    expect(gateTarget("/chart?race=abc&car=120&tab=story")).toEqual({ kind: "race", id: "abc" });
    expect(gateTarget("/races/abc")).toEqual({ kind: "race", id: "abc" });
    expect(gateTarget("/live/sebring-international-raceway-2026-sunday-7-hour")).toEqual({ kind: "live", slug: "sebring-international-raceway-2026-sunday-7-hour" });
    expect(gateTarget("/live/next/12")).toBeNull();
    expect(gateTarget("/races")).toEqual({ kind: "races" });
    expect(gateTarget("/qualifying/q1")).toEqual({ kind: "qualifying" });
    expect(gateTarget("/dashboard")).toBeNull();
    expect(gateTarget(null)).toBeNull();
  });
  it("says it in words", () => {
    expect(liveName("sebring-international-raceway-2026-sunday-7-hour")).toBe("Sunday 7 Hour");
    expect(gateObject({ kind: "race", id: "x" }, null)).toBe("this race");
    expect(gateObject({ kind: "race", id: "x" }, { name: "Indianapolis 8 Hour — Indianapolis Motor Speedway", track: "", date: "", series: "SRO" })).toBe("Indianapolis 8 Hour");
    expect(gateObject({ kind: "live", slug: "road-atlanta-2026-gto-gtu-sunday-7-hour" }, null)).toBe("GTO GTU Sunday 7 Hour, live");
    expect(gateObject({ kind: "races" }, null)).toBe("every race");
  });
});
