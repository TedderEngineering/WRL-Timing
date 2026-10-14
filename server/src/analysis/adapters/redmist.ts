/**
 * RedMist adapter ('redmist', RM): redmist.racing exports used by the World Racing League.
 *
 *   laps     v1/Exports/GetCarLaps?format=json        header + laps[] of CarPosition snapshots (UTC)
 *   pits     v1/Exports/GetPitStops?format=json       pitStops[] (Flagtronics pit report, track local)
 *   results  v2/Events/LoadSessionResults             eventEntries[], carPositions[] (final state)
 *   flags    v1/Events/LoadFlags                      [{ f, s, e }] RedMist Flags enum, track local
 *   control  control log                              [{ o, t, cor, c1, c1h, c2, c2h, n, s, a }]
 *
 * Only the laps file is required. Semantics follow RedMist.TimingCommon CarPosition.cs and the
 * StatusApi export code (PitStopAnalyzer.cs, ExportDataSource.cs):
 *  - `ttm` is the total time since the session (race clock) start; the crossing instant of a lap is
 *    session start + ttm. The lap objects carry no time of day. The session start is taken from the
 *    results file (`sessionStartTime` when set, else `localTimeOfDay - runningRaceTime`), which
 *    reproduces Speedhive's `Time of Day` to the millisecond on Barber 2026.
 *  - `lip` (LapIncludedPit) = the car was seen in the pit lane during this lap; `ip` (IsInPit) = it
 *    was in the pit lane when the lap record was written at the line crossing.
 *  - `pet` / `pdm` (pit entry time / duration) are sticky, describe the most recent stop and are
 *    not used per lap; the pit report carries the per-stop values.
 *  - Lap numbers (`llp`) are the timing system's credited laps: penalty laps (`pl`) are deducted,
 *    so a crossing disappears from the numbering when one is applied.
 */
import type { Driver } from "../schema/package-types.js";
import type {
  AdapterResult,
  CanonEntry,
  CanonFlagRecord,
  CanonLap,
  CanonMessage,
  CanonPitRecord,
  CanonResultRow,
  CanonicalRace,
  Issue,
  LineFlag,
  SourceFileInfo,
} from "../types.js";
import { carId, carOrder, parseClock, parseDuration, rd } from "../util.js";
import { AdapterBlocker, checkLapOrder } from "./errors.js";

export const REDMIST_ADAPTER_VERSION = "1.0.0";

/** RedMist.TimingCommon.Models.Flags. */
export const RM_FLAGS = ["Unknown", "Green", "Yellow", "Red", "White", "Checkered", "Black", "Purple35", "Purple60", "Blue", "MeatBall", "Debris", "WavingYellow"] as const;

/** Overall track flag at the line → LineFlag. White (last lap) is still green running; Purple = Code 35/60 full-course slow. */
export function rmLineFlag(f: number | null | undefined): LineFlag {
  switch (f) {
    case 1:
    case 4:
      return "G";
    case 2:
    case 7:
    case 8:
      return "Y";
    case 3:
      return "R";
    case 5:
      return "C";
    default:
      return null;
  }
}

/** Flags-file record type (D-FCY-SOURCE vocabulary) for a RedMist flag; null = not a race-state change. */
function rmRecType(f: number): string | null {
  switch (f) {
    case 1:
      return "GF";
    case 2:
    case 7:
    case 8:
      return "FCY";
    case 3:
      return "RF";
    case 5:
      return "FF";
    default:
      return null;
  }
}

interface RmLapJson {
  n?: string | number | null;
  llp?: number | null;
  ltm?: string | null;
  ttm?: string | null;
  flg?: number | null;
  ip?: boolean | null;
  lip?: boolean | null;
  dn?: string | null;
  class?: string | null;
  pl?: number | null;
  pet?: string | null;
  pdm?: number | null;
  ds?: string | null;
}

interface RmPitJson {
  carNumber?: string | number | null;
  stopNumber?: number | null;
  startLap?: number | null;
  endLap?: number | null;
  pitEntryTime?: string | null;
  pitExitTime?: string | null;
  pitEntryTimeUnavailable?: boolean | null;
  pitEntryTimeRenumbered?: boolean | null;
  pitDurationMs?: number | null;
  driverBefore?: string | null;
  driverAfter?: string | null;
}

