/**
 * The car a viewer follows at a live event, kept on this device per event (picked on the pre-race
 * page or by changing the focus car on the live page), so the live page opens on it.
 */
const key = (eventName: string) => `rt.live.car:${eventName}`;

export function readLiveCar(eventName: string | null | undefined): string | null {
  if (!eventName) return null;
  try {
    return localStorage.getItem(key(eventName));
  } catch {
    return null;
  }
}

export function saveLiveCar(eventName: string | null | undefined, car: string | null) {
  if (!eventName) return;
  try {
    if (car) localStorage.setItem(key(eventName), car);
    else localStorage.removeItem(key(eventName));
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}

/**
 * The cars a viewer follows on a live race's track map (car numbers as published), kept on this
 * device per race page. Followed cars are drawn as large as the focus car.
 */
const followKey = (slug: string) => `rt.live.follow:${slug}`;

export function readFollowedCars(slug: string | null | undefined): string[] {
  if (!slug) return [];
  try {
    const v = JSON.parse(localStorage.getItem(followKey(slug)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function saveFollowedCars(slug: string | null | undefined, cars: string[]) {
  if (!slug) return;
  try {
    if (cars.length) localStorage.setItem(followKey(slug), JSON.stringify(cars));
    else localStorage.removeItem(followKey(slug));
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}

/** Follow a car, or stop following it (by published number). */
export function toggleFollow(cars: string[], car: string): string[] {
  return cars.includes(car) ? cars.filter((c) => c !== car) : [...cars, car];
}
