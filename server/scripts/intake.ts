/**
 * RaceTrace intake CLI (RaceTrace 2.0, G4). Run from server/:
 *
 *   npx tsx scripts/intake.ts preflight
 *   npx tsx scripts/intake.ts discover --series imsa-mpc,sro-gt4,sro-grcup,wrl --season 2026 [--since 2026-09-01]
 *                                      [--all-sessions] [--redmist <event id|event/session>]…
 *                                      [--json] [--save <file>]
 *   npx tsx scripts/intake.ts discover --series wrl-speedhive --season 2025 [--org <speedhive org id>] [--speedhive <event|session URL>]…
 *   npx tsx scripts/intake.ts pull <sourceKey…> | --from <discover.json> [--states new,changed,results-upgrade]
 *                                  [--skip-attach-candidates | --attach-single-candidates] [--force]
 *   npx tsx scripts/intake.ts push <dir…> [--force] [--dry-run] [--archive-only]
 *   npx tsx scripts/intake.ts push <dir> --attach <raceId>      replace an existing race that has no source key yet
 *   npx tsx scripts/intake.ts status <dir…>
 *   npx tsx scripts/intake.ts facts <dir> [--out <file>]        G2 build-facts on the folder's files (when present)
 *   npx tsx scripts/intake.ts validate <draft.json> [--base <facts.base.json>] [--scope-class <id>] [--publish] [--json]
 *   npx tsx scripts/intake.ts steps                              which pipeline scripts this checkout has
 *   npx tsx scripts/intake.ts speedhive-org --from-session <URL|id>
 *   npx tsx scripts/intake.ts analyze [--series imsa-*,sro-*,wrl] [--season 2025,2026] [--race <raceId>]… [--force] [--limit N]
 *                                      [--notes <file>]   facts + rule checks for races with a source key, uploaded as a
 *                                      DRAFT analysis package (no stories yet; those are written race by race later)
 *   npx tsx scripts/intake.ts reimport-plan --series imsa-*,sro-*,wrl,wrl-speedhive --season 2025,2026 [--save <file>] [--apply] [--approve <raceId,…>]
 *                                      pair races already on the site (no source key) with their timing sessions by
 *                                      their cars; --apply re-imports every exact pair in place (same id, URL, name, status)
 *
 *   npx tsx scripts/intake.ts refresh [--series …] [--season 2025,2026] [--limit N]   pull every keyed race again
 *                                      and push it with force (a parser change reaching older imports)
 *   npx tsx scripts/intake.ts names --series imsa-*,sro-*,wrl,wrl-speedhive --season 2025,2026 [--apply] [--notes <file>]
 *                                      rename races with a source key to the naming standard and set each race's
 *                                      date to its session's day; nothing changes without --apply
 *
 * Environment (process env, then server/.env.intake, then <repo>/.env.intake):
 *   RACETRACE_API_URL     e.g. https://<api host>   (the "/api" suffix is optional)
 *   RACETRACE_API_TOKEN   rt_… token from Admin → API Tokens (scope "intake"). Never printed.
 *   SPEEDHIVE_WRL_ORG_ID  Speedhive organisation id of WRL (for `discover --series wrl-speedhive`, 2025 races)
 *   INTAKE_REDMIST_GAP_MS gap between RedMist requests (default 1600; RedMist allows ~1 per 1.1 s anonymously)
 *   INTAKE_WORK_DIR       work folder root (default <repo>/intake-work, git-ignored)
 *   INTAKE_USER_AGENT     User-Agent override for the timing sites
 *   INTAKE_DELAY_MS       gap between requests to a timing site (default 500)
 *
 * Exit codes: 0 ok · 1 error · 2 usage · 3 a pipeline step is not on this branch.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { createHttpClient, DEFAULT_USER_AGENT } from "../src/intake/http.js";
import { discover, download, resolve } from "../src/intake/index.js";
import { addManualFiles, readManifest, workDirFor, writeManifest } from "../src/intake/manifest.js";
import { apiConfigFromEnv, apiRequest, attachCandidates, buildPushBody, compareWithKnown, type KnownRace, type UnkeyedRace } from "../src/intake/push.js";
import { seriesById } from "../src/intake/series.js";
import { speedhiveOrgFromSession } from "../src/intake/sources/speedhive.js";
import { candidateSessions, planReimport, type SessionPrint, type SiteRace } from "../src/intake/reimport.js";
import { identityChange, type IdentityChange } from "../src/intake/standard-name.js";
import { parserInput } from "../src/intake/parser-input.js";
import { getParser } from "../src/utils/parsers/index.js";
import { canonicalSourceKey } from "../src/intake/source-key.js";
import { buildFactsArgs, packageIdFor } from "../src/intake/facts-args.js";
import type { Manifest, RaceSession } from "../src/intake/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = resolvePath(here, "..");
const REPO = resolvePath(SERVER, "..");
for (const p of [join(SERVER, ".env.intake"), join(REPO, ".env.intake")]) if (existsSync(p)) dotenv.config({ path: p, override: false });

const WORK = resolvePath(process.env.INTAKE_WORK_DIR || join(REPO, "intake-work"));
const log = (m: string) => process.stderr.write(m + "\n");

// ─── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      const next = argv[i + 1];
      const v = inline ?? (next !== undefined && !next.startsWith("--") ? (i++, next) : "true");
      (flags[k] ??= []).push(v);
    } else pos.push(a);
  }
  const one = (k: string) => flags[k]?.[flags[k].length - 1];
  const has = (k: string) => k in flags && one(k) !== "false";
  return { pos, flags, one, has };
}

function http() {
  return createHttpClient({
    userAgent: process.env.INTAKE_USER_AGENT || DEFAULT_USER_AGENT,
    delayMs: Number(process.env.INTAKE_DELAY_MS || 500),
  });
}

class UsageError extends Error {}
class StepMissing extends Error {}

function table(rows: string[][]): string {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((c, i) => (c ?? "").padEnd(w[i])).join("  ").trimEnd()).join("\n");
}

async function knownRaces(): Promise<KnownRace[] | null> {
  const cfg = apiConfigFromEnv();
  if (!cfg) return null;
  const r = await apiRequest<{ races: KnownRace[] }>(cfg, "GET", "/admin/intake/races");
  if (r.status !== 200) throw new Error(`GET /admin/intake/races → HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data.races;
}

async function unkeyedRaces(series: string, season: number): Promise<UnkeyedRace[]> {
  const cfg = apiConfigFromEnv();
  if (!cfg) return [];
  const r = await apiRequest<{ races: UnkeyedRace[] }>(cfg, "GET", `/admin/intake/races?unkeyed=1&series=${encodeURIComponent(series)}&season=${season}`);
  if (r.status !== 200) throw new Error(`GET /admin/intake/races?unkeyed=1 → HTTP ${r.status}`);
  return r.data.races;
}

// ─── commands ────────────────────────────────────────────────────────────────

async function cmdDiscover(a: ReturnType<typeof parseArgs>) {
  const series = a.flags.series ?? [];
  const season = Number(a.one("season") ?? new Date().getFullYear());
  if (series.length === 0) throw new UsageError("discover needs --series (e.g. imsa-mpc, imsa-*, sro-gt4, sro-grcup, sro-*, wrl, wrl-speedhive)");
  if (!Number.isInteger(season)) throw new UsageError("--season must be a year");
  const since = a.one("since");
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new UsageError("--since must be YYYY-MM-DD");
  let org = Number(a.one("org") ?? process.env.SPEEDHIVE_WRL_ORG_ID ?? "") || undefined;
  const h = http();
  // As reimport-plan does: with no organisation id set, find WRL's from a known WRL session.
  if (!org && series.some((x) => x.split(",").includes("wrl-speedhive")) && !(a.flags.speedhive ?? []).length) {
    try {
      org = (await speedhiveOrgFromSession(h, String(KNOWN_WRL_SPEEDHIVE_SESSION))).id ?? undefined;
      log(`Speedhive WRL organisation: ${org ?? "not found"}`);
    } catch (e) {
      log(`Warning: could not find the Speedhive WRL organisation (${(e as Error).message})`);
    }
  }
  const sessions = await discover(h, {
    series,
    season,
    since,
    allSessions: a.has("all-sessions"),
    speedhiveOrgId: org,
    speedhiveRefs: a.flags.speedhive,
    redmistRefs: a.flags.redmist,
    log,
  });
  let known: KnownRace[] | null = null;
  try {
    known = await knownRaces();
  } catch (e) {
    log(`Warning: could not read known races from the API (${(e as Error).message}); every session is listed as "new".`);
  }
  const cmp = compareWithKnown(sessions, known ?? []);
  // New sessions may be races already on the site from before source keys (admin uploads): suggest them.
  const unkeyed = new Map<string, UnkeyedRace[]>();
  if (known) {
    for (const c of cmp.filter((x) => x.state === "new")) {
      const rs = seriesById(c.session.seriesId)?.raceSeries;
      const k = `${rs}|${c.session.season}`;
      if (rs && !unkeyed.has(k)) {
        try {
          unkeyed.set(k, await unkeyedRaces(rs, c.session.season));
        } catch (e) {
          log(`Warning: could not read races without a source key (${(e as Error).message}).`);
          unkeyed.set(k, []);
        }
      }
    }
  }
  const out = cmp.map((c) => ({
    state: known ? c.state : "new",
    sourceKey: c.session.sourceKey,
    series: c.session.seriesId,
    event: c.session.event,
    session: c.session.sessionName,
    date: c.session.raceDate,
    resultsStatus: c.session.resultsStatus,
    knownResultsStatus: c.known?.resultsStatus ?? null,
    raceId: c.known?.raceId ?? null,
    version: c.session.version,
    attachCandidates:
      c.state === "new"
        ? attachCandidates(c.session, seriesById(c.session.seriesId)?.raceSeries ?? "", unkeyed.get(`${seriesById(c.session.seriesId)?.raceSeries}|${c.session.season}`) ?? []).map((r) => ({
            raceId: r.raceId,
            name: r.name,
            date: r.date,
            status: r.status,
          }))
        : [],
  }));
  const save = a.one("save") ?? join(WORK, "discover-latest.json");
  mkdirSync(dirname(save), { recursive: true });
  writeFileSync(save, JSON.stringify({ discoveredAt: new Date().toISOString(), season, series, since: since ?? null, comparedWithSite: !!known, sessions: out }, null, 2));
  if (a.has("json")) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }
  const rows = [["STATE", "DATE", "SERIES", "EVENT", "SESSION", "RESULTS", "SOURCE KEY", "ON SITE WITHOUT KEY?"]];
  for (const o of out) rows.push([o.state, o.date, o.series, o.event, o.session, o.resultsStatus, o.sourceKey, o.attachCandidates.map((r) => `${r.raceId} (${r.name})`).join("; ")]);
  console.log(table(rows));
  const n = (s: string) => out.filter((o) => o.state === s).length;
  console.log(`\n${out.length} session(s): ${n("new")} new, ${n("changed")} changed, ${n("results-upgrade")} results upgrade, ${n("unchanged")} unchanged.${known ? "" : " (Not compared with the site: RACETRACE_API_URL/RACETRACE_API_TOKEN not set.)"}`);
  console.log(`Saved: ${save}`);
}

async function cmdPull(a: ReturnType<typeof parseArgs>) {
  let keys = [...a.pos];
  const attachTo = new Map<string, string>();
  const from = a.one("from");
  if (from) {
    const states = (a.one("states") ?? "new,changed,results-upgrade").split(",");
    const d = JSON.parse(readFileSync(from, "utf-8")) as { sessions: { state: string; sourceKey: string; attachCandidates?: { raceId: string; name: string }[] }[] };
    const skipAttach = a.has("skip-attach-candidates") || a.has("attach-single-candidates");
    const attachSingle = a.has("attach-single-candidates");
    for (const s of d.sessions.filter((x) => states.includes(x.state))) {
      const cands = s.state === "new" ? (s.attachCandidates ?? []) : [];
      // The owner chose (--attach-single-candidates) to replace races already on the site when exactly one matches.
      if (attachSingle && cands.length === 1) {
        attachTo.set(canonicalSourceKey(s.sourceKey), cands[0].raceId);
        keys.push(s.sourceKey);
        continue;
      }
      // Otherwise a new session that may be a race already on the site waits for the owner (push --attach).
      if (skipAttach && cands.length > 0) {
        log(`skipped ${s.sourceKey}: may be ${cands.map((r) => `${r.raceId} (${r.name})`).join("; ")} — owner decides (push --attach)`);
        continue;
      }
      keys.push(s.sourceKey);
    }
  }
  keys = [...new Set(keys.map(canonicalSourceKey))];
  if (keys.length === 0) throw new UsageError("pull needs source keys or --from <discover.json>");
  const h = http();
  const rows = [["RESULT", "FILES", "RESULTS", "DIR"]];
  let failed = 0;
  for (const key of keys) {
    log(`\n${key}`);
    try {
      const s: RaceSession = await resolve(h, key);
      const dir = workDirFor(WORK, s.sourceKey);
      const r = await download(h, s, dir, { force: a.has("force"), log });
      const m = r.manifest;
      const target = attachTo.get(s.sourceKey);
      if (target) {
        m.attachToRaceId = target;
        writeManifest(dir, m);
        log(`  will replace existing race ${target} on push (owner chose --attach-single-candidates)`);
      }
      for (const x of m.missing) log(`  missing: ${x.note}`);
      for (const w of m.warnings) log(`  warning: ${w}`);
      for (const f of r.failed) log(`  FAILED: ${f.name}: ${f.error}`);
      if (r.failed.length) failed++;
      rows.push([
        r.failed.length ? "partial" : r.downloaded.length ? "downloaded" : "unchanged",
        `${m.files.length} (${r.downloaded.length} new)`,
        m.resultsStatus,
        dir,
      ]);
    } catch (e) {
      failed++;
      log(`  ERROR: ${(e as Error).message}`);
      rows.push(["error", "-", "-", key]);
    }
  }
  console.log("\n" + table(rows));
  if (failed) process.exitCode = 1;
}

function loadDir(dir: string): Manifest {
  const m = readManifest(dir);
  if (!m) throw new Error(`${dir}: no manifest.json (run pull first)`);
  return m;
}

async function cmdPush(a: ReturnType<typeof parseArgs>) {
  if (a.pos.length === 0) throw new UsageError("push needs one or more work folders");
  const cfg = apiConfigFromEnv();
  if (!cfg && !a.has("dry-run")) throw new UsageError("Set RACETRACE_API_URL and RACETRACE_API_TOKEN (see .claude/skills/racetrace-ingest/SKILL.md)");
  const attach = a.one("attach");
  if (attach !== undefined && (a.pos.length !== 1 || attach === "true" || !/^[A-Za-z0-9_-]{1,100}$/.test(attach))) {
    throw new UsageError("--attach <raceId> takes one race id and exactly one work folder");
  }
  const rows = [["ACTION", "RACE", "RESULTS", "WARNINGS", "DIR"]];
  let failed = 0;
  for (const d of a.pos) {
    const dir = resolvePath(d);
    const m = loadDir(dir);
    if (attach) {
      m.attachToRaceId = attach;
      writeManifest(dir, m);
      log(`${dir}: will replace the chart of existing race ${attach} and give it the source key ${m.sourceKey}`);
    }
    const added = addManualFiles(dir, m, new Date());
    if (added.length) {
      log(`${dir}: added by hand: ${added.join(", ")}`);
      writeManifest(dir, m);
    }
    const { body, skipped } = buildPushBody(dir, m, { includeArchiveOnly: a.has("archive-only"), force: a.has("force") });
    for (const s of skipped) log(`  not sent: ${s}`);
    const size = JSON.stringify(body).length;
    if (a.has("dry-run")) {
      rows.push(["dry-run", "-", body.resultsStatus, "-", `${dir} (${Object.keys(body.files).length} files, ${(size / 1048576).toFixed(1)} MB)`]);
      continue;
    }
    const r = await apiRequest<any>(cfg!, "POST", "/admin/intake/races", body);
    writeFileSync(join(dir, "intake-result.json"), JSON.stringify({ at: new Date().toISOString(), status: r.status, ...(typeof r.data === "object" ? r.data : { body: String(r.data).slice(0, 2000) }) }, null, 2));
    if (r.status >= 200 && r.status < 300) {
      for (const w of r.data.warnings ?? []) log(`  warning: ${w}`);
      rows.push([r.data.attached ? "attached" : r.data.action, r.data.raceId, body.resultsStatus, String((r.data.warnings ?? []).length), dir]);
    } else {
      failed++;
      log(`  ${dir}: HTTP ${r.status} ${r.data?.code ?? ""}: ${r.data?.error ?? JSON.stringify(r.data).slice(0, 500)}`);
      rows.push([`error ${r.status}`, r.data?.code ?? "-", body.resultsStatus, "-", dir]);
    }
  }
  console.log(table(rows));
  if (failed) process.exitCode = 1;
}

function cmdStatus(a: ReturnType<typeof parseArgs>) {
  for (const d of a.pos.length ? a.pos : []) {
    const dir = resolvePath(d);
    const m = loadDir(dir);
    console.log(`${m.sourceKey}\n  ${m.metadata.name} | ${m.metadata.raceDate} | results ${m.resultsStatus} | version ${m.version}`);
    console.log(table([["KEY", "ROLE", "MARK", "BYTES", "NAME"], ...m.files.map((f) => [f.key, f.role, f.mark ?? "", String(f.bytes), f.name])]).replace(/^/gm, "  "));
    for (const x of m.missing) console.log(`  missing: ${x.note}`);
    const res = join(dir, "intake-result.json");
    if (existsSync(res)) {
      const r = JSON.parse(readFileSync(res, "utf-8"));
      console.log(`  last push: ${r.at} → ${r.action ?? `HTTP ${r.status}`} ${r.raceId ?? ""}`);
    }
  }
}

const STEPS = {
  "build-facts (G2)": join(SERVER, "scripts", "build-facts.ts"),
  "validate-package (G2)": join(SERVER, "src", "analysis", "validate-package.ts"),
  "run-rule-checks (G3)": join(SERVER, "scripts", "run-rule-checks.ts"),
  "build-analysis-input": join(SERVER, "scripts", "build-analysis-input.ts"),
  "merge-analysis": join(SERVER, "scripts", "merge-analysis.ts"),
  "upload-package (G5)": join(SERVER, "scripts", "upload-package.ts"),
};

function cmdSteps(a: ReturnType<typeof parseArgs>) {
  const out = Object.entries(STEPS).map(([k, p]) => ({ step: k, present: existsSync(p), path: p }));
  if (a.has("json")) console.log(JSON.stringify(out, null, 2));
  else console.log(table([["STEP", "PRESENT", "PATH"], ...out.map((o) => [o.step, o.present ? "yes" : "NO", o.path])]));
}

function cmdFacts(a: ReturnType<typeof parseArgs>) {
  const dir = resolvePath(a.pos[0] ?? "");
  const m = loadDir(dir);
  const script = STEPS["build-facts (G2)"];
  if (!existsSync(script)) throw new StepMissing("build-facts is not on this branch (G2). The raw race and legacy charts are imported; skip the analysis package.");
  const pkgId = packageIdFor(m);
  const out = resolvePath(a.one("out") ?? join(REPO, "analysis-runs", pkgId, "facts.json"));
  mkdirSync(dirname(out), { recursive: true });
  const args = [script, ...buildFactsArgs(m, (n) => join(dir, n), out)];
  log(`npx tsx ${args.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ")}`);
  // Node + tsx's CLI directly, no shell: arguments with spaces stay intact on Windows too.
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const r = spawnSync(process.execPath, [tsxCli, ...args], { cwd: SERVER, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`build-facts exited with ${r.status}`);
  console.log(JSON.stringify({ packageId: pkgId, facts: out }));
}

async function cmdValidate(a: ReturnType<typeof parseArgs>) {
  const p = STEPS["validate-package (G2)"];
  if (!existsSync(p)) throw new StepMissing("validate-package is not on this branch (G2).");
  const mod: any = await import(pathToFileURL(p).href);
  if (typeof mod.validatePackage !== "function") throw new StepMissing("validate-package.ts has no validatePackage export.");
  const pkg = JSON.parse(readFileSync(resolvePath(a.pos[0] ?? ""), "utf-8"));
  const base = a.one("base") ? JSON.parse(readFileSync(resolvePath(a.one("base")!), "utf-8")) : undefined;
  const rep = mod.validatePackage(pkg, {
    stage: base ? "analysis" : "facts",
    publish: a.has("publish"),
    ...(base ? { base } : {}),
    ...(a.one("scope-class") ? { scopeClass: a.one("scope-class") } : {}),
  });
  if (a.has("json")) console.log(JSON.stringify(rep, null, 2));
  else {
    for (const w of rep.warnings ?? []) console.log("WARN", w);
    for (const e of rep.errors ?? []) console.log("ERROR", e);
    console.log(rep.ok ? "validate-package: PASS" : `validate-package: FAIL (${rep.errors.length} errors)`);
  }
  if (!rep.ok) process.exitCode = 1;
}

async function cmdPreflight(a: ReturnType<typeof parseArgs>) {
  const checks: [string, boolean, string][] = [];
  const url = process.env.RACETRACE_API_URL;
  const tok = process.env.RACETRACE_API_TOKEN;
  checks.push(["RACETRACE_API_URL set", !!url, url ?? "unset"]);
  checks.push(["RACETRACE_API_TOKEN set", !!tok && tok.startsWith("rt_"), tok ? (tok.startsWith("rt_") ? "set" : "set, but does not start with rt_") : "unset"]);
  checks.push(["SPEEDHIVE_WRL_ORG_ID set (WRL discovery)", !!process.env.SPEEDHIVE_WRL_ORG_ID, process.env.SPEEDHIVE_WRL_ORG_ID ?? "unset (use --speedhive <URL> or speedhive-org)"]);
  const cfg = apiConfigFromEnv();
  if (cfg) {
    try {
      const h = await fetch(`${cfg.url}/health`);
      checks.push(["API reachable (/api/health)", h.ok, `HTTP ${h.status}`]);
    } catch (e) {
      checks.push(["API reachable (/api/health)", false, (e as Error).message]);
    }
    try {
      const w = await apiRequest<any>(cfg, "GET", "/admin/intake/whoami");
      const ok = w.status === 200 && w.data?.via === "api-token" && (w.data?.token?.scopes ?? []).includes("intake");
      checks.push(["Token valid with intake scope", ok, w.status === 200 ? `${w.data.email} via ${w.data.via} (${w.data.token?.prefix ?? ""}…)` : `HTTP ${w.status} ${w.data?.code ?? ""}`]);
    } catch (e) {
      checks.push(["Token valid with intake scope", false, (e as Error).message]);
    }
  }
  checks.push(["Work folder", true, WORK]);
  for (const [k, p] of Object.entries(STEPS)) checks.push([`step ${k}`, existsSync(p), existsSync(p) ? "present" : "not on this branch"]);
  if (a.has("json")) console.log(JSON.stringify(checks.map(([check, ok, detail]) => ({ check, ok, detail })), null, 2));
  else console.log(table([["CHECK", "OK", "DETAIL"], ...checks.map(([c, ok, d]) => [c, ok ? "yes" : "NO", d])]));
  const required = checks.slice(0, 2).concat(checks.filter(([c]) => c.startsWith("API reachable") || c.startsWith("Token valid")));
  if (!cfg || required.some(([, ok]) => !ok)) process.exitCode = 1;
}

async function cmdSpeedhiveOrg(a: ReturnType<typeof parseArgs>) {
  const ref = a.one("from-session") ?? a.one("from-event") ?? a.pos[0];
  if (!ref) throw new UsageError("speedhive-org needs --from-session <Speedhive session URL or id>");
  const r = await speedhiveOrgFromSession(http(), ref);
  console.log(JSON.stringify(r, null, 2));
  if (r.id) log(`\nAdd to .env.intake:  SPEEDHIVE_WRL_ORG_ID=${r.id}`);
}

/** WRL 2025 on Speedhive: a known WRL session (COTA 2025 Sunday) gives the organisation id when none is set. */
const KNOWN_WRL_SPEEDHIVE_SESSION = 11586857;

