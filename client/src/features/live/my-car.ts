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
