import { describe, expect, it } from "vitest";
import { fixTwelveHour } from "../control-times.js";

// Sunday at Sebring: the session opened 07:04 track time.
const start = Date.parse("2026-10-18T07:04:49Z");
const at = (t: string) => ({ o: 1, t, n: "x" });

describe("race control times on a 24-hour clock", () => {
  it("reads a 12-hour log as morning or afternoon, whichever is nearer the session's start", () => {
    const fixed = fixTwelveHour([at("2026-10-18T07:30:00"), at("2026-10-18T12:58:00"), at("2026-10-18T02:36:00"), at("2026-10-18T02:41:00")], start);
    expect(fixed.map((e) => e.t)).toEqual(["2026-10-18T07:30:00", "2026-10-18T12:58:00", "2026-10-18T14:36:00", "2026-10-18T14:41:00"]);
  });
  it("leaves a 24-hour log alone", () => {
    const log = [at("2026-10-18T09:00:00"), at("2026-10-18T14:41:00")];
    expect(fixTwelveHour(log, start)).toBe(log);
  });
  it("leaves the log alone without the session's start", () => {
    const log = [at("2026-10-18T02:41:00")];
    expect(fixTwelveHour(log, null)).toBe(log);
  });
});