/** Cars and laps of a pulled session, from the legacy parser (what the site's chart would show). */
async function sessionPrint(dir: string, m: Manifest): Promise<SessionPrint | null> {
  const parser = getParser(m.legacyFormat);
  if (!parser) return null;
  const { body } = buildPushBody(dir, m, { includeArchiveOnly: false });
  const { input, missing } = parserInput(parser, body.files);
  if (missing.length) return null;
  const parsed = await parser.parse(input);
  const cars = Object.entries(parsed.data.cars)
    .filter(([, c]) => (c as { laps: unknown[] }).laps.length > 0)
    .map(([k]) => k);
  return { cars, maxLap: parsed.data.maxLap };
}

/** Every race session of these series and seasons on the timing sites, one per source key. */
async function discoverSessions(h: ReturnType<typeof http>, series: string[], seasons: number[], orgFlag?: string): Promise<RaceSession[]> {
  let org = Number(orgFlag ?? process.env.SPEEDHIVE_WRL_ORG_ID ?? "") || undefined;
  if (!org && series.some((x) => x.split(",").includes("wrl-speedhive"))) {
    try {
      org = (await speedhiveOrgFromSession(h, String(KNOWN_WRL_SPEEDHIVE_SESSION))).id ?? undefined;
      log(`Speedhive WRL organisation: ${org ?? "not found"}`);
    } catch (e) {
      log(`Warning: could not find the Speedhive WRL organisation (${(e as Error).message}); 2025 WRL races will be not-found.`);
    }
  }
  const sessions: RaceSession[] = [];
  for (const season of seasons) {
    for (const sel of series) {
      const ids = sel.split(",").filter((x) => x !== "wrl-speedhive" || org);
      if (!ids.length) continue;
      try {
        sessions.push(...(await discover(h, { series: ids, season, speedhiveOrgId: org, log })));
      } catch (e) {
        log(`Warning: discover ${ids.join(",")} ${season}: ${(e as Error).message}`);
      }
    }
  }
  return [...new Map(sessions.map((x) => [x.sourceKey, x])).values()];
}

