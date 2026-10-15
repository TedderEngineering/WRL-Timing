import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── In-memory Prisma stand-in (transactions roll back on error) ─────────────
const store = vi.hoisted(() => ({
  races: new Map<string, any>(),
  entries: [] as any[],
  laps: [] as any[],
  events: [] as any[],
  audit: [] as any[],
  seq: 0,
}));
const db = vi.hoisted(() => {
  const where = (r: any, w: any) => Object.entries(w).every(([k, v]) => r[k] === v);
  const self: any = {
    race: {
      findUnique: vi.fn(async ({ where: w }: any) => {
        const r = [...store.races.values()].find((x) => where(x, w));
        return r ? { ...r } : null;
      }),
      findMany: vi.fn(async () => [...store.races.values()]),
      create: vi.fn(async ({ data }: any) => {
        if (data.sourceKey && [...store.races.values()].some((r) => r.sourceKey === data.sourceKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const r = { id: `race${++store.seq}`, updatedAt: new Date(), ...data };
        store.races.set(r.id, r);
        return r;
      }),
      update: vi.fn(async ({ where: w, data }: any) => {
        const r = store.races.get(w.id);
        Object.assign(r, data, { updatedAt: new Date() });
        return r;
      }),
    },
    raceEntry: {
      createMany: vi.fn(async ({ data }: any) => void store.entries.push(...data)),
      deleteMany: vi.fn(async ({ where: w }: any) => void (store.entries = store.entries.filter((e) => e.raceId !== w.raceId))),
    },
    raceLap: {
      createMany: vi.fn(async ({ data }: any) => void store.laps.push(...data)),
      deleteMany: vi.fn(async ({ where: w }: any) => void (store.laps = store.laps.filter((e) => e.raceId !== w.raceId))),
    },
    event: {
      findMany: vi.fn(async () => store.events),
      create: vi.fn(async ({ data }: any) => {
        const e = { id: `event${++store.seq}`, ...data };
        store.events.push(e);
        return e;
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => void store.audit.push(data)) },
    // Serialised like a database would order two writers; a failed transaction restores its snapshot.
    $transaction: vi.fn((fn: any) => {
      const run = async () => {
        const snap = { races: new Map([...store.races].map(([k, v]) => [k, { ...v }])), entries: [...store.entries], laps: [...store.laps], events: [...store.events] };
        try {
          return await fn(self);
        } catch (e) {
          Object.assign(store, snap);
          throw e;
        }
      };
      const p = lock.then(run);
      lock = p.catch(() => undefined);
      return p;
    }),
  };
  let lock: Promise<unknown> = Promise.resolve();
  return self;
});
vi.mock("../../models/prisma.js", () => ({ prisma: db }));
vi.mock("../../config/env.js", () => ({ env: { NODE_ENV: "test", JWT_ACCESS_SECRET: "x".repeat(32), JWT_REFRESH_SECRET: "y".repeat(32) } }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intakeRace, listIntakeRaces, parserInput, type IntakeDeps } from "../intake.js";
import { getParser } from "../../utils/parsers/index.js";
import type { RaceDataParser } from "../../utils/parsers/types.js";
import { download, resolve } from "../../intake/index.js";
import { buildPushBody } from "../../intake/push.js";
import { fakeHttp, fixture } from "../../intake/__tests__/fake-http.js";

/** Parser stand-in: "car,lap,pos" rows → valid chart data. */
const fakeParser: RaceDataParser = {
  id: "fake",
  name: "Fake",
  series: "TEST",
  description: "",
  fileSlots: [
    { key: "lapsCsv", label: "Laps", description: "", required: true },
    { key: "resultsCsv", label: "Results", description: "", required: false },
  ],
  parse: vi.fn((files: Record<string, string>) => {
    const cars: Record<string, any> = {};
    for (const line of files.lapsCsv.trim().split("\n")) {
      const [car, lap, pos] = line.split(",").map(Number);
      cars[car] ??= { num: car, team: `Team ${car}`, cls: "GT4", finishPos: 1, finishPosClass: 1, laps: [] };
      cars[car].laps.push({ l: lap, p: pos, cp: pos, lt: "1:50.000", ltSec: 110, flag: "GF", pit: 0 });
    }
    const nums = Object.keys(cars).map(Number);
    return {
      data: { maxLap: Math.max(...Object.values(cars).flatMap((c: any) => c.laps.map((l: any) => l.l))), totalCars: nums.length, greenPaceCutoff: 120, cars, fcy: [], classGroups: { GT4: nums }, classCarCounts: { GT4: nums.length } },
      annotations: {},
      warnings: [],
    };
  }),
};

const archive = vi.fn(async (files: Record<string, unknown>) => ({
  paths: Object.fromEntries(Object.keys(files).map((k) => [k, `imports/a${archive.mock.calls.length}/${k}.csv`])),
  warnings: [] as string[],
}));
const deps: IntakeDeps = { getParser: (f) => (f === "fake" ? fakeParser : getParser(f)), archive };
const actor = { userId: "admin1", apiTokenId: "tok1" };

const KEY = "sro:06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1";
function body(over: Record<string, unknown> = {}) {
  return {
    sourceKey: KEY,
    sourceVersion: "v1",
    resultsStatus: "provisional",
    format: "fake",
    metadata: { name: "Pirelli GT4 Race 1 — Indianapolis", date: "2026-10-10", track: "Indianapolis Motor Speedway RC", series: "SRO", season: 2026 },
    files: { lapsCsv: "7,1,1\n007,1,2\n7,2,1\n", resultsCsv: "x", driveTimeCsv: "archive only" },
    ...over,
  };
}

beforeEach(() => {
  store.races.clear();
  store.entries = [];
  store.laps = [];
  store.events = [];
  store.audit = [];
  store.seq = 0;
  db.$transaction.mockClear();
  archive.mockClear();
  (fakeParser.parse as any).mockClear();
});

describe("intake upsert by source key", () => {
  it("creates a DRAFT race with the source key, archive paths, entries and laps, and an audit row", async () => {
    const r = await intakeRace(body(), actor, deps);
    expect(r.action).toBe("created");
    const race = store.races.get(r.raceId);
    expect(race).toMatchObject({ sourceKey: KEY, sourceVersion: "v1", resultsStatus: "provisional", status: "DRAFT", premium: false, series: "SRO", createdBy: "admin1", eventId: "event1" });
    expect(race.date.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(race.sourceFiles).toEqual({ lapsCsv: "imports/a1/lapsCsv.csv", resultsCsv: "imports/a1/resultsCsv.csv", driveTimeCsv: "imports/a1/driveTimeCsv.csv" });
    expect(store.entries).toHaveLength(1); // "7" and "007" both parse to 7 in this fake parser
    expect(store.laps).toHaveLength(3);
    expect(store.audit[0]).toMatchObject({ action: "INTAKE_CREATE_RACE", targetId: r.raceId, details: { sourceKey: KEY, apiTokenId: "tok1" } });
  });

  it("archive-only keys reach the archive but never the parser", async () => {
    await intakeRace(body(), actor, deps);
    expect(Object.keys((fakeParser.parse as any).mock.calls[0][0])).toEqual(["lapsCsv", "resultsCsv"]);
    expect(Object.keys(archive.mock.calls[0][0])).toEqual(["lapsCsv", "resultsCsv", "driveTimeCsv"]);
  });

  it("a rerun with the same version is 'unchanged': nothing parsed, archived or written", async () => {
    const first = await intakeRace(body(), actor, deps);
    const again = await intakeRace(body(), actor, deps);
    expect(again).toMatchObject({ action: "unchanged", raceId: first.raceId });
    expect(fakeParser.parse).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledTimes(1);
    expect(store.races.size).toBe(1);
    expect(store.audit).toHaveLength(1);
  });

  it("a new version updates the same race: id, name, status and event kept; data, files and results replaced", async () => {
    const first = await intakeRace(body(), actor, deps);
    const race = store.races.get(first.raceId);
    race.name = "Renamed by the owner";
    race.status = "PUBLISHED";
    const upd = await intakeRace(body({ sourceVersion: "v2", resultsStatus: "official", files: { lapsCsv: "7,1,1\n7,2,1\n7,3,1\n7,4,1\n" } }), actor, deps);
    expect(upd).toMatchObject({ action: "updated", raceId: first.raceId });
    expect(store.races.size).toBe(1);
    expect(store.races.get(first.raceId)).toMatchObject({
      name: "Renamed by the owner",
      status: "PUBLISHED",
      eventId: "event1",
      sourceVersion: "v2",
      resultsStatus: "official",
      maxLap: 4,
      sourceFiles: { lapsCsv: "imports/a2/lapsCsv.csv" },
    });
    expect(store.laps.filter((l) => l.raceId === first.raceId)).toHaveLength(4);
    expect(store.audit[1]).toMatchObject({ action: "INTAKE_UPDATE_RACE", details: { previousResultsStatus: "provisional", previousSourceFiles: { lapsCsv: "imports/a1/lapsCsv.csv", resultsCsv: "imports/a1/resultsCsv.csv", driveTimeCsv: "imports/a1/driveTimeCsv.csv" } } });
  });

  it("source keys are compared in canonical form (encoded or untidy input updates the same race)", async () => {
    const first = await intakeRace(body(), actor, deps);
    const enc = KEY.replace(/ /g, "%20");
    const r = await intakeRace(body({ sourceKey: enc, sourceVersion: "v2" }), actor, deps);
    expect(r.raceId).toBe(first.raceId);
    expect(r.sourceKey).toBe(KEY);
  });

  it("official results are never replaced by provisional ones unless forced", async () => {
    await intakeRace(body({ resultsStatus: "official" }), actor, deps);
    await expect(intakeRace(body({ sourceVersion: "v2", resultsStatus: "provisional" }), actor, deps)).rejects.toMatchObject({ statusCode: 409, code: "RESULTS_DOWNGRADE" });
    expect(archive).toHaveBeenCalledTimes(1);
    const forced = await intakeRace(body({ sourceVersion: "v2", resultsStatus: "provisional", force: true }), actor, deps);
    expect(forced.action).toBe("updated");
  });

  it("a failed archive stops the import before any DB write", async () => {
    const failing: IntakeDeps = { ...deps, archive: vi.fn(async () => { throw Object.assign(new Error("Import stopped"), { statusCode: 502, code: "ARCHIVE_FAILED" }); }) };
    await expect(intakeRace(body(), actor, failing)).rejects.toMatchObject({ code: "ARCHIVE_FAILED" });
    expect(store.races.size).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(store.audit).toHaveLength(0);
  });

  it("a parse failure is a 400 and nothing is archived", async () => {
    await expect(intakeRace(body({ files: { lapsCsv: "garbage" } }), actor, deps)).rejects.toMatchObject({ statusCode: 400, code: "INVALID_RACE_DATA" });
    expect(archive).not.toHaveBeenCalled();
  });

  it("rejects bad input: source key, format, missing required slot", async () => {
    await expect(intakeRace(body({ sourceKey: "wrl:1" }), actor, deps)).rejects.toThrow();
    await expect(intakeRace(body({ format: "nope" }), actor, deps)).rejects.toMatchObject({ code: "UNKNOWN_FORMAT" });
    await expect(intakeRace(body({ files: { resultsCsv: "x" } }), actor, deps)).rejects.toMatchObject({ code: "MISSING_FILE" });
  });

  it("a duplicate created concurrently becomes a 409 and the transaction rolls back", async () => {
    const r1 = intakeRace(body(), actor, deps);
    const r2 = intakeRace(body(), actor, deps);
    const res = await Promise.allSettled([r1, r2]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((res.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409, code: "SOURCE_KEY_CONFLICT" });
    expect(store.races.size).toBe(1);
  });

  it("a write that runs out of time is a clear 504, with a long enough limit for a 24-hour race", async () => {
    db.$transaction.mockImplementationOnce(async (_fn: any, opts: any) => {
      expect(opts.timeout).toBeGreaterThanOrEqual(300_000);
      throw Object.assign(new Error("Transaction already closed"), { code: "P2028" });
    });
    await expect(intakeRace(body(), actor, deps)).rejects.toMatchObject({ statusCode: 504, code: "WRITE_TIMEOUT" });
    expect(store.races.size).toBe(0);
  });

  it("archives only the files added by hand when the push carries a manifest", async () => {
    const { filesToArchive } = await import("../intake.js");
    const files = { lapsCsv: "a", resultsCsv: "b", flagsCsv: "c" };
    const manifest = { files: [{ key: "lapsCsv" }, { key: "resultsCsv" }, { key: "flagsCsv", manual: true }] };
    expect(filesToArchive(files, manifest, undefined)).toEqual({ flagsCsv: "c" });
    expect(filesToArchive(files, { files: [{ key: "lapsCsv" }] }, undefined)).toEqual({});
    expect(filesToArchive(files, undefined, undefined)).toEqual(files);
    expect(filesToArchive(files, manifest, "all")).toEqual(files);
  });

  it("lists intake races for discovery", async () => {
    await intakeRace(body(), actor, deps);
    const rows = await listIntakeRaces();
    expect(rows).toEqual([expect.objectContaining({ sourceKey: KEY, sourceVersion: "v1", resultsStatus: "provisional", status: "DRAFT" })]);
  });
});

describe("Speedhive end to end (fixtures → work folder → push body → real parser)", () => {
  it("imports without Redmist files: the parser gets placeholders that are never archived", async () => {
    const parser = getParser("speedhive")!;
    const p = parserInput(parser, { summaryCsv: "a", lapsCsv: "b" });
    expect(p.placeholders).toEqual(["flagsCsv", "controlLogCsv"]);
    expect(p.missing).toEqual([]);

    const SH = "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults";
    const lap = JSON.parse(fixture("speedhive-lapdata.json"));
    const http = fakeHttp({
      [`${SH}/sessions/11748965`]: fixture("speedhive-session.json"),
      [`${SH}/events/3197001`]: fixture("speedhive-event.json"),
      [`${SH}/sessions/11748965/classification`]: fixture("speedhive-classification.json"),
      [`${SH}/sessions/11748965/lapdata/1/laps?count=500&offset=0`]: JSON.stringify(lap.p1),
      [`${SH}/sessions/11748965/lapdata/2/laps?count=500&offset=0`]: JSON.stringify(lap.p2_page1),
      [`${SH}/sessions/11748965/lapdata/2/laps?count=500&offset=2`]: JSON.stringify(lap.p2_page2),
    });
    const root = mkdtempSync(join(tmpdir(), "intake-e2e-"));
    try {
      const s = await resolve(http, "speedhive:session:11748965");
      const { manifest } = await download(http, s, join(root, "w"));
      const { body: b } = buildPushBody(join(root, "w"), manifest);
      const r = await intakeRace(b, actor, deps);
      expect(r.action).toBe("created");
      expect(r.warnings.join(" ")).toMatch(/No flagsCsv supplied/);
      // Every file came from the timing site, so nothing is archived (the manifest is in the audit row).
      expect(archive).not.toHaveBeenCalled();
      expect(store.races.get(r.raceId)).toMatchObject({ series: "WRL", sourceKey: "speedhive:session:11748965", resultsStatus: "unknown", sanctioningBody: "WRL" });
      expect(store.laps.length).toBe(6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("attach a session to a race imported before source keys", () => {
  const legacy = (over: Record<string, unknown> = {}) => {
    const r = { id: "old1", name: "GT4 Indy R1 (hand upload)", date: new Date("2026-10-10T00:00:00Z"), series: "SRO", status: "PUBLISHED", sourceKey: null, sourceVersion: null, resultsStatus: null, sourceFiles: { lapsCsv: "imports/hand/laps.csv" }, eventId: "eventX", ...over };
    store.races.set(r.id, r);
    return r;
  };

  it("claims the race: same id, name and status; data replaced; source key set; audited as an attach", async () => {
    legacy();
    const r = await intakeRace(body({ attachToRaceId: "old1" }), actor, deps);
    expect(r).toMatchObject({ action: "updated", attached: true, raceId: "old1" });
    expect(store.races.size).toBe(1);
    expect(store.races.get("old1")).toMatchObject({ name: "GT4 Indy R1 (hand upload)", status: "PUBLISHED", eventId: "eventX", sourceKey: KEY, sourceVersion: "v1", resultsStatus: "provisional" });
    expect(store.laps.filter((l) => l.raceId === "old1")).toHaveLength(3);
    expect(store.audit[0]).toMatchObject({ action: "INTAKE_ATTACH_RACE", targetId: "old1", details: { attached: true, previousSourceFiles: { lapsCsv: "imports/hand/laps.csv" } } });
    // From then on the source key finds it; repeating the attach is harmless.
    const again = await intakeRace(body({ attachToRaceId: "old1", sourceVersion: "v2" }), actor, deps);
    expect(again).toMatchObject({ action: "updated", raceId: "old1" });
    expect(again.attached).toBeUndefined();
  });

  it("refuses a race that does not exist, already has a source key, or does not look like the session", async () => {
    await expect(intakeRace(body({ attachToRaceId: "nope" }), actor, deps)).rejects.toMatchObject({ statusCode: 404, code: "ATTACH_NOT_FOUND" });
    legacy({ id: "keyed", sourceKey: "sro:other" });
    await expect(intakeRace(body({ attachToRaceId: "keyed" }), actor, deps)).rejects.toMatchObject({ statusCode: 409, code: "ATTACH_KEYED" });
    legacy({ id: "wrl", series: "WRL" });
    await expect(intakeRace(body({ attachToRaceId: "wrl" }), actor, deps)).rejects.toMatchObject({ statusCode: 409, code: "ATTACH_MISMATCH" });
    legacy({ id: "other", name: "Pirelli GT4 Race 2 (hand upload)" });
    await expect(intakeRace(body({ attachToRaceId: "other" }), actor, deps)).rejects.toMatchObject({ statusCode: 409, code: "ATTACH_MISMATCH" });
    legacy({ id: "far", date: new Date("2026-10-03T00:00:00Z") });
    await expect(intakeRace(body({ attachToRaceId: "far" }), actor, deps)).rejects.toMatchObject({ statusCode: 409, code: "ATTACH_MISMATCH" });
    expect(store.audit).toHaveLength(0);
    // force overrides the look-alike check (owner's decision)
    const r = await intakeRace(body({ attachToRaceId: "far", force: true }), actor, deps);
    expect(r).toMatchObject({ attached: true, raceId: "far" });
  });

  it("accepts a race dated on the event's first day, a few days before the session", async () => {
    legacy({ id: "early", date: new Date("2026-10-07T00:00:00Z") });
    const r = await intakeRace(body({ attachToRaceId: "early" }), actor, deps);
    expect(r).toMatchObject({ attached: true, raceId: "early" });
  });

  it("refuses to attach when the source key already belongs to another race", async () => {
    const first = await intakeRace(body(), actor, deps);
    legacy();
    await expect(intakeRace(body({ attachToRaceId: "old1", sourceVersion: "v2" }), actor, deps)).rejects.toMatchObject({ statusCode: 409, code: "ATTACH_CONFLICT" });
    expect(store.races.get(first.raceId).sourceKey).toBe(KEY);
    expect(store.races.get("old1").sourceKey).toBeNull();
  });
});
