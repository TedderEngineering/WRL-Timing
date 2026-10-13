/**
 * WRL adapters: Speedhive export ('speedhive', SH) and WRL website export ('wrl-website', WW).
 * FACT_ENGINE_SPEC.md §4.2. Neither requires a flags file or a control log (D-FCY-SOURCE rank 3).
 */
import type { Driver } from "../schema/package-types.js";
import type { AdapterResult, CanonEntry, CanonLap, CanonResultRow, CanonicalRace, Issue, LineFlag, SourceFileInfo } from "../types.js";
import { carId, parseDuration } from "../util.js";
import { readTable, type Table } from "./table.js";
import { AdapterBlocker, checkLapOrder } from "./errors.js";

export const WRL_ADAPTER_VERSION = "1.0.0";

function intOrNull(s: string): number | null {
  const t = s.trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

function requireHeaders(t: Table, f: SourceFileInfo, names: string[]): void {
  for (const h of names) {
    if (!t.hasColumn(h)) throw new AdapterBlocker("ADAPTER-HEADER-MISSING", `${f.name}: column '${h}' missing`, [f.fileId]);
  }
}

function one(files: SourceFileInfo[], role: string, format: string, required: boolean): SourceFileInfo | null {
  const xs = files.filter((f) => f.role === role);
  if (xs.length === 0 && required) throw new AdapterBlocker("ADAPTER-REQUIRED-FILE-MISSING", `${format}: the ${role} file is required`);
  return xs[0] ?? null;
}

function shFlag(s: string): LineFlag {
  const t = s.trim().toUpperCase();
  if (t.startsWith("G")) return "G";
  if (t.startsWith("Y") || t === "FCY" || t === "CAUTION") return "Y";
  if (t.startsWith("R")) return "R";
  if (t.startsWith("C") || t.startsWith("F")) return "C";
  return null;
}

/** '2026-02-28T09:01:53.42' (naive local) → { date, secondsSinceMidnight }. */
function parseNaive(s: string): { date: string; sec: number } | null {
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  return { date: m[1], sec: Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function setSpans(laps: Record<string, CanonLap[]>): void {
  for (const ls of Object.values(laps)) {
    for (let i = 0; i < ls.length; i++) ls[i].span = i === 0 ? 1 : Math.max(1, ls[i].lap - ls[i - 1].lap);
  }
}

function statusRow(raw: string): string {
  return raw.trim();
}

function baseRace(format: "speedhive" | "wrl-website", files: SourceFileInfo[]): CanonicalRace {
  return {
    format,
    adapterVersion: WRL_ADAPTER_VERSION,
    files,
    timeBase: format === "speedhive" ? "clock" : "elapsed",
    session: { dateCandidates: [], utcOffsetCandidates: [] },
    entries: [],
    laps: {},
    pitRecords: [],
    driveStints: [],
    flagRecords: [],
    raceControl: [],
    results: null,
  };
}

function buildEntries(
  order: string[],
  meta: Record<string, { cls: string; team: string; drivers: Driver[] }>,
  results: CanonResultRow[],
): CanonEntry[] {
  const seen = new Set<string>();
  const out: CanonEntry[] = [];
  const add = (car: string, r?: CanonResultRow) => {
    if (seen.has(car)) return;
    seen.add(car);
    const m = meta[car];
    out.push({
      car,
      className: r?.className || m?.cls || "Unclassified",
      team: r?.team || m?.team || "",
      makeRaw: null,
      makeBasis: null,
      vehicle: null,
      drivers: m?.drivers ?? [],
    });
  };
  for (const r of results) add(r.car, r);
  for (const c of order) add(c);
  return out;
}

/* ------------------------------------------------------------------ Speedhive */

export function adaptSpeedhive(files: SourceFileInfo[]): AdapterResult {
  const issues: Issue[] = [];
  const lf = one(files, "laps", "speedhive", true)!;
  const sf = one(files, "summary", "speedhive", false);
  const race = baseRace("speedhive", files);
  const t = readTable(lf.text ?? "", ",");
  requireHeaders(t, lf, ["Start Number", "Class", "Team/Name", "Lap Number", "Lap Time", "Time of Day", "In Pit", "Status"]);
  const raw: { car: string; lap: number; tod: { date: string; sec: number }; r: (typeof t.rows)[number] }[] = [];
  const meta: Record<string, { cls: string; team: string; drivers: Driver[] }> = {};
  const order: string[] = [];
  for (const r of t.rows) {
    const car = carId(r.get("Start Number"));
    const lap = intOrNull(r.get("Lap Number"));
    const tod = parseNaive(r.get("Time of Day"));
    if (!car || lap === null || !tod) continue;
    if (lap < 1) {
      issues.push({ severity: "note", code: "LAP-ZERO-DROPPED", message: `${lf.name} line ${r.line}: car '${car}' lap ${lap} row dropped.`, files: [lf.fileId] });
      continue;
    }
    raw.push({ car, lap, tod, r });
    if (!meta[car]) {
      meta[car] = { cls: r.get("Class"), team: r.get("Team/Name"), drivers: [] };
      order.push(car);
    }
  }
  // D-DATE: the date part of the first lap-1 row's Time of Day.
  const lap1 = raw.filter((x) => x.lap === 1).sort((a, b) => a.tod.date.localeCompare(b.tod.date) || a.tod.sec - b.tod.sec);
  const date = (lap1[0] ?? raw[0])?.tod.date;
  if (!date) throw new AdapterBlocker("ADAPTER-REQUIRED-FILE-MISSING", `${lf.name}: no lap rows`, [lf.fileId]);
  race.session.dateCandidates.push({ date, source: `${lf.fileId}:Time of Day (first lap-1 row)` });
  for (const x of raw) {
    const r = x.r;
    const lap: CanonLap = {
      lap: x.lap,
      row: r.line,
      fileId: lf.fileId,
      lapTimeS: parseDuration(r.get("Lap Time")),
      tS: x.tod.sec + 86400 * daysBetween(date, x.tod.date),
      elapsedS: null,
      span: 1,
      flag: shFlag(r.get("Status")),
      inPit: r.get("In Pit").toLowerCase() === "true",
      driverNumber: null,
      driverName: null,
    };
    (race.laps[x.car] ??= []).push(lap);
  }
  checkLapOrder(race.laps, lf);
  setSpans(race.laps);

  const results: CanonResultRow[] = [];
  if (sf) {
    const st = readTable(sf.text ?? "", ",");
    requireHeaders(st, sf, ["Position", "Start Number", "Class", "Position In Class", "Status"]);
    for (const r of st.rows) {
      const car = carId(r.get("Start Number"));
      if (!car) continue;
      results.push({
        car,
        position: intOrNull(r.get("Position")),
        positionClass: intOrNull(r.get("Position In Class")),
        positionClassSource: "class_column",
        rawStatus: statusRow(r.get("Status")),
        laps: null,
        totalTimeS: null,
        gapFirst: null,
        bestLapS: null,
        bestLapNumber: null,
        className: r.get("Class") || null,
        team: r.get("Name") || null,
        vehicle: null,
        makeRaw: null,
        drivers: [],
        fileId: sf.fileId,
        row: r.line,
        refs: [`${sf.fileId}:L${r.line}`],
      });
    }
    race.results = { mark: "unknown", fileIds: [sf.fileId], rows: results, postRaceLines: [] };
  }
  race.entries = buildEntries(order, meta, results);
  return { race, issues };
}

/* ------------------------------------------------------------------ WRL website */

export function adaptWrlWebsite(files: SourceFileInfo[]): AdapterResult {
  const issues: Issue[] = [];
  const lf = one(files, "laps", "wrl-website", true)!;
  const sf = one(files, "summary", "wrl-website", false);
  const race = baseRace("wrl-website", files);
  const t = readTable(lf.text ?? "", ",");
  requireHeaders(t, lf, ["Car_Number", "Lap_Number", "Total_Race_Time", "In_Pit", "Last_In_Pit", "Flag_Status", "Class", "Team_Name", "Lap_Time"]);
  const meta: Record<string, { cls: string; team: string; drivers: Driver[]; byName: Map<string, number> }> = {};
  const order: string[] = [];
  for (const r of t.rows) {
    const car = carId(r.get("Car_Number"));
    const lap = intOrNull(r.get("Lap_Number"));
    if (!car || lap === null) continue;
    if (!meta[car]) {
      meta[car] = { cls: r.get("Class"), team: r.get("Team_Name"), drivers: [], byName: new Map() };
      order.push(car);
    }
    const trt = parseDuration(r.get("Total_Race_Time"));
    if (lap < 1 || trt === null) {
      issues.push({
        severity: "note",
        code: "LAP-ZERO-DROPPED",
        message: `${lf.name} line ${r.line}: car '${car}' lap ${lap}${trt === null ? " (no Total_Race_Time)" : ""} dropped (WN4).`,
        factIds: [],
        files: [lf.fileId],
      });
      continue;
    }
    const name = r.get("Driver_Name") || null;
    let dn: number | null = null;
    if (name) {
      const m = meta[car];
      if (!m.byName.has(name)) {
        m.byName.set(name, m.drivers.length + 1);
        m.drivers.push({ number: m.drivers.length + 1, name });
      }
      dn = m.byName.get(name)!;
    }
    const fs = r.get("Flag_Status").toLowerCase();
    const flag: LineFlag = fs.startsWith("green") ? "G" : fs.startsWith("yellow") ? "Y" : fs.startsWith("red") ? "R" : fs.startsWith("checkered") || fs.startsWith("chequered") ? "C" : null;
    (race.laps[car] ??= []).push({
      lap,
      row: r.line,
      fileId: lf.fileId,
      lapTimeS: parseDuration(r.get("Lap_Time")),
      tS: trt,
      elapsedS: trt,
      span: 1,
      flag,
      inPit: r.get("In_Pit").toLowerCase() === "yes",
      lastInPit: r.get("Last_In_Pit").toLowerCase() === "yes",
      driverNumber: dn,
      driverName: name,
    });
  }
  checkLapOrder(race.laps, lf);
  setSpans(race.laps);

  const results: CanonResultRow[] = [];
  if (sf) {
    const st = readTable(sf.text ?? "", ",");
    requireHeaders(st, sf, ["Overall_Position", "Class_Position", "Car_Number", "Laps_Completed"]);
    for (const r of st.rows) {
      const car = carId(r.get("Car_Number"));
      if (!car) continue;
      results.push({
        car,
        position: intOrNull(r.get("Overall_Position")),
        positionClass: intOrNull(r.get("Class_Position")),
        positionClassSource: "class_column",
        rawStatus: "",
        laps: intOrNull(r.get("Laps_Completed")),
        totalTimeS: null,
        gapFirst: r.get("Overall_Gap") || null,
        bestLapS: parseDuration(r.get("Best_Lap_Time")),
        bestLapNumber: intOrNull(r.get("Best_Lap_Number")),
        className: r.get("Class") || null,
        team: r.get("Team_Name") || null,
        vehicle: null,
        makeRaw: null,
        drivers: [],
        fileId: sf.fileId,
        row: r.line,
        refs: [`${sf.fileId}:L${r.line}`],
      });
    }
    race.results = { mark: "unknown", fileIds: [sf.fileId], rows: results, postRaceLines: [] };
  }
  race.entries = buildEntries(order, meta, results);
  return { race, issues };
}
