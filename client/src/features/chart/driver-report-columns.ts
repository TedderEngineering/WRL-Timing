/**
 * The Driver Report's column names and what each one means: the tab's headers and their ⓘ
 * explanations, and the PDF's headers, from one list so they never disagree.
 */
import { CLASS_LIMIT, CLEAR_GAP_S, DRIVER_LIMIT, Z_WINDOW_S } from "./driver-performance";

export type DriverColumnId = "driver" | "car" | "spread" | "avgLap" | "fastLap" | "stdDev" | "avgZ" | "clearAirPct" | "overtakes" | "shown" | "laps" | "track";

export interface DriverColumnText {
  /** The tab's header. */
  name: string;
  /** The PDF's header (short, upper case). */
  pdf: string;
  /** The ⓘ explanation: what it is, and how to read it. */
  tip: string;
}

export const DRIVER_COLUMNS: Record<DriverColumnId, DriverColumnText> = {
  driver: { name: "Driver", pdf: "DRIVER", tip: "Who drove, from the driver changes at the pit stops." },
  car: { name: "Car", pdf: "CAR", tip: "Car number and team." },
  spread: {
    name: "Lap-time spread",
    pdf: "LAP-TIME SPREAD",
    tip: `Each lap counted in the average, on the class's time scale. Green: clean air. Purple: a car within ${CLEAR_GAP_S} s ahead. The box is the driver's best lap.`,
  },
  avgLap: {
    name: "Avg lap",
    pdf: "AVG LAP",
    tip: "The average of the laps counted: the driver's fastest racing laps, at most half the laps they drove. The table is ranked on it.",
  },
  fastLap: { name: "Best lap", pdf: "BEST LAP", tip: "The driver's fastest racing lap." },
  stdDev: {
    name: "Consistency",
    pdf: "CONSISTENCY",
    tip: "How much the counted laps vary, in seconds (standard deviation). Lower is more consistent.",
  },
  avgZ: {
    name: "Pace vs class",
    pdf: "PACE VS CLASS",
    tip: `Each counted lap against the class's counted laps run within ${Math.round(Z_WINDOW_S / 60)} minutes of it, in spreads of the class (z-score). 0 is the class's pace at that time; below 0 is quicker. Fair between drivers who raced in different conditions.`,
  },
  clearAirPct: {
    name: "Clean-air laps",
    pdf: "CLEAN AIR",
    tip: `Share of the counted laps with no car within ${CLEAR_GAP_S} s ahead when the driver crossed the line at the start and at the end of the lap. Traffic between the lines can be missed.`,
  },
  overtakes: {
    name: "Passes",
    pdf: "PASSES",
    tip: "Cars of any class the driver passed on track: ahead of the driver at one crossing of the line, behind at the next. Pit and caution laps don't count.",
  },
  shown: {
    name: "Laps counted",
    pdf: "LAPS COUNTED",
    tip: `Laps in the average: the fastest racing laps, at most half the laps driven. Lap 1, pit in- and out-laps, caution laps, and laps over ${Math.round((CLASS_LIMIT - 1) * 100)}% off the class's best or ${Math.round((DRIVER_LIMIT - 1) * 100)}% off the driver's own are left out.`,
  },
  laps: { name: "Laps driven", pdf: "LAPS DRIVEN", tip: "Laps the driver drove, and their share of the car's laps." },
  track: { name: "Time on track", pdf: "TIME ON TRACK", tip: "The driver's stints from the start to the flag, lighter early and darker late. DNF marks where the car stopped." },
};
