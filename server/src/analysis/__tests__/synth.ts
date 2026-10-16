/**
 * Synthetic race files for unit tests (no third-party data). Builds Alkamel-IMSA-shaped inputs (laps
 * CSV, pit JSON, flags CSV, results JSON, optional Drive Time CSV) and WRL-website / Speedhive CSVs.
 */
import { createHash } from "node:crypto";
import type { SourceFileRole } from "../schema/package-types.js";
import type { InputFile } from "../types.js";

export function textFile(name: string, role: SourceFileRole, text: string): InputFile {
  return {
    name,
    role,
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    archive: { path: `synthetic/${name}`, archivedAt: "2026-10-13T00:00:00Z" },
  };
}

export function clockStr(s: number): string {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = (ms % 60000) / 1000;
  return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
}

export function durStr(s: number): string {
  const ms = Math.round(s * 1000);
  const m = Math.floor(ms / 60000);
  const sec = (ms % 60000) / 1000;
  return m ? `${m}:${sec.toFixed(3).padStart(6, "0")}` : sec.toFixed(3);
}

export interface SynthStop {
  /** In-lap. */
  lap: number;
  /** Official pit-lane time. */
  pitLane: number;
  /** No card (only the B flag on the in-lap). */
  noCard?: boolean;
  /** The car never crosses the line again. */
  retire?: boolean;
  /** Pit-in before the start (pit-lane start). */
  pitLaneStart?: boolean;
  inDriver?: number;
  outDriver?: number;
}

export interface SynthCar {
  car: string;
  cls: string;
  base: number;
  /** Seconds after the start signal that the car crosses the line at the start of lap 1 (grid offset). */
  grid: number;
  laps: number;
  stops?: SynthStop[];
  /** Extra seconds per lap (lap → s). */
  extra?: Record<number, number>;
  make?: string;
  vehicle?: string;
  /** Results status (default Classified). */
  status?: string;
  /** Seconds added in the results' elapsed time (post-race penalty). */
  resultsPenalty?: number;
}

export interface SynthRace {
  cars: SynthCar[];
  /** Start-signal clock, seconds since midnight. */
  start?: number;
  /** FCY periods as race seconds [start, end]. */
  fcy?: [number, number][];
  /** Race-control messages: [race seconds, text]. */
  rc?: [number, string][];
  /** IMSA report_message lines. */
  postRace?: string[];
  mark?: "Official" | "Provisional";
  driveTime?: boolean;
  /** Drive Time PIT_TYPE=PENALTY on these (car, in-lap). */
  penaltyPitType?: [string, number][];
  /** A red flag as race seconds [red flag, restart]: an RF record, then FCY at the restart. Drive Time
   *  stops its clock during it, so a PIT row that spans it is split at both ends. */
  red?: [number, number];
}

interface Built {
  car: SynthCar;
  ends: number[];
  lt: number[];
  B: Set<number>;
  pits: { inC: number; outC: number | null; pl: number; stop: SynthStop }[];
}

function buildCar(c: SynthCar, start: number): Built {
  const lt: number[] = [];
  const extra: Record<number, number> = { ...(c.extra ?? {}) };
  const B = new Set<number>();
  for (const s of c.stops ?? []) {
    if (s.pitLaneStart) continue;
    extra[s.lap] = (extra[s.lap] ?? 0) + 15;
    if (!s.retire) extra[s.lap + 1] = (extra[s.lap + 1] ?? 0) + s.pitLane - 5;
    B.add(s.lap);
  }
  const ends: number[] = [];
  let t = start + c.grid;
  const plStart = (c.stops ?? []).find((s) => s.pitLaneStart);
  for (let L = 1; L <= c.laps; L++) {
    const x = c.base + (extra[L] ?? 0) + (L === 1 ? 5 : 0) + (L === 1 && plStart ? plStart.pitLane : 0);
    t += x;
    lt.push(Math.round(x * 1000) / 1000);
    ends.push(Math.round(t * 1000) / 1000);
  }
  const pits: Built["pits"] = [];
  for (const s of c.stops ?? []) {
    if (s.pitLaneStart) {
      const inC = start + c.grid - 1;
      pits.push({ inC, outC: inC + s.pitLane, pl: s.pitLane, stop: s });
      continue;
    }
    const inC = ends[s.lap - 1] - 15;
    pits.push({ inC, outC: s.retire ? null : inC + s.pitLane, pl: s.pitLane, stop: s });
  }
  return { car: c, ends, lt, B, pits };
}

