/**
 * Dev helper: build each Stage 1 race and list every mismatch against expected/<race>.json.
 *   RACETRACE_FIXTURE_DATA=/home/claude/fixture-data npx tsx scripts/fixture-compare.ts [race…] [--all]
 */
import { readFileSync } from "node:fs";
import { buildFacts } from "../src/analysis/buildFacts.js";
import { FIXTURE_RACES, loadFixtureInputs } from "../src/analysis/__tests__/fixture-races.js";
import { compareRace } from "../src/analysis/__tests__/compare-fixture.js";

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const races = args.filter((a) => !a.startsWith("--"));
  for (const fr of FIXTURE_RACES) {
    if (races.length && !races.includes(fr.race)) continue;
    const pkg = buildFacts({ format: fr.format, files: await loadFixtureInputs(fr), options: fr.options });
    const exp = JSON.parse(readFileSync(new URL(`../src/analysis/__fixtures__/expected/${fr.race}.json`, import.meta.url), "utf8"));
    const r = compareRace(pkg, exp);
    console.log(`${fr.race}: ${r.matchedPassages}/${r.totalPassages} passages match; ${r.mismatches.length} field mismatches; ${r.raceLevel.length} race-level`);
    for (const m of r.raceLevel) console.log("  RACE", m.key, m.field, JSON.stringify(m.expected), "=>", JSON.stringify(m.actual));
    for (const m of r.mismatches.slice(0, all ? 1e9 : 25)) console.log("  ", m.key, m.field, JSON.stringify(m.expected), "=>", JSON.stringify(m.actual));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
