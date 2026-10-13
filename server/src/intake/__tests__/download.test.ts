import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { download, resolve } from "../index.js";
import { readManifest, workDirFor } from "../manifest.js";
import { sha256 } from "../names.js";
import { buildPushBody, compareWithKnown, fileContentForKey, pushVersion, apiConfigFromEnv } from "../push.js";
import type { RaceSession } from "../types.js";
import { fakeHttp, fixture } from "./fake-http.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "intake-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const BASE = "https://usac.alkamelna.com/Results/06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1";
const PDF = Buffer.from("%PDF-1.4\nsynthetic pit cards\n%%EOF\n");
const files: Record<string, string | Buffer> = {
  "23_AnalysisEnduranceWithSections_Race 1.CSV": "NUMBER;DRIVER_NUMBER;LAP_NUMBER;LAP_TIME\n7;1;1;1:50.000\n007;1;1;1:51.000\n",
  "03_Results_Race 1_Official.CSV": "POSITION;NUMBER;STATUS;LAPS\n1;7;Classified;1\n2;007;Classified;1\n",
  "03_Results_Race 1_Provisional.CSV": "POSITION;NUMBER;STATUS;LAPS\n1;007;Classified;1\n",
  "20_Pit Stops Time Cards_Race 1.PDF": PDF,
  "26_Weather_Race 1.CSV": "TIME_UTC_SECONDS;AIR_TEMP\n1791640800;21.0\n",
};

function sroSession(): RaceSession {
  return {
    sourceKey: "sro:06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1",
    site: "sro",
    seriesId: "sro-gt4",
    seriesLabel: "Pirelli GT4 America",
    championship: "03_Pirelli GT4 America",
    season: 2026,
    event: "Indianapolis Motor Speedway RC",
    track: "Indianapolis Motor Speedway RC",
    sessionName: "Race 1",
    sessionType: "race",
    startTime: "2026-10-10T10:00",
    raceDate: "2026-10-10",
    files: Object.keys(files).map((n) => ({ url: encodeURI(`${BASE}/${n}`), name: n })),
    resultsStatus: "official",
    version: "v1",
    legacyFormat: "sro",
    factFormat: "alkamel-sro",
  };
}

describe("Alkamel download: manifest and idempotency", () => {
  it("writes the selected files under their original names and a manifest with url, sha256, size and fetch time", async () => {
    const http = fakeHttp(Object.fromEntries(Object.entries(files).map(([n, b]) => [`${BASE}/${n}`, { status: 200, body: b, headers: { etag: `"${n.length}"` } }])));
    const dir = workDirFor(root, sroSession().sourceKey);
    const r = await download(http, sroSession(), dir, { now: () => new Date("2026-10-13T12:00:00Z") });
    expect(r.failed).toEqual([]);
    expect(r.downloaded.sort()).toEqual(["03_Results_Race 1_Official.CSV", "20_Pit Stops Time Cards_Race 1.PDF", "23_AnalysisEnduranceWithSections_Race 1.CSV", "26_Weather_Race 1.CSV"]);
    const m = readManifest(dir)!;
    expect(m.resultsStatus).toBe("official");
    expect(m.metadata).toMatchObject({ name: "Pirelli GT4 Race 1 — Indianapolis Motor Speedway RC", series: "SRO", season: 2026, raceDate: "2026-10-10" });
    const pdf = m.files.find((f) => f.key === "pitStopPdf")!;
    expect(pdf).toMatchObject({ name: "20_Pit Stops Time Cards_Race 1.PDF", bytes: PDF.length, sha256: sha256(PDF), fetchedAt: "2026-10-13T12:00:00.000Z", parserSlot: true, etag: '"34"' });
    expect(pdf.url).toContain("%20");
    expect(readFileSync(join(dir, pdf.name)).equals(PDF)).toBe(true);
    expect(existsSync(join(dir, "03_Results_Race 1_Provisional.CSV"))).toBe(false);
  });

  it("a rerun sends conditional requests and rewrites nothing when the site answers 304", async () => {
    const routes = Object.fromEntries(
      Object.entries(files).map(([n, b]) => [
        `${BASE}/${n}`,
        (h: Record<string, string>) => (h["if-none-match"] ? { status: 304 } : { status: 200, body: b, headers: { etag: `"e-${n.length}"` } }),
      ])
    );
    const dir = join(root, "w");
    await download(fakeHttp(routes), sroSession(), dir);
    const http2 = fakeHttp(routes);
    const r2 = await download(http2, sroSession(), dir);
    expect(r2.downloaded).toEqual([]);
    expect(r2.unchanged).toHaveLength(4);
    expect(http2.calls.every((c) => c.headers["if-none-match"]?.startsWith('"e-'))).toBe(true);
  });

  it("index dates and sizes that match the manifest skip the request entirely; a changed file is re-fetched", async () => {
    const s = sroSession();
    s.files = s.files.map((f) => ({ ...f, listedModified: "2026-10-10 12:00", listedSize: "1K" }));
    const dir = join(root, "w");
    const routes = Object.fromEntries(Object.entries(files).map(([n, b]) => [`${BASE}/${n}`, { status: 200, body: b }]));
    await download(fakeHttp(routes), s, dir);
    const http2 = fakeHttp(routes);
    expect((await download(http2, s, dir)).downloaded).toEqual([]);
    expect(http2.calls).toHaveLength(0);
    // The site republishes the laps file.
    const s3 = { ...s, files: s.files.map((f) => (f.name.startsWith("23_") ? { ...f, listedModified: "2026-10-10 15:00" } : f)) };
    const newLaps = "NUMBER;DRIVER_NUMBER;LAP_NUMBER;LAP_TIME\n7;1;1;1:49.000\n";
    const http3 = fakeHttp({ ...routes, [`${BASE}/23_AnalysisEnduranceWithSections_Race 1.CSV`]: newLaps });
    const r3 = await download(http3, s3, dir);
    expect(r3.downloaded).toEqual(["23_AnalysisEnduranceWithSections_Race 1.CSV"]);
    expect(http3.calls).toHaveLength(1);
    expect(readFileSync(join(dir, "23_AnalysisEnduranceWithSections_Race 1.CSV"), "utf-8")).toBe(newLaps);
  });

  it("a failed file is reported and recorded as a warning, the others still land", async () => {
    const routes = Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("26_")).map(([n, b]) => [`${BASE}/${n}`, { status: 200, body: b }]));
    const r = await download(fakeHttp(routes), sroSession(), join(root, "w"));
    expect(r.failed.map((f) => f.name)).toEqual(["26_Weather_Race 1.CSV"]);
    expect(r.manifest.warnings[0]).toMatch(/26_Weather/);
    expect(r.manifest.files).toHaveLength(3);
  });
});

