/**
 * IMSA timing & scoring JSON parser
 *
 * Used by: IMSA WeatherTech, IMSA Michelin Pilot Challenge, IMSA VP Racing SportsCar Challenge
 *
 * Expects two JSON files from IMSA timing exports:
 *   1. Time Cards JSON (23_Time_Cards_Race.json): session, participants with per-lap data
 *      - Lap times, pit lane crossings, driver numbers, speeds, sector times, validity
 *   2. Flags/RC Messages JSON (25_FlagsAnalysisWithRCMessages_Race.json): session, flags
 *      - Flag transitions (GREEN, FCY, CHEQUERED) with lap numbers
 *      - Race Control messages: penalties, incidents, pit events
 *
 * Positions are computed from session_elapsed times (who completed each lap first).
 * Pit stops come from `crossing_pit_finish_lane`. Driver stints from `driver_number`.
 * Penalties, incidents, and caution periods from the flags file.
 */

import type { RaceDataParser, ParsedResult } from "./types.js";
import type { RaceDataJson } from "../race-validators.js";

// ─── IMSA JSON types ─────────────────────────────────────────────────────────

interface IMSASession {
  championship_name: string;
  event_name: string;
  session_name: string;
  session_date: string;
  circuit: { name: string; length: number; country: string };
  weather?: { air_temperature: string; track_temperature: string; track_status: string };
  finalize_type?: { type: string; time_in_seconds?: number };
  report_message?: string;
  [key: string]: any;
}

interface IMSADriver {
  number: number;
  firstname: string;
  surname: string;
  license: string;
  country: string;
  [key: string]: any;
}

interface IMSASectorTime {
  index: number;
  time: string;
  hour: string;
  is_session_best: boolean;
  is_personal_best: boolean;
}

interface IMSALap {
  number: number;
  driver_number: string;
  time: string;                    // "1:58.002"
  is_session_best: boolean;
  is_personal_best: boolean;
  top_speed_kph: string;
  session_elapsed: string;         // "4:03.626" or "1:02:15.123"
  hour: string;                    // "13:49:46.113" wall-clock
  average_speed_kph: string;
  is_valid: boolean;
  manually_invalidated: boolean;
  crossing_pit_finish_lane: boolean;
  sector_times: IMSASectorTime[];
  [key: string]: any;
}

interface IMSAParticipant {
  number: string;
  team: string;
  class: string;
  vehicle: string;
  manufacturer: string;
  drivers: IMSADriver[];
  laps: IMSALap[];
  [key: string]: any;
}

interface IMSATimeCardsData {
  session: IMSASession;
  participants: IMSAParticipant[];
}

interface IMSAFlagEvent {
  time: string;
  elapsed: string;
  rec_type: string; // "GF" | "FCY" | "FF" | "RCMessage"
  flag: string;
  sector: string;
  message: string;
  flag_time: string;
  accum_time: string;
  lap: number;
}

interface IMSAFlagsData {
  session: IMSASession;
  flags: IMSAFlagEvent[];
}

// ─── Time utilities ──────────────────────────────────────────────────────────

/** Parse "M:SS.mmm" or "H:MM:SS.mmm" to seconds */
function parseElapsed(s: string): number {
  if (!s) return 0;
  const parts = s.split(":");
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  } else if (parts.length === 3) {
    return (
      parseInt(parts[0], 10) * 3600 +
      parseInt(parts[1], 10) * 60 +
      parseFloat(parts[2])
    );
  }
  return 0;
}

/** Parse wall-clock "HH:MM:SS.mmm" to seconds-of-day */
function parseTimeOfDay(t: string): number {
  const parts = t.split(":");
  if (parts.length < 3) return 0;
  return (
    parseInt(parts[0], 10) * 3600 +
    parseInt(parts[1], 10) * 60 +
    parseFloat(parts[2])
  );
}

/** Parse lap time "M:SS.mmm" or "SS.mmm" to seconds */
function parseLapTimeStr(t: string): number {
  if (!t) return 0;
  const parts = t.split(":");
  if (parts.length === 1) return parseFloat(parts[0]) || 0;
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  if (parts.length === 3)
    return (
      parseInt(parts[0], 10) * 3600 +
      parseInt(parts[1], 10) * 60 +
      parseFloat(parts[2])
    );
  return 0;
}

