/**
 * A car's pit stops, counted the same way on every page (the owner's rule): every pit-lane visit
 * is a stop (a service stop, a garage visit, a drive-through, stop-and-go or penalty served, a
 * red-flag hold, retiring in the pits), one per pit note on its in-lap. A race without pit notes
 * counts the laps flagged as pit laps, a run of flagged laps (one visit over two laps) once.
 * Client copy: client/src/features/chart/pit-visits.ts.
 */
export function pitVisitLaps(laps: { l: number; pit: number }[], pits: { l: number }[] | null | undefined): number[] {
  if (pits) return [...new Set(pits.filter((p) => p.l > 0).map((p) => p.l))].sort((a, b) => a - b);
  const out: number[] = [];
  const sorted = [...laps].sort((a, b) => a.l - b.l);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].pit !== 1) continue;
    if (i > 0 && sorted[i - 1].pit === 1 && sorted[i - 1].l === sorted[i].l - 1) continue;
    out.push(sorted[i].l);
  }
  return out;
}
