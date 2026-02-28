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
import { generateAnnotations } from "./position-analysis.js";
import { extractBase64, extractPdfText } from "../pdf-extract.js";
import { parseDelimitedCSV, mapHeaders, col } from "./csv-utils.js";

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

// ─── Parser ──────────────────────────────────────────────────────────────────

export const imsaParser: RaceDataParser = {
  id: "imsa",
  name: "IMSA Timing & Scoring",
  series: "IMSA",
  description:
    "Import from IMSA JSON timing exports. Requires Time Cards JSON; optionally accepts Flags Analysis as JSON (with RC messages) or PDF (flag periods only). If no flags file, caution periods are detected from lap times.",
  fileSlots: [
    {
      key: "lapChartJson",
      label: "Lap Chart JSON",
      description:
        "IMSA Lap Chart export (e.g. 12_Lap_Chart_Race.json) — positions per lap, participants, session metadata.",
      required: true,
      accept: ".json",
    },
    {
      key: "flagsJson",
      label: "Flags / Flag Analysis (optional)",
      description:
        "IMSA Flags Analysis — JSON with RC messages (2024 and earlier) or PDF flag analysis (2025+). Optional: caution periods will be detected from lap times if omitted.",
      required: false,
      accept: ".json,.pdf",
    },
    {
      key: "pitStopJson",
      label: "Pit Stops / Time Cards (optional)",
      description:
        "IMSA Pit Stop export (e.g. 20_Pit_Stops_Time_Cards_Race.json) — exact pit in/out times, driver changes, manufacturer data.",
      required: false,
      accept: ".json",
    },
    {
      key: "timeCardsCsv",
      label: "Time Cards CSV (optional)",
      description:
        "IMSA Time Cards CSV export (e.g. 23_Time_Cards_Race.csv) — per-lap timing with flag status, driver names, pit times. Enriches lap data with FLAG_AT_FL.",
      required: false,
      accept: ".csv",
    },
  ],

  async parse(files) {
    const { lapChartJson, flagsJson, pitStopJson, timeCardsCsv } = files;
    const mainJson = lapChartJson;
    if (!mainJson && !timeCardsCsv) throw new Error("Missing Lap Chart JSON or Time Cards CSV file");
    const flagsInput = flagsJson || null;

    const warnings: string[] = [];

    // ── Parse Lap Chart / Time Cards JSON (required unless CSV provides lap data) ─
    let timeCards: IMSATimeCardsData | null = null;

    if (mainJson && mainJson.trim().length > 0) {
      try {
        timeCards = JSON.parse(mainJson.replace(/^\uFEFF/, ""));
      } catch (e: any) {
        warnings.push(`Could not parse Lap Chart JSON: ${e.message}. Will use CSV data if available.`);
      }
    }

    if (!timeCards?.participants?.length && !timeCardsCsv) {
      throw new Error("Lap Chart JSON has no participants and no Time Cards CSV provided");
    }

    // ── Process flags data (JSON, PDF, or absent) ─────────────────────
    //
    // Three paths:
    //   1. JSON with RC messages (2024 and earlier) → full flag events + penalties/incidents
    //   2. PDF flag analysis (2025+) → FCY periods only, no RC messages
    //   3. No flags file → derive FCY from lap time analysis

    let flagsData: IMSAFlagsData | null = null;
    let pdfFcyPeriods: Array<{ startLap: number; endLap: number }> | null = null;

    if (flagsInput) {
      const b64 = extractBase64(flagsInput);
      if (b64) {
        // ── PDF path ──────────────────────────────────────────
        try {
          const pdfText = await extractPdfText(flagsInput);
          pdfFcyPeriods = parsePdfFlagPeriods(pdfText);
          warnings.push(
            `Flags PDF: extracted ${pdfFcyPeriods.length} caution period(s). No RC messages available from PDF format.`
          );
        } catch (e: any) {
          warnings.push(`Could not parse Flags PDF: ${e.message}. FCY will be detected from lap times.`);
        }
      } else {
        // ── JSON path ─────────────────────────────────────────
        try {
          flagsData = JSON.parse(flagsInput.replace(/^\uFEFF/, ""));
        } catch (e: any) {
          warnings.push(`Could not parse Flags JSON: ${e.message}. FCY will be detected from lap times.`);
        }
      }
    } else {
      warnings.push("No flags file provided. Caution periods will be detected from lap times.");
    }

    // ── Build time→lap interpolation from flag events (JSON only) ─────
    const flagEvents: IMSAFlagEvent[] = flagsData
      ? (flagsData.flags || []).filter(
          (f) => f.rec_type === "GF" || f.rec_type === "FCY" || f.rec_type === "FF"
        )
      : [];

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

    // ── Parse pit stop JSON (optional) ──────────────────────────
    let pitStopMap: Map<number, any> | null = null;
    if (pitStopJson) {
      try {
        const cleanPit = pitStopJson.replace(/^\uFEFF/, "");
        const pitData = JSON.parse(cleanPit);
        if (pitData.pit_stop_analysis && Array.isArray(pitData.pit_stop_analysis)) {
          pitStopMap = new Map();
          for (const entry of pitData.pit_stop_analysis) {
            const num = parseInt(entry.number, 10);
            if (!isNaN(num)) pitStopMap.set(num, entry);
          }
          warnings.push(`Pit stop data loaded for ${pitStopMap.size} cars`);
        }
      } catch (e: any) {
        warnings.push(`Could not parse Pit Stop JSON: ${e.message}. Continuing without it.`);
      }
    }

    // ── Build FCY periods ─────────────────────────────────────────────
    // Priority: JSON flag events > PDF flag periods > (deferred to lap-time fallback)
    const fcy: Array<[number, number]> = [];

    if (flagEvents.length > 0) {
      // From JSON flag events
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
    } else if (pdfFcyPeriods && pdfFcyPeriods.length > 0) {
      // From PDF flag analysis
      for (const p of pdfFcyPeriods) {
        if (p.startLap > 0 && p.endLap >= p.startLap) {
          fcy.push([p.startLap, p.endLap]);
        }
      }
    }
    // else: fcy remains empty; will be filled by lap-time fallback after positions are computed

    const fcyLapSet = new Set<number>();
    for (const [start, end] of fcy) {
      for (let l = start; l <= end; l++) fcyLapSet.add(l);
    }

    // ── Parse RC messages for penalties and incidents (JSON only) ──────
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

    if (flagsData) {
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
      csvFlag?: string; // per-lap flag from CSV FLAG_AT_FL ("GF", "FCY", etc.)
    }

    const carLapsRaw = new Map<string, CarLapRaw[]>();

    // ── CSV-derived participant metadata (when Lap Chart JSON lacks roster) ──
    // Maps carNum → { class, team, manufacturer, driverName }
    const csvParticipants = new Map<string, {
      cls: string;
      team: string;
      manufacturer: string;
      driverNames: Set<string>;
    }>();

    // ── Time Cards CSV path: build carLapsRaw from CSV data ─────────────
    let hasCsvLaps = false;
    if (timeCardsCsv) {
      try {
        const csvRows = parseDelimitedCSV(timeCardsCsv);
        if (csvRows.length < 2) throw new Error("CSV has no data rows");
        const hdr = mapHeaders(csvRows[0]);

        // Verify required columns exist
        const required = ["number", "lap_number", "lap_time", "elapsed"];
        for (const h of required) {
          if (!hdr.has(h)) throw new Error(`Missing required CSV column: ${h.toUpperCase()}`);
        }

        for (let i = 1; i < csvRows.length; i++) {
          const row = csvRows[i];
          const carNum = col(row, hdr, "number");
          const lapNum = parseInt(col(row, hdr, "lap_number"), 10);
          if (!carNum || isNaN(lapNum) || lapNum < 1) continue;
          if (lapNum > maxLap) maxLap = lapNum;

          const lapTimeStr = col(row, hdr, "lap_time");
          const elapsedStr = col(row, hdr, "elapsed");
          const pitField = col(row, hdr, "crossing_finish_line_in_pit");
          const isPit = pitField === "1" || pitField.toUpperCase() === "B" || /true|yes|pit/i.test(pitField);
          const kph = col(row, hdr, "kph");
          const topSpeed = col(row, hdr, "top_speed");
          const driverNum = col(row, hdr, "driver_number");
          const driverName = col(row, hdr, "driver_name");
          const flagAtFl = col(row, hdr, "flag_at_fl").toUpperCase();
          const hour = col(row, hdr, "hour");
          const cls = col(row, hdr, "class");
          const team = col(row, hdr, "team");
          const manufacturer = col(row, hdr, "manufacturer");

          if (!carLapsRaw.has(carNum)) carLapsRaw.set(carNum, []);
          carLapsRaw.get(carNum)!.push({
            num: carNum,
            lapNum,
            elapsedSec: parseElapsed(elapsedStr),
            lapTimeSec: parseLapTimeStr(lapTimeStr),
            lapTimeStr,
            pit: isPit,
            speedMph: kphToMph(topSpeed || kph || "0"),
            driverNum: driverNum || "1",
            hour,
            csvFlag: flagAtFl || undefined,
          });

          // Collect participant metadata from CSV rows
          if (!csvParticipants.has(carNum)) {
            csvParticipants.set(carNum, {
              cls: cls || "Unknown",
              team: team || `Car #${carNum}`,
              manufacturer: manufacturer || "",
              driverNames: new Set(),
            });
          }
          if (driverName) csvParticipants.get(carNum)!.driverNames.add(driverName);
          // Update class/team if a later row has them and previous didn't
          const cp = csvParticipants.get(carNum)!;
          if (cls && cp.cls === "Unknown") cp.cls = cls;
          if (team && cp.team === `Car #${carNum}`) cp.team = team;
          if (manufacturer && !cp.manufacturer) cp.manufacturer = manufacturer;
        }

        hasCsvLaps = carLapsRaw.size > 0;
        if (hasCsvLaps) {
          warnings.push(`Time Cards CSV: loaded ${carLapsRaw.size} cars with per-lap flag data`);
        }
      } catch (e: any) {
        warnings.push(`Could not parse Time Cards CSV: ${e.message}. Falling back to JSON data.`);
      }
    }

    // ── JSON path: build carLapsRaw from JSON participants (if CSV didn't provide laps)
    if (!hasCsvLaps && timeCards?.participants) {
      for (const p of timeCards.participants) {
        const carNum = p.number;
        const laps: CarLapRaw[] = [];

        if (!Array.isArray(p.laps)) continue;
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

    // ── Lap-time FCY fallback (when no flags file or PDF) ─────────────
    // Detect caution periods by looking for laps where the field bunches up:
    // median lap time is significantly slower than green-flag pace and
    // lap time variance is low (everyone going the same slow speed).
    if (fcy.length === 0 && maxLap > 5) {
      // Collect all lap times per lap number (excluding pit laps)
      const lapTimesPerLap = new Map<number, number[]>();
      for (const [, rawLaps] of carLapsRaw) {
        for (const rl of rawLaps) {
          if (rl.pit || rl.lapTimeSec <= 0) continue;
          let arr = lapTimesPerLap.get(rl.lapNum);
          if (!arr) { arr = []; lapTimesPerLap.set(rl.lapNum, arr); }
          arr.push(rl.lapTimeSec);
        }
      }

      // Compute median of all non-pit lap times as baseline green pace
      const allTimes: number[] = [];
      for (const [, times] of lapTimesPerLap) {
        allTimes.push(...times);
      }
      allTimes.sort((a, b) => a - b);
      const greenMedian = allTimes.length > 0
        ? allTimes[Math.floor(allTimes.length * 0.25)] // 25th percentile = fast green pace
        : 120;

      // A lap is FCY-candidate if its median time is >130% of green pace
      // AND it has enough cars to be meaningful
      const fcyCandidates = new Set<number>();
      for (let lap = 1; lap <= maxLap; lap++) {
        const times = lapTimesPerLap.get(lap);
        if (!times || times.length < 3) continue;
        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)];
        if (median > greenMedian * 1.3) {
          fcyCandidates.add(lap);
        }
      }

      // Merge consecutive FCY candidate laps into periods
      let fcyStart: number | null = null;
      for (let lap = 1; lap <= maxLap; lap++) {
        if (fcyCandidates.has(lap)) {
          if (fcyStart === null) fcyStart = lap;
        } else if (fcyStart !== null) {
          fcy.push([fcyStart, lap - 1]);
          fcyStart = null;
        }
      }
      if (fcyStart !== null) fcy.push([fcyStart, maxLap]);

      // Rebuild fcyLapSet
      fcyLapSet.clear();
      for (const [start, end] of fcy) {
        for (let l = start; l <= end; l++) fcyLapSet.add(l);
      }

      if (fcy.length > 0) {
        warnings.push(`Detected ${fcy.length} caution period(s) from lap time analysis (no flags file).`);
      }
    }

    // ── Build FCY periods from CSV flag data (when CSV provides per-lap flags) ──
    if (hasCsvLaps && fcy.length === 0) {
      // Use FLAG_AT_FL from CSV to build precise FCY periods
      const fcyLapsFromCsv = new Set<number>();
      for (const [, laps] of carLapsRaw) {
        for (const rl of laps) {
          if (rl.csvFlag === "FCY" || rl.csvFlag === "YELLOW") {
            fcyLapsFromCsv.add(rl.lapNum);
          }
        }
      }

      // Merge consecutive FCY laps into periods
      const sortedFcyLaps = Array.from(fcyLapsFromCsv).sort((a, b) => a - b);
      let fcyStart: number | null = null;
      for (const lap of sortedFcyLaps) {
        if (fcyStart === null) {
          fcyStart = lap;
        } else if (lap > sortedFcyLaps[sortedFcyLaps.indexOf(lap) - 1] + 1) {
          fcy.push([fcyStart, sortedFcyLaps[sortedFcyLaps.indexOf(lap) - 1]]);
          fcyStart = lap;
        }
      }
      if (fcyStart !== null) {
        fcy.push([fcyStart, sortedFcyLaps[sortedFcyLaps.length - 1]]);
      }

      // Rebuild fcyLapSet
      fcyLapSet.clear();
      for (const [start, end] of fcy) {
        for (let l = start; l <= end; l++) fcyLapSet.add(l);
      }

      if (fcy.length > 0) {
        warnings.push(`Detected ${fcy.length} caution period(s) from CSV FLAG_AT_FL data.`);
      }
    }

    // ── Build car data ─────────────────────────────────────────────
    const participantMap = new Map<string, IMSAParticipant>();
    if (timeCards?.participants) {
      for (const p of timeCards.participants) {
        participantMap.set(p.number, p);
      }
    }

    // Final positions from last lap
    const finalPosMap = lapPositions.get(maxLap) || new Map();

    // For cars that didn't finish on the last lap, use their last completed lap's position
    // plus offset them behind all finishers
    const finisherCount = finalPosMap.size;

    const cars: RaceDataJson["cars"] = {};
    const classGroups: Record<string, number[]> = {};
    const classCarCounts: Record<string, number> = {};
    const makeGroups: Record<string, number[]> = {};
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
      const csvMeta = csvParticipants.get(carNum);

      // Need at least one source of participant info (JSON roster, CSV metadata, or pit stop data)
      if (!participant && !csvMeta) {
        warnings.push(`Car #${carNum} has laps but no participant entry`);
        continue;
      }

      const num = parseInt(carNum, 10);
      if (isNaN(num)) continue;

      const cls = participant?.class || csvMeta?.cls || "Unknown";
      const pitEntry = pitStopMap?.get(num);
      const make = pitEntry?.manufacturer || participant?.manufacturer || csvMeta?.manufacturer || "";
      const vehicle = pitEntry?.vehicle || participant?.vehicle || "";

      let team: string;
      if (participant) {
        const driverSurnames = participant.drivers
          .map((d) => d.surname)
          .filter(Boolean)
          .join(" / ");
        team = driverSurnames
          ? `${participant.team || `Car #${carNum}`} (${driverSurnames})`
          : participant.team || `Car #${carNum}`;
      } else if (csvMeta) {
        const driverList = Array.from(csvMeta.driverNames).join(" / ");
        team = driverList
          ? `${csvMeta.team} (${driverList})`
          : csvMeta.team;
      } else {
        team = `Car #${carNum}`;
      }
      const finishPos = overallFinishPos.get(carNum) || 999;

      // Build laps array with positions
      const lapEntries = rawLaps.map((rl) => {
        const posMap = lapPositions.get(rl.lapNum);
        const p = posMap?.get(carNum) || 999;

        // Per-lap flag: prefer CSV FLAG_AT_FL, fall back to fcyLapSet
        let flag: string;
        if (rl.csvFlag) {
          // GF = green flag, FCY/YELLOW = full course yellow, FF = checkered (green)
          flag = rl.csvFlag === "FCY" || rl.csvFlag === "YELLOW" ? "FCY" : "GREEN";
        } else {
          flag = fcyLapSet.has(rl.lapNum) ? "FCY" : "GREEN";
        }

        return {
          l: rl.lapNum,
          p,
          cp: 0, // computed below
          lt: rl.lapTimeStr,
          ltSec: rl.lapTimeSec > 0 ? rl.lapTimeSec : 0.001,
          flag,
          pit: (rl.pit ? 1 : 0) as 0 | 1,
          spd: rl.speedMph,
        };
      });

      cars[String(num)] = {
        num,
        team,
        cls,
        ...(make ? { make } : {}),
        ...(vehicle ? { vehicle } : {}),
        finishPos,
        finishPosClass: 0, // computed below
        laps: lapEntries,
      };

      if (!classGroups[cls]) classGroups[cls] = [];
      classGroups[cls].push(num);
      classCarCounts[cls] = (classCarCounts[cls] || 0) + 1;

      if (make) {
        if (!makeGroups[make]) makeGroups[make] = [];
        makeGroups[make].push(num);
      }

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
      const stintLapRanges: Array<{ stint: number; start: number; end: number }> = [];
      let stintStartLap = rawLaps[0]?.lapNum || 1;

      // Figure out starting driver name
      const startingDriverNum = rawLaps.length > 0 ? rawLaps[0].driverNum : "1";
      const getDriverLabel = (drvNum: string): string => {
        if (participant) {
          const driver = participant.drivers.find(
            (d) => String(d.number) === drvNum
          );
          if (driver) return driver.surname;
        }
        return `D${drvNum}`;
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

          stintLapRanges.push({ stint: stintNum, start: stintStartLap, end: rl.lapNum });
          stintStartLap = rl.lapNum + 1;
          stintNum++;
        }
      }

      // Close final stint range
      stintLapRanges.push({ stint: stintNum, start: stintStartLap, end: maxLap });

      // Penalty and incident annotations from RC messages
      const PENALTY_COLOR = "#f87171"; // red
      const events = carEvents.get(carNum) || [];
      let penaltyYOffset = 0; // stagger multiple penalty labels
      const dtPenaltyLaps: number[] = []; // Track DT penalties for "DT Served" detection
      for (const ev of events) {
        if (ev.lap < 1 || ev.lap > maxLap) continue;
        const lapKey = String(ev.lap);

        if (ev.type === "penalty") {
          const shortPenalty = shortenPenalty(ev.message);
          const existing = reasons[lapKey];
          reasons[lapKey] = existing
            ? `${existing}; ${shortPenalty}`
            : shortPenalty;

          // Add visual penalty marker (vertical red line on chart)
          const punishment = extractPunishment(ev.message);
          const penaltyLabel = punishment || shortPenalty;

          // Prefix with stint number for context
          const stintRange = stintLapRanges.find(r => ev.lap >= r.start && ev.lap <= r.end);
          const stintPrefix = stintRange ? `S${stintRange.stint} ` : "";

          pits.push({
            l: ev.lap,
            lb: `${stintPrefix}${penaltyLabel}`,
            c: PENALTY_COLOR,
            yo: penaltyYOffset,
            da: 0,
          });
          penaltyYOffset += 12; // stagger if multiple penalties on nearby laps

          // Track DT penalties for served detection
          if (/^DT$/i.test(punishment)) {
            dtPenaltyLaps.push(ev.lap);
          }
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

      // Add "DT Served" markers: find the next pit stop after each DT penalty
      for (const dtLap of dtPenaltyLaps) {
        const nextPit = rawLaps.find(rl => rl.lapNum > dtLap && rl.pit);
        if (nextPit) {
          const stintRange = stintLapRanges.find(r => nextPit.lapNum >= r.start && nextPit.lapNum <= r.end);
          const stintPrefix = stintRange ? `S${stintRange.stint} ` : "";
          pits.push({
            l: nextPit.lapNum,
            lb: `${stintPrefix}DT Served`,
            c: PENALTY_COLOR,
            yo: penaltyYOffset,
            da: 0,
          });
          penaltyYOffset += 12;

          const lapKey = String(nextPit.lapNum);
          const existingReason = reasons[lapKey];
          reasons[lapKey] = existingReason ? `${existingReason}; DT Served` : "DT Served";
        }
      }

      // When pit stop data is available, generate settles from actual pit events
      // to avoid duplicates and ensure accurate position tracking
      if (pitEntry && pitEntry.pit_stops.length > 0) {
        const carLaps = cars[String(num)]?.laps || [];
        for (const ps of pitEntry.pit_stops) {
          // Find the lap where this pit stop occurred using wall-clock time
          const pitInLap = timeToLap(ps.in_time);
          if (pitInLap <= 0) continue;

          // Pre-pit position
          const prePitLapData = carLaps.find(ld => ld.l === pitInLap - 1) || carLaps.find(ld => ld.l === pitInLap);
          if (!prePitLapData) continue;
          const prePitPos = prePitLapData.p;

          // Find settled position: first non-pit, non-FCY lap after pit
          const pitOutLap = timeToLap(ps.out_time);
          let settledPos: number | null = null;
          let settledLap = 0;

          for (let scanLap = Math.max(pitOutLap, pitInLap + 1); scanLap <= Math.min(pitInLap + 8, maxLap); scanLap++) {
            const ld = carLaps.find(l => l.l === scanLap);
            if (ld && ld.pit === 0 && !fcyLapSet.has(scanLap)) {
              settledPos = ld.p;
              settledLap = scanLap;
              break;
            }
          }
          // Fallback: any non-pit lap
          if (settledPos === null) {
            for (let scanLap = pitInLap + 1; scanLap <= Math.min(pitInLap + 12, maxLap); scanLap++) {
              const ld = carLaps.find(l => l.l === scanLap);
              if (ld && ld.pit === 0) {
                settledPos = ld.p;
                settledLap = scanLap;
                break;
              }
            }
          }
          if (settledPos === null) continue;

          const net = prePitPos - settledPos;
          let su: string;
          let color: string;
          if (net > 0) {
            su = `Was P${prePitPos} · Gained ${net}`;
            color = "#4ade80";
          } else if (net < 0) {
            su = `Was P${prePitPos} · Lost ${Math.abs(net)}`;
            color = "#f87171";
          } else {
            su = `Was P${prePitPos} · Held`;
            color = "#888";
          }

          settles.push({
            l: settledLap,
            p: settledPos,
            lb: `Settled P${settledPos}`,
            su,
            c: color,
          });
        }
      }
      // When no pit stop data, settles are generated by position-analysis.ts
      // with correct conditional colors (green for gains, red for losses, gray for holds)

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

    const raceData: RaceDataJson = {
      maxLap,
      totalCars,
      greenPaceCutoff,
      cars,
      fcy,
      classGroups,
      classCarCounts,
      ...(Object.keys(makeGroups).length > 0 ? { makeGroups } : {}),
    };

    // Merge position-change analysis with IMSA-specific annotations
    // (driver changes, RC messages, penalties, pit labels)
    const mergedAnnotations = generateAnnotations(raceData, annotations);

    return {
      data: raceData,
      annotations: mergedAnnotations,
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

// ─── PDF Flag Analysis Parser ────────────────────────────────────────────────

/**
 * Extract FCY (full-course yellow / caution) periods from IMSA Flag Analysis PDF text.
 *
 * Handles multiple PDF table formats:
 *   - Tabular with columns: Flag, Start Lap, End Lap (or Laps range)
 *   - Line-based: "YELLOW  Lap 16 to Lap 21"
 *   - Compact: "FCY  16-21" or "Caution  L16–L21"
 *   - Row-based with duration: "2  YELLOW  16  21  5:33.456"
 *
 * Returns an array of { startLap, endLap } for each yellow/caution period.
 */
function parsePdfFlagPeriods(
  pdfText: string
): Array<{ startLap: number; endLap: number }> {
  const results: Array<{ startLap: number; endLap: number }> = [];
  const lines = pdfText.split(/\n/).map((l) => l.trim()).filter(Boolean);

  // ── Strategy A: Pair YELLOW→GREEN lines (2025 IMSA format) ──────
  // Real format:
  //   FULL COURSE YELLOW  12:36:24.441  36:55.129  15:33.967  16:32.711  25
  //   GREEN FLAG          12:51:58.408  52:29.096  57.702     36:54.087  32
  // The last number on each line is the lap number.
  // FCY period = yellow start lap → green restart lap.

  let pendingYellowLap: number | null = null;

  for (const line of lines) {
    // Extract the last standalone number on the line (the lap column)
    const lastNumMatch = line.match(/\b(\d{1,3})\s*$/);
    if (!lastNumMatch) continue;
    const lapNum = parseInt(lastNumMatch[1], 10);
    if (lapNum < 1 || lapNum > 500) continue;

    const upper = line.toUpperCase();

    // Skip penalty/incident lines
    if (/PASS\s+UNDER\s+YELLOW/i.test(line)) continue;

    if (
      upper.includes("FULL COURSE YELLOW") ||
      upper.includes("FULL COURSE CAUTION") ||
      (/\bYELLOW\b/.test(upper) && !upper.includes("GREEN") && !/PASS|PENALTY/.test(upper)) ||
      /\bFCY\b/.test(upper)
    ) {
      // If we already have a pending yellow without a green, treat it as a 1-lap caution
      if (pendingYellowLap !== null) {
        results.push({ startLap: pendingYellowLap, endLap: pendingYellowLap });
      }
      pendingYellowLap = lapNum;
    } else if (upper.includes("GREEN") && pendingYellowLap !== null) {
      results.push({ startLap: pendingYellowLap, endLap: lapNum });
      pendingYellowLap = null;
    }
  }
  // Close any trailing yellow without a green
  if (pendingYellowLap !== null) {
    results.push({ startLap: pendingYellowLap, endLap: pendingYellowLap });
  }

  // ── Strategy B fallback: explicit "Lap X to Lap Y" patterns ─────
  // Only used if Strategy A found nothing (older PDF formats)
  if (results.length === 0) {
    for (const line of lines) {
      if (!/yellow|caution|fcy/i.test(line)) continue;
      if (/pass\s+under\s+yellow/i.test(line)) continue;

      // "YELLOW Lap 16 to Lap 21" or "FCY Lap 16 – Lap 21"
      const lapToLap = line.match(
        /(?:yellow|caution|fcy)\s+.*?lap\s*(\d+)\s*(?:to|[-–—])\s*lap\s*(\d+)/i
      );
      if (lapToLap) {
        results.push({
          startLap: parseInt(lapToLap[1], 10),
          endLap: parseInt(lapToLap[2], 10),
        });
        continue;
      }

      // Compact "FCY 16-21" or "YELLOW L16–L21"
      const compact = line.match(
        /(?:yellow|caution|fcy)\s+L?(\d+)\s*[-–—]\s*L?(\d+)/i
      );
      if (compact) {
        results.push({
          startLap: parseInt(compact[1], 10),
          endLap: parseInt(compact[2], 10),
        });
        continue;
      }
    }
  }

  // Deduplicate and sort
  const seen = new Set<string>();
  const unique: Array<{ startLap: number; endLap: number }> = [];
  for (const r of results) {
    const key = `${r.startLap}-${r.endLap}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  unique.sort((a, b) => a.startLap - b.startLap);

  return unique;
}
