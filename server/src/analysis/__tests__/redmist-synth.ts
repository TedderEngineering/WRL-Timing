/**
 * A small synthetic RedMist race (no third-party data): five cars, 20 laps of 100 s, one FCY, and the
 * five RedMist exports (laps, pits, results, flags, control) shaped like the real JSON.
 *
 *  car 1 (GTO)  Flagtronics stop with entry/exit clocks: in-lap 6, out-lap 7, 95.123 s, driver change.
 *  car 2 (GTO)  duration-only stop (equipment clock not set) under the FCY: in-lap 12, out-lap 13, 88 s.
 *  car 3 (GP1)  a pit visit in the lap flags (laps 15-16) that the pit report does not list.
 *  car 4 (GP1)  report stop at lap 10 only, while the car was already in the pit lane at the lap-9
 *               crossing (re-anchored to 9-10); 1-lap penalty in the control log.
 *  car 5 (GP1)  pit-lane start: lap-1 report stop holding the pre-start wait (1500 s).
 *
 * With { garage: true }, car 3's visit (laps 15-16) lasts 1300 s more and the pit report lists it
 * with a 70-s pit-lane time: the car was repaired behind the wall, outside the timed pit lane.
 */
import type { InputFile } from "../types.js";
import { textFile } from "./synth.js";

export const RM_DATE = "2026-05-02";
const START = 9 * 3600; // session (race clock) start, local
const FCY_FROM = 1201; // race clock
const FCY_TO = 1621;

function hms(s: number): string {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = (ms % 60000) / 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
}