interface RmControlJson {
  o?: number | null;
  t?: string | null;
  cor?: string | null;
  c1?: string | null;
  c1h?: boolean | null;
  c2?: string | null;
  c2h?: boolean | null;
  n?: string | null;
  s?: string | null;
  a?: string | null;
}

function parseJson(f: SourceFileInfo): unknown {
  try {
    return JSON.parse(f.text ?? "");
  } catch (e) {
    throw new AdapterBlocker("ADAPTER-HEADER-MISSING", `${f.name}: not valid JSON (${(e as Error).message})`, [f.fileId]);
  }
}

function one(files: SourceFileInfo[], role: string, required: boolean): SourceFileInfo | null {
  const xs = files.filter((f) => f.role === role);
  if (xs.length === 0 && required) throw new AdapterBlocker("ADAPTER-REQUIRED-FILE-MISSING", `redmist: the ${role} file is required`);
  return xs[0] ?? null;
}

/** 'UTC-06:00' → -360. */
export function parseUtcLabel(s: unknown): number | null {
  const m = String(s ?? "").match(/^UTC\s*([+-])(\d{1,2}):?(\d{2})$/i);
  if (!m) return String(s ?? "").toUpperCase() === "UTC" ? 0 : null;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}

/** 'YYYY-MM-DDTHH:MM:SS(.f)' (naive local) → { date, sec }. */
function parseNaiveLocal(s: string | null | undefined): { date: string; sec: number } | null {
  const m = String(s ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  return { date: m[1], sec: Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function plausibleYear(date: string): boolean {
  return Number(date.slice(0, 4)) >= 2000;
}

const str = (x: unknown): string => (x === null || x === undefined ? "" : String(x)).trim();

function setSpans(laps: Record<string, CanonLap[]>): void {
  for (const ls of Object.values(laps)) {
    for (let i = 0; i < ls.length; i++) ls[i].span = i === 0 ? 1 : Math.max(1, ls[i].lap - ls[i - 1].lap);
  }
}

/**
 * A stop whose entry time the equipment reissued: the visit runs from the first entry time seen on the
 * stop's laps to the last one plus the final duration. The lap snapshots carry the device's clock even
 * when its date is unset (year 0001); only the time of day is used. Null when fewer than two entries.
 */
export function renumberedVisitS(laps: RmLapJson[]): number | null {
  const sorted = [...laps].sort((a, b) => (a.llp ?? 0) - (b.llp ?? 0));
  const tods: number[] = [];
  for (const x of sorted) {
    const m = str(x.pet).match(/T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (!m) continue;
    const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (!tods.length || tods[tods.length - 1] !== t) tods.push(t);
  }
  const last = sorted[sorted.length - 1];
  if (tods.length < 2 || typeof last?.pdm !== "number" || last.pdm <= 0) return null;
  const span = (((tods[tods.length - 1] - tods[0]) % 86400) + 86400) % 86400;
  return span > 6 * 3600 ? null : span + last.pdm / 1000;
}

const NON_PENALTY_ACTION = /^(no action( needed)?|no aciton needed|no penalty|none|continue)$/i;
const NOT_FINAL_STATUS = /overturned|under investigation|pending|rescinded|withdrawn/i;

export function adaptRedmist(files: SourceFileInfo[]): AdapterResult {
  const issues: Issue[] = [];
  const lf = one(files, "laps", true)!;
  const pf = one(files, "pit_cards_json", false);
  const rf = one(files, "results", false);
  const ff = one(files, "flags", false);
  const cf = one(files, "control_log", false);

  const race: CanonicalRace = {
    format: "redmist",
    adapterVersion: REDMIST_ADAPTER_VERSION,
    files,
    timeBase: "clock",
    session: { dateCandidates: [], utcOffsetCandidates: [] },
    entries: [],
    laps: {},
    pitRecords: [],
    driveStints: [],
    flagRecords: [],
    raceControl: [],
    results: null,
  };

  /* ------------------------------------------------------------ headers, time zone */
  const lapsDoc = parseJson(lf) as { laps?: RmLapJson[]; trackTimeZone?: string; eventName?: string; sessionName?: string; truncated?: boolean; skippedRows?: number; sessionStillLive?: boolean };
  if (!lapsDoc || !Array.isArray(lapsDoc.laps)) throw new AdapterBlocker("ADAPTER-HEADER-MISSING", `${lf.name}: 'laps' array missing (expected the RedMist GetCarLaps JSON export)`, [lf.fileId]);
  const offset = parseUtcLabel(lapsDoc.trackTimeZone);
  if (offset !== null) race.session.utcOffsetCandidates.push({ offsetMinutes: offset, source: `${lf.fileId}:trackTimeZone` });
  if (lapsDoc.eventName) race.session.event = String(lapsDoc.eventName);
  if (lapsDoc.sessionName) race.session.session = String(lapsDoc.sessionName);
  if (lapsDoc.truncated) issues.push({ severity: "warning", code: "REDMIST-EXPORT-TRUNCATED", message: `${lf.name}: RedMist marked the lap export truncated; laps after the cut are missing.`, files: [lf.fileId] });
  if (lapsDoc.sessionStillLive) issues.push({ severity: "warning", code: "REDMIST-SESSION-LIVE", message: `${lf.name}: exported while the session was still live; the lap data may be incomplete.`, files: [lf.fileId] });
  if ((lapsDoc.skippedRows ?? 0) > 0) issues.push({ severity: "warning", code: "REDMIST-ROWS-SKIPPED", message: `${lf.name}: RedMist skipped ${lapsDoc.skippedRows} unreadable lap row(s); a lost row can lose a pit stop.`, files: [lf.fileId] });

  /* ------------------------------------------------------------ results doc (session start) */
  const resDoc = rf ? (parseJson(rf) as Record<string, unknown>) : null;
  const flagsDoc = ff ? (parseJson(ff) as { f?: number; s?: string; e?: string | null }[]) : null;
  if (flagsDoc && !Array.isArray(flagsDoc)) throw new AdapterBlocker("ADAPTER-HEADER-MISSING", `${ff!.name}: expected an array of { f, s, e } flag records`, [ff!.fileId]);
  const pitsDoc = pf ? (parseJson(pf) as { pitStops?: RmPitJson[]; trackTimeZone?: string; truncated?: boolean; skippedLapRows?: number; sessionStillLive?: boolean }) : null;
  if (pitsDoc && !Array.isArray(pitsDoc.pitStops)) throw new AdapterBlocker("ADAPTER-HEADER-MISSING", `${pf!.name}: 'pitStops' array missing (expected the RedMist GetPitStops JSON export)`, [pf!.fileId]);
  const ctlDoc = cf ? (parseJson(cf) as RmControlJson[] | { controlLogEntries?: RmControlJson[] }) : null;
  const ctlRows: RmControlJson[] = !ctlDoc ? [] : Array.isArray(ctlDoc) ? ctlDoc : Array.isArray(ctlDoc.controlLogEntries) ? ctlDoc.controlLogEntries : [];

  // D-DATE: the first green flag's local date, else the control log, else a pit report clock.
  const firstGreen = (flagsDoc ?? []).filter((x) => x.f === 1).map((x) => parseNaiveLocal(x.s)).filter((x): x is { date: string; sec: number } => !!x && plausibleYear(x.date)).sort((a, b) => a.date.localeCompare(b.date) || a.sec - b.sec)[0];
  if (firstGreen) race.session.dateCandidates.push({ date: firstGreen.date, source: `${ff!.fileId}:first green flag` });
  else {
    const c = ctlRows.map((x) => parseNaiveLocal(x.t)).filter((x): x is { date: string; sec: number } => !!x && plausibleYear(x.date)).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (c) race.session.dateCandidates.push({ date: c.date, source: `${cf!.fileId}:first control-log time` });
    else {
      const p = (pitsDoc?.pitStops ?? []).map((x) => str(x.pitEntryTime).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && plausibleYear(d)).sort()[0];
      if (p) race.session.dateCandidates.push({ date: p, source: `${pf!.fileId}:first pit entry time` });
    }
  }
  const baseDate: string | null = race.session.dateCandidates[0]?.date ?? null;

  /** Naive local 'YYYY-MM-DDTHH:MM:SS' → adapter clock seconds (since local midnight of baseDate). */
  const localClock = (s: string | null | undefined): number | null => {
    const x = parseNaiveLocal(s);
    if (!x) return null;
    return x.sec + (baseDate && plausibleYear(x.date) ? 86400 * daysBetween(baseDate, x.date) : 0);
  };
  /** ISO with offset (pit report) → adapter clock seconds, via the track offset. */
  const isoClock = (s: string | null | undefined): number | null => {
    const t = str(s);
    if (!t) return null;
    const ms = Date.parse(t);
    if (!Number.isFinite(ms) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) return localClock(t);
    if (!baseDate || offset === null) return parseClock(t.slice(11, 19)) ?? null;
    return (ms - Date.parse(`${baseDate}T00:00:00Z`)) / 1000 + offset * 60;
  };

  // Session (race clock) start, local clock seconds.
  let startS: number | null = null;
  let startSource = "";
  if (resDoc) {
    const sst = str(resDoc.sessionStartTime);
    const sstClock = /^\d{4}/.test(sst) && plausibleYear(sst.slice(0, 10)) ? (/[zZ]|[+-]\d{2}:?\d{2}$/.test(sst) ? isoClock(sst) : localClock(sst)) : null;
    if (sstClock !== null) {
      startS = sstClock;
      startSource = `${rf!.fileId}:sessionStartTime`;
    } else {
      const tod = parseClock(str(resDoc.localTimeOfDay));
      const run = parseDuration(str(resDoc.runningRaceTime));
      if (tod !== null && run !== null) {
        startS = (((tod - run) % 86400) + 86400) % 86400;
        startSource = `${rf!.fileId}:localTimeOfDay - runningRaceTime`;
      }
    }
  }
  const rawLaps = lapsDoc.laps;
  if (startS === null) {
    // Fallback: the first green flag less the earliest lap-1 start on the race clock (ttm - ltm).
    let minL1: number | null = null;
    for (const x of rawLaps) {
      if (x.llp !== 1) continue;
      const tt = parseDuration(str(x.ttm));
      const lt = parseDuration(str(x.ltm));
      if (tt !== null && lt !== null) minL1 = minL1 === null ? tt - lt : Math.min(minL1, tt - lt);
    }
    if (firstGreen && minL1 !== null) {
      startS = firstGreen.sec - minL1;
      startSource = "first green flag - earliest lap-1 start";
      issues.push({
        severity: "warning",
        code: "REDMIST-START-ESTIMATED",
        message: `No results file with the race clock: the session start is estimated as the first green flag less the earliest lap-1 start (${rd(minL1, 1)} s on the race clock); crossing times may be off by a few seconds.`,
        files: [ff!.fileId],
      });
    } else {
      race.timeBase = "elapsed";
      startS = 0;
      startSource = "none";
      issues.push({
        severity: "warning",
        code: "REDMIST-START-UNKNOWN",
        message: "Neither the results file nor a flags file gives the session start: crossings are on the race clock only (no time of day); flags and pit-report clocks cannot be placed.",
        files: [lf.fileId],
      });
    }
  }
  const clockOk = race.timeBase === "clock";
  if (clockOk) {
    const h = Math.floor(startS / 3600);
    const m = Math.floor((startS % 3600) / 60);
    const sec = rd(startS % 60, 3)!;
    issues.push({ severity: "note", code: "REDMIST-SESSION-START", message: `Crossing times are the session start (${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")} local, from ${startSource}) plus RedMist's total race time per lap.`, files: [lf.fileId] });
  }

  /* ------------------------------------------------------------ driver names */
  // A name with a driver source (ds, e.g. 'rfidHelmet') is the driver identified at the crossing. Without
  // a source the name's provenance is unknown; when such names turn up on several cars they are not used.
  const sourceless = new Map<string, Set<string>>();
  for (const x of lapsDoc.laps) {
    const nm = str(x.dn);
    if (!nm || str(x.ds)) continue;
    const c = carId(str(x.n));
    if (!sourceless.has(nm)) sourceless.set(nm, new Set());
    sourceless.get(nm)!.add(c);
  }
  const crossCar = [...sourceless.values()].filter((cs) => cs.size > 1).length;
  const dropSourceless = crossCar > 0;
  if (dropSourceless) {
    issues.push({
      severity: "warning",
      code: "REDMIST-DRIVER-NAMES-UNUSED",
      message: `${lf.name}: lap driver names carry no driver source and ${crossCar} of ${sourceless.size} names appear on more than one car; they are not used (no lap driver, no driver changes from laps; the entry lists no drivers).`,
      files: [lf.fileId],
    });
  }

  /* ------------------------------------------------------------ laps */
  const order: string[] = [];
  const lapClass: Record<string, string> = {};
  const driverMeta: Record<string, { drivers: Driver[]; byName: Map<string, number> }> = {};
  const dropped: string[] = [];
  const penaltyLaps: Record<string, number> = {};
  rawLaps.forEach((x, i) => {
    const row = i + 1;
    const car = carId(str(x.n));
    const lap = typeof x.llp === "number" && Number.isInteger(x.llp) ? x.llp : null;
    if (!car || lap === null) {
      dropped.push(`L${row}`);
      return;
    }
    if (!driverMeta[car]) {
      driverMeta[car] = { drivers: [], byName: new Map() };
      order.push(car);
      if (str(x.class)) lapClass[car] = str(x.class);
    }
    const tt = parseDuration(str(x.ttm));
    if (lap < 1 || tt === null) {
      issues.push({ severity: "note", code: "LAP-ZERO-DROPPED", message: `${lf.name} row ${row}: car '${car}' lap ${lap}${tt === null ? " (no total time)" : ""} dropped.`, files: [lf.fileId] });
      return;
    }
    const name = (dropSourceless && !str(x.ds) ? "" : str(x.dn)) || null;
    let dnum: number | null = null;
    if (name) {
      const m = driverMeta[car];
      if (!m.byName.has(name)) {
        m.byName.set(name, m.drivers.length + 1);
        m.drivers.push({ number: m.drivers.length + 1, name });
      }
      dnum = m.byName.get(name)!;
    }
    if ((x.pl ?? 0) > (penaltyLaps[car] ?? 0)) penaltyLaps[car] = x.pl ?? 0;
    const l: CanonLap = {
      lap,
      row,
      fileId: lf.fileId,
      lapTimeS: parseDuration(str(x.ltm)),
      tS: startS! + tt,
      elapsedS: tt,
      span: 1,
      flag: rmLineFlag(x.flg),
      inPit: x.lip === true,
      crossedInPit: x.ip === true,
      driverNumber: dnum,
      driverName: name,
      speedKph: null,
      topSpeedKph: null,
    };
    (race.laps[car] ??= []).push(l);
  });
  if (dropped.length) issues.push({ severity: "warning", code: "REDMIST-ROW-UNREADABLE", message: `${lf.name}: ${dropped.length} lap object(s) without a car number or lap number dropped (${dropped.slice(0, 5).join(", ")}${dropped.length > 5 ? ", …" : ""}).`, files: [lf.fileId] });
  if (!Object.keys(race.laps).length) throw new AdapterBlocker("ADAPTER-REQUIRED-FILE-MISSING", `${lf.name}: no lap rows`, [lf.fileId]);
  checkLapOrder(race.laps, lf);
  setSpans(race.laps);

  // Crossings missing from the numbering (penalty laps deducted, or rows lost): elapsed between two
  // crossings exceeds the lap time.
  const gapCars: string[] = [];
  for (const [car, ls] of Object.entries(race.laps)) {
    let n = 0;
    for (let i = 1; i < ls.length; i++) {
      const lt = ls[i].lapTimeS;
      if (lt !== null && ls[i].tS - ls[i - 1].tS - lt > 1.0) n++;
    }
    if (n) gapCars.push(`${car} (${n})`);
  }
  if (gapCars.length) {
    issues.push({
      severity: "warning",
      code: "TIME-ELAPSED-MISMATCH",
      message: `RedMist laps whose elapsed time since the previous crossing exceeds the lap time by more than 1 s (a crossing is missing from the numbering, e.g. when penalty laps are deducted): car ${gapCars.join(", ")}. Such laps are not used as clean laps.`,
      files: [lf.fileId],
    });
  }
  const pen = Object.entries(penaltyLaps).filter(([, v]) => v > 0).sort((a, b) => carOrder(a[0], b[0]));
  if (pen.length) {
    issues.push({
      severity: "note",
      code: "REDMIST-PENALTY-LAPS",
      message: `RedMist lap numbers are credited laps: penalty laps are deducted when applied (${pen.map(([c, v]) => `car ${c}: ${v}`).join(", ")}), so lap numbers after the deduction are lower than laps driven (Speedhive counts laps driven).`,
      files: [lf.fileId],
    });
  }

  /* ------------------------------------------------------------ results */
  const results: CanonResultRow[] = [];
  const entryMeta = new Map<string, { team: string; cls: string }>();
  if (resDoc) {
    const ee = Array.isArray(resDoc.eventEntries) ? (resDoc.eventEntries as { no?: unknown; nm?: unknown; t?: unknown; c?: unknown }[]) : [];
    for (const e of ee) {
      const car = carId(str(e.no));
      if (car) entryMeta.set(car, { team: str(e.nm) || str(e.t), cls: str(e.c) });
    }
    const cps = Array.isArray(resDoc.carPositions) ? (resDoc.carPositions as Record<string, unknown>[]) : [];
    cps.forEach((cp, i) => {
      const car = carId(str(cp.n));
      if (!car) return;
      const ovp = typeof cp.ovp === "number" && cp.ovp >= 1 ? cp.ovp : null;
      const clp = typeof cp.clp === "number" && cp.clp >= 1 ? cp.clp : null;
      const laps = typeof cp.llp === "number" ? cp.llp : null;
      const hasLaps = (race.laps[car]?.length ?? 0) > 0;
      results.push({
        car,
        position: ovp,
        positionClass: clp,
        positionClassSource: "class_column",
        rawStatus: !hasLaps && (laps ?? 0) === 0 ? "Not Started" : "",
        laps,
        totalTimeS: null,
        gapFirst: null,
        bestLapS: parseDuration(str(cp.bt)),
        bestLapNumber: typeof cp.bl === "number" && cp.bl >= 1 ? cp.bl : null,
        className: str(cp.class) || entryMeta.get(car)?.cls || null,
        team: entryMeta.get(car)?.team || null,
        vehicle: null,
        makeRaw: null,
        drivers: [],
        fileId: rf!.fileId,
        row: i + 1,
        refs: [`${rf!.fileId}:carPositions:${i + 1}`],
      });
    });
    race.results = { mark: "unofficial", fileIds: [rf!.fileId], rows: results, postRaceLines: [] };
    issues.push({ severity: "note", code: "REDMIST-RESULTS-UNOFFICIAL", message: "Finishing positions are RedMist's final live-timing state, not the series' official results.", files: [rf!.fileId] });
  }

  /* ------------------------------------------------------------ pit report */
  if (pitsDoc) {
    if (pitsDoc.truncated) issues.push({ severity: "warning", code: "REDMIST-EXPORT-TRUNCATED", message: `${pf!.name}: RedMist marked the pit report truncated; later stops are missing.`, files: [pf!.fileId] });
    if ((pitsDoc.skippedLapRows ?? 0) > 0) issues.push({ severity: "warning", code: "REDMIST-ROWS-SKIPPED", message: `${pf!.name}: ${pitsDoc.skippedLapRows} lap row(s) could not be read when the pit report was derived; a stop may be missing.`, files: [pf!.fileId] });
    const po = parseUtcLabel(pitsDoc.trackTimeZone);
    if (po !== null && offset !== null && po !== offset) issues.push({ severity: "warning", code: "TIMEZONE-DISAGREE", message: `${pf!.name} trackTimeZone ${pitsDoc.trackTimeZone} differs from the laps file (${lapsDoc.trackTimeZone}).`, files: [pf!.fileId] });
    pitsDoc.pitStops!.forEach((s, i) => {
      const car = carId(str(s.carNumber));
      if (!car) return;
      const durMs = typeof s.pitDurationMs === "number" && s.pitDurationMs > 0 ? s.pitDurationMs : null;
      const inC = clockOk ? isoClock(s.pitEntryTime) : null;
      let outC = clockOk ? isoClock(s.pitExitTime) : null;
      if (outC === null && inC !== null && durMs !== null) outC = inC + durMs / 1000;
      const rec: CanonPitRecord = {
        car,
        source: "pit_json",
        fileId: pf!.fileId,
        ref: `${pf!.fileId}:stop:${car}:${s.stopNumber ?? i + 1}`,
        nr: typeof s.stopNumber === "number" ? s.stopNumber : null,
        inClockS: inC,
        outClockS: inC !== null ? outC : null,
        pitTimeS: durMs !== null ? durMs / 1000 : null,
        inDriver: str(s.driverBefore) || null,
        outDriver: str(s.driverAfter) || null,
        pitType: null,
        inLap: typeof s.startLap === "number" ? s.startLap : null,
        outLap: typeof s.endLap === "number" ? s.endLap : null,
        timePrecision: inC !== null ? "ms" : durMs !== null && durMs % 1000 === 0 ? "s" : "ms",
        entryUnavailable: s.pitEntryTimeUnavailable === true,
        entryRenumbered: s.pitEntryTimeRenumbered === true,
      };
      if (rec.entryRenumbered && rec.inLap !== null && rec.outLap !== null) {
        const est = renumberedVisitS(rawLaps.filter((x) => carId(str(x.n)) === car && typeof x.llp === "number" && x.llp >= rec.inLap! && x.llp <= rec.outLap!));
        if (est !== null) rec.estimatedVisitS = est;
      }
      race.pitRecords.push(rec);
    });
  }

  /* ------------------------------------------------------------ flags (rank 1 FCY) */
  if (flagsDoc && clockOk) {
    const recs = flagsDoc
      .map((x, i) => ({ x, row: i + 1, t: localClock(x.s) }))
      .filter((r): r is { x: (typeof flagsDoc)[number]; row: number; t: number } => r.t !== null && typeof r.x.f === "number")
      .sort((a, b) => a.t - b.t || a.row - b.row);
    const g = recs.find((r) => r.x.f === 1);
    let preRace = 0;
    const blips: string[] = [];
    recs.forEach((r, k) => {
      if (r.x.f !== 1) return;
      const end = localClock(r.x.e);
      const nxt = recs.slice(k + 1).find((q) => rmRecType(q.x.f!) !== null);
      if (end !== null && end - r.t < 10 && nxt && rmRecType(nxt.x.f!) === "FCY" && r !== g) blips.push(`${str(r.x.s).slice(11)}-${str(r.x.e).slice(11)}`);
    });
    for (const r of recs) {
      const typ = rmRecType(r.x.f!);
      if (!typ) continue;
      if (typ === "GF" && blips.includes(`${str(r.x.s).slice(11)}-${str(r.x.e).slice(11)}`)) continue;
      if (!g || r.t < g.t) {
        preRace++;
        continue;
      }
      const name = RM_FLAGS[r.x.f!] ?? `flag ${r.x.f}`;
      race.flagRecords.push({
        tS: r.t,
        recType: typ,
        flag: name,
        message: `${name}${r.x.e ? ` until ${str(r.x.e).slice(11)}` : ""}`,
        lap: null,
        fileId: ff!.fileId,
        row: r.row,
      } satisfies CanonFlagRecord);
    }
    if (blips.length) issues.push({ severity: "note", code: "REDMIST-FLAG-BLIP", message: `Green flag(s) shorter than 10 s between two cautions ignored (${blips.join(", ")}): the caution is treated as one period.`, files: [ff!.fileId] });
    if (preRace) issues.push({ severity: "note", code: "REDMIST-PRE-RACE-FLAGS", message: `${preRace} flag record(s) before the first green flag (formation) are not race flags and are ignored.`, files: [ff!.fileId] });
  }

  /* ------------------------------------------------------------ control log (race control, penalties) */
  if (cf) {
    const seen = new Set<string>();
    const rows = ctlRows.map((x, i) => ({ x, row: i + 1 })).sort((a, b) => (a.x.o ?? 0) - (b.x.o ?? 0) || a.row - b.row);
    const lapEnds = Object.values(race.laps).flatMap((ls) => ls.map((l) => l.tS));
    const lo = Math.min(...lapEnds) - 3 * 3600;
    const hi = Math.max(...lapEnds) + 3 * 3600;
    let outOfSession = 0;
    let dup = 0;
    for (const { x, row } of rows) {
      const key = JSON.stringify([x.o, x.t, x.c1, x.c1h, x.c2, x.c2h, x.n, x.s, x.a, x.cor]);
      if (seen.has(key)) {
        dup++;
        continue;
      }
      seen.add(key);
      let tS = clockOk ? localClock(x.t) : null;
      if (tS !== null && (tS < lo || tS > hi)) {
        outOfSession++;
        tS = null;
      }
      const note = str(x.n);
      const action = str(x.a);
      const status = str(x.s);
      const c1 = carId(str(x.c1));
      const c2 = carId(str(x.c2));
      const msg = (text: string) => race.raceControl.push({ tS, text, fileId: cf.fileId, row } satisfies CanonMessage);
      if (!c1 && !c2) {
        // Session messages: GREEN FLAG, FULL COURSE CAUTION, Code 35, CHECKERED FLAG …
        if (note || action) msg([note, action].filter(Boolean).join(" - "));
        continue;
      }
      const penal = !!action && !NON_PENALTY_ACTION.test(action) && !NOT_FINAL_STATUS.test(status);
      const targets = [c1 && x.c1h ? c1 : "", c2 && x.c2h ? c2 : ""].filter(Boolean);
      if (penal && !targets.length && c1 && !c2) targets.push(c1);
      const where = str(x.cor) ? ` (${/^\d+$/.test(str(x.cor)) ? "turn " : ""}${str(x.cor)})` : "";
      if (penal && targets.length) {
        for (const car of targets) msg(`Car ${car}: Penalty - ${note || "Infraction"}${where} - ${action}`);
        continue;
      }
      const cars = [c1, c2].filter(Boolean).map((c) => `#${c}`).join(" / ");
      const tail = [action, status].filter(Boolean).join(", ");
      msg(`${cars}: ${note || "Incident"}${where}${tail ? ` - ${tail}` : ""}`);
      if (penal && !targets.length) {
        issues.push({ severity: "warning", code: "RC-CAR-AMBIGUOUS", message: `${cf.name} entry ${x.o ?? row}: '${action}' names cars ${cars} but marks none as responsible; no penalty is attached.`, files: [cf.fileId] });
      }
    }
    if (dup) issues.push({ severity: "note", code: "REDMIST-CONTROL-DUPLICATES", message: `${cf.name}: ${dup} duplicate control-log row(s) ignored.`, files: [cf.fileId] });
    if (outOfSession) issues.push({ severity: "warning", code: "REDMIST-CONTROL-TIME", message: `${cf.name}: ${outOfSession} control-log time(s) fall outside the session (typing error?); kept without a time.`, files: [cf.fileId] });
    issues.push({ severity: "note", code: "REDMIST-CONTROL-MINUTES", message: `${cf.name}: control-log times are whole minutes; penalty issue times are accurate to one minute.`, files: [cf.fileId] });
  }

  /* ------------------------------------------------------------ entries */
  const seen = new Set<string>();
  const add = (car: string) => {
    if (seen.has(car)) return;
    seen.add(car);
    const m = entryMeta.get(car);
    const r = results.find((x) => x.car === car);
    const drivers = [...(driverMeta[car]?.drivers ?? [])];
    // Drivers named only in the pit report (driver before/after).
    for (const p of race.pitRecords) {
      if (p.car !== car) continue;
      for (const n of [p.inDriver, p.outDriver]) {
        if (n && !drivers.some((d) => d.name.toLowerCase() === n.toLowerCase())) drivers.push({ number: drivers.length + 1, name: n });
      }
    }
    const e: CanonEntry = {
      car,
      className: r?.className || m?.cls || lapClass[car] || "Unclassified",
      team: m?.team || "",
      makeRaw: null,
      makeBasis: null,
      vehicle: null,
      drivers,
    };
    race.entries.push(e);
  };
  for (const r of results) add(r.car);
  for (const car of [...entryMeta.keys()]) add(car);
  for (const car of order) add(car);
  for (const p of race.pitRecords) {
    if (!seen.has(p.car)) issues.push({ severity: "blocker", code: "CARD-UNMATCHED", message: `Pit report stop ${p.ref} names car '${p.car}', which has no laps and no entry.`, files: [p.fileId] });
  }
  return { race, issues };
}