/**
 * names-plan / names: bring every race with a source key in line with its timing session —
 * one naming standard (standard-name.ts) and the day the race actually ran. Nothing changes
 * without --apply; ids, links and status are kept.
 */
async function cmdNames(a: ReturnType<typeof parseArgs>) {
  const cfg = apiConfigFromEnv();
  if (!cfg) throw new UsageError("names needs RACETRACE_API_URL and RACETRACE_API_TOKEN");
  const series = a.flags.series ?? ["imsa-*", "sro-*", "wrl", "wrl-speedhive"];
  const seasons = (a.one("season") ?? "2025,2026").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
  const keyed = (await knownRaces()) ?? [];
  const h = http();
  const sessions = new Map((await discoverSessions(h, series, seasons, a.one("org"))).map((s) => [s.sourceKey, s]));

  const changes: IdentityChange[] = [];
  const missing: KnownRace[] = [];
  for (const r of keyed) {
    const s = sessions.get(r.sourceKey);
    if (!s) {
      if (r.season === undefined || seasons.includes(r.season)) missing.push(r);
      continue;
    }
    const c = identityChange(
      { raceId: r.raceId, name: r.name, series: r.series ?? "", track: r.track ?? "", sourceKey: r.sourceKey, date: r.date ?? "", season: r.season ?? s.season },
      { site: s.site, championship: s.championship, sessionName: s.sessionName, track: s.track, raceDate: s.raceDate, season: s.season }
    );
    if (c) changes.push(c);
  }
  changes.sort((x, y) => y.to.date.localeCompare(x.to.date));

  const lines = [
    `NAMES AND DATES: ${changes.length} race(s) to change, ${keyed.length - changes.length - missing.length} already right, ${missing.length} without a session found`,
    "",
    "race id | name now → standard name | date now → session date | season",
    ...changes.map(
      (c) =>
        `${c.raceId} | ${c.from.name} → ${c.to.name} | ${c.from.date === c.to.date ? c.to.date : `${c.from.date} → ${c.to.date}`}${c.from.season === c.to.season ? "" : ` | season ${c.from.season} → ${c.to.season}`}`
    ),
    ...(missing.length ? ["", "NO SESSION FOUND (left as they are)", ...missing.map((r) => `${r.raceId} | ${r.name} | ${r.sourceKey}`)] : []),
  ];

  let applied = 0;
  const failures: string[] = [];
  if (a.has("apply")) {
    for (const c of changes) {
      const res = await apiRequest<any>(cfg, "POST", `/admin/intake/races/${encodeURIComponent(c.raceId)}/identity`, c.to);
      if (res.status >= 200 && res.status < 300) applied++;
      else failures.push(`error ${res.status} ${res.data?.code ?? ""} | ${c.raceId} | ${String(res.data?.error ?? "").slice(0, 160)}`);
    }
    lines.unshift(`APPLIED: ${applied} renamed or re-dated, ${failures.length} failed`, ...failures, "");
  }
  console.log(lines.join("\n"));
  const notes = a.one("notes");
  if (notes) {
    mkdirSync(dirname(notes), { recursive: true });
    writeFileSync(notes, lines.join("\n") + "\n");
  }
  if (failures.length) process.exitCode = 1;
}