/** Naive local 'YYYY-MM-DDTHH:MM:SS(.fff)' for a race-clock instant. */
function local(raceClock: number): string {
  const ms = Math.round((START + raceClock) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  return `${RM_DATE}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${f ? `.${String(f).padStart(3, "0")}` : ""}`;
}

/** Car 1's Flagtronics stop: entry 70 s into lap 6, 95.123 s in the pit lane. */
export const RM_CAR1_ENTRY = 10 + 500 + 70;
export const RM_CAR1_PIT = 95.123;

interface CarSpec {
  car: string;
  cls: string;
  team: string;
  grid: number;
  extra: Record<number, number>;
  lip: number[];
  ip: number[];
  driver: (lap: number) => string;
  /** Laps run (default 20). */
  laps?: number;
}

export const RM_CARS: CarSpec[] = [
  { car: "1", cls: "GTO", team: "Alpha Racing", grid: 10, extra: { 6: 25, 7: 65 }, lip: [6, 7], ip: [6], driver: (l) => (l <= 6 ? "Ann Able" : "Bob Baker") },
  { car: "2", cls: "GTO", team: "Bravo Motorsport", grid: 11, extra: { 12: 25, 13: 65 }, lip: [12, 13], ip: [12], driver: () => "Cat Cole" },
  { car: "3", cls: "GP1", team: "Charlie Team", grid: 12, extra: { 15: 25, 16: 65 }, lip: [15, 16], ip: [15], driver: () => "Dan Drew" },
  { car: "4", cls: "GP1", team: "Delta Works", grid: 13, extra: { 9: 25, 10: 65 }, lip: [9, 10], ip: [9], driver: () => "Eve Egan" },
  { car: "5", cls: "GP1", team: "Echo Speed", grid: 40, extra: {}, lip: [1], ip: [], driver: () => "Fay Fox" },
];

/** Race-clock crossing of a car's lap (end of lap). */
export function crossing(c: CarSpec, lap: number): number {
  let t = c.grid;
  for (let l = 1; l <= lap; l++) t += 100 + (c.extra[l] ?? 0);
  return t;
}

/** Car 3's extra out-lap time with { garage: true }. */
export const RM_GARAGE_EXTRA_S = 1300;

/** { dtReissued: true }: car 1's drive-through, issued at race clock 1740 and served in its lap-18 visit. */
export const RM_DT_ISSUED = "09:29:00";

export function redmistFiles(
  opts: { pits?: boolean; prefix?: string; garage?: boolean; stuckFlags?: boolean; phantom?: boolean; lateJoin?: boolean; dtReissued?: boolean; retireInPit?: boolean } = {},
): InputFile[] {
  const pre = opts.prefix ?? "redmist_9_1";
  let cars = opts.garage ? RM_CARS.map((c) => (c.car === "3" ? { ...c, extra: { 15: 25, 16: 65 + RM_GARAGE_EXTRA_S } } : c)) : RM_CARS;
  // { stuckFlags: true }: car 2's "in pit lane at the line" flag stays set from its stop (lap 12) to
  // lap 18 while it laps at racing pace again (Sebring Sunday 2026, #48).
  if (opts.stuckFlags) cars = cars.map((c) => (c.car === "2" ? { ...c, ip: [12, 13, 14, 15, 16, 17, 18], lip: [12, 13, 14, 15, 16, 17, 18] } : c));
  // { lateJoin: true }: car 6 joins from the garage 1000 s after the start and runs 10 laps (Sebring 2026 #290).
  if (opts.lateJoin) cars = [...cars, { car: "6", cls: "GP1", team: "Foxtrot Racing", grid: 1000, extra: {}, lip: [], ip: [], driver: () => "Gus Gray", laps: 10 }];
  // { dtReissued: true }: car 1's second visit (laps 18-19) holds a stop and the drive-through race
  // control issued just before; the equipment reissued the entry, so the report times only the
  // last 15 s (Sebring 2026 #696).
  if (opts.dtReissued) cars = cars.map((c) => (c.car === "1" ? { ...c, extra: { ...c.extra, 18: 25, 19: 110 }, lip: [...c.lip, 18, 19], ip: [...c.ip, 18] } : c));
  // { retireInPit: true }: car 4 comes in on lap 14 and stays; laps 15-16 are counted in the pit lane (Sebring 2026 #260).
  if (opts.retireInPit) cars = cars.map((c) => (c.car === "4" ? { ...c, extra: { ...c.extra, 15: 100, 16: 100 }, lip: [...c.lip, 14, 15, 16], ip: [...c.ip, 14, 15, 16], laps: 16 } : c));
  const laps: Record<string, unknown>[] = [];
  for (const c of cars) {
    for (let lap = 1; lap <= (c.laps ?? 20); lap++) {
      const end = crossing(c, lap);
      laps.push({
        eid: "9",
        sid: "1",
        n: c.car,
        class: c.cls,
        llp: lap,
        ltm: hms(100 + (c.extra[lap] ?? 0)),
        ttm: hms(end),
        flg: end >= FCY_FROM && end < FCY_TO ? 2 : 1,
        ip: c.ip.includes(lap),
        lip: c.lip.includes(lap),
        dn: c.driver(lap),
        ds: "rfidHelmet",
        pl: 0,
        pet: "0001-04-11T00:00:31Z",
        pdm: 453000,
      });
    }
  }
  const lapsDoc = {
    eventId: 9,
    eventName: "Synthetic Raceway 2026",
    sessionId: 1,
    sessionName: "Saturday 8 Hour",
    carNumber: null,
    trackTimeZone: "UTC-05:00",
    trackTimeZoneKnown: true,
    lapDataTimeZone: "UTC",
    sessionStillLive: false,
    laps,
    lapCount: laps.length,
    skippedRows: 0,
    truncated: false,
  };
  const pitsDoc = {
    eventId: 9,
    sessionId: 1,
    trackTimeZone: "UTC-05:00",
    pitStops: [
      // car 1: entry 70 s into lap 6, exit in lap 7
      { carNumber: "1", stopNumber: 1, startLap: 6, endLap: 7, pitEntryTime: `${local(RM_CAR1_ENTRY)}-05:00`, pitExitTime: `${local(RM_CAR1_ENTRY + RM_CAR1_PIT)}-05:00`, pitEntryTimeUnavailable: false, pitEntryTimeRenumbered: false, pitDurationMs: 95123, pitDuration: "1:35.123", driverBefore: "Ann Able", driverAfter: "Bob Baker", driverChanged: true },
      { carNumber: "2", stopNumber: 1, startLap: 12, endLap: 13, pitEntryTime: null, pitExitTime: null, pitEntryTimeUnavailable: true, pitEntryTimeRenumbered: false, pitDurationMs: 88000, pitDuration: "1:28.000", driverBefore: "Cat Cole", driverAfter: "Cat Cole", driverChanged: false },
      { carNumber: "4", stopNumber: 1, startLap: 10, endLap: 10, pitEntryTime: null, pitExitTime: null, pitEntryTimeUnavailable: true, pitEntryTimeRenumbered: false, pitDurationMs: 70000, pitDuration: "1:10.000", driverBefore: "Eve Egan", driverAfter: "Eve Egan", driverChanged: false },
      { carNumber: "5", stopNumber: 1, startLap: 1, endLap: 1, pitEntryTime: null, pitExitTime: null, pitEntryTimeUnavailable: true, pitEntryTimeRenumbered: false, pitDurationMs: 1500000, pitDuration: "25:00.000", driverBefore: "", driverAfter: "Fay Fox", driverChanged: false },
      // { stuckFlags: true }: car 2's next reported stop, laps 18-19, inside its stuck flags.
      ...(opts.stuckFlags
        ? [{ carNumber: "2", stopNumber: 2, startLap: 18, endLap: 19, pitEntryTime: null, pitExitTime: null, pitEntryTimeUnavailable: true, pitEntryTimeRenumbered: false, pitDurationMs: 70000, pitDuration: "1:10.000", driverBefore: "Cat Cole", driverAfter: "Cat Cole", driverChanged: false }]
        : []),
      // { phantom: true }: a 5-s report row for car 1 on lap 15, with no lap pit flag.
      ...(opts.phantom
        ? [{ carNumber: "1", stopNumber: 2, startLap: 15, endLap: 15, pitEntryTime: null, pitExitTime: null, pitEntryTimeUnavailable: true, pitEntryTimeRenumbered: false, pitDurationMs: 5000, pitDuration: "0:05.000", driverBefore: "Bob Baker", driverAfter: "Bob Baker", driverChanged: false }]
        : []),
      ...(opts.dtReissued
        ? [{ carNumber: "1", stopNumber: 2, startLap: 18, endLap: 19, pitEntryTime: `${local(crossing(cars[0], 18) + 60)}-05:00`, pitExitTime: `${local(crossing(cars[0], 18) + 75)}-05:00`, pitEntryTimeUnavailable: false, pitEntryTimeRenumbered: true, pitDurationMs: 15000, pitDuration: "0:15.000", driverBefore: "Bob Baker", driverAfter: "Bob Baker", driverChanged: false }]
        : []),
      ...(opts.garage
        ? [{ carNumber: "3", stopNumber: 1, startLap: 15, endLap: 16, pitEntryTime: null, pitExitTime: null, pitEntryTimeUnavailable: true, pitEntryTimeRenumbered: false, pitDurationMs: 70000, pitDuration: "1:10.000", driverBefore: "Dan Drew", driverAfter: "Dan Drew", driverChanged: false }]
        : []),
    ],
    pitStopCount: opts.garage ? 5 : 4,
    truncated: false,
    skippedLapRows: 0,
  };
  const resultsDoc = {
    eventId: 9,
    sessionId: 1,
    localTimeOfDay: "12:00:00",
    runningRaceTime: "03:00:00",
    sessionStartTime: "0001-01-01T00:00:00",
    localTimeZoneOffset: 0,
    eventEntries: cars.map((c) => ({ no: c.car, nm: c.team, t: "Sponsor Co", c: c.cls })),
    carPositions: cars.map((c, i) => ({ n: c.car, class: c.cls, ovp: i + 1, clp: c.cls === "GTO" ? i + 1 : i - 1, llp: c.laps ?? 20, bt: "00:01:40.000", bl: 2, ttm: hms(crossing(c, c.laps ?? 20)) })),
    classOrder: { GTO: "1", GP1: "2" },
  };
  const flagsDoc = [
    { f: 2, s: `${RM_DATE}T08:59:00`, e: `${RM_DATE}T09:00:09` },
    { f: 1, s: local(10), e: local(1200) },
    { f: 2, s: local(1201), e: local(1499) },
    { f: 1, s: local(1500), e: local(1505) }, // 6-second green blip
    { f: 2, s: local(1506), e: local(1620) },
    { f: 1, s: local(1621), e: local(2039) },
    { f: 5, s: local(2040), e: null },
  ];
  const control = [
    { o: 1, t: `${RM_DATE}T09:00:00`, cor: null, c1: null, c1h: false, c2: null, c2h: false, n: "GREEN FLAG", s: null, a: null },
    { o: 2, t: `${RM_DATE}T09:05:00`, cor: "4", c1: "4", c1h: true, c2: "3", c2h: false, n: "CONTACT", s: "FINAL", a: "1 LAP" },
    { o: 2, t: `${RM_DATE}T09:05:00`, cor: "4", c1: "4", c1h: true, c2: "3", c2h: false, n: "CONTACT", s: "FINAL", a: "1 LAP" },
    { o: 3, t: `${RM_DATE}T09:10:00`, cor: "PR", c1: "3", c1h: false, c2: null, c2h: false, n: "PIT LANE/FUELING INFRACTION", s: "FINAL", a: "WARNING" },
    { o: 4, t: `${RM_DATE}T09:12:00`, cor: "7", c1: "1", c1h: false, c2: "2", c2h: false, n: "CONTACT", s: "FINAL", a: "NO ACTION NEEDED" },
    { o: 5, t: `${RM_DATE}T09:20:00`, cor: null, c1: null, c1h: true, c2: null, c2h: true, n: "FULL COURSE CAUTION", s: null, a: null },
    { o: 6, t: `${RM_DATE}T04:15:00`, cor: "2", c1: "2", c1h: false, c2: "5", c2h: false, n: "Contact", s: "Under Investigation", a: null },
    { o: 7, t: `${RM_DATE}T09:27:00`, cor: null, c1: null, c1h: false, c2: null, c2h: false, n: "GREEN FLAG", s: null, a: null },
  ];
  if (opts.dtReissued)
    control.push({ o: 8, t: `${RM_DATE}T${RM_DT_ISSUED}`, cor: "PR", c1: "1", c1h: false, c2: null, c2h: false, n: "PIT LANE/FUELING INFRACTION", s: "FINAL", a: "DRIVE THROUGH" });
  const out = [textFile(`${pre}_laps.json`, "laps", JSON.stringify(lapsDoc))];
  if (opts.pits !== false) out.push(textFile(`${pre}_pits.json`, "pit_cards_json", JSON.stringify(pitsDoc)));
  out.push(textFile(`${pre}_results.json`, "results", JSON.stringify(resultsDoc)));
  out.push(textFile(`${pre}_flags.json`, "flags", JSON.stringify(flagsDoc)));
  out.push(textFile(`${pre}_control.json`, "control_log", JSON.stringify(control)));
  return out;
}
