/**
 * Detect car numbers that stop being distinct once parsed as integers.
 *
 * Every parser keys its cars by `parseInt(carNumber, 10)` and writes them to
 * `cars[String(num)]`, which silently discards leading zeros. Alkamel fields
 * routinely run "007", "07" and "7" as three separate entries — SRO GT4 America
 * at COTA in 2025 did exactly that — and all three land on the same key, so the
 * last one written wins and the others vanish along with their laps.
 *
 * Fixing that properly means giving cars string identity throughout the schema,
 * ingest and chart code. Until then this reports the condition, so an import that
 * loses cars says so instead of quietly under-reporting the field.
 */

export interface CarNumberCollision {
  /** The integer all these car numbers reduce to. */
  parsed: number;
  /** The distinct source car numbers, in file order. */
  sources: string[];
  /** Lap records held by each source, parallel to `sources`, when counts are known. */
  lapRecords?: number[];
}

/**
 * Group source car numbers by the integer they parse to, returning only the
 * groups with more than one member. Order of first appearance is preserved,
 * which matches the order the parsers write them in — so the last entry of each
 * group is the one that survives.
 */
export function findCarNumberCollisions(
  carNumbers: Iterable<string>,
  lapCounts?: Map<string, number>
): CarNumberCollision[] {
  const byParsed = new Map<number, string[]>();

  for (const raw of carNumbers) {
    const carNumber = raw.trim();
    if (!carNumber) continue;
    const parsed = parseInt(carNumber, 10);
    if (isNaN(parsed)) continue;

    let group = byParsed.get(parsed);
    if (!group) {
      group = [];
      byParsed.set(parsed, group);
    }
    if (!group.includes(carNumber)) group.push(carNumber);
  }

  const collisions: CarNumberCollision[] = [];
  for (const [parsed, sources] of byParsed) {
    if (sources.length < 2) continue;
    collisions.push({
      parsed,
      sources,
      ...(lapCounts
        ? { lapRecords: sources.map((s) => lapCounts.get(s) ?? 0) }
        : {}),
    });
  }

  return collisions.sort((a, b) => a.parsed - b.parsed);
}

/**
 * One warning per collision, naming what is kept and what is lost.
 * Returns an empty array when nothing collides, so callers can spread it.
 */
export function carNumberCollisionWarnings(
  collisions: CarNumberCollision[]
): string[] {
  return collisions.map((c) => {
    const kept = c.sources[c.sources.length - 1];
    const lost = c.sources.slice(0, -1);
    const listed = c.sources.map((s) => `"${s}"`).join(", ");

    let detail = "";
    if (c.lapRecords) {
      const lostRecords = c.lapRecords
        .slice(0, -1)
        .reduce((sum, n) => sum + n, 0);
      detail = ` ${lostRecords} lap record(s) will be dropped.`;
    }

    return (
      `Car numbers ${listed} all reduce to ${c.parsed}, so only "${kept}" will be ` +
      `kept and ${lost.map((s) => `"${s}"`).join(", ")} discarded.${detail} ` +
      "Leading zeros are not preserved in car identity."
    );
  });
}