/**
 * refresh: pull every race that already has a source key again and push it with force, so a
 * parser change reaches races imported before it (e.g. the finishing status of each car).
 * Same id, link, name and status; nothing is created.
 */
async function cmdRefresh(a: ReturnType<typeof parseArgs>) {
  const cfg = apiConfigFromEnv();
  if (!cfg) throw new UsageError("refresh needs RACETRACE_API_URL and RACETRACE_API_TOKEN");
  const series = a.flags.series ?? ["imsa-*", "sro-*", "wrl", "wrl-speedhive"];
  const sites = sitesFor(series);
  const seasons = (a.one("season") ?? "2025,2026").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
  const limit = Number(a.one("limit") ?? "") || Infinity;
  const keyed = ((await knownRaces()) ?? [])
    .filter((r) => sites.has(r.sourceKey.split(":")[0]) && (r.season === undefined || seasons.includes(r.season)))
    .sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""))
    .slice(0, limit);
  log(`${keyed.length} race(s) to refresh`);
  const h = http();
  const rows = [["ACTION", "RACE", "RESULTS", "WARNINGS", "DIR"]];
  let failed = 0;
  for (const [i, r] of keyed.entries()) {
    log(`[${i + 1}/${keyed.length}] ${r.date ?? ""} ${r.name}`);
    try {
      const s = await resolve(h, r.sourceKey);
      const dir = workDirFor(WORK, s.sourceKey);
      const { manifest: m } = await download(h, s, dir, { log: () => undefined });
      const { body } = buildPushBody(dir, m, { force: true });
      const res = await apiRequest<any>(cfg, "POST", "/admin/intake/races", body);
      if (res.status >= 200 && res.status < 300) rows.push([res.data.action, r.raceId, body.resultsStatus, String((res.data.warnings ?? []).length), r.name]);
      else {
        failed++;
        log(`  ${r.name}: HTTP ${res.status} ${res.data?.code ?? ""}: ${String(res.data?.error ?? "").slice(0, 300)}`);
        rows.push([`error ${res.status}`, r.raceId, res.data?.code ?? "-", "-", r.name]);
      }
      rmSync(dir, { recursive: true, force: true }); // keep the runner's disk small
    } catch (e) {
      failed++;
      log(`  ${r.name}: ERROR ${(e as Error).message}`);
      rows.push(["error", r.raceId, "-", "-", r.name]);
    }
  }
  console.log(table(rows));
  if (failed) process.exitCode = 1;
}

