/**
 * Run the rulebook checks on a Race Analysis Package and merge the results into it.
 *
 *   npx tsx scripts/run-rule-checks.ts <package.json> --series <id|name> --season <yyyy> [--event <key>]
 *        [--session <key>] [--no-event] [--rulebook-dir <dir>] [--out <file>]
 *
 * Writes (schema 1.1.0 rule-check contract):
 *   ruleChecks[]   one check per rule × subject (car, stop, stint, driver) evaluated, passes included, with the
 *                  citation, severityCeiling and race-control linkage (officialAction)
 *   ruleMarkers[]  kind = earliest_legal_pit, per car
 *   ruleCoverage   rules run (with check counts) and rules not checkable (with the reason and open questions)
 *   rulebook, rulebookVersion, completeness.ruleChecks
 * It never writes ruleFindings[]: the Claude pass (/analyze-race) writes them from the checks.
 * The package is written back in place unless --out is given. No database access.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultRulebookDir,
  RulebookError,
  selectRulebook,
} from "../src/rules/load-rulebook.js";
import { runRuleChecks } from "../src/rules/run-rule-checks.js";
import { markRuleChecksAbsent, mergeRuleChecks } from "../src/rules/merge-rule-checks.js";
import type { RaceAnalysisPackage } from "../src/analysis/schema/package-types.js";

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`);
  console.error(
    "usage: run-rule-checks.ts <package.json> --series <id|name> --season <yyyy> [--event <key>] [--session <key>] [--no-event] [--rulebook-dir <dir>] [--out <file>]"
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-event") out.noEvent = true;
    else if (a.startsWith("--")) {
      const v = argv[++i];
      if (v === undefined) usage(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else pos.push(a);
  }
  if (pos.length !== 1) usage("exactly one package file");
  return { file: pos[0], ...out } as {
    file: string;
    series?: string;
    season?: string;
    event?: string;
    session?: string;
    noEvent?: boolean;
    "rulebook-dir"?: string;
    out?: string;
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const path = resolve(args.file);
  const pkg = JSON.parse(readFileSync(path, "utf8")) as RaceAnalysisPackage;
  const series = args.series ?? pkg.metadata?.seriesId ?? pkg.metadata?.series;
  const season = Number(args.season ?? pkg.metadata?.season);
  if (!series) usage("--series is required (no metadata.seriesId in the package)");
  if (!Number.isInteger(season)) usage("--season must be a year");

  const rb = selectRulebook(series, season, args["rulebook-dir"] ?? defaultRulebookDir());
  const outPath = resolve(args.out ?? path);
  if (!rb) {
    // D2: series without v1 rule checks get facts and stories but no rule checks.
    writeFileSync(outPath, `${JSON.stringify(markRuleChecksAbsent(pkg), null, 1)}\n`);
    console.log(`no rulebook for ${series} ${season}: rule checks absent`);
    return;
  }

  const res = runRuleChecks(pkg, rb, {
    eventKey: args.event ?? null,
    sessionKey: args.session ?? null,
    noEvent: !!args.noEvent,
  });
  writeFileSync(outPath, `${JSON.stringify(mergeRuleChecks(pkg, res, rb), null, 1)}\n`);

  const checks = res.ruleChecks;
  const count = (f: (c: (typeof checks)[number]) => boolean) => checks.filter(f).length;
  const cov = res.ruleCoverage;
  console.log(
    `${rb.id} event=${res.rulebook.eventKey ?? "none"} session=${res.rulebook.sessionKey ?? "none"} hash=${res.rulebook.sha256.slice(0, 12)}\n` +
      `rules run: ${new Set(cov.run.map((r) => r.ruleId)).size}, not checkable: ${cov.notCheckable.length}\n` +
      `checks: ${checks.length} (pass ${count((c) => c.status === "pass")}, fail ${count((c) => c.status === "fail")}, ` +
      `unknown ${count((c) => c.status === "unknown")}, not_applicable ${count((c) => c.status === "not_applicable")}); ` +
      `ceiling of non-pass: likely ${count((c) => c.status !== "pass" && c.severityCeiling === "likely")}, ` +
      `possible ${count((c) => c.status !== "pass" && c.severityCeiling === "possible")}, ` +
      `info ${count((c) => c.status !== "pass" && c.severityCeiling === "info")}; markers: ${res.ruleMarkers.length}`
  );
  for (const c of checks.filter((x) => x.status !== "pass" && x.severityCeiling !== "info")) {
    console.log(
      `  ${c.id} ${c.status} ceiling ${c.severityCeiling}: measured ${c.measured} vs ${c.limit} (official action: ${(c.officialAction ?? []).join(",") || "none"})`
    );
  }
  for (const n of cov.notCheckable.filter(
    (x) => x.reason === "tbd_value" || x.reason === "unsourced_value"
  )) {
    console.log(`  not checkable ${n.ruleId}: ${n.reason} ${n.detail}`);
  }
  if (pkg.ruleFindings?.length)
    console.log(
      `  note: the package already has ${pkg.ruleFindings.length} ruleFindings; they are left as they are (rewrite them with /analyze-race)`
    );
}

try {
  main();
} catch (e) {
  if (e instanceof RulebookError) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
