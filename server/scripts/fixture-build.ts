/**
 * Dev helper: build the Stage 1 fixture races from $RACETRACE_FIXTURE_DATA and write packages.
 *   RACETRACE_FIXTURE_DATA=/home/claude/fixture-data npx tsx scripts/fixture-build.ts <outDir> [race…]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { buildFacts } from "../src/analysis/buildFacts.js";
import { validatePackage } from "../src/analysis/validate-package.js";
import { FIXTURE_RACES, loadFixtureInputs } from "../src/analysis/__tests__/fixture-races.js";

async function main() {
  const [outDir, ...races] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  for (const fr of FIXTURE_RACES) {
    if (races.length && !races.includes(fr.race)) continue;
    const inputs = await loadFixtureInputs(fr);
    const t0 = performance.now();
    const pkg = buildFacts({ format: fr.format, files: inputs, options: fr.options });
    const ms = performance.now() - t0;
    const json = JSON.stringify(pkg);
    writeFileSync(join(outDir, `${fr.race}.json`), json);
    const rep = validatePackage(pkg, { publish: false });
    console.log(
      `${fr.race}: ${pkg.entries.length} cars, ${pkg.events.pitPassages.length} passages, ${pkg.pitCycles.length} cycles, ${pkg.fcyPeriods.length} fcy, ${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gz), ${ms.toFixed(0)} ms, validate ${rep.ok ? "PASS" : "FAIL"}`,
    );
    for (const e of rep.errors.slice(0, 10)) console.log("  ERROR", e);
    for (const q of pkg.dataQuality.filter((x) => x.severity !== "note").slice(0, 12)) console.log(`  ${q.severity} ${q.code}: ${q.message.slice(0, 160)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