async function cmdReimportPlan(a: ReturnType<typeof parseArgs>) {
  const cfg = apiConfigFromEnv();
  if (!cfg) throw new UsageError("reimport-plan needs RACETRACE_API_URL and RACETRACE_API_TOKEN");
  const series = a.flags.series ?? ["imsa-*", "sro-*", "wrl", "wrl-speedhive"];
  const seasons = (a.one("season") ?? "2025,2026").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
  const ur = await apiRequest<{ races: SiteRace[] }>(cfg, "GET", "/admin/intake/races?unkeyed=1&cars=1");
  if (ur.status !== 200) throw new Error(`GET /admin/intake/races?unkeyed=1&cars=1 → HTTP ${ur.status}`);
  const races = ur.data.races.filter((r) => seasons.includes(r.season));
  log(`${races.length} race(s) on the site without a source key in ${seasons.join(", ")}`);

  const h = http();
  const uniq = await discoverSessions(h, series, seasons, a.one("org"));
  const cands = candidateSessions(races, uniq);
  log(`${uniq.length} session(s) found; ${cands.length} could be one of those races — fetching them to compare cars`);

  const prints = new Map<string, SessionPrint>();
  const dirs = new Map<string, string>();
  for (const [i, s] of cands.entries()) {
    log(`[${i + 1}/${cands.length}] ${s.raceDate} ${s.seriesId} ${s.event} — ${s.sessionName}`);
    try {
      const dir = workDirFor(WORK, s.sourceKey);
      const r = await download(h, s, dir, { log: () => undefined });
      const p = await sessionPrint(dir, r.manifest);
      if (p) {
        prints.set(s.sourceKey, p);
        dirs.set(s.sourceKey, dir);
      } else log("  could not parse (missing lap file?)");
    } catch (e) {
      log(`  skipped: ${(e as Error).message}`);
    }
  }

  const keyed = await knownRaces();
  const taken = new Map((keyed ?? []).map((k) => [k.sourceKey, { raceId: k.raceId, name: k.name }]));
  const rows = planReimport(races, uniq, prints, taken);
  const save = a.one("save") ?? join(WORK, "reimport-plan.json");
  mkdirSync(dirname(save), { recursive: true });
  writeFileSync(save, JSON.stringify({ plannedAt: new Date().toISOString(), seasons, series, rows: rows.map((r) => ({ ...r, dir: r.sourceKey ? dirs.get(r.sourceKey) ?? null : null })) }, null, 2));
  const n = (st: string) => rows.filter((r) => r.state === st).length;
  console.log(
    table([
      ["STATE", "RACE DATE", "SERIES", "RACE ON THE SITE", "SESSION", "CARS", "LAPS", "NOTE"],
      ...rows.map((r) => [
        r.state,
        r.raceDate,
        r.raceSeries,
        `${r.raceName} (${r.raceId})`,
        r.session ? `${r.session.date} ${r.session.event} — ${r.session.sessionName}` : "",
        r.carOverlap !== undefined ? `${Math.round(r.carOverlap * 100)}%` : "",
        r.lapCounts ? `${r.lapCounts[0] ?? "?"}/${r.lapCounts[1]}` : "",
        r.note,
      ]),
    ])
  );
  console.log(`\n${rows.length} race(s): ${n("exact")} exact, ${n("unsure")} unsure, ${n("duplicate")} duplicate, ${n("not-found")} not found. Saved: ${save}`);
  // --notes: the same plan, compact, for the workflow's annotations (they hold ~4 KB each):
  // the races to look at first in full, then the exact pairs one short line each.
  const notes = a.one("notes");
  if (notes) {
    const short = (r: (typeof rows)[number]) =>
      [r.raceDate, r.raceSeries, r.raceName, r.raceId, r.session ? `${r.session.date} ${r.session.event} — ${r.session.sessionName}` : "-", r.carOverlap !== undefined ? `${Math.round(r.carOverlap * 100)}%` : "-", r.lapCounts ? `${r.lapCounts[0] ?? "?"}/${r.lapCounts[1]}` : "-", r.note].join(" | ");
    const lines = [
      `${rows.length} race(s): ${n("exact")} exact, ${n("unsure")} unsure, ${n("duplicate")} duplicate, ${n("not-found")} not found.`,
      "date | series | race on the site | id | session | cars | laps (site/session) | note",
      ...(["unsure", "duplicate", "not-found"] as const).flatMap((st) => {
        const rs = rows.filter((r) => r.state === st);
        return rs.length ? [``, `${st.toUpperCase()} (${rs.length})`, ...rs.map(short)] : [];
      }),
      "",
      `EXACT (${n("exact")})`,
      ...rows.filter((r) => r.state === "exact").map((r) => `${r.raceDate} | ${r.raceSeries} | ${r.raceName} | ${r.raceId} | ${r.session?.date ?? ""} ${r.session?.sessionName ?? ""}`),
    ];
    mkdirSync(dirname(notes), { recursive: true });
    writeFileSync(notes, lines.join("\n") + "\n");
  }

  if (!a.has("apply")) return;
  const out = [["RESULT", "RACE", "SOURCE KEY"]];
  let failed = 0;
  // The owner can approve an "unsure" pair by race id (--approve id,id): it is applied like an exact
  // one, with force so the server's name/date check does not refuse it.
  const approved = new Set((a.flags.approve ?? []).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean));
  for (const id of approved) if (!rows.some((r) => r.raceId === id && r.state === "unsure")) log(`--approve ${id}: no unsure pair with this race id (left alone)`);
  for (const r of rows.filter((x) => x.state === "exact" || (x.state === "unsure" && approved.has(x.raceId)))) {
    const dir = r.sourceKey ? dirs.get(r.sourceKey) : undefined;
    if (!dir) continue;
    const m = readManifest(dir)!;
    m.attachToRaceId = r.raceId;
    writeManifest(dir, m);
    // An approved pair is one the server's own check would refuse (different day name, date or
    // number): the owner's approval is what lets it through, for that race only.
    const { body } = buildPushBody(dir, m, r.state === "unsure" ? { force: true } : {});
    const res = await apiRequest<any>(cfg, "POST", "/admin/intake/races", body);
    if (res.status >= 200 && res.status < 300) out.push([res.data.attached ? "re-imported" : res.data.action, `${r.raceName} (${r.raceId})`, r.sourceKey!]);
    else {
      failed++;
      out.push([`error ${res.status} ${res.data?.code ?? ""}`, `${r.raceName} (${r.raceId})`, `${r.sourceKey}: ${String(res.data?.error ?? "").slice(0, 160)}`]);
    }
  }
  console.log("\n" + table(out));
  // The results go into the notes too, failures first, so the workflow's annotations show them.
  const notesFile = a.one("notes");
  if (notesFile) {
    const ok = out.slice(1).filter((r) => !r[0].startsWith("error"));
    const bad = out.slice(1).filter((r) => r[0].startsWith("error"));
    // Failures first (top of the first annotation), the re-imported races after the plan.
    const head = [`APPLIED: ${ok.length} re-imported, ${bad.length} failed`, ...bad.map((r) => r.join(" | ")), ""];
    const tail = ["", `RE-IMPORTED (${ok.length})`, ...ok.map((r) => `${r[0]} | ${r[1]}`)];
    writeFileSync(notesFile, head.join("\n") + "\n" + readFileSync(notesFile, "utf-8") + tail.join("\n") + "\n");
  }
  if (failed) process.exitCode = 1;
}

