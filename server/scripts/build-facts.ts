/**
 * Build the fact sections of a Race Analysis Package from raw race files.
 *
 *   npx tsx scripts/build-facts.ts <format> <file…> --out pkg.json [options]
 *
 * format: speedhive | wrl-website | alkamel-sro | alkamel-grcup | alkamel-imsa | redmist
 * (redmist: <event>_<session>_laps.json [+ _pits.json _results.json _flags.json _control.json])
 * File roles are detected from the timing-provider file names; override one with role=path
 * (e.g. results=/path/x.csv). Options:
 *   --date YYYY-MM-DD        race date (required for wrl-website; must agree with a dated file otherwise)
 *   --start HH:MM:SS         local start clock (wrl-website)
 *   --track-id ID --track-name NAME --tz IANA_ZONE [--layout L]
 *   --series S --event E --session S --season N --package-id ID
 *   --cycle-model rounds|windows|singleton   (rulebook pitCycleModel)
 *   --duration SECONDS       scheduled race duration (drive time ends at expiry)
 *   --transit SECONDS        configured pit-lane transit
 *   --garage SECONDS         garage threshold (default 600)
 *   --generated-at ISO       fixed generatedAt (default: now)
 *   --no-validate            skip validate-package after writing
 * The package is a schema-valid draft: carStories empty, raceSummary null.
 */
import { writeFile } from "node:fs/promises";
import { buildFacts } from "../src/analysis/buildFacts.js";
import { loadInputFile } from "../src/analysis/inputs.js";
import { validatePackage } from "../src/analysis/validate-package.js";
import type { BuildOptions, EngineRulebook } from "../src/analysis/types.js";
import type { SourceFileRole, SourceFormat } from "../src/analysis/schema/package-types.js";
import { SOURCE_FORMATS } from "../src/analysis/adapters/index.js";

async function main() {
  const argv = process.argv.slice(2);
  const format = argv.shift() as SourceFormat;
  if (!SOURCE_FORMATS.includes(format)) {
    console.error(`usage: build-facts.ts <${SOURCE_FORMATS.join("|")}> <files…> --out pkg.json`);
    process.exit(2);
  }
  const files: { path: string; role?: SourceFileRole }[] = [];
  const flags: Record<string, string> = {};
  let validate = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-validate") validate = false;
    else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i];
    else {
      const m = a.match(/^([a-z_]+)=(.+)$/);
      if (m && /^(laps|time_cards|summary|results|results_by_class|pit_cards_json|pit_cards_pdf|drive_time|flags|control_log|lap_chart|weather|other)$/.test(m[1])) files.push({ path: m[2], role: m[1] as SourceFileRole });
      else files.push({ path: a });
    }
  }
  if (!flags.out) throw new Error("--out is required");
  const rb: EngineRulebook = {};
  if (flags["cycle-model"]) rb.pitCycleModel = flags["cycle-model"] as EngineRulebook["pitCycleModel"];
  if (flags.duration) rb.scheduledDurationS = Number(flags.duration);
  if (flags.transit) rb.pitLaneTransitS = Number(flags.transit);
  if (flags.garage) rb.garageThresholdS = Number(flags.garage);
  const opts: BuildOptions = {
    raceDate: flags.date,
    startClock: flags.start,
    series: flags.series,
    event: flags.event,
    session: flags.session,
    season: flags.season ? Number(flags.season) : undefined,
    packageId: flags["package-id"],
    generatedAt: flags["generated-at"] ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    rulebook: Object.keys(rb).length ? rb : null,
  };
  if (flags["track-id"] || flags.tz) {
    opts.track = { id: flags["track-id"] ?? "tbd", name: flags["track-name"] ?? flags["track-id"] ?? "TBD", timezone: flags.tz ?? "UTC", ...(flags.layout ? { layout: flags.layout } : {}) };
  }
  const inputs = await Promise.all(files.map((f) => loadInputFile(f.path, { role: f.role })));
  const t0 = performance.now();
  const pkg = buildFacts({ format, files: inputs, options: opts });
  const ms = performance.now() - t0;
  const json = JSON.stringify(pkg);
  await writeFile(flags.out, json);
  console.log(`wrote ${flags.out}: ${json.length} bytes, ${pkg.entries.length} entries, ${pkg.events.pitPassages.length} passages, ${pkg.pitCycles.length} cycles, built in ${ms.toFixed(0)} ms`);
  if (validate) {
    const rep = validatePackage(pkg, { publish: false });
    for (const w of rep.warnings) console.log("WARN", w);
    for (const e of rep.errors) console.log("ERROR", e);
    console.log(rep.ok ? "validate-package: PASS" : `validate-package: FAIL (${rep.errors.length} errors)`);
    if (!rep.ok) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
