/**
 * WRL Website CSV parser
 *
 * Used by: WRL (World Racing League) direct website exports.
 *
 * Expects two CSV files:
 *   1. Summary CSV: Overall_Position, Class_Position, Car_Number, Team_Name,
 *      Sponsor, Class, Laps_Completed, Total_Race_Time, Best_Lap_Time,
 *      Best_Lap_Number, Overall_Gap, Class_Gap, Penalties, Pit_Stops,
 *      Last_Driver, Last_Driver_ID
 *   2. All Laps CSV: Car_Number, Team_Name, Sponsor, Class, Lap_Number,
 *      Lap_Time, Total_Race_Time, Best_Lap_Time, Best_Lap_Number,
 *      Is_Personal_Best, Overall_Position, Class_Position, Overall_Gap,
 *      Overall_Diff, Class_Gap, Class_Diff, Overall_Start_Position,
 *      Overall_Positions_Gained, In_Class_Start_Position,
 *      Class_Positions_Gained, In_Pit, Last_In_Pit, Penalties, Pit_Stops,
 *      Driver_Name, Driver_ID, Flag_Status, Last_Flag
 */

import type { RaceDataParser } from "./types.js";
import type { RaceDataJson } from "../race-validators.js";
import { parseCSV, mapHeaders, col, parseLapTime } from "./csv-utils.js";
import { generateAnnotations } from "./position-analysis.js";

