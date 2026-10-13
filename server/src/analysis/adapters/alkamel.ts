/**
 * Alkamel adapters: SRO / GT4 America ('alkamel-sro'), Toyota GR Cup ('alkamel-grcup') and IMSA
 * ('alkamel-imsa'). FACT_ENGINE_SPEC.md §4. Adapters normalise spelling and units only; they never
 * compute positions, FCY, pit kinds or time lost.
 */
import type { Driver, SourceFormat } from "../schema/package-types.js";
import type {
  AdapterResult,
  CanonDriveStint,
  CanonEntry,
  CanonFlagRecord,
  CanonLap,
  CanonMessage,
  CanonPitRecord,
  CanonResultRow,
  CanonResults,
  CanonicalRace,
  Issue,
  LineFlag,
  SourceFileInfo,
} from "../types.js";
import { carId, parseClock, parseDuration } from "../util.js";
import { readTable } from "./table.js";
import { parsePitCardsPdf } from "./pit-cards-pdf.js";
import { AdapterBlocker, checkLapOrder } from "./errors.js";

export const ALKAMEL_ADAPTER_VERSION = "1.0.0";

const FLAG_MAP: Record<string, LineFlag> = {
  GF: "G",
  GREEN: "G",
  FCY: "Y",
  YF: "Y",
  SC: "S",
  RF: "R",
  RED: "R",
  FF: "C",
  CHEQUERED: "C",
};

function mapFlag(raw: string): LineFlag {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  return FLAG_MAP[s] ?? null;
}

