/**
 * A car's official finishing status, from the results file. The parsers store it on each car as `status`;
 * the race page shows it instead of a position when a car was not classified.
 *
 *   classified     took the flag and is in the classification
 *   dnf            classified as not running at the end ("Retired", "DNF")
 *   nc             not classified (did not cover enough distance)
 *   dsq            disqualified or excluded
 *   dns            did not start
 */
export type FinishStatus = "classified" | "dnf" | "nc" | "dsq" | "dns";

export function normalizeFinishStatus(raw: string | null | undefined): FinishStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(dsq|dq|disq|excl)|disqualif|exclu/.test(s)) return "dsq";
  if (/^dns$|not start|did not start|^withdrawn/.test(s)) return "dns";
  if (/^nc$|not classified|unclassified|n\.c\./.test(s)) return "nc";
  if (/^dnf$|retired|did not finish|^ret$|accident|mechanical/.test(s)) return "dnf";
  if (/classified|running|finished|^ok$|^active$|^\d+$/.test(s)) return "classified";
  return null;
}