const SH = "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults";
function shRoutes() {
  const lap = JSON.parse(fixture("speedhive-lapdata.json"));
  return {
    [`${SH}/sessions/11748965`]: fixture("speedhive-session.json"),
    [`${SH}/events/3197001`]: fixture("speedhive-event.json"),
    [`${SH}/sessions/11748965/classification`]: fixture("speedhive-classification.json"),
    [`${SH}/sessions/11748965/lapdata/1/laps?count=500&offset=0`]: JSON.stringify(lap.p1),
    // Paged: two laps, then the third.
    [`${SH}/sessions/11748965/lapdata/2/laps?count=500&offset=0`]: JSON.stringify(lap.p2_page1),
    [`${SH}/sessions/11748965/lapdata/2/laps?count=500&offset=2`]: JSON.stringify(lap.p2_page2),
    // Position 3 (DNS) has no lap data: 404.
    [`${SH}/sessions/11748965/announcements`]: fixture("speedhive-announcements.json"),
  };
}

describe("Speedhive download", () => {
  it("writes summary and all-laps CSVs in the Python exporter's format, plus the raw JSON", async () => {
    const http = fakeHttp(shRoutes());
    const s = await resolve(http, "speedhive:session:11748965");
    const dir = workDirFor(root, s.sourceKey);
    const r = await download(http, s, dir);
    const m = r.manifest;
    const laps = m.files.find((f) => f.key === "lapsCsv")!;
    const summary = m.files.find((f) => f.key === "summaryCsv")!;
    expect(laps.name).toBe("speedhive_Saturday_8_Hour_11748965_all_laps.csv");
    expect(summary.name).toBe("speedhive_Saturday_8_Hour_11748965_summary.csv");
    const csv = readFileSync(join(dir, laps.name), "utf-8");
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Team/Name,Start Number,Class,Finish Position (Overall),Finish Position (Class),Lap Number,Lap Time,Time of Day,Diff vs Best Lap,Diff vs Last Lap,Speed,In Pit,Field Position,Leader Lap,Gap to Leader (Time),Gap to Leader (Laps),Gap Ahead (Time),Gap Behind (Time),Status,Sector 1,Sector 2"
    );
    expect(lines[1]).toBe("Synthetic Alpha,60,GTU,1,1,1,1:35.100,2026-02-28T09:01:35.1,1.000,,82.057,False,1,1,0.000,0,0.000,-1.200,GREEN,30.000,65.100");
    expect(lines[3]).toContain(",True,");
    expect(lines[4]).toBe('"Synthetic, Bravo ""Q""",007,GTO,2,1,1,1:36.000,2026-02-28T09:01:36.0,1.000,,82.057,False,2,1,0.000,0,0.000,-1.200,GREEN,,');
    expect(lines.filter((l) => l.startsWith('"Synthetic, Bravo')).length).toBe(3); // all three pages of laps
    expect(csv.endsWith("\r\n")).toBe(true);
    const sum = readFileSync(join(dir, summary.name), "utf-8").split("\r\n");
    expect(sum[0]).toBe("Position,Start Number,Name,Class,Position In Class,Status,Best Lap");
    expect(sum[3]).toBe("3,7,Synthetic Charlie,GTO,2,DNS,");
    expect(m.files.filter((f) => !f.parserSlot).map((f) => f.key).sort()).toEqual([
      "speedhiveAnnouncementsJson", "speedhiveClassificationJson", "speedhiveEventJson", "speedhiveLapdataJson", "speedhiveSessionJson",
    ]);
    expect(m.missing.map((x) => x.role)).toEqual(["flags", "control_log"]);
    expect(m.warnings.join(" ")).toMatch(/1 participant\(s\) have no lap data/);
    expect(m.metadata).toMatchObject({ name: "WRL @ Barber #87 — Saturday 8 Hour", series: "WRL", raceDate: "2026-02-28", track: "Barber Motorsports Park" });
  });

  it("an unchanged event is not downloaded again; a Redmist export dropped in by hand is picked up", async () => {
    const http = fakeHttp(shRoutes());
    const s = await resolve(http, "speedhive:session:11748965");
    const dir = join(root, "w");
    await download(http, s, dir);
    writeFileSync(join(dir, "redmist flags.csv"), "Flag,Start,End,Duration\nGreen,2/28/2026 9:00:00 AM,2/28/2026 9:30:00 AM,00:30:00\n");
    const http2 = fakeHttp(shRoutes());
    const r2 = await download(http2, s, dir);
    expect(http2.calls).toHaveLength(0);
    expect(r2.manifest.files.find((f) => f.manual)).toMatchObject({ name: "redmist flags.csv", key: "flagsCsv", role: "flags", parserSlot: true });
  });
});

