import { describe, expect, it } from "vitest";
import { fixTwelveHour } from "../control-times.js";

// Sunday at Sebring: the session opened 07:04 track time.
const start = Date.parse("2026-10-18T07:04:49Z");
let o = 0;
const at = (t: string) => ({ o: ++o, t, n: "x" });

describe("race control times on a 24-hour clock", () => {
  it("reads Sunday's log, 24-hour times with the latest on a 12-hour clock", () => {
    o = 0;
    const log = [at("2026-10-18T07:54:00"), at("2026-10-18T08:00:00"), at("2026-10-18T12:55:00"), at("2026-10-18T12:58:00"), at("2026-10-18T13:35:00"), at("2026-10-18T13:39:00"), at("2026-10-18T02:36:00"), at("2026-10-18T02:41:00")];
    expect(fixTwelveHour(log, start).map((e) => e.t!.slice(11))).toEqual(["07:54:00", "08:00:00", "12:55:00", "12:58:00", "13:35:00", "13:39:00", "14:36:00", "14:41:00"]);
  });
  it("follows the log's order, not the list's (newest first)", () => {
    o = 0;
    const log = [at("2026-10-18T12:58:00"), at("2026-10-18T02:36:00")].reverse();
    expect(fixTwelveHour(log, start).map((e) => e.t!.slice(11))).toEqual(["14:36:00", "12:58:00"]);
  });
  it("reads a wholly 12-hour log from the session's start", () => {
    o = 0;
    const log = [at("2026-10-18T07:30:00"), at("2026-10-18T12:58:00"), at("2026-10-18T02:36:00")];
    expect(fixTwelveHour(log, start).map((e) => e.t!.slice(11))).toEqual(["07:30:00", "12:58:00", "14:36:00"]);
  });
  it("leaves a 24-hour log as it is, and the log without the session's start", () => {
    o = 0;
    const log = [at("2026-10-18T09:00:00"), at("2026-10-18T14:41:00")];
    expect(fixTwelveHour(log, start).map((e) => e.t)).toEqual(log.map((e) => e.t));
    expect(fixTwelveHour(log, null)).toBe(log);
  });
});
