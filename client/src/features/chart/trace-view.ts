import { useCallback, useEffect, useMemo, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { getVisibleCars } from "./chart-renderer";
import { makeGroupsOf } from "./makes";
import { classRivals } from "./car-groups";

/**
 * The view both race charts share (Position Trace and Lap Times): class, makes, focus and
 * compare. Held once on the race page so switching tabs keeps the same cars, colours and
 * filters, and both charts get the same controls.
 */
export interface TraceView {
  /** Makes picked in the Make filter; empty = all makes. */
  makeFilter: string[];
  setMakeFilter: (m: string[]) => void;
  /** Compare is every car in view (the laptop's default). */
  compareAll: boolean;
  setCompareAll: (on: boolean) => void;
  /** Compare is the focus car's class rivals, two ahead and two behind (the phone's default; car-groups.ts). */
  compareRivals: boolean;
  setCompareRivals: () => void;
  /** Every car in the class view and the makes picked: the field the charts draw. */
  fieldCars: number[];
  toggleComp: (n: number) => void;
  addComp: (n: number) => void;
  clearComp: () => void;
  /** Change class; a class view is about that class, so a focus car from another class gives way to its leader. */
  pickClass: (c: string) => void;
}

export function useTraceView(args: {
  data: RaceChartData | null;
  focusNum: number;
  setFocusNum: (n: number) => void;
  setCompSet: React.Dispatch<React.SetStateAction<Set<number>>>;
  classView: string;
  setClassView: (c: string) => void;
  /** Which race this is. A live race's data changes every update but is the same race; without a key, new data = new race. */
  raceKey?: string;
  /**
   * What a new race, class or make compares against until the person picks cars: every car in
   * view (laptop), or the focus car's class rivals (phone, plan decision M3). Default "all".
   */
  defaultCompare?: "all" | "rivals";
}): TraceView {
  const { data, focusNum, setFocusNum, setCompSet, classView, setClassView, raceKey } = args;
  const defaultCompare = args.defaultCompare ?? "all";
  const race = raceKey ?? data;
  const [makeFilter, setMakeFilter] = useState<string[]>([]);
  // "custom" = cars the person picked; kept until a new race, class or make.
  const [mode, setMode] = useState<"all" | "rivals" | "custom">(defaultCompare);
  const compareAll = mode === "all";
  const setCompareAll = useCallback((on: boolean) => setMode(on ? "all" : "custom"), []);
  const setCompareRivals = useCallback(() => setMode("rivals"), []);

  const fieldCars = useMemo(() => {
    if (!data) return [];
    const base = getVisibleCars(data, classView);
    if (!makeFilter.length) return base;
    const groups = makeGroupsOf(data);
    const keep = new Set(makeFilter.flatMap((m) => groups[m] ?? []));
    return base.filter((n) => keep.has(n) || n === focusNum);
  }, [data, classView, makeFilter, focusNum]);

  // A new race, class or make goes back to the default (a live update is not a new race).
  useEffect(() => {
    setMode(defaultCompare);
  }, [classView, makeFilter, race, defaultCompare]);
  useEffect(() => {
    if (!data || mode === "custom") return;
    if (mode === "rivals") {
      setCompSet(new Set(classRivals(data, focusNum, fieldCars)));
      return;
    }
    // Every car in view with laps; before the race (no laps anywhere) every entry.
    setCompSet(new Set(fieldCars.filter((n) => n !== focusNum && ((data.cars[String(n)]?.laps.length ?? 0) > 0 || data.maxLap === 0))));
  }, [mode, fieldCars, focusNum, data, setCompSet]);

  const toggleComp = useCallback(
    (n: number) => {
      setMode("custom");
      setCompSet((prev) => {
        const next = new Set(prev);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        return next;
      });
    },
    [setCompSet]
  );
  const addComp = useCallback(
    (n: number) => {
      setMode("custom");
      setCompSet((prev) => new Set(prev).add(n));
    },
    [setCompSet]
  );
  const clearComp = useCallback(() => {
    setMode("custom");
    setCompSet(new Set());
  }, [setCompSet]);

  const pickClass = useCallback(
    (c: string) => {
      if (!data) return;
      setMakeFilter([]);
      if (c && data.cars[String(focusNum)]?.cls !== c) {
        const leader = (data.classGroups[c] ?? [])
          .map((n) => data.cars[String(n)])
          .filter((car) => car && car.laps.length > 0)
          .sort((x, y) => (x.finishPosClass || 999) - (y.finishPosClass || 999))[0];
        if (leader) setFocusNum(leader.num);
      }
      setClassView(c);
    },
    [data, focusNum, setFocusNum, setClassView]
  );

  return { makeFilter, setMakeFilter, compareAll, setCompareAll, compareRivals: mode === "rivals", setCompareRivals, fieldCars, toggleComp, addComp, clearComp, pickClass };
}