export const wrlWebsiteParser: RaceDataParser = {
  id: "wrl-website",
  name: "WRL Website",
  series: "WRL",
  description:
    "Import from WRL website CSV exports. Summary and All Laps files from the WRL live timing page.",
  fileSlots: [
    {
      key: "summaryCsv",
      label: "Summary CSV",
      description:
        "WRL website summary export — Overall_Position, Car_Number, Team_Name, Class, Laps_Completed, etc.",
      required: true,
    },
    {
      key: "lapsCsv",
      label: "All Laps CSV",
      description:
        "WRL website all laps export — lap times, positions, pit stops, and flags for every car.",
      required: true,
    },
  ],

  parse(files) {
    const { summaryCsv, lapsCsv } = files;
    if (!summaryCsv) throw new Error("Missing summary CSV");
    if (!lapsCsv) throw new Error("Missing laps CSV");

    const warnings: string[] = [];

    // ── Parse Summary CSV ──────────────────────────────────────────
    const summaryRows = parseCSV(summaryCsv);
    if (summaryRows.length < 2) throw new Error("Summary CSV has no data rows");
    const summaryHdr = mapHeaders(summaryRows[0]);

    const carMeta = new Map<
      number,
      { team: string; cls: string; finPos: number; finPosCls: number }
    >();

    for (let i = 1; i < summaryRows.length; i++) {
      const row = summaryRows[i];
      const num = parseInt(col(row, summaryHdr, "car_number"), 10);
      if (isNaN(num)) continue;

      carMeta.set(num, {
        team: col(row, summaryHdr, "team_name") || `Car #${num}`,
        cls: col(row, summaryHdr, "class") || "Unknown",
        finPos: parseInt(col(row, summaryHdr, "overall_position"), 10) || 999,
        finPosCls: parseInt(col(row, summaryHdr, "class_position"), 10) || 999,
      });
    }

    // ── Parse All Laps CSV ─────────────────────────────────────────
    const lapsRows = parseCSV(lapsCsv);
    if (lapsRows.length < 2) throw new Error("All Laps CSV has no data rows");
    const lapsHdr = mapHeaders(lapsRows[0]);

    const carLaps = new Map<
      number,
      Array<{
        l: number; p: number; cp: number;
        lt: string; ltSec: number; flag: string;
        pit: 0 | 1; spd: number;
      }>
    >();

    const carFromLaps = new Map<
      number,
      { team: string; cls: string; finPos: number; finPosCls: number }
    >();

    let maxLap = 0;

    for (let i = 1; i < lapsRows.length; i++) {
      const row = lapsRows[i];
      const num = parseInt(col(row, lapsHdr, "car_number"), 10);
      if (isNaN(num)) continue;

      const lapNum = parseInt(col(row, lapsHdr, "lap_number"), 10);
      if (isNaN(lapNum) || lapNum < 1) continue;

      const lapTimeStr = col(row, lapsHdr, "lap_time");
      const ltSec = parseLapTime(lapTimeStr);
      const inPit = col(row, lapsHdr, "in_pit").toLowerCase() === "yes";
      const overallPos = parseInt(col(row, lapsHdr, "overall_position"), 10) || lapNum;
      const classPos = parseInt(col(row, lapsHdr, "class_position"), 10) || 0;
      const flagStatus = col(row, lapsHdr, "flag_status").toLowerCase();

      let flag = "GREEN";
      if (flagStatus.includes("yellow") || flagStatus.includes("caution")) {
        flag = "FCY";
      } else if (flagStatus.includes("red")) {
        flag = "RED";
      } else if (flagStatus.includes("checkered")) {
        flag = "GREEN";
      }

      if (!carLaps.has(num)) carLaps.set(num, []);
      carLaps.get(num)!.push({
        l: lapNum,
        p: overallPos,
        cp: classPos,
        lt: lapTimeStr,
        ltSec: ltSec > 0 ? ltSec : 0.001,
        flag,
        pit: inPit ? 1 : 0,
        spd: 0,
      });

      if (lapNum > maxLap) maxLap = lapNum;

      if (!carFromLaps.has(num)) {
        carFromLaps.set(num, {
          team: col(row, lapsHdr, "team_name") || `Car #${num}`,
          cls: col(row, lapsHdr, "class") || "Unknown",
          finPos: parseInt(col(row, lapsHdr, "overall_position"), 10) || 999,
          finPosCls: parseInt(col(row, lapsHdr, "class_position"), 10) || 999,
        });
      }
    }

    // ── Recompute class positions per lap (more accurate than CSV) ──
    for (let lap = 1; lap <= maxLap; lap++) {
      const classLapEntries = new Map<string, Array<{ num: number; pos: number }>>();

      for (const [num, laps] of carLaps) {
        const lapData = laps.find((l) => l.l === lap);
        if (!lapData) continue;

        const cls = carMeta.get(num)?.cls || carFromLaps.get(num)?.cls || "Unknown";
        if (!classLapEntries.has(cls)) classLapEntries.set(cls, []);
        classLapEntries.get(cls)!.push({ num, pos: lapData.p });
      }

      for (const [, entries] of classLapEntries) {
        entries.sort((a, b) => a.pos - b.pos);
        for (let ci = 0; ci < entries.length; ci++) {
          const lapData = carLaps.get(entries[ci].num)!.find((l) => l.l === lap);
          if (lapData) lapData.cp = ci + 1;
        }
      }
    }

    // ── Build cars record ────────────────────────────────────────
    const cars: RaceDataJson["cars"] = {};
    const classGroups: Record<string, number[]> = {};
    const classCarCounts: Record<string, number> = {};

    for (const [num, laps] of carLaps) {
      laps.sort((a, b) => a.l - b.l);

      const meta = carMeta.get(num) || carFromLaps.get(num);
      if (!meta) {
        warnings.push(`Car #${num} has laps but no metadata — skipping`);
        continue;
      }

      cars[String(num)] = {
        num, team: meta.team, cls: meta.cls,
        finishPos: meta.finPos, finishPosClass: meta.finPosCls,
        laps,
      };

      if (!classGroups[meta.cls]) classGroups[meta.cls] = [];
      classGroups[meta.cls].push(num);
      classCarCounts[meta.cls] = (classCarCounts[meta.cls] || 0) + 1;
    }

    // ── Detect FCY periods ───────────────────────────────────────
    const fcy: Array<[number, number]> = [];
    let fcyStart: number | null = null;

    for (let lap = 1; lap <= maxLap; lap++) {
      let fcyCount = 0;
      let totalCount = 0;

      for (const [, laps] of carLaps) {
        const lapData = laps.find((l) => l.l === lap);
        if (lapData) {
          totalCount++;
          if (lapData.flag === "FCY") fcyCount++;
        }
      }

      const isFcy = totalCount > 0 && fcyCount / totalCount > 0.5;
      if (isFcy && fcyStart === null) {
        fcyStart = lap;
      } else if (!isFcy && fcyStart !== null) {
        fcy.push([fcyStart, lap - 1]);
        fcyStart = null;
      }
    }
    if (fcyStart !== null) fcy.push([fcyStart, maxLap]);

    // ── Green pace cutoff ────────────────────────────────────────
    const greenLapTimes: number[] = [];
    for (const [, laps] of carLaps) {
      for (const lap of laps) {
        if (lap.flag === "GREEN" && lap.pit === 0 && lap.ltSec > 1) {
          greenLapTimes.push(lap.ltSec);
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
    if (totalCars === 0) throw new Error("No valid car data found in CSVs");

    const raceData: RaceDataJson = { maxLap, totalCars, greenPaceCutoff, cars, fcy, classGroups, classCarCounts };
    const annotations = generateAnnotations(raceData);

    return {
      data: raceData,
      annotations,
      warnings,
    };
  },
};
