/**
 * Run the rulebook checks on a Race Analysis Package and merge the results into it.
 *
 *   npx tsx scripts/run-rule-checks.ts <package.json> --series <id|name> --season <yyyy> [--event <key>]
 *        [--session <key>] [--no-event] [--rulebook-dir <dir>] [--out <file>]
 *
 * Writes (schema 1.1 decisions, 12 Oct 2026):
 *   ruleFindings[]      engine findings, `statement: null` (the Claude pass writes it)
 *   ruleMarkers[]       kind = earliest_legal_pit, per car
 *   ruleChecksRun[]     every rule evaluated, with pass / finding counts
 *   rulesNotCheckable[] every rule not evaluated, with the reason (TBD value, data, context-only ...)
 *   rulebook, rulebookVersion, completeness.ruleChecks
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
import {
  markRuleChecksAbsent,
  mergeRuleChecks,
  type PackageWithRuleChecks,
} from "../src/rules/merge-rule-checks.js";

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
  const pkg = JSON.parse(readFileSync(path, "utf8")) as PackageWithRuleChecks;
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

  const sev = (s: string) => res.ruleFindings.filter((f) => f.severity === s).length;
  console.log(
    `${rb.id} event=${res.rulebook.eventKey ?? "none"} session=${res.rulebook.sessionKey ?? "none"} hash=${res.rulebook.sha256.slice(0, 12)}\n` +
      `rules run: ${res.checksRun.length}, not checkable: ${res.notCheckable.length}\n` +
      `findings: ${res.ruleFindings.length} (likely ${sev("likely")}, possible ${sev("possible")}, info ${sev("info")}); markers: ${res.ruleMarkers.length}`
  );
  for (const f of res.ruleFindings.filter((x) => x.severity !== "info")) {
    console.log(
      `  ${f.id} ${f.ruleId} car ${f.car} ${f.severity}: measured ${JSON.stringify(f.measured)} vs ${JSON.stringify(f.threshold)} (race control: ${f.raceControl.status})`
    );
  }
  for (const n of res.notCheckable.filter(
    (x) => x.reason === "tbd_value" || x.reason === "unsourced_value"
  )) {
    console.log(`  not checkable ${n.ruleId}: ${n.reason} ${n.detail}`);
  }
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
