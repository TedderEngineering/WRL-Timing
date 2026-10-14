/**
 * Intake sources: discover, resolve (source key → session) and download, per site.
 */
import type { HttpClient } from "./http.js";
import { resolveSeries } from "./series.js";
import { parseSourceKey } from "./source-key.js";
import { discoverImsa, downloadImsa, resolveImsa } from "./sources/imsa.js";
import { discoverSro, downloadSro, resolveSro } from "./sources/sro.js";
import { discoverSpeedhive, discoverSpeedhiveEvent, downloadSpeedhive, resolveSpeedhive } from "./sources/speedhive.js";
import { discoverRedmist, discoverRedmistRef, downloadRedmist, resolveRedmist } from "./sources/redmist.js";
import type { DiscoverOptions, DownloadOptions, DownloadReport, RaceSession } from "./types.js";

export interface DiscoverRequest extends DiscoverOptions {
  /** Series ids or wildcards (series.ts). */
  series: string[];
  /** Speedhive organisation id for WRL. */
  speedhiveOrgId?: number;
  /** Speedhive event or session URLs/ids (WRL without the organisation id). */
  speedhiveRefs?: string[];
  /** RedMist event or event/session refs ("405", "405/3", an API URL); default: every WRL event. */
  redmistRefs?: string[];
}

export async function discover(http: HttpClient, req: DiscoverRequest): Promise<RaceSession[]> {
  const out: RaceSession[] = [];
  for (const sel of resolveSeries(req.series)) {
    if (sel.site === "imsa") out.push(...(await discoverImsa(http, sel, req)));
    else if (sel.site === "sro") out.push(...(await discoverSro(http, sel, req)));
    else if (sel.site === "redmist") {
      if (req.redmistRefs?.length) {
        for (const ref of req.redmistRefs) out.push(...(await discoverRedmistRef(http, ref, req)));
      } else out.push(...(await discoverRedmist(http, req)));
    } else if (sel.site === "speedhive") {
      if (req.speedhiveRefs?.length) {
        for (const ref of req.speedhiveRefs) out.push(...(await discoverSpeedhiveEvent(http, ref, req)));
      } else if (req.speedhiveOrgId) {
        out.push(...(await discoverSpeedhive(http, req.speedhiveOrgId, req)));
      } else {
        throw new Error(
          "WRL discovery needs the Speedhive organisation id (--org or SPEEDHIVE_WRL_ORG_ID; find it with " +
            "`intake speedhive-org --from-session <WRL session URL>`) or a Speedhive event/session URL (--speedhive <url>)."
        );
      }
    }
  }
  out.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.sourceKey.localeCompare(b.sourceKey));
  return out;
}

export function resolve(http: HttpClient, sourceKey: string): Promise<RaceSession> {
  const p = parseSourceKey(sourceKey);
  switch (p.site) {
    case "imsa":
      return resolveImsa(http, sourceKey);
    case "sro":
      return resolveSro(http, sourceKey);
    case "speedhive":
      return resolveSpeedhive(http, sourceKey);
    case "redmist":
      return resolveRedmist(http, sourceKey);
  }
}

export function download(http: HttpClient, s: RaceSession, dir: string, opts?: DownloadOptions): Promise<DownloadReport> {
  switch (s.site) {
    case "imsa":
      return downloadImsa(s, dir, http, opts);
    case "sro":
      return downloadSro(s, dir, http, opts);
    case "speedhive":
      return downloadSpeedhive(s, dir, http, opts);
    case "redmist":
      return downloadRedmist(s, dir, http, opts);
  }
}

export * from "./types.js";
export { createHttpClient } from "./http.js";
export { readManifest, writeManifest, workDirFor, addManualFiles } from "./manifest.js";
export { SERIES, resolveSeries } from "./series.js";
export { canonicalSourceKey, parseSourceKey } from "./source-key.js";