/** Convert kph string to mph number */
function kphToMph(kph: string): number {
  const v = parseFloat(kph);
  return v > 0 ? v * 0.621371 : 0;
}

// ─── Annotation helpers ──────────────────────────────────────────────────────

const PIT_COLOR = "#fbbf24"; // yellow
const SETTLE_COLOR = "#f87171"; // red

// ─── Parser ──────────────────────────────────────────────────────────────────

export const imsaParser: RaceDataParser = {
  id: "imsa",
  name: "IMSA Timing & Scoring",
  series: "IMSA",
  description:
    "Import from IMSA JSON timing exports (Time Cards + Flags/RC Messages). Supports WeatherTech, Michelin Pilot Challenge, and VP Racing SportsCar Challenge.",
  fileSlots: [
    {
      key: "timeCardsJson",
      label: "Time Cards JSON",
      description:
        "IMSA Time Cards export (e.g. 23_Time_Cards_Race.json) — lap times, pit crossings, driver stints, speeds.",
      required: true,
      accept: ".json",
    },
    {
      key: "flagsJson",
      label: "Flags & RC Messages JSON",
      description:
        "IMSA Flags Analysis export (e.g. 25_FlagsAnalysisWithRCMessages_Race.json) — caution periods, penalties, race control messages.",
      required: true,
      accept: ".json",
    },
  ],

  parse(files) {
    const { timeCardsJson, flagsJson } = files;
    if (!timeCardsJson) throw new Error("Missing Time Cards JSON file");
    if (!flagsJson) throw new Error("Missing Flags & RC Messages JSON file");

    const warnings: string[] = [];

    // ── Parse JSON files (handle BOM) ──────────────────────────────
    let timeCards: IMSATimeCardsData;
    let flagsData: IMSAFlagsData;

    try {
      timeCards = JSON.parse(timeCardsJson.replace(/^\uFEFF/, ""));
    } catch (e: any) {
      throw new Error(`Failed to parse Time Cards JSON: ${e.message}`);
    }

    try {
      flagsData = JSON.parse(flagsJson.replace(/^\uFEFF/, ""));
    } catch (e: any) {
      throw new Error(`Failed to parse Flags JSON: ${e.message}`);
    }

    if (!timeCards.participants?.length) throw new Error("Time Cards has no participants");

    // ── Build time→lap interpolation from flag events ──────────────
    const flagEvents = (flagsData.flags || []).filter(
      (f) => f.rec_type === "GF" || f.rec_type === "FCY" || f.rec_type === "FF"
    );

    const anchors: Array<{ timeSec: number; lap: number }> = [];
    for (const fe of flagEvents) {
      if (fe.lap > 0 && fe.time) {
        anchors.push({ timeSec: parseTimeOfDay(fe.time), lap: fe.lap });
      }
    }
    anchors.sort((a, b) => a.timeSec - b.timeSec);

    function timeToLap(timeStr: string): number {
      if (!timeStr || anchors.length === 0) return 0;
      const t = parseTimeOfDay(timeStr);
      if (t <= anchors[0].timeSec) return anchors[0].lap;
      if (t >= anchors[anchors.length - 1].timeSec) return anchors[anchors.length - 1].lap;
      for (let i = 0; i < anchors.length - 1; i++) {
        if (t >= anchors[i].timeSec && t <= anchors[i + 1].timeSec) {
          const frac =
            (t - anchors[i].timeSec) /
            (anchors[i + 1].timeSec - anchors[i].timeSec);
          return Math.round(
            anchors[i].lap + frac * (anchors[i + 1].lap - anchors[i].lap)
          );
        }
      }
      return anchors[anchors.length - 1].lap;
    }

    // ── Build FCY periods from flag events ─────────────────────────
    const fcy: Array<[number, number]> = [];
    let fcyStartLap: number | null = null;

    for (const fe of flagEvents) {
      if (fe.rec_type === "FCY" && fe.lap > 0) {
        if (fcyStartLap === null) fcyStartLap = fe.lap;
      } else if (
        (fe.rec_type === "GF" || fe.rec_type === "FF") &&
        fcyStartLap !== null
      ) {
        fcy.push([fcyStartLap, Math.max(fcyStartLap, fe.lap - 1)]);
        fcyStartLap = null;
      }
    }

    const fcyLapSet = new Set<number>();
    for (const [start, end] of fcy) {
      for (let l = start; l <= end; l++) fcyLapSet.add(l);
    }

    // ── Parse RC messages for penalties and incidents ───────────────
    interface CarEvent {
      lap: number;
      type: "penalty" | "pit_enter" | "incident" | "off_course" | "stopped" | "other";
      message: string;
      time: string;
    }

    const carEvents = new Map<string, CarEvent[]>();

    function addCarEvent(carNum: string, event: CarEvent) {
      if (!carEvents.has(carNum)) carEvents.set(carNum, []);
      carEvents.get(carNum)!.push(event);
    }

    const rcMessages = (flagsData.flags || []).filter(
      (f) => f.rec_type === "RCMessage" && f.message
    );

    for (const rc of rcMessages) {
      const msg = rc.message.trim();
      const estimatedLap = timeToLap(rc.time);

      // Pattern: "Car NN: Penalty - <description> - <punishment>"
      const penaltyMatch = msg.match(/^Car\s+(\d+):\s*Penalty\s*-\s*(.+)/i);
      if (penaltyMatch) {
        addCarEvent(penaltyMatch[1], {
          lap: estimatedLap,
          type: "penalty",
          message: penaltyMatch[2],
          time: rc.time,
        });
        continue;
      }

      // Multi-car penalty: "Cars 26, 67, 24: Penalty - ..."
      const multiPenalty = msg.match(/^Cars?\s+([\d,\s&]+):\s*Penalty\s*-\s*(.+)/i);
      if (multiPenalty) {
        const nums = multiPenalty[1].match(/\d+/g) || [];
        for (const n of nums) {
          addCarEvent(n, {
            lap: estimatedLap,
            type: "penalty",
            message: multiPenalty[2],
            time: rc.time,
          });
        }
        continue;
      }

      // "CAR NN ENTERED PIT LANE" / "CAR NN ENTERED CLOSED PIT"
      const pitMatch = msg.match(/^CAR\s+(\d+)\s+ENTERED\s+(PIT|CLOSED)/i);
      if (pitMatch) {
        addCarEvent(pitMatch[1], {
          lap: estimatedLap,
          type: "pit_enter",
          message: msg,
          time: rc.time,
        });
        continue;
      }

      // "CAR NN OFF COURSE..." / "CAR NN STOPPED ON COURSE..."
      const offMatch = msg.match(
        /^CAR\s+(\d+)\*?\s+(OFF COURSE|STOPPED ON COURSE)/i
      );
      if (offMatch) {
        addCarEvent(offMatch[1], {
          lap: estimatedLap,
          type: offMatch[2].toUpperCase().startsWith("OFF")
            ? "off_course"
            : "stopped",
          message: msg,
          time: rc.time,
        });
        continue;
      }

      // "CAR NN SPUN..."
      const spinMatch = msg.match(/^CAR\s+(\d+)\*?\s+SPUN/i);
      if (spinMatch) {
        addCarEvent(spinMatch[1], {
          lap: estimatedLap,
          type: "incident",
          message: msg,
          time: rc.time,
        });
        continue;
      }

      // "INCIDENT INVOLVING CARS NN & NN..."
      const incidentMatch = msg.match(
        /^INCIDENT INVOLVING (?:CARS?|MULTIPLE)\s+([\d,\s&]+)/i
      );
      if (incidentMatch) {
        const nums = incidentMatch[1].match(/\d+/g) || [];
        for (const n of nums) {
          addCarEvent(n, {
            lap: estimatedLap,
            type: "incident",
            message: msg,
            time: rc.time,
          });
        }
        continue;
      }
    }

    // ── Compute positions from session_elapsed ─────────────────────
    // For each lap N, gather all cars that completed lap N, sort by elapsed
    // This matches official IMSA timing positions exactly.

    let maxLap = 0;

    // First pass: build per-car lap data with parsed times
    interface CarLapRaw {
      num: string;
      lapNum: number;
      elapsedSec: number;
      lapTimeSec: number;
      lapTimeStr: string;
      pit: boolean;
      speedMph: number;
      driverNum: string;
      hour: string;
    }

    const carLapsRaw = new Map<string, CarLapRaw[]>();

    for (const p of timeCards.participants) {
      const carNum = p.number;
      const laps: CarLapRaw[] = [];

      for (const lap of p.laps) {
        const lapNum = lap.number;
        if (lapNum < 1) continue;
        if (lapNum > maxLap) maxLap = lapNum;

        laps.push({
          num: carNum,
          lapNum,
          elapsedSec: parseElapsed(lap.session_elapsed),
          lapTimeSec: parseLapTimeStr(lap.time),
          lapTimeStr: lap.time,
          pit: !!lap.crossing_pit_finish_lane,
          speedMph: kphToMph(lap.average_speed_kph || "0"),
          driverNum: lap.driver_number,
          hour: lap.hour,
        });
      }

      if (laps.length > 0) {
        carLapsRaw.set(carNum, laps);
      }
    }

    // Compute positions per lap
    const lapPositions = new Map<number, Map<string, number>>(); // lap → (carNum → position)

    for (let lap = 1; lap <= maxLap; lap++) {
      const entries: Array<{ num: string; elapsed: number }> = [];

      for (const [carNum, laps] of carLapsRaw) {
        const lapData = laps.find((l) => l.lapNum === lap);
        if (lapData) {
          entries.push({ num: carNum, elapsed: lapData.elapsedSec });
        }
      }

      entries.sort((a, b) => a.elapsed - b.elapsed);
      const posMap = new Map<string, number>();
      for (let i = 0; i < entries.length; i++) {
        posMap.set(entries[i].num, i + 1);
      }
      lapPositions.set(lap, posMap);
    }

    // ── Build car data ─────────────────────────────────────────────
    const participantMap = new Map<string, IMSAParticipant>();
    for (const p of timeCards.participants) {
      participantMap.set(p.number, p);
    }

    // Final positions from last lap
    const finalPosMap = lapPositions.get(maxLap) || new Map();

    // For cars that didn't finish on the last lap, use their last completed lap's position
    // plus offset them behind all finishers
    const finisherCount = finalPosMap.size;

    const cars: RaceDataJson["cars"] = {};
    const classGroups: Record<string, number[]> = {};
    const classCarCounts: Record<string, number> = {};
    const annotations: Record<
      string,
      {
        reasons: Record<string, string>;
        pits: Array<{ l: number; lb: string; c: string; yo: number; da: number }>;
        settles: Array<{ l: number; p: number; lb: string; su: string; c: string }>;
      }
    > = {};

    // Sort all cars by (laps completed desc, final elapsed asc) for finish positions
    const carFinishOrder: Array<{
      num: string;
      lapsCompleted: number;
      finalElapsed: number;
    }> = [];

    for (const [carNum, laps] of carLapsRaw) {
      const lastLap = laps[laps.length - 1];
      carFinishOrder.push({
        num: carNum,
        lapsCompleted: laps.length,
        finalElapsed: lastLap.elapsedSec,
      });
    }

    carFinishOrder.sort((a, b) => {
      if (b.lapsCompleted !== a.lapsCompleted)
        return b.lapsCompleted - a.lapsCompleted;
      return a.finalElapsed - b.finalElapsed;
    });

    const overallFinishPos = new Map<string, number>();
    carFinishOrder.forEach((c, i) => overallFinishPos.set(c.num, i + 1));

    for (const [carNum, rawLaps] of carLapsRaw) {
      const participant = participantMap.get(carNum);
      if (!participant) {
        warnings.push(`Car #${carNum} has laps but no participant entry`);
        continue;
      }

      const num = parseInt(carNum, 10);
      if (isNaN(num)) continue;

      const cls = participant.class || "Unknown";
      const driverSurnames = participant.drivers
        .map((d) => d.surname)
        .filter(Boolean)
        .join(" / ");
      const team = driverSurnames
        ? `${participant.team || `Car #${carNum}`} (${driverSurnames})`
        : participant.team || `Car #${carNum}`;
      const finishPos = overallFinishPos.get(carNum) || 999;

      // Build laps array with positions
      const lapEntries = rawLaps.map((rl) => {
        const posMap = lapPositions.get(rl.lapNum);
        const p = posMap?.get(carNum) || 999;
        return {
          l: rl.lapNum,
          p,
          cp: 0, // computed below
          lt: rl.lapTimeStr,
          ltSec: rl.lapTimeSec > 0 ? rl.lapTimeSec : 0.001,
          flag: fcyLapSet.has(rl.lapNum) ? "FCY" : ("GREEN" as string),
          pit: (rl.pit ? 1 : 0) as 0 | 1,
          spd: rl.speedMph,
        };
      });

      cars[String(num)] = {
        num,
        team,
        cls,
        finishPos,
        finishPosClass: 0, // computed below
        laps: lapEntries,
      };

      if (!classGroups[cls]) classGroups[cls] = [];
      classGroups[cls].push(num);
      classCarCounts[cls] = (classCarCounts[cls] || 0) + 1;

      // ── Build annotations ──────────────────────────────────────
      const reasons: Record<string, string> = {};
      const pits: Array<{
        l: number;
        lb: string;
        c: string;
        yo: number;
        da: number;
      }> = [];
      const settles: Array<{
        l: number;
        p: number;
        lb: string;
        su: string;
        c: string;
      }> = [];

      // Pit annotations from crossing_pit_finish_lane with driver change tracking
      let stintNum = 1;

      // Figure out starting driver name
      const startingDriverNum = rawLaps.length > 0 ? rawLaps[0].driverNum : "1";
      const getDriverLabel = (drvNum: string): string => {
        const driver = participant.drivers.find(
          (d) => String(d.number) === drvNum
        );
        return driver ? driver.surname : `D${drvNum}`;
      };

      let currentDriverNum = startingDriverNum;
      let currentDriverLabel = getDriverLabel(currentDriverNum);

      for (const rl of rawLaps) {
        // Detect driver change even without pit (e.g. between laps)
        if (rl.driverNum !== currentDriverNum) {
          const newDriverLabel = getDriverLabel(rl.driverNum);

          // If this isn't a pit lap, still note the driver change in reasons
          if (!rl.pit) {
            const lapKey = String(rl.lapNum);
            const changeNote = `Driver → ${newDriverLabel}`;
            const existing = reasons[lapKey];
            reasons[lapKey] = existing
              ? `${existing}; ${changeNote}`
              : changeNote;
          }

          currentDriverNum = rl.driverNum;
          currentDriverLabel = newDriverLabel;
        }

        if (rl.pit) {
          const posMap = lapPositions.get(rl.lapNum);
          const posAfter = posMap?.get(carNum) || 0;
          const prevPosMap = lapPositions.get(rl.lapNum - 1);
          const posBefore = prevPosMap?.get(carNum) || posAfter;
          const delta = posAfter - posBefore;

          // Check if this pit has a driver change
          const prevLap = rawLaps.find((l) => l.lapNum === rl.lapNum - 1);
          const isDriverChange =
            prevLap && prevLap.driverNum !== rl.driverNum;
          const newDriverLabel = getDriverLabel(rl.driverNum);

          // Build pit label: "S1→S2 Surname" on driver change, "S2 Pit" otherwise
          let pitLabel: string;
          if (isDriverChange) {
            pitLabel = `S${stintNum}→S${stintNum + 1} ${newDriverLabel}`;
          } else {
            pitLabel = `S${stintNum} ${currentDriverLabel}`;
          }

          pits.push({
            l: rl.lapNum,
            lb: pitLabel,
            c: PIT_COLOR,
            yo: 0,
            da: delta,
          });

          // Add reason for driver change
          if (isDriverChange) {
            const lapKey = String(rl.lapNum);
            const changeNote = `Driver → ${newDriverLabel}`;
            const existing = reasons[lapKey];
            reasons[lapKey] = existing
              ? `${existing}; ${changeNote}`
              : changeNote;
          }

          stintNum++;
        }
      }

      // Penalty and incident annotations from RC messages
      const events = carEvents.get(carNum) || [];
      for (const ev of events) {
        if (ev.lap < 1 || ev.lap > maxLap) continue;
        const lapKey = String(ev.lap);

        if (ev.type === "penalty") {
          const shortPenalty = shortenPenalty(ev.message);
          const existing = reasons[lapKey];
          reasons[lapKey] = existing
            ? `${existing}; ${shortPenalty}`
            : shortPenalty;
        } else if (
          ev.type === "incident" ||
          ev.type === "off_course" ||
          ev.type === "stopped"
        ) {
          const shortMsg = shortenIncident(ev.message);
          const existing = reasons[lapKey];
          reasons[lapKey] = existing
            ? `${existing}; ${shortMsg}`
            : shortMsg;
        }
      }

      // Settle markers: position changes across caution periods
      for (const [fcyStart, fcyEnd] of fcy) {
        const prePosMap = lapPositions.get(fcyStart - 1);
        const postPosMap = lapPositions.get(
          Math.min(fcyEnd + 1, maxLap)
        );

        const prePos = prePosMap?.get(carNum);
        const postPos = postPosMap?.get(carNum);

        if (prePos && postPos) {
          const delta = postPos - prePos;
          if (Math.abs(delta) >= 3) {
            const settleLap = Math.min(fcyEnd + 1, maxLap);
            settles.push({
              l: settleLap,
              p: postPos,
              lb: `Settled P${postPos}`,
              su: `Was P${prePos} · ${delta > 0 ? "Lost" : "Gained"} ${Math.abs(delta)}`,
              c: SETTLE_COLOR,
            });
          }
        }
      }

      annotations[String(num)] = { reasons, pits, settles };
    }

    // ── Compute class positions per lap ────────────────────────────
    for (let lap = 1; lap <= maxLap; lap++) {
      const classLapEntries = new Map<
        string,
        Array<{ num: number; pos: number }>
      >();

      for (const [numStr, car] of Object.entries(cars)) {
        const lapData = car.laps.find((l: any) => l.l === lap);
        if (!lapData) continue;
        if (!classLapEntries.has(car.cls))
          classLapEntries.set(car.cls, []);
        classLapEntries
          .get(car.cls)!
          .push({ num: car.num, pos: (lapData as any).p });
      }

      for (const [, entries] of classLapEntries) {
        entries.sort((a, b) => a.pos - b.pos);
        for (let ci = 0; ci < entries.length; ci++) {
          const car = cars[String(entries[ci].num)];
          const lapData = car.laps.find((l: any) => l.l === lap);
          if (lapData) (lapData as any).cp = ci + 1;
        }
      }
    }

    // ── Compute finish positions in class ──────────────────────────
    for (const [, nums] of Object.entries(classGroups)) {
      const sorted = nums
        .slice()
        .sort(
          (a, b) => cars[String(a)].finishPos - cars[String(b)].finishPos
        );
      for (let i = 0; i < sorted.length; i++) {
        cars[String(sorted[i])].finishPosClass = i + 1;
      }
    }

    // ── Green pace cutoff ────────────────────────────────────────
    const greenLapTimes: number[] = [];
    for (const [, car] of Object.entries(cars)) {
      for (const lap of car.laps) {
        const ld = lap as any;
        if (ld.flag === "GREEN" && ld.pit === 0 && ld.ltSec > 1) {
          greenLapTimes.push(ld.ltSec);
        }
      }
    }

    let greenPaceCutoff = 300;
    if (greenLapTimes.length > 10) {
      greenLapTimes.sort((a, b) => a - b);
      const p95Idx = Math.floor(greenLapTimes.length * 0.95);
      greenPaceCutoff = greenLapTimes[p95Idx] * 1.1;
    }

    const totalCars = Object.keys(cars).length;
    if (totalCars === 0)
      throw new Error("No valid car data found in IMSA JSON files");

    // ── Summary ───────────────────────────────────────────────────
    const totalPenalties = Array.from(carEvents.values())
      .flat()
      .filter((e) => e.type === "penalty").length;
    const totalPitStops = Object.values(annotations).reduce(
      (sum, a) => sum + a.pits.length,
      0
    );
    const totalDriverChanges = Object.values(annotations).reduce(
      (sum, a) =>
        sum +
        Object.values(a.reasons).filter((r) => r.includes("Driver →")).length,
      0
    );

    warnings.push(
      `Parsed ${totalCars} cars across ${maxLap} laps with ${fcy.length} caution periods, ${totalPenalties} penalties, ${totalPitStops} pit stops, and ${totalDriverChanges} driver changes`
    );

    return {
      data: {
        maxLap,
        totalCars,
        greenPaceCutoff,
        cars,
        fcy,
        classGroups,
        classCarCounts,
      },
      annotations,
      warnings,
    };
  },
};

