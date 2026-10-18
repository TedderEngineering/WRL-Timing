import { useCallback, useEffect, useMemo, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { getVisibleCars } from "./chart-renderer";
import { makeGroupsOf } from "./makes";

/**
 * The view both race charts share (Position Trace and Lap Times): class, makes, focus and
 * compare. Held once on the race page so switching tabs keeps the same cars, colours and
 * filters, and both charts get the same controls.
 */
export interface TraceView {
  /** Makes picked in the Make filter; empty = all makes. */
  makeFilter: string[];
  setMakeFilter: (m: string[]) => void;
  /** Compare is every car in view (the default). */
  compareAll: boolean;
  setCompareAll: (on: boolean) => void;
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
}): TraceView {
  const { data, focusNum, setFocusNum, setCompSet, classView, setClassView, raceKey } = args;
  const race = raceKey ?? data;
  const [makeFilter, setMakeFilter] = useState<string[]>([]);
  const [compareAll, setCompareAll] = useState(true);

  const fieldCars = useMemo(() => {
    if (!data) return [];
    const base = getVisibleCars(data, classView);
    if (!makeFilter.length) return base;
    const groups = makeGroupsOf(data);
    const keep = new Set(makeFilter.flatMap((m) => groups[m] ?? []));
    return base.filter((n) => keep.has(n) || n === focusNum);
  }, [data, classView, makeFilter, focusNum]);

  // A new race, class or make goes back to every car (a live update is not a new race).
  useEffect(() => {
    setCompareAll(true);
  }, [classView, makeFilter, race]);
  useEffect(() => {
    if (!compareAll || !data) return;
    // Every car in view with laps; before the race (no laps anywhere) every entry.
    setCompSet(new Set(fieldCars.filter((n) => n !== focusNum && ((data.cars[String(n)]?.laps.length ?? 0) > 0 || data.maxLap === 0))));
  }, [compareAll, fieldCars, focusNum, data, setCompSet]);

  const toggleComp = useCallback(
    (n: number) => {
      setCompareAll(false);
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
      setCompareAll(false);
      setCompSet((prev) => new Set(prev).add(n));
    },
    [setCompSet]
  );
  const clearComp = useCallback(() => {
    setCompareAll(false);
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

  return { makeFilter, setMakeFilter, compareAll, setCompareAll, fieldCars, toggleComp, addComp, clearComp, pickClass };
}