describe("push body", () => {
  it("sends parser slots and archive files; PDFs as data URLs; manual files change the pushed version", async () => {
    const routes = Object.fromEntries(Object.entries(files).map(([n, b]) => [`${BASE}/${n}`, { status: 200, body: b }]));
    const dir = join(root, "w");
    const { manifest } = await download(fakeHttp(routes), sroSession(), dir);
    const { body, skipped } = buildPushBody(dir, manifest);
    expect(skipped).toEqual([]);
    expect(Object.keys(body.files).sort()).toEqual(["lapsCsv", "pitStopPdf", "resultsCsv", "weatherCsv"]);
    expect(body.files.pitStopPdf).toBe(`data:application/pdf;base64,${PDF.toString("base64")}`);
    expect(body).toMatchObject({ sourceKey: manifest.sourceKey, sourceVersion: "v1", resultsStatus: "official", format: "sro", metadata: { date: "2026-10-10", series: "SRO", season: 2026 } });
    expect(body.manifest.files.map((f) => f.sha256)).toHaveLength(4);

    const small = buildPushBody(dir, manifest, { maxBytes: 200 });
    expect(Object.keys(small.body.files).sort()).toEqual(["lapsCsv", "pitStopPdf", "resultsCsv"]);
    expect(small.skipped).toEqual(["26_Weather_Race 1.CSV (size cap)"]);

    const withManual = { ...manifest, files: [...manifest.files, { ...manifest.files[0], key: "flagsCsv", name: "x.csv", manual: true, sha256: "abc" }] };
    expect(pushVersion(withManual, { flagsCsv: "x" })).toMatch(/^v1\+[0-9a-f]{8}$/);
    expect(pushVersion(manifest, body.files)).toBe("v1");
  });

  it("decodes text files as UTF-8 without a BOM", () => {
    expect(fileContentForKey("lapsCsv", Buffer.from("﻿a;b\n", "utf-8"))).toBe("a;b\n");
  });

  it("compares discovered sessions with the site's known races", () => {
    const s = (key: string, version: string, rs: RaceSession["resultsStatus"]) => ({ ...sroSession(), sourceKey: key, version, resultsStatus: rs });
    const known = [
      { sourceKey: "a", sourceVersion: "v1", resultsStatus: "provisional", raceId: "r1", name: "", status: "DRAFT", updatedAt: "" },
      { sourceKey: "b", sourceVersion: "v1+abcd1234", resultsStatus: "official", raceId: "r2", name: "", status: "PUBLISHED", updatedAt: "" },
      { sourceKey: "c", sourceVersion: "v1", resultsStatus: "official", raceId: "r3", name: "", status: "DRAFT", updatedAt: "" },
    ];
    const out = compareWithKnown([s("a", "v2", "official"), s("b", "v1", "official"), s("c", "v2", "official"), s("d", "v1", "provisional")], known);
    expect(out.map((o) => o.state)).toEqual(["results-upgrade", "unchanged", "changed", "new"]);
  });

  it("reads the API config from env and never needs the token anywhere else", () => {
    expect(apiConfigFromEnv({ RACETRACE_API_URL: "https://api.example.com/", RACETRACE_API_TOKEN: "rt_x" })).toEqual({ url: "https://api.example.com/api", token: "rt_x" });
    expect(apiConfigFromEnv({ RACETRACE_API_URL: "https://api.example.com/api" })).toBeNull();
  });
});