function intOrNull(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function byRole(files: SourceFileInfo[], role: string): SourceFileInfo[] {
  return files.filter((f) => f.role === role);
}

function isJson(f: SourceFileInfo): boolean {
  return /\.json$/i.test(f.name) || (f.text ?? "").trimStart().startsWith("{");
}

function reportMarkFromName(name: string): CanonResults["mark"] {
  if (/official/i.test(name)) return "official";
  if (/provisional/i.test(name)) return "provisional";
  if (/unofficial/i.test(name)) return "unofficial";
  return "unknown";
}

function markFromText(s: string | undefined | null): CanonResults["mark"] | null {
  const t = (s ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("official")) return "official";
  if (t.startsWith("provisional")) return "provisional";
  if (t.startsWith("unofficial")) return "unofficial";
  return null;
}

/* ------------------------------------------------------------------ laps */

interface LapsParse {
  laps: Record<string, CanonLap[]>;
  meta: Record<string, { className: string; team: string; make: string; driverNames: Record<number, string> }>;
}

function parseLaps(f: SourceFileInfo, issues: Issue[]): LapsParse {
  const t = readTable(f.text ?? "", ";");
  for (const h of ["NUMBER", "LAP_NUMBER", "LAP_TIME", "HOUR", "CROSSING_FINISH_LINE_IN_PIT", "FLAG_AT_FL", "CLASS"]) {
    if (!t.hasColumn(h)) {
      throw new AdapterBlocker("ADAPTER-HEADER-MISSING", `${f.name}: column ${h} missing`, [f.fileId]);
    }
  }
  const laps: Record<string, CanonLap[]> = {};
  const meta: LapsParse["meta"] = {};
  for (const r of t.rows) {
    const car = carId(r.get("NUMBER"));
    const L = intOrNull(r.get("LAP_NUMBER"));
    const clock = parseClock(r.get("HOUR"));
    if (!car || L === null || clock === null) continue;
    const dn = intOrNull(r.get("DRIVER_NUMBER"));
    const lap: CanonLap = {
      lap: L,
      row: r.line,
      fileId: f.fileId,
      lapTimeS: parseDuration(r.get("LAP_TIME")),
      tS: clock,
      elapsedS: parseDuration(r.get("ELAPSED")),
      span: 1,
      flag: mapFlag(r.get("FLAG_AT_FL")),
      crossedInPit: r.get("CROSSING_FINISH_LINE_IN_PIT") !== "",
      pitTimeS: parseDuration(r.get("PIT_TIME")),
      driverNumber: dn,
      driverName: r.get("DRIVER_NAME") || null,
      speedKph: numOrNull(r.get("KPH")),
      topSpeedKph: numOrNull(r.get("TOP_SPEED")),
    };
    (laps[car] ??= []).push(lap);
    const m = (meta[car] ??= { className: r.get("CLASS"), team: r.get("TEAM"), make: r.get("MANUFACTURER"), driverNames: {} });
    if (dn !== null && lap.driverName && !m.driverNames[dn]) m.driverNames[dn] = lap.driverName;
  }
  // Midnight rollover (D-TIME): a crossing more than 12 h before the race's first lap-1 clock is next day.
  const lap1 = Object.values(laps).flatMap((ls) => ls.filter((x) => x.lap === 1).map((x) => x.tS));
  const ref = lap1.length ? Math.min(...lap1) : Math.min(...Object.values(laps).flatMap((ls) => ls.map((x) => x.tS)));
  checkLapOrder(laps, f, ref);
  void issues;
  return { laps, meta };
}

/* ------------------------------------------------------------------ results */

function driversFromCsvRow(get: (k: string) => string): Driver[] {
  const out: Driver[] = [];
  for (let k = 1; k <= 8; k++) {
    const fn = get(`DRIVER${k}_FIRSTNAME`);
    const sn = get(`DRIVER${k}_SECONDNAME`);
    if (!fn && !sn) continue;
    const d: Driver = { number: k, name: `${fn} ${sn}`.trim() };
    const lic = get(`DRIVER${k}_LICENSE`);
    if (lic) d.license = lic;
    const c = get(`DRIVER${k}_COUNTRY`);
    if (c) d.country = c;
    const sh = get(`DRIVER${k}_SHORTNAME`);
    if (sh) d.shortName = sh;
    out.push(d);
  }
  if (out.length === 0) {
    // GR Cup results: single DRIVER_* columns.
    const fn = get("DRIVER_FIRSTNAME");
    const sn = get("DRIVER_SECONDNAME");
    if (fn || sn) {
      const d: Driver = { number: 1, name: `${fn} ${sn}`.trim() };
      const lic = get("DRIVER_LICENSE");
      if (lic) d.license = lic;
      const c = get("DRIVER_COUNTRY");
      if (c) d.country = c;
      out.push(d);
    }
  }
  return out;
}

function parseResultsCsv(f: SourceFileInfo): CanonResultRow[] {
  const t = readTable(f.text ?? "", ";");
  const rows: CanonResultRow[] = [];
  for (const r of t.rows) {
    const car = carId(r.get("NUMBER"));
    if (!car) continue;
    rows.push({
      car,
      position: intOrNull(r.get("POSITION")),
      positionClass: null,
      positionClassSource: null,
      rawStatus: r.get("STATUS"),
      laps: intOrNull(r.get("LAPS")),
      totalTimeS: parseDuration(r.get("TOTAL_TIME")),
      gapFirst: ["", "-"].includes(r.get("GAP_FIRST")) ? null : r.get("GAP_FIRST"),
      bestLapS: parseDuration(r.get("FL_TIME")),
      bestLapNumber: intOrNull(r.get("FL_LAPNUM")),
      className: r.get("CLASS") || null,
      team: r.get("TEAM") || null,
      vehicle: r.get("VEHICLE") || null,
      makeRaw: null,
      drivers: driversFromCsvRow((k) => r.get(k)),
      fileId: f.fileId,
      row: r.line,
      refs: [`${f.fileId}:L${r.line}`],
    });
  }
  return rows;
}

/** 05 Results by Class CSV: CLASS_TYPE;POS;PIC;NUMBER;... */
function parseByClassCsv(f: SourceFileInfo): Map<string, { pic: number | null; pos: number | null; cls: string; line: number; laps: number | null; elapsed: number | null; vehicle: string; team: string }> {
  const t = readTable(f.text ?? "", ";");
  const m = new Map();
  for (const r of t.rows) {
    const car = carId(r.get("NUMBER"));
    if (!car) continue;
    m.set(car, {
      pic: intOrNull(r.get("PIC")),
      pos: intOrNull(r.get("POS")),
      cls: r.get("CLASS_TYPE"),
      line: r.line,
      laps: intOrNull(r.get("LAPS")),
      elapsed: parseDuration(r.get("ELAPSED")),
      vehicle: r.get("VEHICLE"),
      team: r.get("TEAM"),
    });
  }
  return m;
}

function driversFromJson(ds: any[] | undefined): Driver[] {
  return (ds ?? [])
    .filter((d) => d && (d.firstname || d.surname))
    .map((d) => {
      const x: Driver = { number: Number(d.number), name: `${d.firstname ?? ""} ${d.surname ?? ""}`.trim() };
      if (d.license) x.license = String(d.license);
      if (d.country) x.country = String(d.country);
      if (d.short_name) x.shortName = String(d.short_name);
      return x;
    })
    .filter((d) => Number.isInteger(d.number) && d.number >= 1);
}

/* ------------------------------------------------------------------ date / offset */

function weatherCandidates(f: SourceFileInfo, startClock: number | null): { date: string; offsetMinutes: number } | null {
  const t = readTable(f.text ?? "", ";");
  const first = t.rows.find((r) => /^\d+$/.test(r.get("TIME_UTC_SECONDS")));
  if (!first || startClock === null) return null;
  const epoch = Number(first.get("TIME_UTC_SECONDS"));
  const utcSod = ((epoch % 86400) + 86400) % 86400;
  let diff = startClock - utcSod; // local - utc, seconds
  while (diff > 14 * 3600) diff -= 86400;
  while (diff < -12 * 3600) diff += 86400;
  const offsetMinutes = Math.round(diff / 900) * 15;
  const local = new Date((epoch + offsetMinutes * 60) * 1000);
  const date = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
  return { date, offsetMinutes };
}

/** 'DD-MM-YYYY HH:MM' or 'DD/MM/YYYY HH:MM' (Alkamel JSON session_date). */
function parseSessionDate(s: string | undefined): { date: string; ambiguous: boolean } | null {
  const m = (s ?? "").trim().match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  return { date: `${m[3]}-${m[2]}-${m[1]}`, ambiguous: dd <= 12 && mm <= 12 && dd !== mm };
}

/* ------------------------------------------------------------------ adapter */

export function adaptAlkamel(format: SourceFormat, files: SourceFileInfo[]): AdapterResult {
  const issues: Issue[] = [];
  const lapFiles = byRole(files, "laps").concat(byRole(files, "time_cards"));
  if (lapFiles.length !== 1) {
    throw new AdapterBlocker("ADAPTER-REQUIRED-FILE-MISSING", `${format}: exactly one laps CSV (23_AnalysisEnduranceWithSections / 23_Time Cards) is required; got ${lapFiles.length}`);
  }
  const lf = lapFiles[0];
  const { laps, meta } = parseLaps(lf, issues);

  const race: CanonicalRace = {
    format,
    adapterVersion: ALKAMEL_ADAPTER_VERSION,
    files,
    timeBase: "clock",
    session: { dateCandidates: [], utcOffsetCandidates: [] },
    entries: [],
    laps,
    pitRecords: [],
    driveStints: [],
    flagRecords: [],
    raceControl: [],
    results: null,
  };

  const lap1Clocks = Object.values(laps).flatMap((ls) => ls.filter((x) => x.lap === 1).map((x) => x.tS - (x.lapTimeS ?? 0)));
  const startClock = lap1Clocks.length ? Math.min(...lap1Clocks) : null;

  /* ---- results */
  const resultRows: CanonResultRow[] = [];
  let mark: CanonResults["mark"] = "unknown";
  const resultFileIds: string[] = [];
  const postRaceLines: { text: string; fileId: string }[] = [];
  const jsonMake = new Map<string, string>();
  for (const f of byRole(files, "results")) {
    resultFileIds.push(f.fileId);
    if (isJson(f)) {
      const d = JSON.parse((f.text ?? "").replace(/^\uFEFF/, ""));
      const s = d.session ?? {};
      mark = markFromText(s.report_mark) ?? reportMarkFromName(f.name);
      for (const line of String(s.report_message ?? "").split(/\r?\n/)) if (line.trim()) postRaceLines.push({ text: line.trim(), fileId: f.fileId });
      const sd = parseSessionDate(s.session_date);
      if (sd) race.session.dateCandidates.push({ date: sd.date, source: `${f.fileId}:session.session_date`, ambiguous: sd.ambiguous });
      const cd = parseSessionDate(s.creation_date);
      if (cd) race.session.dateCandidates.push({ date: cd.date, source: `${f.fileId}:session.creation_date(cross-check)`, ambiguous: true });
      race.session.series ??= s.championship_name;
      race.session.event ??= s.event_name;
      race.session.session ??= s.session_name;
      race.session.trackName ??= s.circuit?.name;
      if (typeof s.circuit?.length === "number") race.session.trackLengthM ??= s.circuit.length;
      if (s.finalize_type?.type === "By Time" && Number(s.finalize_type.time_in_seconds) > 0) {
        race.session.scheduledDurationS ??= Number(s.finalize_type.time_in_seconds);
      }
      (d.classification ?? []).forEach((c: any, i: number) => {
        const car = carId(String(c.number ?? ""));
        if (!car) return;
        if (c.manufacturer) jsonMake.set(car, String(c.manufacturer));
        resultRows.push({
          car,
          position: Number.isInteger(c.position) ? c.position : intOrNull(String(c.position ?? "")),
          positionClass: null,
          positionClassSource: null,
          rawStatus: String(c.status ?? ""),
          laps: intOrNull(String(c.laps ?? "")),
          totalTimeS: parseDuration(String(c.elapsed_time ?? "")),
          gapFirst: ["", "-"].includes(String(c.gap_first ?? "")) ? null : String(c.gap_first),
          bestLapS: parseDuration(String(c.fastest_lap_time ?? "")),
          bestLapNumber: intOrNull(String(c.fastest_lap_number ?? "")),
          className: c.class ? String(c.class) : null,
          team: c.team ? String(c.team) : null,
          vehicle: c.vehicle ? String(c.vehicle) : null,
          makeRaw: c.manufacturer ? String(c.manufacturer) : null,
          drivers: driversFromJson(c.drivers),
          fileId: f.fileId,
          row: i + 1,
          refs: [`${f.fileId}:classification[${i}]`],
        });
      });
    } else {
      mark = reportMarkFromName(f.name);
      resultRows.push(...parseResultsCsv(f));
    }
  }
  // IMSA: prefer the JSON when both JSON and CSV results were supplied.
  const jsonIds = new Set(byRole(files, "results").filter(isJson).map((f) => f.fileId));
  const resultsDedup = jsonIds.size ? resultRows.filter((r) => jsonIds.has(r.fileId)) : resultRows;

  for (const f of byRole(files, "results_by_class")) {
    resultFileIds.push(f.fileId);
    if (isJson(f)) {
      const d = JSON.parse((f.text ?? "").replace(/^\uFEFF/, ""));
      if (mark === "unknown") mark = markFromText(d.session?.report_mark) ?? reportMarkFromName(f.name);
      for (const cl of d.classifications ?? []) {
        (cl.classification ?? []).forEach((c: any, i: number) => {
          const car = carId(String(c.number ?? ""));
          const row = resultsDedup.find((x) => x.car === car);
          if (row && Number.isInteger(c.position)) {
            row.positionClass = c.position;
            row.positionClassSource = "by_class_file";
            row.refs.push(`${f.fileId}:classifications[${cl.name}][${i}]`);
          }
        });
      }
    } else {
      const bc = parseByClassCsv(f);
      if (mark === "unknown") mark = reportMarkFromName(f.name);
      if (resultsDedup.length === 0) {
        // SRO COTA had only the by-class file: it is the results file.
        for (const [car, x] of bc) {
          resultsDedup.push({
            car,
            position: x.pos,
            positionClass: x.pic,
            positionClassSource: "by_class_file",
            rawStatus: "",
            laps: x.laps,
            totalTimeS: x.elapsed,
            gapFirst: null,
            bestLapS: null,
            bestLapNumber: null,
            className: x.cls || null,
            team: x.team || null,
            vehicle: x.vehicle || null,
            makeRaw: null,
            drivers: [],
            fileId: f.fileId,
            row: x.line,
            refs: [`${f.fileId}:L${x.line}`],
          });
        }
      } else {
        for (const row of resultsDedup) {
          const x = bc.get(row.car);
          if (x && x.pic !== null) {
            row.positionClass = x.pic;
            row.positionClassSource = "by_class_file";
            row.refs.push(`${f.fileId}:L${x.line}`);
          }
        }
      }
    }
  }
  if (resultsDedup.length) {
    race.results = { mark, fileIds: resultFileIds, rows: resultsDedup, postRaceLines };
  }

  /* ---- entries: results first, then laps-only cars */
  const seen = new Set<string>();
  const entries: CanonEntry[] = [];
  for (const r of resultsDedup) {
    if (seen.has(r.car)) continue;
    seen.add(r.car);
    const m = meta[r.car];
    const lapMake = m?.make?.trim() || null;
    let makeRaw: string | null = lapMake;
    let makeBasis: CanonEntry["makeBasis"] = lapMake ? "make_column" : null;
    if (format === "alkamel-imsa" && jsonMake.get(r.car)) {
      makeRaw = jsonMake.get(r.car)!;
      makeBasis = "results_json";
    } else if (!makeRaw && jsonMake.get(r.car)) {
      makeRaw = jsonMake.get(r.car)!;
      makeBasis = "results_json";
    }
    const drivers = r.drivers.length ? r.drivers : driversFromLaps(m?.driverNames);
    entries.push({
      car: r.car,
      className: r.className || m?.className || "Unclassified",
      team: r.team || m?.team || "",
      makeRaw,
      makeBasis,
      vehicle: r.vehicle,
      drivers,
    });
  }
  for (const car of Object.keys(laps)) {
    if (seen.has(car)) continue;
    seen.add(car);
    const m = meta[car];
    entries.push({
      car,
      className: m.className || "Unclassified",
      team: m.team,
      makeRaw: m.make?.trim() || null,
      makeBasis: m.make?.trim() ? "make_column" : null,
      vehicle: null,
      drivers: driversFromLaps(m.driverNames),
    });
  }
  race.entries = entries;

  /* ---- pit records */
  const pitJson = byRole(files, "pit_cards_json");
  const pitPdf = byRole(files, "pit_cards_pdf");
  if (pitJson.length) {
    for (const f of pitJson) {
      const d = JSON.parse((f.text ?? "").replace(/^\uFEFF/, ""));
      const s = d.session ?? {};
      const sd = parseSessionDate(s.session_date);
      if (sd) race.session.dateCandidates.push({ date: sd.date, source: `${f.fileId}:session.session_date`, ambiguous: sd.ambiguous });
      if (s.finalize_type?.type === "By Time" && Number(s.finalize_type.time_in_seconds) > 0) race.session.scheduledDurationS ??= Number(s.finalize_type.time_in_seconds);
      race.session.trackName ??= s.circuit?.name;
      for (const e of d.pit_stop_analysis ?? []) {
        const car = String(e.number ?? "").trim();
        if (car !== String(e.number ?? "")) {
          issues.push({ severity: "warning", code: "CAR-ID-VARIANT", message: `Pit JSON car number '${e.number}' has surrounding whitespace; kept as '${car}'.`, files: [f.fileId] });
        }
        if (!jsonMake.get(car) && e.manufacturer) jsonMake.set(car, String(e.manufacturer));
        for (const p of e.pit_stops ?? []) {
          const inC = parseClock(p.in_time);
          if (inC === null) continue;
          race.pitRecords.push({
            car,
            source: "pit_json",
            fileId: f.fileId,
            ref: `${f.fileId}:car:${car}:${p.pit_number}`,
            nr: p.pit_number ?? null,
            inClockS: inC,
            outClockS: parseClock(p.out_time),
            pitTimeS: parseDuration(String(p.pit_time ?? "")),
            inDriver: p.in_driver_surname ?? null,
            outDriver: p.out_driver_surname ?? null,
            inDriverNumber: Number.isInteger(p.in_driver_number) ? p.in_driver_number : null,
            outDriverNumber: Number.isInteger(p.out_driver_number) ? p.out_driver_number : null,
            pitType: null,
          });
        }
      }
    }
    if (pitPdf.length) {
      issues.push({ severity: "note", code: "PIT-PDF-SUPERSEDED", message: "Pit-card PDF supplied alongside the pit JSON; the JSON is used (D-PIT-PASSAGE precedence).", files: pitPdf.map((f) => f.fileId) });
    }
  } else {
    for (const f of pitPdf) {
      const parsed = parsePitCardsPdf(f.pdf ?? []);
      if (parsed.orphans.length) {
        throw new AdapterBlocker("PDF-ORPHAN-ROWS", `${f.name}: ${parsed.orphans.length} card row(s) before any car header`, [f.fileId]);
      }
      for (const c of parsed.cards) {
        const inC = parseClock(c.inTime);
        if (inC === null) continue;
        race.pitRecords.push({
          car: c.car,
          source: "pdf_card",
          fileId: f.fileId,
          ref: `${f.fileId}:card:${c.car}:${c.nr}`,
          nr: c.nr,
          inClockS: inC,
          outClockS: parseClock(c.outTime),
          pitTimeS: parseDuration(c.pitTime),
          inDriver: c.inDriver || null,
          outDriver: c.outDriver || null,
          pitType: null,
        });
      }
    }
  }

  /* ---- drive time */
  for (const f of byRole(files, "drive_time")) {
    const t = readTable(f.text ?? "", ";");
    for (const r of t.rows) {
      const car = carId(r.get("NUMBER"));
      if (!car) continue;
      race.driveStints.push({
        car,
        fileId: f.fileId,
        row: r.line,
        stintNumber: intOrNull(r.get("CAR_STINT_NUMBER")),
        driver: r.get("DRIVER"),
        startClockS: parseClock(r.get("START")),
        endClockS: parseClock(r.get("END")),
        type: r.get("STINT_TYPE"),
        pitType: r.get("PIT_TYPE"),
        timeS: parseDuration(r.get("TIME")),
        totalTrackTimeS: parseDuration(r.get("TOTAL_TRACK_TIME")),
        totalDriverTimeS: parseDuration(r.get("TOTAL DRIVER TIME")),
      } satisfies CanonDriveStint);
    }
  }
  // Rollover for clocks of pit records / drive time / flags relative to the race start.
  const roll = (c: number | null): number | null => (c === null || startClock === null ? c : c < startClock - 43200 ? c + 86400 : c);
  for (const p of race.pitRecords) {
    p.inClockS = roll(p.inClockS)!;
    p.outClockS = roll(p.outClockS);
    if (p.outClockS !== null && p.outClockS < p.inClockS) p.outClockS += 86400;
  }
  for (const d of race.driveStints) {
    d.startClockS = roll(d.startClockS);
    d.endClockS = roll(d.endClockS);
  }

  /* ---- flags + race control */
  for (const f of byRole(files, "flags")) {
    const recs: { time: string; rec: string; flag: string; msg: string; lap: string; row: number }[] = [];
    if (isJson(f)) {
      const d = JSON.parse((f.text ?? "").replace(/^\uFEFF/, ""));
      const sd = parseSessionDate(d.session?.session_date);
      if (sd) race.session.dateCandidates.push({ date: sd.date, source: `${f.fileId}:session.session_date`, ambiguous: sd.ambiguous });
      (d.flags ?? []).forEach((x: any, i: number) =>
        recs.push({ time: String(x.time ?? ""), rec: String(x.rec_type ?? ""), flag: String(x.flag ?? ""), msg: String(x.message ?? ""), lap: String(x.lap ?? ""), row: i + 1 }),
      );
    } else {
      const t = readTable(f.text ?? "", ";");
      for (const r of t.rows) recs.push({ time: r.get("TIME"), rec: r.get("REC_TYPE"), flag: r.get("FLAG"), msg: r.get("MESSAGE"), lap: r.get("LAP"), row: r.line });
    }
    for (const x of recs) {
      const c = roll(parseClock(x.time));
      if (c === null) continue;
      if (x.rec === "RCMessage") {
        race.raceControl.push({ tS: c, text: x.msg, fileId: f.fileId, row: x.row } satisfies CanonMessage);
      } else if (x.rec) {
        race.flagRecords.push({ tS: c, recType: x.rec, flag: x.flag, message: x.msg, lap: intOrNull(x.lap), fileId: f.fileId, row: x.row } satisfies CanonFlagRecord);
      }
    }
  }
  // When both a flags JSON and CSV are given they carry the same records: keep one file's records.
  const flagFileIds = [...new Set(race.flagRecords.map((r) => r.fileId))];
  if (flagFileIds.length > 1) {
    const keep = flagFileIds[0];
    race.flagRecords = race.flagRecords.filter((r) => r.fileId === keep);
    race.raceControl = race.raceControl.filter((r) => r.fileId === keep);
  }

  /* ---- date and offset (D-DATE) */
  for (const f of byRole(files, "weather")) {
    const w = weatherCandidates(f, startClock);
    if (w) {
      race.session.dateCandidates.push({ date: w.date, source: `${f.fileId}:TIME_UTC_SECONDS`, ambiguous: false });
      race.session.utcOffsetCandidates.push({ offsetMinutes: w.offsetMinutes, source: `${f.fileId}:TIME_UTC_SECONDS vs HOUR` });
    }
  }

  // Leading-zero car ids: note (D-CAR).
  const cars = entries.map((e) => e.car);
  const groups = new Map<string, string[]>();
  for (const c of cars) {
    const k = c.replace(/^0+(?=.)/, "");
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const [, g] of groups) {
    if (g.length > 1) {
      issues.push({ severity: "note", code: "CAR-ID-LEADING-ZERO", message: `Cars ${g.map((x) => `'${x}'`).join(", ")} are separate entries. Identity is the exported string.`, factIds: g.map((c) => `car:${c}`) });
    }
  }
  return { race, issues };
}

function driversFromLaps(names: Record<number, string> | undefined): Driver[] {
  return Object.entries(names ?? {})
    .map(([n, name]) => ({ number: Number(n), name }))
    .filter((d) => d.number >= 1)
    .sort((a, b) => a.number - b.number);
}
