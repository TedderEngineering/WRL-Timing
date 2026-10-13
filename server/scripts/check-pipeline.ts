/**
 * End-to-end check of the package pipeline on the reference races:
 *
 *   build-facts.ts → run-rule-checks.ts → validate-package (facts stage)
 *
 *   RACETRACE_FIXTURE_DATA=/home/claude/fixture-data npx tsx scripts/check-pipeline.ts [race…] [--keep <dir>]
 *
 * Each race is built with the build-facts CLI from the raw files in $RACETRACE_FIXTURE_DATA/<race>/ (the build
 * options of src/analysis/__tests__/fixture-races.ts), the run-rule-checks CLI merges the rule checks with the
 * race's rulebook / event keys (RULE_ARGS below, from src/rules/rulebooks/*.yaml; --no-event where the rulebook
 * has no event for the race), and validatePackage checks the result. Exit code 1 when any race fails.
 * Packages are written to a temporary directory, or to --keep <dir>.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_RACES, type FixtureRace } from "../src/analysis/__tests__/fixture-races.js";
import { validatePackage } from "../src/analysis/validate-package.js";
import type { RaceAnalysisPackage } from "../src/analysis/schema/package-types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");

/** run-rule-checks arguments per race (rulebook series / season / event / session keys). */
export const RULE_ARGS: Record<string, string[]> = {
  mpc_road_atlanta: ["--series", "imsa-mpc", "--season", "2026", "--event", "road-atlanta-2026-10"],
  gt4_indy_r1: ["--series", "sro-gt4-america", "--season", "2026", "--event", "indianapolis-2026-10", "--session", "race1"],
  gt4_indy_r2: ["--series", "sro-gt4-america", "--season", "2026", "--event", "indianapolis-2026-10", "--session", "race2"],
  sro_cota_r1: ["--series", "sro-gt4-america", "--season", "2026", "--no-event"],
  // no Toyota GR Cup rulebook in v1 (BRIEF D2): run-rule-checks marks rule checks absent
  grcup_cota_r1: ["--series", "toyota-gr-cup", "--season", "2026", "--no-event"],
  barber: ["--series", "wrl", "--season", "2026", "--event", "barber-2026-02"],
  cota_sat: ["--series", "wrl", "--season", "2026", "--no-event"],
  sunday7: ["--series", "wrl", "--season", "2026", "--no-event"],
};

function buildArgs(fr: FixtureRace, dir: string, out: string): string[] {
  const names = readdirSync(dir);
  const files = fr.files.map((re) => {
    const n = names.find((x) => re.test(x));
    if (!n) throw new Error(`${fr.race}: no file matching ${re}`);
    return join(dir, n);
  });
  const o = fr.options;
  const a: string[] = [fr.format, ...files, "--out", out, "--no-validate"];
  const flag = (k: string, v: string | number | undefined | null) => {
    if (v !== undefined && v !== null) a.push(`--${k}`, String(v));
  };
  flag("date", o.raceDate);
  flag("start", o.startClock);
  flag("series", o.series);
  flag("event", o.event);
  flag("session", o.session);
  flag("season", o.season);
  flag("package-id", o.packageId);
  flag("generated-at", o.generatedAt);
  flag("track-id", o.track?.id);
  flag("track-name", o.track?.name);
  flag("tz", o.track?.timezone);
  flag("layout", o.track?.layout);
  flag("cycle-model", o.rulebook?.pitCycleModel);
  flag("duration", o.rulebook?.scheduledDurationS);
  flag("transit", o.rulebook?.pitLaneTransitS);
  flag("garage", o.rulebook?.garageThresholdS);
  return a;
}

function tsx(script: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(SERVER, "scripts", script), ...args], {
    cwd: SERVER,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function main(): number {
  const argv = process.argv.slice(2);
  let keep: string | null = null;
  const races: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--keep") keep = argv[++i];
    else races.push(argv[i]);
  }
  const root = process.env.RACETRACE_FIXTURE_DATA;
  if (!root) {
    console.error("RACETRACE_FIXTURE_DATA is not set");
    return 2;
  }
  const outDir = keep ?? mkdtempSync(join(tmpdir(), "racetrace-pipeline-"));
  mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const fr of FIXTURE_RACES) {
    if (races.length && !races.includes(fr.race)) continue;
    const pkgPath = join(outDir, `${fr.race}.json`);
    const lines: string[] = [];
    let ok = true;
    const b = tsx("build-facts.ts", buildArgs(fr, join(root, fr.race), pkgPath));
    if (!b.ok) {
      console.log(`${fr.race}: build-facts FAILED\n  ${b.out.split("\n").join("\n  ")}`);
      failed++;
      continue;
    }
    const r = tsx("run-rule-checks.ts", [pkgPath, ...(RULE_ARGS[fr.race] ?? [])]);
    if (!r.ok) {
      console.log(`${fr.race}: run-rule-checks FAILED\n  ${r.out.split("\n").join("\n  ")}`);
      failed++;
      continue;
    }
    lines.push(...r.out.split("\n").map((l) => `  ${l}`));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as RaceAnalysisPackage;
    const rep = validatePackage(pkg, { publish: false });
    if (!rep.ok) ok = false;
    for (const e of rep.errors.slice(0, 20)) lines.push(`  ERROR ${e}`);
    for (const w of rep.warnings.filter((x) => !x.startsWith("V5 "))) lines.push(`  WARN ${w}`);
    if (pkg.ruleFindings.length) {
      ok = false;
      lines.push(`  ERROR the rule checks wrote ${pkg.ruleFindings.length} ruleFindings`);
    }
    const st = (s: string) => pkg.ruleChecks.filter((c) => c.status === s).length;
    console.log(
      `${fr.race}: ${ok ? "PASS" : "FAIL"} — rulebook ${pkg.rulebook.status}${pkg.rulebook.fileId ? ` ${pkg.rulebook.fileId}` : ""}, ` +
        `${pkg.ruleChecks.length} checks (pass ${st("pass")}, fail ${st("fail")}, unknown ${st("unknown")}, n/a ${st("not_applicable")}), ` +
        `${pkg.ruleMarkers?.length ?? 0} markers, ${pkg.ruleCoverage?.notCheckable.length ?? 0} not checkable; ` +
        `validate-package ${rep.ok ? "PASS" : `FAIL (${rep.errors.length} errors)`}`
    );
    for (const l of lines) console.log(l);
    if (!ok) failed++;
  }
  console.log(failed ? `${failed} race(s) FAILED` : "all races PASS");
  if (!keep) console.log(`packages in ${outDir}`);
  return failed ? 1 : 0;
}

process.exit(main());
