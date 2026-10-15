/**
 * Car identity for the chart (item 4: "4" and "4A", "7" and "007").
 *
 * The chart keys cars by an integer (`cars[String(num)]`, classGroups of numbers), and the
 * parsers used `parseInt(carNumber)`, so distinct entries such as "7" and "007" (SRO GT4
 * America runs both) or "4" and "4A" landed on one key: one car vanished, or two cars' laps
 * were merged into one trace. Each race now gets a numbering in which every published car
 * number has its own integer:
 *
 *  - a number that is plainly an integer ("7") keeps it;
 *  - otherwise the first such number to reduce to a free integer takes it ("028" → 28);
 *  - any other ("007" when "7" exists, "4A" when "4" exists, "X1") gets an unused integer
 *    from 10000 up.
 *
 * `label(num)` is the number as published wherever it differs from String(num); the chart
 * carries it as `CarData.label` and the race's entries store it as their car number.
 */
export const SYNTHETIC_BASE = 10000;

export interface CarNumbering {
  /** The race's integer for a published car number; null for a blank one. */
  num(raw: string | number | null | undefined): number | null;
  /** The published car number for an integer, when it differs from String(num). */
  label(num: number): string | undefined;
  /** Published numbers that would have collided under parseInt, for the import's warnings. */
  collisions: string[][];
}

const clean = (raw: string | number | null | undefined) => String(raw ?? "").trim();

export function carNumbering(raws: Iterable<string | number | null | undefined>): CarNumbering {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const r of raws) {
    const c = clean(r);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    order.push(c);
  }
  const byRaw = new Map<string, number>();
  const taken = new Set<number>();
  // Plain integers first, so "7" keeps 7 whatever order the files list them in.
  for (const c of order) {
    if (/^[1-9]\d*$|^0$/.test(c)) {
      byRaw.set(c, Number(c));
      taken.add(Number(c));
    }
  }
  const groups = new Map<number, string[]>();
  for (const c of order) {
    const p = parseInt(c, 10);
    if (Number.isNaN(p)) continue;
    groups.set(p, [...(groups.get(p) ?? []), c]);
  }
  let next = SYNTHETIC_BASE;
  for (const c of order) {
    if (byRaw.has(c)) continue;
    const p = parseInt(c, 10);
    if (!Number.isNaN(p) && p >= 0 && !taken.has(p)) {
      byRaw.set(c, p);
      taken.add(p);
      continue;
    }
    while (taken.has(next)) next++;
    byRaw.set(c, next);
    taken.add(next);
  }
  const labels = new Map<number, string>();
  for (const [c, n] of byRaw) if (c !== String(n)) labels.set(n, c);
  return {
    num(raw) {
      const c = clean(raw);
      if (!c) return null;
      const n = byRaw.get(c);
      if (n !== undefined) return n;
      // A number not seen in the pre-pass: its integer if free, else nothing (never merge two cars).
      const p = parseInt(c, 10);
      return !Number.isNaN(p) && ![...byRaw.values()].includes(p) ? p : null;
    },
    label: (n) => labels.get(n),
    collisions: [...groups.values()].filter((g) => g.length > 1),
  };
}

/** One import warning per group of numbers that parseInt would have merged. */
export function carNumberingWarnings(n: CarNumbering): string[] {
  return n.collisions.map(
    (g) => `Car numbers ${g.map((x) => `"${x}"`).join(", ")} are separate entries; each keeps its own trace (shown with its published number).`
  );
}
