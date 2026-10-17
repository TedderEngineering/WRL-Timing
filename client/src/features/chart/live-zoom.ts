import { createContext, useEffect, useRef } from "react";

/**
 * Zoom when the race's lap count changes.
 *
 * A finished race: a new lap count is a new race, so the zoom resets to the
 * whole race (the charts' behaviour before RaceTrace Live).
 *
 * A live race (`live`): the lap count grows as laps complete. A view at the
 * latest lap keeps following it: the whole race stays the whole race, and a
 * zoomed-in window at the end slides along, keeping its width. "At the latest
 * lap" allows FOLLOW_TOLERANCE laps, since swiping or pinching on a phone
 * leaves the end a fraction of a lap short (99.97 of 100), and an exact test
 * then stopped following for good. A view zoomed into earlier laps stays where
 * the viewer put it.
 */
export const FOLLOW_TOLERANCE = 1;

export function nextZoom(prevMax: number, nextMax: number, start: number, end: number, live: boolean): [number, number] {
  if (!live || nextMax < prevMax) return [1, nextMax];
  if (end < prevMax - FOLLOW_TOLERANCE) return [start, end];
  if (start <= 1.001) return [1, nextMax];
  return [Math.max(1, nextMax - (end - start)), nextMax];
}

export function useLapZoomOnGrow(
  maxLap: number,
  lapStart: number,
  lapEnd: number,
  setLapStart: (n: number) => void,
  setLapEnd: (n: number) => void,
  live = false
) {
  const prev = useRef(maxLap);
  const view = useRef({ lapStart, lapEnd });
  view.current = { lapStart, lapEnd };
  useEffect(() => {
    const [s, e] = nextZoom(prev.current, maxLap, view.current.lapStart, view.current.lapEnd, live);
    prev.current = maxLap;
    setLapStart(s);
    setLapEnd(e);
    // Only the lap count drives this; the zoom itself is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxLap]);
}

/** True inside RaceTrace Live: positions are "running", not "finished". */
export const LiveRaceContext = createContext(false);

/**
 * RaceTrace Live: seconds since the chart data arrived, for moving gaps on between updates
 * (null = hold them as of the last crossings: a caution or the finish).
 */
export const LiveClockContext = createContext<(() => number | null) | null>(null);
