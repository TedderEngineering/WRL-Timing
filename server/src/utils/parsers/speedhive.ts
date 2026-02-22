/**
 * SpeedHive / MyLaps CSV parser
 *
 * Used by: WRL (World Racing League), and any series using SpeedHive timing.
 *
 * Expects two CSV files:
 *   1. Summary CSV: Position, Start Number, Name, Class, Position In Class, Status
 *   2. All Laps CSV: Team/Name, Start Number, Class, Finish Position (Overall),
 *      Finish Position (Class), Lap Number, Lap Time, Time of Day, Diff vs Best Lap,
 *      Diff vs Last Lap, Speed, In Pit, Field Position, Leader Lap,
 *      Gap to Leader (Time), Gap to Leader (Laps), Gap Ahead (Time),
 *      Gap Behind (Time), Status
 */

import type { RaceDataParser } from "./types.js";
import type { RaceDataJson } from "../race-validators.js";
import { parseCSV, mapHeaders, col, parseLapTime } from "./csv-utils.js";

export const speedhiveParser: RaceDataParser = {
  id: "speedhive",
  name: "SpeedHive / MyLaps",
  series: "WRL",
  description:
    "Import from SpeedHive CSV exports. Used by WRL and other series using MyLaps timing.",
  fileSlots: [
    {
      key: "summaryCsv",
      label: "Summary CSV",
      description:
        "SpeedHive summary export — Position, Start Number, Name, Class, Position In Class, Status.",
      required: true,
    },
    {
      key: "lapsCsv",
      label: "All Laps CSV",
      description:
        "SpeedHive all laps export — lap times, positions, speeds, pit stops, and flags for every car.",
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
      const num = parseInt(col(row, summaryHdr, "start number"), 10);
      if (isNaN(num)) continue;

      carMeta.set(num, {
        team: col(row, summaryHdr, "name") || `Car #${num}`,
        cls: col(row, summaryHdr, "class") || "Unknown",
        finPos: parseInt(col(row, summaryHdr, "position"), 10) || 999,
        finPosCls: parseInt(col(row, summaryHdr, "position in class"), 10) || 999,
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
      const num = parseInt(col(row, lapsHdr, "start number"), 10);
      if (isNaN(num)) continue;

      const lapNum = parseInt(col(row, lapsHdr, "lap number"), 10);
      if (isNaN(lapNum) || lapNum < 1) continue;

      const lapTimeStr = col(row, lapsHdr, "lap time");
      const ltSec = parseLapTime(lapTimeStr);
      const speed = parseFloat(col(row, lapsHdr, "speed")) || 0;
      const inPit = col(row, lapsHdr, "in pit").toLowerCase() === "true";
      const fieldPos = parseInt(col(row, lapsHdr, "field position"), 10) || lapNum;
      const status = col(row, lapsHdr, "status").toUpperCase();

      let flag = "GREEN";
      if (status.includes("FCY") || status.includes("YELLOW") || status.includes("CAUTION")) {
        flag = "FCY";
      } else if (status.includes("RED")) {
        flag = "RED";
      } else if (status.includes("CODE") || status.includes("SC")) {
        flag = "FCY";
      }

      if (!carLaps.has(num)) carLaps.set(num, []);
      carLaps.get(num)!.push({
        l: lapNum,
        p: fieldPos,
        cp: 0,
        lt: lapTimeStr,
        ltSec: ltSec > 0 ? ltSec : 0.001,
        flag,
        pit: inPit ? 1 : 0,
        spd: speed,
      });

      if (lapNum > maxLap) maxLap = lapNum;

      if (!carFromLaps.has(num)) {
        carFromLaps.set(num, {
          team: col(row, lapsHdr, "team/name") || `Car #${num}`,
          cls: col(row, lapsHdr, "class") || "Unknown",
          finPos: parseInt(col(row, lapsHdr, "finish position (overall)"), 10) || 999,
          finPosCls: parseInt(col(row, lapsHdr, "finish position (class)"), 10) || 999,
        });
      }
    }

    // ── Compute class positions per lap ──────────────────────────
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

    return {
      data: { maxLap, totalCars, greenPaceCutoff, cars, fcy, classGroups, classCarCounts },
      annotations: {},
      warnings,
    };
  },
};