export function synthImsa(r: SynthRace): InputFile[] {
  const start = r.start ?? 43200;
  const built = r.cars.map((c) => buildCar(c, start));
  const lapLines = ["NUMBER; DRIVER_NUMBER; LAP_NUMBER; LAP_TIME; LAP_IMPROVEMENT; CROSSING_FINISH_LINE_IN_PIT; S1; S1_IMPROVEMENT; S2; S2_IMPROVEMENT; S3; S3_IMPROVEMENT; KPH; ELAPSED; HOUR;S1_LARGE;S2_LARGE;S3_LARGE;TOP_SPEED;DRIVER_NAME;PIT_TIME;CLASS;GROUP;TEAM;MANUFACTURER;FLAG_AT_FL;"];
  const fcy = r.fcy ?? [];
  for (const b of built) {
    let driver = 1;
    for (let L = 1; L <= b.car.laps; L++) {
      const end = b.ends[L - 1];
      const rt = end - start;
      const under = fcy.some(([a, z]) => rt > a && rt <= z);
      const stopOut = b.car.stops?.find((s) => !s.pitLaneStart && !s.noCard && s.lap + 1 === L);
      const stopIn = b.car.stops?.find((s) => !s.pitLaneStart && s.lap === L);
      // On the in-lap the driver is unchanged; the new driver takes over on the out-lap (below).
      if (stopOut?.outDriver) driver = stopOut.outDriver;
      const pitTime = stopOut ? durStr(stopOut.pitLane) : "";
      lapLines.push(
        [b.car.car, driver, L, durStr(b.lt[L - 1]), 0, b.B.has(L) ? "B" : "", "", "", "", "", "", "", "150.0", clockStr(end - start), clockStr(end), "", "", "", "", `Driver ${driver}`, pitTime, b.car.cls, "", `Team ${b.car.car}`, b.car.make ?? "Toyota", under ? "FCY" : "GF"].join(";") + ";",
      );
    }
  }
  const pitJson = {
    session: { session_date: "02-10-2026 11:40", finalize_type: { type: "By Time", time_in_seconds: 7200 } },
    pit_stop_analysis: built.map((b) => ({
      number: b.car.car,
      class: b.car.cls,
      manufacturer: b.car.make ?? "Toyota",
      pit_stops: b.pits
        .filter((p) => !p.stop.noCard)
        .map((p, i) => ({
          pit_number: i + 1,
          in_time: clockStr(p.inC),
          in_driver_number: p.stop.inDriver ?? 1,
          out_time: p.outC === null ? "" : clockStr(p.outC),
          out_driver_number: p.stop.outDriver ?? p.stop.inDriver ?? 1,
          pit_time: p.outC === null ? "" : durStr(p.pl),
        })),
    })),
  };
  const flags = ["TIME;ELAPSED;REC_TYPE;FLAG;SECTOR;MESSAGE;FLAG_TIME;ACCUM_TIME;LAP", `${clockStr(start)};-;GF;GREEN FLAG;;;;;1`];
  const msgs: [number, string][] = [...(r.rc ?? [])];
  const evs: [number, string][] = [];
  for (const [a, z] of fcy) {
    evs.push([a, "FCY"]);
    evs.push([z, "GF"]);
  }
  if (r.red) {
    evs.push([r.red[0], "RF"]);
    evs.push([r.red[1], "FCY"]);
  }
  const lastEnd = Math.max(...built.map((b) => b.ends[b.ends.length - 1]));
  const leaderLast = Math.min(...built.filter((b) => b.car.laps === Math.max(...built.map((x) => x.car.laps))).map((b) => b.ends[b.ends.length - 1]));
  void lastEnd;
  evs.push([leaderLast - start, "FF"]);
  for (const [t, rec] of evs.sort((a, b) => a[0] - b[0])) flags.push(`${clockStr(start + t)};;${rec};${rec};;;;;`);
  for (const [t, m] of msgs) flags.push(`${clockStr(start + t)};;RCMessage;;;${m};-;-;0`);
  // results: by laps desc, then elapsed (+ penalty)
  const res = built
    .map((b) => ({ b, laps: b.car.laps, el: b.ends[b.ends.length - 1] - start + (b.car.resultsPenalty ?? 0) }))
    .sort((x, y) => y.laps - x.laps || x.el - y.el);
  const classification = res.map((x, i) => ({
    status: x.b.car.status ?? "Classified",
    position: i + 1,
    number: x.b.car.car,
    laps: String(x.laps),
    elapsed_time: clockStr(x.el),
    class: x.b.car.cls,
    team: `Team ${x.b.car.car}`,
    vehicle: x.b.car.vehicle ?? `${x.b.car.make ?? "Toyota"} Racer`,
    manufacturer: x.b.car.make ?? "Toyota",
    drivers: [
      { number: 1, firstname: "Driver", surname: `One${x.b.car.car}` },
      { number: 2, firstname: "Driver", surname: `Two${x.b.car.car}` },
    ],
  }));
  const results = { session: { report_mark: r.mark ?? "Official", report_message: (r.postRace ?? []).join("\r\n"), session_date: "02-10-2026 11:40", championship_name: "Synthetic Series", event_name: "Synthetic Event", session_name: "Race", circuit: { name: "Synthetic Park" } }, classification };
  const files = [
    textFile("23_Time Cards_Race.CSV", "laps", lapLines.join("\n") + "\n"),
    textFile("20_Pit Stops Time Cards_Race.JSON", "pit_cards_json", JSON.stringify(pitJson)),
    textFile("25_FlagsAnalysisWithRCMessages_Race.CSV", "flags", flags.join("\n") + "\n"),
    textFile("03_Results_Race_Official.JSON", "results", JSON.stringify(results)),
  ];
  if (r.driveTime) {
    const dt = ["NUMBER;TEAM;VEHICLE;CLASS;GROUP;CAR_STINT_NUMBER;DRIVER;START;END;STINT_TYPE;PIT_TYPE;TIME;TOTAL_TRACK_TIME;TOTAL DRIVER TIME;STINT"];
    for (const b of built) {
      for (const p of b.pits) {
        if (p.stop.noCard) continue;
        const pen = (r.penaltyPitType ?? []).some(([c, l]) => c === b.car.car && l === p.stop.lap);
        const out = p.outC ?? lastEnd + 60;
        const row = (a: number, z: number) =>
          dt.push([b.car.car, "T", "V", b.car.cls, "", "", "", clockStr(Math.floor(a)).replace(/\.000$/, ""), clockStr(Math.floor(z)).replace(/\.000$/, ""), "PIT", pen ? "PENALTY" : "NORMAL", durStr(z - a), "", "", ""].join(";"));
        const rs = r.red ? start + r.red[0] : null;
        const re = r.red ? start + r.red[1] : null;
        if (rs !== null && re !== null && p.inC < re && out > rs) {
          // Drive Time pauses during the red flag: the part before it, then the part after the restart.
          if (p.inC < rs) row(p.inC, rs);
          if (out > re) row(re, out);
        } else row(p.inC, out);
      }
    }
    files.push(textFile("20_Drive Time_Race.CSV", "drive_time", dt.join("\n") + "\n"));
  }
  return files;
}

