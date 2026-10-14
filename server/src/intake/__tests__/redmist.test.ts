/**
 * RedMist intake (WRL from 2026): source keys, the pure JSON → CSV conversion,
 * discovery / download against recorded synthetic responses, and the legacy
 * parser reading the result. No network; fixtures are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discover, download, resolve } from "../index.js";
import { buildFactsArgs } from "../facts-args.js";
import { readManifest, workDirFor } from "../manifest.js";
import {
  buildRedmistAllLapsCsv,
  buildRedmistControlCsv,
  buildRedmistFlagsCsv,
  buildRedmistSummaryCsv,
  carsFromResults,
  eventDisplayName,
  formatLapTime,
  localTimestamp,
  parseSpan,
  plausibleDate,
  sessionLocalDate,
  pitInLaps,
  rmStatus,
  sessionClock,
  type RmLap,
} from "../parse-redmist.js";
import { attachCandidates, buildPushBody } from "../push.js";
import { resolveSeries } from "../series.js";
import { canonicalSourceKey, parseRedmistRef, parseSourceKey, redmistSourceKey, SOURCE_KEY_PATTERN } from "../source-key.js";
import { paced, redmistPacing, redmistUrls } from "../sources/redmist.js";
import { speedhiveParser } from "../../utils/parsers/speedhive.js";
import { fakeHttp, fixture } from "./fake-http.js";

const json = (name: string) => JSON.parse(fixture(name));
const LAPS = () => json("redmist-laps.json");
const PITS = () => json("redmist-pits.json");
const RESULTS = () => json("redmist-results.json");
const FLAGS = () => json("redmist-flags.json");
const CONTROL = () => json("redmist-control.json");

const routes = () => ({
  [redmistUrls.archived(0, 100)]: fixture("redmist-archived.json"),
  [redmistUrls.liveAndRecent()]: "[]",
  [redmistUrls.event(9001)]: JSON.stringify({ e: 9001, n: "World Racing League - Synthetic Park 2026", d: "2026-05-02", t: "Synthetic Park", on: "World Racing League", organizationId: 1 }),
  [redmistUrls.sessions(9001)]: fixture("redmist-sessions-9001.json"),
  [redmistUrls.availability(9001, 7)]: JSON.stringify({ sessionCompleted: true, lapDataAvailable: true, pitReportAvailable: true, carNumbers: ["7", "11"] }),
  [redmistUrls.availability(9001, 8)]: JSON.stringify({ sessionCompleted: true, lapDataAvailable: false, pitReportAvailable: false, carNumbers: [] }),
  [redmistUrls.laps(9001, 7)]: fixture("redmist-laps.json"),
  [redmistUrls.pits(9001, 7)]: fixture("redmist-pits.json"),
  [redmistUrls.results(9001, 7)]: fixture("redmist-results.json"),
  [redmistUrls.flags(9001, 7)]: fixture("redmist-flags.json"),
  [redmistUrls.control(9001, 7)]: fixture("redmist-control.json"),
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "intake-redmist-"));
  redmistPacing.gapMs = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete redmistPacing.gapMs;
  delete redmistPacing.last;
});

describe("RedMist source keys", () => {
  it("round-trips and matches the server's pattern", () => {
    const k = redmistSourceKey("0405", 3);
    expect(k).toBe("redmist:event:405/session:3");
    expect(SOURCE_KEY_PATTERN.test(k)).toBe(true);
    expect(parseSourceKey(k)).toEqual({ site: "redmist", eventId: 405, sessionId: 3 });
    expect(canonicalSourceKey(" redmist:event:405/session:3 ")).toBe(k);
    for (const bad of ["redmist:event:405", "redmist:session:3", "redmist:event:x/session:3"]) {
      expect(SOURCE_KEY_PATTERN.test(bad)).toBe(false);
      expect(() => parseSourceKey(bad)).toThrow();
    }
  });

  it("reads event and session references", () => {
    expect(parseRedmistRef("405")).toEqual({ eventId: 405, sessionId: null });
    expect(parseRedmistRef("405/3")).toEqual({ eventId: 405, sessionId: 3 });
    expect(parseRedmistRef("https://api.redmist.racing/status/v1/Exports/GetCarLaps?eventId=405&sessionId=3&format=csv")).toEqual({ eventId: 405, sessionId: 3 });
    expect(parseRedmistRef("https://redmist.racing/event/155")).toEqual({ eventId: 155, sessionId: null });
    expect(() => parseRedmistRef("barber")).toThrow();
  });

  it("wrl is RedMist; wrl-speedhive is the 2025 fallback", () => {
    expect(resolveSeries(["wrl"]).map((s) => s.site)).toEqual(["redmist"]);
    expect(resolveSeries(["wrl-speedhive"]).map((s) => s.site)).toEqual(["speedhive"]);
  });
});

describe("RedMist times", () => {
  it("parses .NET TimeSpans and writes Speedhive lap times", () => {
    expect(parseSpan("08:03:48.003")).toBeCloseTo(29028.003, 6);
    expect(parseSpan("1.02:00:00")).toBe(93600);
    expect(parseSpan("1:32.786")).toBeCloseTo(92.786, 6);
    expect(parseSpan("")).toBeNull();
    expect(parseSpan("2 laps")).toBeNull();
    expect(formatLapTime(99.089)).toBe("1:39.089");
    expect(formatLapTime(3723.5)).toBe("1:02:03.500");
  });

  it("dates: ISO and LoadEvent's US format; year 1 is no date; session starts are UTC", () => {
    expect(plausibleDate("2026-09-26T13:27:33.337749")).toBe("2026-09-26");
    expect(plausibleDate("09/23/2026 00:00:00")).toBe("2026-09-23");
    expect(plausibleDate("0001-01-01T00:00:00")).toBeNull();
    expect(sessionLocalDate({ sid: 3, eid: 405, st: "2026-09-26T13:27:33.337749", tz: -6 })).toBe("2026-09-26");
    // an evening session in the US is the next day in UTC
    expect(sessionLocalDate({ sid: 9, eid: 1, st: "2026-09-27T01:30:00", tz: -6 })).toBe("2026-09-26");
    expect(sessionLocalDate({ sid: 9, eid: 1, st: "0001-01-01T00:00:00", tz: -6 }, "2026-05-02")).toBe("2026-05-02");
  });

  it("rolls the date over midnight (14-hour races)", () => {
    expect(localTimestamp("2026-11-14", 86399.5)).toBe("2026-11-14T23:59:59.500");
    expect(localTimestamp("2026-11-14", 86400 + 3725.25)).toBe("2026-11-15T01:02:05.250");
  });

  it("race-clock start: results time of day less running time, even across midnight", () => {
    const c = sessionClock(LAPS().laps, RESULTS(), FLAGS(), null)!;
    expect(c).toEqual({ date: "2026-05-02", startSec: 23 * 3600 + 40 * 60, source: "results localTimeOfDay - runningRaceTime" });
  });

  it("falls back to the first green less the earliest lap-1 start, and says it is an estimate", () => {
    const c = sessionClock(LAPS().laps, null, FLAGS(), null)!;
    // green 23:40:00; car 11 starts lap 1 at 30.0 s on the race clock
    expect(c.startSec).toBeCloseTo(23 * 3600 + 40 * 60 - 30, 6);
    expect(c.source).toMatch(/estimate/);
    expect(sessionClock(LAPS().laps, null, null, null)).toBeNull();
  });

  it("uses sessionStartTime when it is a real date", () => {
    const c = sessionClock([], { ...RESULTS(), sessionStartTime: "2026-05-02T23:41:02.5" }, null, null)!;
    expect(c).toMatchObject({ date: "2026-05-02", startSec: 23 * 3600 + 41 * 60 + 2.5 });
  });
});

describe("RedMist → Speedhive-format CSVs", () => {
  const parse = (csv: string) => csv.trim().split("\r\n").map((l) => l.split(","));

  it("summary: results order, entry-list team names, cars without laps kept from results", () => {
    const rows = parse(buildRedmistSummaryCsv(carsFromResults(RESULTS(), LAPS().laps)));
    expect(rows[0]).toEqual(["Position", "Start Number", "Name", "Class", "Position In Class", "Status"]);
    expect(rows.slice(1).map((r) => r.slice(0, 5))).toEqual([
      ["1", "7", "Example Motorsport", "GTU", "1"],
      ["2", "11", "Synthetic Racing", "GTO", "1"],
    ]);
  });

  it("all laps: crossing time = race-clock start + total time, pit flags, gaps, flags, driver, pit-report in-lap", () => {
    const cars = carsFromResults(RESULTS(), LAPS().laps);
    const clock = sessionClock(LAPS().laps, RESULTS(), FLAGS(), null);
    const rows = parse(buildRedmistAllLapsCsv(LAPS().laps, cars, clock, PITS()));
    const h = rows[0];
    const col = (r: string[], name: string) => r[h.indexOf(name)];
    expect(h.slice(-2)).toEqual(["Driver", "Pit Stop"]);
    const car11 = rows.filter((r) => col(r, "Start Number") === "11");
    expect(car11.map((r) => col(r, "Lap Number"))).toEqual(["1", "2", "3", "4"]);
    expect(car11.map((r) => col(r, "Time of Day"))).toEqual([
      "2026-05-02T23:42:30.100",
      "2026-05-02T23:46:20.100",
      "2026-05-02T23:48:40.100",
      "2026-05-02T23:50:40.100",
    ]);
    expect(car11.map((r) => col(r, "Lap Time"))).toEqual(["2:00.100", "3:50.000", "2:20.000", "2:00.000"]);
    expect(car11.map((r) => col(r, "In Pit"))).toEqual(["True", "True", "True", "False"]);
    expect(car11.map((r) => col(r, "Pit Stop"))).toEqual(["False", "True", "False", "False"]);
    expect(car11.map((r) => col(r, "Status"))).toEqual(["GREEN", "GREEN", "YELLOW", "FINISH"]);
    expect(car11.map((r) => col(r, "Driver"))).toEqual(["Alex Synth", "Alex Synth", "Blake Synth", "Blake Synth"]);
    const last = car11[3];
    expect([col(last, "Gap to Leader (Time)"), col(last, "Gap to Leader (Laps)"), col(last, "Gap Ahead (Time)")]).toEqual(["", "1", "65.500"]);
    // a later snapshot of the same lap replaces the earlier one
    const car7lap3 = rows.find((r) => col(r, "Start Number") === "7" && col(r, "Lap Number") === "3")!;
    expect(col(car7lap3, "Lap Time")).toBe("2:01.500");
    // results order: the winner's laps come first
    expect(col(rows[1], "Start Number")).toBe("7");
  });

  it("without the pit report, stops come from the lap pit flags (lap-1 staging ignored)", () => {
    const laps: RmLap[] = [
      { n: "5", llp: 1, lip: true, ip: false },
      { n: "5", llp: 2, lip: false, ip: false },
      { n: "5", llp: 3, lip: true, ip: true },
      { n: "5", llp: 4, lip: true, ip: false },
      { n: "5", llp: 5, lip: false, ip: false },
      // a lone flag with both crossings on track: the flag landed one lap late, the in-lap is lap 7
      { n: "5", llp: 6, lip: false, ip: false },
      { n: "5", llp: 7, lip: false, ip: false },
      { n: "5", llp: 8, lip: true, ip: false },
      { n: "5", llp: 9, lip: false, ip: false },
    ];
    expect([...pitInLaps(laps, null)].sort()).toEqual(["5|3", "5|7"]);
    expect([...pitInLaps(laps, { pitStops: [{ carNumber: "5", startLap: 4, endLap: 5 }] })]).toEqual(["5|4"]);
  });

  it("flags and control-log CSVs in the shapes the legacy parsers read", () => {
    const f = parse(buildRedmistFlagsCsv(FLAGS()));
    expect(f).toEqual([
      ["Flag", "Start", "End", "Duration"],
      ["Green", "2026-05-02T23:40:00", "2026-05-02T23:46:00", "6:00.000"],
      ["Yellow", "2026-05-02T23:46:00", "2026-05-02T23:52:00", "6:00.000"],
    ]);
    const c = parse(buildRedmistControlCsv(CONTROL()));
    expect(c[0]).toEqual(["Sequence", "Timestamp", "Car_1", "Car_2", "Description", "Action", "Status", "Corner"]);
    expect(c[1].slice(0, 5)).toEqual(["1", "2026-05-02T23:40:00", "", "", "Green Flag"]);
    expect(c[2]).toEqual(["2", "2026-05-02T23:47:00", "#11", "#7", "Contact", "No Penalty", "Final", "5"]);
    expect(rmStatus(8)).toBe("FCY");
    expect(rmStatus(0)).toBe("");
  });

  it("the legacy parser takes the Pit Stop column instead of guessing from lap times", async () => {
    const cars = carsFromResults(RESULTS(), LAPS().laps);
    const clock = sessionClock(LAPS().laps, RESULTS(), FLAGS(), null);
    const r = await speedhiveParser.parse({
      summaryCsv: buildRedmistSummaryCsv(cars),
      lapsCsv: buildRedmistAllLapsCsv(LAPS().laps, cars, clock, PITS()),
      flagsCsv: buildRedmistFlagsCsv(FLAGS()),
      controlLogCsv: buildRedmistControlCsv(CONTROL()),
    });
    const pitLaps = (num: string) => r.data.cars[num].laps.filter((l) => l.pit === 1).map((l) => l.l);
    expect(pitLaps("11")).toEqual([2]);
    expect(pitLaps("7")).toEqual([]);
    expect(r.warnings.some((w) => /pit data \(1 stops\)/.test(w))).toBe(true);
    expect(r.data.cars["11"].team).toBe("Synthetic Racing");
  });

  it("strips the series prefix from event names", () => {
    expect(eventDisplayName("World Racing League - West Desert 2026", 405)).toBe("West Desert 2026");
    expect(eventDisplayName("WRL @ Barber", 1)).toBe("Barber");
    expect(eventDisplayName("", 7)).toBe("RedMist event 7");
  });
});

describe("RedMist discovery and download", () => {
  it("lists WRL race sessions that have finished with lap data; skips other organisations, qualifying and sessions without laps", async () => {
    const http = fakeHttp(routes());
    const logs: string[] = [];
    const s = await discover(http, { series: ["wrl"], season: 2026, log: (m) => logs.push(m) });
    const mine = s.filter((x) => x.sourceKey.startsWith("redmist:event:9001/"));
    expect(mine.map((x) => x.sourceKey)).toEqual(["redmist:event:9001/session:7"]);
    expect(mine[0]).toMatchObject({
      site: "redmist",
      seriesId: "wrl",
      event: "Synthetic Park 2026",
      track: "Synthetic Park",
      sessionName: "Saturday 8 Hour",
      sessionType: "race",
      raceDate: "2026-05-02",
      legacyFormat: "speedhive",
      factFormat: "redmist",
      resultsStatus: "unknown",
      ids: { eventId: 9001, sessionId: 7, lapData: true, pitReport: true, organizationId: 1 },
    });
    expect(logs.some((l) => /9001\/8 .*no lap data/.test(l))).toBe(true);
    // no availability call for qualifying, the other organisation or the 2025 event's sessions
    expect(http.calls.some((c) => c.url.includes("sessionId=6"))).toBe(false);
    expect(http.calls.some((c) => c.url.includes("eventId=9002"))).toBe(false);
    expect(http.calls.some((c) => c.url.includes("LoadSessions?eventId=9003"))).toBe(false);
  });

  it("discovers one event by reference, and resolve(sourceKey) matches discovery", async () => {
    const byRef = await discover(fakeHttp(routes()), { series: ["wrl"], season: 2026, redmistRefs: ["9001"] });
    expect(byRef.map((x) => x.sourceKey)).toEqual(["redmist:event:9001/session:7"]);
    const r = await resolve(fakeHttp(routes()), "redmist:event:9001/session:7");
    expect(r.version).toBe(byRef[0].version);
    await expect(resolve(fakeHttp(routes()), "redmist:event:9001/session:8")).rejects.toThrow(/without lap data/);
  });

  it("downloads the JSON, writes the parser CSVs, and a rerun with the same version fetches nothing", async () => {
    const http = fakeHttp(routes());
    const s = await resolve(http, "redmist:event:9001/session:7");
    const dir = workDirFor(root, s.sourceKey);
    const r = await download(http, s, dir, { now: () => new Date("2026-10-14T12:00:00Z") });
    expect(r.failed).toEqual([]);
    const m = readManifest(dir)!;
    expect(m.metadata).toMatchObject({ name: "WRL Synthetic Park 2026 — Saturday 8 Hour", series: "WRL", raceDate: "2026-05-02", season: 2026 });
    const byKey = Object.fromEntries(m.files.map((f) => [f.key, f]));
    expect(Object.keys(byKey).sort()).toEqual(
      ["controlLogCsv", "flagsCsv", "lapsCsv", "redmistControlJson", "redmistFlagsJson", "redmistLapsJson", "redmistPitsJson", "redmistResultsJson", "summaryCsv"].sort()
    );
    expect(byKey.lapsCsv).toMatchObject({ name: "redmist_9001_7_all_laps.csv", role: "laps", parserSlot: true });
    expect(byKey.redmistPitsJson).toMatchObject({ name: "redmist_9001_7_pits.json", role: "pit_cards_json", parserSlot: false });
    expect(m.missing).toEqual([]);
    expect(readFileSync(join(dir, "redmist_9001_7_all_laps.csv"), "utf-8")).toContain("2026-05-02T23:46:20.100");

    // The fact engine gets the raw JSON, one file per role.
    const args = buildFactsArgs(m, (n) => `/w/${n}`, "/o/facts.json");
    expect(args[0]).toBe("redmist");
    expect(args.filter((a) => a.includes("="))).toEqual([
      "laps=/w/redmist_9001_7_laps.json",
      "pit_cards_json=/w/redmist_9001_7_pits.json",
      "results=/w/redmist_9001_7_results.json",
      "flags=/w/redmist_9001_7_flags.json",
      "control_log=/w/redmist_9001_7_control.json",
    ]);

    const before = http.calls.length;
    const again = await download(http, s, dir);
    expect(again.downloaded).toEqual([]);
    expect(http.calls.length).toBe(before);
  });

  it("records a missing pit report and still builds the chart files", async () => {
    const rt = routes();
    rt[redmistUrls.availability(9001, 7)] = JSON.stringify({ sessionCompleted: true, lapDataAvailable: true, pitReportAvailable: false });
    const http = fakeHttp(rt);
    const s = await resolve(http, "redmist:event:9001/session:7");
    const dir = workDirFor(root, s.sourceKey);
    await download(http, s, dir);
    const m = readManifest(dir)!;
    expect(m.files.some((f) => f.key === "redmistPitsJson")).toBe(false);
    expect(m.missing.map((x) => x.role)).toEqual(["pit_cards_json"]);
    expect(http.calls.some((c) => c.url.includes("GetPitStops"))).toBe(false);
  });

  it("push body carries an attach request only when the owner set one", async () => {
    const http = fakeHttp(routes());
    const s = await resolve(http, "redmist:event:9001/session:7");
    const dir = workDirFor(root, s.sourceKey);
    const { manifest } = await download(http, s, dir);
    expect(buildPushBody(dir, manifest).body.attachToRaceId).toBeUndefined();
    const { body } = buildPushBody(dir, { ...manifest, attachToRaceId: "race_abc" });
    expect(body).toMatchObject({ sourceKey: "redmist:event:9001/session:7", format: "speedhive", attachToRaceId: "race_abc" });
    expect(Object.keys(body.files)).toEqual(expect.arrayContaining(["summaryCsv", "lapsCsv", "flagsCsv", "controlLogCsv", "redmistLapsJson"]));
  });
});

describe("attach candidates", () => {
  it("suggests races of the same series within a day, the same date first", () => {
    const unkeyed = [
      { raceId: "a", name: "WRL Barber Sunday", date: "2026-03-01", track: "Barber", series: "WRL", season: 2026, status: "PUBLISHED" },
      { raceId: "b", name: "WRL Barber Saturday", date: "2026-02-28", track: "Barber", series: "WRL", season: 2026, status: "PUBLISHED" },
      { raceId: "c", name: "GT4 Barber", date: "2026-02-28", track: "Barber", series: "SRO", season: 2026, status: "PUBLISHED" },
      { raceId: "d", name: "WRL COTA", date: "2026-04-10", track: "COTA", series: "WRL", season: 2026, status: "PUBLISHED" },
    ];
    expect(attachCandidates({ raceDate: "2026-02-28" }, "WRL", unkeyed).map((r) => r.raceId)).toEqual(["b", "a"]);
  });
});

describe("RedMist pacing", () => {
  it("keeps the gap between calls, shared across clients paced with the same settings", async () => {
    let t = 0;
    const slept: number[] = [];
    const p = { gapMs: 1600, now: () => t, sleep: async (ms: number) => void (slept.push(ms), (t += ms)) };
    const http = fakeHttp({ "https://x.test/a": "{}" });
    await paced(http, p).getJson("https://x.test/a");
    t += 100;
    await paced(http, p).getJson("https://x.test/a");
    expect(slept).toEqual([1500]);
  });
});
