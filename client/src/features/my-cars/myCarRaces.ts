/**
 * The races the user's followed cars ran (mobile redesign, step 6: Events opens on "My cars").
 * Each car is looked up by its number with the public car search (GET /api/search/cars, cached at
 * the edge), and the results that are that car (same series, number and team, as the server's
 * carMatchesEntry) give its races. No new server route: one small request per followed car.
 */
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { followedCar, type CarResult } from "./CarSearch";
import type { MyCar } from "./api";

export function useMyCarRaceIds(cars: MyCar[] | null): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null);
  const key = cars?.map((c) => `${c.id}:${c.number}`).join(",") ?? "";
  useEffect(() => {
    if (!cars) return;
    if (!cars.length) {
      setIds(new Set());
      return;
    }
    let alive = true;
    Promise.all(
      cars.map((car) =>
        api
          .get<{ cars: CarResult[] }>(`/search/cars?q=${encodeURIComponent(car.number)}`)
          .then((r) => (r.cars ?? []).filter((res) => followedCar([car], res)).flatMap((res) => res.races.map((x) => x.raceId)))
          .catch(() => [] as string[])
      )
    ).then((lists) => alive && setIds(new Set(lists.flat())));
    return () => {
      alive = false;
    };
    // The list's identity changes on every load; its cars are what count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ids;
}
