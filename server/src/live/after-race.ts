/**
 * After a WRL race ends on the timing feed, bring it into RaceTrace without waiting for Monday.
 *
 * Every CHECK_MS this looks at the WRL sessions that ended recently (poller.ts listRecentSessions).
 * Each race (not practice or qualifying) that ended at least SETTLE_MS ago starts the GitHub
 * "RaceTrace intake" workflow once, in import mode for that one session (RedMist event/session):
 * the workflow imports it as a DRAFT under its standard name and builds its facts as a DRAFT
 * package. Nothing is published; the owner publishes.
 *
 * Needs GITHUB_DISPATCH_TOKEN (a token that may only start this repository's workflows) and,
 * optionally, GITHUB_REPO (default TedderEngineering/WRL-Timing). Off without the token, or with
 * AFTER_RACE_IMPORT=0. Starting the same session twice (after a restart) is harmless: the import
 * then finds it unchanged.
 */
import { listRecentSessions, type LiveSessionRef } from "./poller.js";

export const CHECK_MS = 2 * 60_000;
/** Wait this long after the flag: the feed's files settle. */
export const SETTLE_MS = 20 * 60_000;
const WORKFLOW = "intake.yml";

export interface DispatchInputs {
  mode: "import";
  series: "wrl";
  season: string;
  since: string;
  redmist: string;
}

/** The workflow inputs for one ended race. */
export function dispatchInputs(s: Pick<LiveSessionRef, "eventId" | "sessionId" | "startedAt" | "endedAt">): DispatchInputs {
  const at = s.startedAt ?? s.endedAt ?? new Date().toISOString();
  // The day before the start (UTC), so a race starting in the evening of its local day is in range.
  const since = new Date(Date.parse(at) - 86_400_000).toISOString().slice(0, 10);
  return { mode: "import", series: "wrl", season: at.slice(0, 4), since, redmist: `${s.eventId}/${s.sessionId}` };
}

/** Races that ended SETTLE_MS ago or more and have not been started yet. */
export function dueRaces(recent: LiveSessionRef[], started: Set<string>, now: number): LiveSessionRef[] {
  return recent.filter(
    (s) => s.kind === "race" && s.endedAt !== null && now - Date.parse(s.endedAt) >= SETTLE_MS && !started.has(`${s.eventId}/${s.sessionId}`)
  );
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

export async function dispatchImport(inputs: DispatchInputs, token: string, repo: string, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<boolean> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: inputs }),
  });
  if (res.status === 204) return true;
  console.warn(`[after-race] workflow dispatch failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return false;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAfterRaceImport(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token || env.AFTER_RACE_IMPORT === "0") return false;
  const repo = env.GITHUB_REPO?.trim() || "TedderEngineering/WRL-Timing";
  const started = new Set<string>();
  const check = async () => {
    try {
      for (const s of dueRaces(await listRecentSessions(), started, Date.now())) {
        const key = `${s.eventId}/${s.sessionId}`;
        started.add(key);
        if (await dispatchImport(dispatchInputs(s), token, repo)) console.log(`[after-race] import started for ${s.slug}`);
        else started.delete(key);
      }
    } catch (e) {
      console.warn(`[after-race] check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  void check();
  timer = setInterval(() => void check(), CHECK_MS);
  timer.unref?.();
  return true;
}

export function stopAfterRaceImport(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