/** Source-key site of each intake series selector (imsa-*, sro-gt4, wrl, wrl-speedhive…). */
function sitesFor(selectors: string[]): Set<string> {
  const out = new Set<string>();
  for (const sel of selectors.flatMap((x) => x.split(","))) {
    const x = sel.trim().toLowerCase();
    if (!x) continue;
    if (x.startsWith("imsa")) out.add("imsa");
    else if (x.startsWith("sro")) out.add("sro");
    else if (x === "wrl-speedhive") out.add("speedhive");
    else if (x === "wrl") out.add("redmist");
    else throw new UsageError(`analyze: unknown series "${sel}"`);
  }
  return out;
}

function runTsx(script: string, args: string[]): { status: number | null; out: string } {
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const r = spawnSync(process.execPath, [tsxCli, script, ...args], { cwd: SERVER, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Facts and rule checks for every race that has a source key, uploaded as a DRAFT analysis
 * package. No stories: the package has no race summary, so it cannot be published until the
 * Claude pass writes them. Races whose newest package is not rejected are skipped unless --force.
 */
async function cmdAnalyze(a: ReturnType<typeof parseArgs>) {
  const cfg = apiConfigFromEnv();
  if (!cfg) throw new UsageError("analyze needs RACETRACE_API_URL and RACETRACE_API_TOKEN");
  for (const k of ["build-facts (G2)", "run-rule-checks (G3)", "validate-package (G2)"] as const) {
    if (!existsSync(STEPS[k])) throw new StepMissing(`${k} is not on this branch.`);
  }
  const sites = sitesFor(a.flags.series ?? ["imsa-*", "sro-*", "wrl", "wrl-speedhive"]);
  const seasons = (a.one("season") ?? "2025,2026").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
  const only = new Set(a.flags.race ?? []);
  const limit = Number(a.one("limit") ?? "0") || Infinity;
  const force = a.has("force");

  const all = (await knownRaces()) ?? [];
  const races = all
    .filter((r) => (only.size ? only.has(r.raceId) : sites.has(r.sourceKey.split(":")[0]) && (r.season === undefined || seasons.includes(r.season))))
    // Newest first: stories follow in the same order.
    .sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
  const todo = races.filter((r) => force || only.size || !r.latestPackage || r.latestPackage.status === "REJECTED");
  log(`${races.length} race(s) with a source key; ${races.length - todo.length} already have a package (use --force to rebuild); ${Math.min(todo.length, limit)} to analyze`);

  const validator: any = await import(pathToFileURL(STEPS["validate-package (G2)"]).href);
  const h = http();
  const rows: { result: string; race: KnownRace; detail: string }[] = [];
  for (const [i, r] of todo.slice(0, limit === Infinity ? undefined : limit).entries()) {
    log(`\n[${i + 1}/${Math.min(todo.length, limit)}] ${r.date ?? ""} ${r.name} (${r.raceId})`);
    const add = (result: string, detail: string) => {
      rows.push({ result, race: r, detail });
      log(`  ${result}: ${detail}`);
    };
    try {
      const s = await resolve(h, r.sourceKey);
      const dir = workDirFor(WORK, s.sourceKey);
      const dl = await download(h, s, dir, { log: () => undefined });
      const m = dl.manifest;
      if (dl.failed.length) log(`  some files failed: ${dl.failed.map((f) => f.name).join(", ")}`);
      const runDir = join(dir, "analysis");
      mkdirSync(runDir, { recursive: true });
      const facts = join(runDir, "facts.json");
      const pkgPath = join(runDir, "package.json");

      const bf = runTsx(STEPS["build-facts (G2)"], [...buildFactsArgs(m, (n) => join(dir, n), facts), "--no-validate"]);
      if (bf.status !== 0 || !existsSync(facts)) {
        add("facts failed", bf.out.trim().split("\n").slice(-3).join(" / ").slice(0, 300));
        continue;
      }
      const fpkg = JSON.parse(readFileSync(facts, "utf-8"));
      const blockers = (fpkg.dataQuality ?? []).filter((q: any) => q.severity === "blocker");
      if (blockers.length) {
        add("blocked", blockers.map((q: any) => q.code ?? q.id).join(", "));
        continue;
      }

      const rc = runTsx(STEPS["run-rule-checks (G3)"], [facts, "--out", pkgPath]);
      if (rc.status !== 0 || !existsSync(pkgPath)) {
        add("rule checks failed", rc.out.trim().split("\n").slice(-2).join(" / ").slice(0, 300));
        continue;
      }
      const ruleLine = rc.out.trim().split("\n").find((l) => l.startsWith("checks:") || l.startsWith("no rulebook")) ?? "";

      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const rep = validator.validatePackage(pkg, { stage: "facts" });
      if (!rep.ok) {
        add("invalid", `${rep.errors.length} error(s): ${rep.errors.slice(0, 2).join(" / ").slice(0, 300)}`);
        continue;
      }
      const notes = encodeURIComponent(`intake analyze: facts + rule checks, no stories yet (${m.sourceKey})`);
      const up = await apiRequest<any>(cfg, "POST", `/admin/races/${encodeURIComponent(r.raceId)}/packages?notes=${notes}`, pkg);
      if (up.status === 201) {
        const fails = (pkg.ruleChecks ?? []).filter((c: any) => c.status === "fail").length;
        const unknown = (pkg.ruleChecks ?? []).filter((c: any) => c.status === "unknown").length;
        add("draft uploaded", `v${up.data.package?.version ?? "?"} · ${(pkg.entries ?? []).length} cars · rule checks ${pkg.ruleChecks?.length ?? 0} (${fails} fail, ${unknown} unknown)${ruleLine.startsWith("no rulebook") ? " · no rulebook" : ""}`);
      } else {
        add(`upload ${up.status}`, `${up.data?.code ?? ""} ${String(up.data?.error ?? "").slice(0, 200)}`);
      }
    } catch (e) {
      add("error", (e as Error).message.slice(0, 300));
    }
  }

  const table2 = table([["RESULT", "DATE", "RACE", "ID", "DETAIL"], ...rows.map((x) => [x.result, x.race.date ?? "", x.race.name, x.race.raceId, x.detail])]);
  console.log(table2);
  const n = (res: string) => rows.filter((x) => x.result === res).length;
  const summary = `${rows.length} race(s): ${n("draft uploaded")} draft uploaded, ${n("blocked")} blocked, ${rows.length - n("draft uploaded") - n("blocked")} failed.`;
  console.log(`\n${summary}`);
  const notes = a.one("notes");
  if (notes) {
    mkdirSync(dirname(notes), { recursive: true });
    const failedFirst = [...rows].sort((x, y) => Number(x.result === "draft uploaded") - Number(y.result === "draft uploaded"));
    writeFileSync(notes, [summary, "result | date | race | id | detail", ...failedFirst.map((x) => [x.result, x.race.date ?? "", x.race.name, x.race.raceId, x.detail].join(" | "))].join("\n") + "\n");
  }
  if (rows.some((x) => x.result !== "draft uploaded" && x.result !== "blocked")) process.exitCode = 1;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  switch (cmd) {
    case "discover":
      return cmdDiscover(a);
    case "pull":
      return cmdPull(a);
    case "push":
      return cmdPush(a);
    case "status":
      return cmdStatus(a);
    case "facts":
      return cmdFacts(a);
    case "validate":
      return cmdValidate(a);
    case "steps":
      return cmdSteps(a);
    case "preflight":
      return cmdPreflight(a);
    case "speedhive-org":
      return cmdSpeedhiveOrg(a);
    case "reimport-plan":
      return cmdReimportPlan(a);
    case "analyze":
      return cmdAnalyze(a);
    case "names":
      return cmdNames(a);
    case "refresh":
      return cmdRefresh(a);
    default:
      throw new UsageError(`Unknown command "${cmd ?? ""}". Commands: preflight, discover, pull, push, status, facts, validate, steps, speedhive-org, reimport-plan, analyze, names, refresh`);
  }
}

main().catch((e) => {
  log(`${e instanceof StepMissing ? "SKIPPED" : "ERROR"}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof UsageError ? 2 : e instanceof StepMissing ? 3 : 1);
});
