/**
 * IMSA timing & scoring JSON parser
 *
 * Used by: IMSA WeatherTech, IMSA Michelin Pilot Challenge, IMSA VP Racing SportsCar Challenge
 *
 * Expects two JSON files from IMSA timing exports:
 *   1. Lap Chart JSON (12_Lap_Chart_Race.json): session, participants, laps (position per lap)
 *   2. Flags/RC Messages JSON (25_FlagsAnalysisWithRCMessages_Race.json): session, flags
 *
 * The lap chart provides position data per lap. The flags file provides:
 *   - Flag transitions (GREEN, FCY, CHEQUERED) with lap numbers
 *   - Race Control messages with timestamps: penalties, incidents, pit events
 *
 * Since RC messages have timestamps but lap=0, we interpolate laps from flag events.
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

interface IMSAParticipant {
  number: string;
  grid_position: number;
  team: string;
  class: string;
  vehicle: string;
  manufacturer: string;
  drivers: IMSADriver[];
  [key: string]: any;
}

interface IMSALapPosition {
  position: number;
  number: string;
}

interface IMSALap {
  lap_number: number;
  positions: IMSALapPosition[];
}

interface IMSALapChartData {
  session: IMSASession;
  participants: IMSAParticipant[];
  laps: IMSALap[];
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

function parseTimeToSeconds(t: string): number {
  // Format: "HH:MM:SS.mmm"
  const parts = t.split(":");
  if (parts.length < 3) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const s = parseFloat(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

// ─── Annotation color palette ────────────────────────────────────────────────

const PIT_COLOR = "#fbbf24";    // yellow
const PENALTY_COLOR = "#f87171"; // red
const INCIDENT_COLOR = "#fb923c"; // orange
const SETTLE_COLOR = "#f87171";  // red

// ─── Parser ──────────────────────────────────────────────────────────────────

export const imsaParser: RaceDataParser = {
  id: "imsa",
  name: "IMSA Timing & Scoring",
  series: "IMSA",
  description:
    "Import from IMSA JSON timing exports (Lap Chart + Flags/RC Messages). Supports WeatherTech, Michelin Pilot Challenge, and VP Racing SportsCar Challenge.",
  fileSlots: [
    {
      key: "lapChartJson",
      label: "Lap Chart JSON",
      description:
        "IMSA Lap Chart export (e.g. 12_Lap_Chart_Race.json) with session info, participants, and lap positions.",
      required: true,
      accept: ".json",
    },
    {
      key: "flagsJson",
      label: "Flags & RC Messages JSON",
      description:
        "IMSA Flags Analysis export (e.g. 25_FlagsAnalysisWithRCMessages_Race.json) with flag changes, penalties, and race control messages.",
      required: true,
      accept: ".json",
    },
  ],

  parse(files) {
    const { lapChartJson, flagsJson } = files;
    if (!lapChartJson) throw new Error("Missing Lap Chart JSON file");
    if (!flagsJson) throw new Error("Missing Flags & RC Messages JSON file");

    const warnings: string[] = [];

    // ── Parse JSON files (handle BOM) ──────────────────────────────
    let lapChart: IMSALapChartData;
    let flagsData: IMSAFlagsData;

    try {
      const cleanLap = lapChartJson.replace(/^\uFEFF/, "");
      lapChart = JSON.parse(cleanLap);
    } catch (e: any) {
      throw new Error(`Failed to parse Lap Chart JSON: ${e.message}`);
    }

    try {
      const cleanFlags = flagsJson.replace(/^\uFEFF/, "");
      flagsData = JSON.parse(cleanFlags);
    } catch (e: any) {
      throw new Error(`Failed to parse Flags JSON: ${e.message}`);
    }

    if (!lapChart.participants?.length) throw new Error("Lap Chart has no participants");
    if (!lapChart.laps?.length) throw new Error("Lap Chart has no lap data");

    // ── Build participant map ──────────────────────────────────────
    const participantMap = new Map<string, IMSAParticipant>();
    for (const p of lapChart.participants) {
      participantMap.set(p.number, p);
    }

    // ── Build time→lap interpolation from flag events ──────────────
    const flagEvents = (flagsData.flags || []).filter(
      (f) => f.rec_type === "GF" || f.rec_type === "FCY" || f.rec_type === "FF"
    );

    // Anchor points: [{timeSec, lap}]
    const anchors: Array<{ timeSec: number; lap: number }> = [];
    for (const fe of flagEvents) {
      if (fe.lap > 0 && fe.time) {
        anchors.push({ timeSec: parseTimeToSeconds(fe.time), lap: fe.lap });
      }
    }
    anchors.sort((a, b) => a.timeSec - b.timeSec);

    function timeToLap(timeStr: string): number {
      if (!timeStr || anchors.length === 0) return 0;
      const t = parseTimeToSeconds(timeStr);
      if (t <= anchors[0].timeSec) return anchors[0].lap;
      if (t >= anchors[anchors.length - 1].timeSec) return anchors[anchors.length - 1].lap;

      // Linear interpolation between closest anchors
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
      } else if ((fe.rec_type === "GF" || fe.rec_type === "FF") && fcyStartLap !== null) {
        // Green or finish ends the caution — caution runs through the lap BEFORE restart
        fcy.push([fcyStartLap, Math.max(fcyStartLap, fe.lap - 1)]);
        fcyStartLap = null;
      }
    }
    if (fcyStartLap !== null) {
      fcy.push([fcyStartLap, lapChart.laps[lapChart.laps.length - 1].lap_number]);
    }

    // Build a set of FCY laps for quick lookup
    const fcyLapSet = new Set<number>();
    for (const [start, end] of fcy) {
      for (let l = start; l <= end; l++) fcyLapSet.add(l);
    }

    // ── Parse RC messages into per-car events ──────────────────────
    interface CarEvent {
      lap: number;
      type: "penalty" | "pit_enter" | "incident" | "off_course" | "stopped" | "other";
      message: string;
      time: string;
    }

    const carEvents = new Map<string, CarEvent[]>();
    const globalEvents: CarEvent[] = []; // events not tied to a specific car

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
        const carNum = penaltyMatch[1];
        const detail = penaltyMatch[2];
        addCarEvent(carNum, {
          lap: estimatedLap,
          type: "penalty",
          message: detail,
          time: rc.time,
        });
        continue;
      }

      // Multi-car penalty: "Car 26, 67, 24: Penalty - ..."
      const multiPenalty = msg.match(/^Cars?\s+([\d,\s&]+):\s*Penalty\s*-\s*(.+)/i);
      if (multiPenalty) {
        const nums = multiPenalty[1].match(/\d+/g) || [];
        const detail = multiPenalty[2];
        for (const n of nums) {
          addCarEvent(n, {
            lap: estimatedLap,
            type: "penalty",
            message: detail,
            time: rc.time,
          });
        }
        continue;
      }

      // "CAR NN ENTERED PIT LANE" or "CAR NN ENTERED CLOSED PIT"
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

      // "CAR NN OFF COURSE..." or "CAR NN STOPPED ON COURSE..."
      const offMatch = msg.match(/^CAR\s+(\d+)\*?\s+(OFF COURSE|STOPPED ON COURSE)/i);
      if (offMatch) {
        addCarEvent(offMatch[1], {
          lap: estimatedLap,
          type: offMatch[2].toUpperCase().startsWith("OFF") ? "off_course" : "stopped",
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

      // Anything else with a car number
      const genericCar = msg.match(/^CAR\s+(\d+)/i);
      if (genericCar) {
        addCarEvent(genericCar[1], {
          lap: estimatedLap,
          type: "other",
          message: msg,
          time: rc.time,
        });
        continue;
      }

      // Global events (PITS OPEN, etc.)
      globalEvents.push({
        lap: estimatedLap,
        type: "other",
        message: msg,
        time: rc.time,
      });
    }

    // ── Process laps: build position data per car ──────────────────
    const maxLap = lapChart.laps[lapChart.laps.length - 1].lap_number;

    // Track positions per car per lap
    const carPositions = new Map<string, Map<number, number>>(); // carNum → (lap → position)
    const allCarNums = new Set<string>();

    for (const lapEntry of lapChart.laps) {
      for (const pos of lapEntry.positions) {
        allCarNums.add(pos.number);
        if (!carPositions.has(pos.number)) carPositions.set(pos.number, new Map());
        carPositions.get(pos.number)!.set(lapEntry.lap_number, pos.position);
      }
    }

    // ── Detect pit stops from position drops ───────────────────────
    // A car dropping 5+ positions in a single lap during/near a FCY is likely pitting
    const PIT_DROP_THRESHOLD = 5;

    for (const [carNum, posMap] of carPositions) {
      const laps = Array.from(posMap.keys()).sort((a, b) => a - b);
      for (let i = 1; i < laps.length; i++) {
        const prevPos = posMap.get(laps[i - 1])!;
        const currPos = posMap.get(laps[i])!;
        const drop = currPos - prevPos;

        if (drop >= PIT_DROP_THRESHOLD) {
          // Check if there's already a pit_enter event near this lap
          const events = carEvents.get(carNum) || [];
          const hasPitEvent = events.some(
            (e) => e.type === "pit_enter" && Math.abs(e.lap - laps[i]) <= 2
          );

          if (!hasPitEvent) {
            addCarEvent(carNum, {
              lap: laps[i],
              type: "pit_enter",
              message: `Position drop P${prevPos}→P${currPos} (inferred pit)`,
              time: "",
            });
          }
        }
      }
    }

    // ── Build car data and annotations ─────────────────────────────
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

    // Final positions from last lap
    const finalLap = lapChart.laps[lapChart.laps.length - 1];
    const finalPositions = new Map<string, number>();
    for (const p of finalLap.positions) {
      finalPositions.set(p.number, p.position);
    }

    for (const carNum of allCarNums) {
      const participant = participantMap.get(carNum);
      if (!participant) {
        warnings.push(`Car #${carNum} found in laps but not in participants`);
        continue;
      }

      const num = parseInt(carNum, 10);
      if (isNaN(num)) continue;

      const cls = participant.class || "Unknown";
      const team = participant.team || `Car #${carNum}`;
      const posMap = carPositions.get(carNum) || new Map();
      const finishPos = finalPositions.get(carNum) || 999;

      // Build laps array
      const lapEntries = Array.from(posMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([lapNum, pos]) => ({
          l: lapNum,
          p: pos,
          cp: 0, // computed below
          lt: "",
          ltSec: 0,
          flag: fcyLapSet.has(lapNum) ? "FCY" : ("GREEN" as string),
          pit: 0 as 0 | 1,
          spd: 0,
        }));

      if (lapEntries.length === 0) continue;

      // Mark pit laps from events
      const events = carEvents.get(carNum) || [];
      const pitLaps = new Set<number>();
      for (const ev of events) {
        if (ev.type === "pit_enter" && ev.lap > 0) {
          pitLaps.add(ev.lap);
          // Also mark adjacent laps (in/out)
          pitLaps.add(ev.lap + 1);
        }
      }

      for (const le of lapEntries) {
        if (pitLaps.has(le.l)) le.pit = 1;
      }

      // Compute finish position in class
      // (will be recomputed globally below, just set a placeholder)
      const finishPosClass = 0;

      cars[String(num)] = {
        num,
        team,
        cls,
        finishPos,
        finishPosClass,
        laps: lapEntries,
      };

      if (!classGroups[cls]) classGroups[cls] = [];
      classGroups[cls].push(num);
      classCarCounts[cls] = (classCarCounts[cls] || 0) + 1;

      // ── Build annotations for this car ───────────────────────────
      const reasons: Record<string, string> = {};
      const pits: Array<{ l: number; lb: string; c: string; yo: number; da: number }> = [];
      const settles: Array<{ l: number; p: number; lb: string; su: string; c: string }> = [];

      // Track stint number
      let stintNum = 1;

      // Sort events by estimated lap
      const sortedEvents = [...events].sort((a, b) => a.lap - b.lap);

      for (const ev of sortedEvents) {
        if (ev.lap < 1 || ev.lap > maxLap) continue;
        const lapKey = String(ev.lap);

        if (ev.type === "penalty") {
          // Shorten penalty description for the label
          const shortPenalty = shortenPenalty(ev.message);
          const existing = reasons[lapKey];
          reasons[lapKey] = existing ? `${existing}; ${shortPenalty}` : shortPenalty;
        } else if (ev.type === "pit_enter") {
          const pos = posMap.get(ev.lap) || 0;
          const prevPos = posMap.get(ev.lap - 1) || pos;
          const delta = pos - prevPos;

          pits.push({
            l: ev.lap,
            lb: `S${stintNum} Pit`,
            c: PIT_COLOR,
            yo: 0,
            da: delta,
          });
          stintNum++;

          if (!reasons[lapKey]) {
            reasons[lapKey] = `Pit stop`;
          }
        } else if (ev.type === "incident" || ev.type === "off_course" || ev.type === "stopped") {
          const shortMsg = shortenIncident(ev.message);
          const existing = reasons[lapKey];
          reasons[lapKey] = existing ? `${existing}; ${shortMsg}` : shortMsg;
        }
      }

      // ── Detect settle events (big position changes after FCY) ────
      for (const [fcyStart, fcyEnd] of fcy) {
        // Look at position just before caution vs. position after restart
        const prePos = posMap.get(fcyStart - 1) || posMap.get(fcyStart);
        const postPos = posMap.get(fcyEnd + 1) || posMap.get(fcyEnd);

        if (prePos && postPos) {
          const delta = postPos - prePos;
          if (Math.abs(delta) >= 3) {
            const settleLap = fcyEnd + 1;
            if (settleLap <= maxLap) {
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
      }

      annotations[String(num)] = { reasons, pits, settles };
    }

    // ── Compute class positions per lap ────────────────────────────
    for (let lap = 1; lap <= maxLap; lap++) {
      const classLapEntries = new Map<string, Array<{ num: number; pos: number }>>();

      for (const [numStr, car] of Object.entries(cars)) {
        const lapData = car.laps.find((l: any) => l.l === lap);
        if (!lapData) continue;

        if (!classLapEntries.has(car.cls)) classLapEntries.set(car.cls, []);
        classLapEntries.get(car.cls)!.push({ num: car.num, pos: (lapData as any).p });
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
    for (const [cls, nums] of Object.entries(classGroups)) {
      const sorted = nums.slice().sort(
        (a, b) => (cars[String(a)].finishPos) - (cars[String(b)].finishPos)
      );
      for (let i = 0; i < sorted.length; i++) {
        cars[String(sorted[i])].finishPosClass = i + 1;
      }
    }

    // ── Green pace cutoff (estimate from position stability) ───────
    // Since we don't have actual lap times, use a generous default
    const greenPaceCutoff = 300;

    const totalCars = Object.keys(cars).length;
    if (totalCars === 0) throw new Error("No valid car data found in IMSA JSON files");

    // ── Summary info ───────────────────────────────────────────────
    const totalPenalties = Array.from(carEvents.values())
      .flat()
      .filter((e) => e.type === "penalty").length;
    const totalFCYPeriods = fcy.length;

    warnings.push(
      `Parsed ${totalCars} cars across ${maxLap} laps with ${totalFCYPeriods} caution periods and ${totalPenalties} penalties`
    );

    if (!anchors.length) {
      warnings.push(
        "No flag event timestamps found — RC message lap mapping may be inaccurate"
      );
    }

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
  // "Pit Lane Speed Violation - (+1) Drive Through" → "Pit Speed +1 - DT"
  // "Too many crew over wall... - Drive Through" → "Crew Violation - DT"
  // "Leaving with equipment attached - Drive Through" → "Equipment - DT"

  const punishment = extractPunishment(detail);

  let desc = detail
    .replace(/\s*-\s*(Drive Through|Stop\s*\+?\s*\d*(?::\d+)?(?:\s*min)?\s*$)/i, "")
    .trim();

  // Shorten common penalty types
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
  const dt = detail.match(/Drive Through/i);
  if (dt) return "DT";

  const stop = detail.match(/Stop\s*\+?\s*(\d+(?::\d+)?(?:\s*min)?)/i);
  if (stop) return `Stop+${stop[1]}`;

  return "";
}

function shortenIncident(msg: string): string {
  // "CAR 5 OFF COURSE, TURN 4 CONT" → "Off T4"
  // "CAR 8 STOPPED ON COURSE, TURN 3" → "Stopped T3"
  // "INCIDENT INVOLVING CARS 2 & 22 UNDER REVIEW" → "Incident w/22"

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
    if (/under review/i.test(msg)) return "Incident Under Review";
    return "Incident";
  }
  if (/continued/i.test(msg)) return "Continued";

  return msg.length > 25 ? msg.substring(0, 23) + "…" : msg;
}