/** WRL website export rows. Each row: [car, cls, lap, lapTime|"" , totalRaceTime, inPit, lastInPit, flag, driver?]. */
export function synthWrlWebsite(rows: [string, string, number, string, string, boolean, boolean, string, string?][], summary: [string, number, number, number][]): InputFile[] {
  const head = "Car_Number,Team_Name,Sponsor,Class,Lap_Number,Lap_Time,Total_Race_Time,Overall_Position,Class_Position,In_Pit,Last_In_Pit,Penalties,Pit_Stops,Driver_Name,Driver_ID,Flag_Status";
  const lines = rows.map(([car, cls, lap, lt, trt, ip, lip, flag, drv]) => [car, `Team ${car}`, "", cls, lap, lt, trt, "", "", ip ? "Yes" : "", lip ? "Yes" : "", "", "", drv ?? "", "", flag].join(","));
  const sh = "Overall_Position,Class_Position,Car_Number,Team_Name,Sponsor,Class,Laps_Completed,Total_Race_Time,Best_Lap_Time,Best_Lap_Number,Overall_Gap,Class_Gap,Penalties,Pit_Stops,Last_Driver,Last_Driver_ID";
  const sl = summary.map(([car, pos, cpos, laps]) => [pos, cpos, car, `Team ${car}`, "", rows.find((r) => r[0] === car)?.[1] ?? "", laps, "", "", "", "", "", "", "", "", ""].join(","));
  return [textFile("x_all_laps.csv", "laps", [head, ...lines].join("\n") + "\n"), textFile("x_summary.csv", "summary", [sh, ...sl].join("\n") + "\n")];
}

/** Speedhive export rows: [car, cls, lap, lapTime, timeOfDay ISO (naive), inPit, status]. */
export function synthSpeedhive(rows: [string, string, number, string, string, boolean, string][], summary: [string, number, string, number, string][]): InputFile[] {
  const head = "Team/Name,Start Number,Class,Finish Position (Overall),Finish Position (Class),Lap Number,Lap Time,Time of Day,Diff vs Best Lap,Diff vs Last Lap,Speed,In Pit,Field Position,Leader Lap,Gap to Leader (Time),Gap to Leader (Laps),Gap Ahead (Time),Gap Behind (Time),Status";
  const lines = rows.map(([car, cls, lap, lt, tod, ip, st]) => [`Team ${car}`, car, cls, "", "", lap, lt, tod, "", "", "", ip ? "True" : "False", "", "", "", "", "", "", st].join(","));
  const sh = "Position,Start Number,Name,Class,Position In Class,Status";
  const sl = summary.map(([car, pos, cls, cpos, st]) => [pos, car, `Team ${car}`, cls, cpos, st].join(","));
  return [textFile("y_all_laps.csv", "laps", [head, ...lines].join("\n") + "\n"), textFile("y_summary.csv", "summary", [sh, ...sl].join("\n") + "\n")];
}