// ─── Helper functions ────────────────────────────────────────────────────────

function shortenPenalty(detail: string): string {
  const punishment = extractPunishment(detail);

  let desc = detail
    .replace(
      /\s*-\s*(Drive Through|Stop\s*\+?\s*\d*(?::\d+)?(?:\s*min)?\s*$)/i,
      ""
    )
    .trim();

  if (/pit lane speed/i.test(desc)) {
    const over = desc.match(/\(\+(\d+)\)/);
    desc = over ? `Pit Speed +${over[1]}` : "Pit Speed";
  } else if (/too many crew/i.test(desc)) {
    desc = "Crew Violation";
  } else if (/leaving with equipment/i.test(desc)) {
    desc = "Equipment Attached";
  } else if (/wheel rotation/i.test(desc)) {
    desc = "Wheel Rotation";
  } else if (/improper attire/i.test(desc)) {
    desc = "Attire Violation";
  } else if (/fire extinguisher/i.test(desc)) {
    desc = "Fire Ext. Violation";
  } else if (/incident responsibility/i.test(desc)) {
    const with_ = desc.match(/with\s+(.+)/i);
    desc = with_ ? `Incident w/${with_[1]}` : "Incident Resp.";
  } else if (/pass under yellow/i.test(desc)) {
    desc = "Pass Under Yellow";
  } else if (/jump re-?start/i.test(desc)) {
    desc = "Jump Restart";
  } else if (/not serving/i.test(desc)) {
    desc = "Penalty Not Served";
  } else if (/not respecting/i.test(desc)) {
    desc = "Black Flag Violation";
  } else if (/chassis change/i.test(desc)) {
    desc = "Chassis Change";
  } else if (/wrong way/i.test(desc)) {
    desc = "Wrong Way Pit Lane";
  } else if (/passaround/i.test(desc)) {
    desc = "Passaround Violation";
  } else if (/person.*over wall/i.test(desc)) {
    desc = "Over Wall Early";
  } else if (/hose|tool|part|person.*pit/i.test(desc)) {
    desc = "Hose/Equipment";
  } else if (/tire without/i.test(desc)) {
    desc = "Tire w/o Crew";
  } else if (/short ?cut/i.test(desc)) {
    desc = "Shortcut";
  } else if (/warming tires/i.test(desc)) {
    desc = "Tire Warming";
  } else if (/emergency service/i.test(desc)) {
    desc = "ESO Violation";
  } else if (desc.length > 30) {
    desc = desc.substring(0, 28) + "…";
  }

  return punishment ? `${desc} - ${punishment}` : desc;
}

function extractPunishment(detail: string): string {
  if (/drive through/i.test(detail)) return "DT";
  const stop = detail.match(/Stop\s*\+?\s*(\d+(?::\d+)?(?:\s*min)?)/i);
  if (stop) return `Stop+${stop[1]}`;
  return "";
}

function shortenIncident(msg: string): string {
  if (/off course/i.test(msg)) {
    const turn = msg.match(/turn\s+(\S+)/i);
    return turn ? `Off T${turn[1]}` : "Off Course";
  }
  if (/stopped on course/i.test(msg)) {
    const turn = msg.match(/turn\s+(\S+)/i);
    return turn ? `Stopped T${turn[1]}` : "Stopped";
  }
  if (/spun/i.test(msg)) {
    const turn = msg.match(/turn\s+(\S+)/i);
    return turn ? `Spun T${turn[1]}` : "Spun";
  }
  if (/incident involving/i.test(msg)) {
    if (/no action/i.test(msg)) return "Incident - No Action";
    if (/under review/i.test(msg)) return "Under Review";
    return "Incident";
  }
  if (/continued/i.test(msg)) return "Continued";
  return msg.length > 25 ? msg.substring(0, 23) + "…" : msg;
}
