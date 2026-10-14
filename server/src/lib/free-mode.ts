/**
 * RaceTrace is free while RACETRACE_FREE is "on" (the default): every race and
 * every feature is open to everyone. Read per call so it can be flipped without
 * a deploy of new code. "off" restores the Free / Pro / Team limits.
 */
export function freeMode(): boolean {
  return (process.env.RACETRACE_FREE ?? "on").trim().toLowerCase() !== "off";
}
