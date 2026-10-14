/**
 * RaceTrace intake CLI (RaceTrace 2.0, G4). Run from server/:
 *
 *   npx tsx scripts/intake.ts preflight
 *   npx tsx scripts/intake.ts discover --series imsa-mpc,sro-gt4,sro-grcup,wrl --season 2026 [--since 2026-09-01]
 *                                      [--all-sessions] [--redmist <event id|event/session>]…
 *                                      [--json] [--save <file>]
 *   npx tsx scripts/intake.ts discover --series wrl-speedhive --season 2025 [--org <speedhive org id>] [--speedhive <event|session URL>]…
 *   npx tsx scripts/intake.ts pull <sourceKey…> | --from <discover.json> [--states new,changed,results-upgrade] [--force]
 *   npx tsx scripts/intake.ts push <dir…> [--force] [--dry-run] [--no-archive-only]
 *   npx tsx scripts/intake.ts push <dir> --attach <raceId>      replace an existing race that has no source key yet
 *   npx tsx scripts/intake.ts status <dir…>
 *   npx tsx scripts/intake.ts facts <dir> [--out <file>]        G2 build-facts on the folder's files (when present)
 *   npx tsx scripts/intake.ts validate <draft.json> [--base <facts.base.json>] [--scope-class <id>] [--publish] [--json]
 *   npx tsx scripts/intake.ts steps                              which pipeline scripts this checkout has
 *   npx tsx scripts/intake.ts speedhive-org --from-session <URL|id>
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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
  const org = Number(a.one("org") ?? process.env.SPEEDHIVE_WRL_ORG_ID ?? "") || undefined;
  const sessions = await discover(http(), {
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
  const from = a.one("from");
  if (from) {
    const states = (a.one("states") ?? "new,changed,results-upgrade").split(",");
    const d = JSON.parse(readFileSync(from, "utf-8")) as { sessions: { state: string; sourceKey: string }[] };
    keys.push(...d.sessions.filter((s) => states.includes(s.state)).map((s) => s.sourceKey));
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
    const { body, skipped } = buildPushBody(dir, m, { includeArchiveOnly: !a.has("no-archive-only"), force: a.has("force") });
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
    default:
      throw new UsageError(`Unknown command "${cmd ?? ""}". Commands: preflight, discover, pull, push, status, facts, validate, steps, speedhive-org`);
  }
}

main().catch((e) => {
  log(`${e instanceof StepMissing ? "SKIPPED" : "ERROR"}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof UsageError ? 2 : e instanceof StepMissing ? 3 : 1);
});
