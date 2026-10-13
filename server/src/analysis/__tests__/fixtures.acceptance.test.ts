/**
 * Fixture acceptance (FACT_ENGINE_SPEC.md §8.2 T1-T5): every Stage 1 pit passage of the 8 races,
 * with fixture_deltas.json applied, against the spec tolerances. Raw files are read from
 * $RACETRACE_FIXTURE_DATA/<race>/ and the tests skip when it is unset (the files are third-party
 * data and are not in the repo). Every remaining mismatch must be listed in known-gaps.json.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFacts } from "../buildFacts.js";
import { validatePackage } from "../validate-package.js";
import { compareRace } from "./compare-fixture.js";
import { FIXTURE_RACES, fixtureAvailable, loadFixtureInputs } from "./fixture-races.js";

const gaps = JSON.parse(readFileSync(new URL("../__fixtures__/known-gaps.json", import.meta.url), "utf8"));

describe("Stage 1 fixtures (RACETRACE_FIXTURE_DATA)", () => {
  for (const fr of FIXTURE_RACES) {
    it.skipIf(!fixtureAvailable(fr.race))(`${fr.race}: passages match within tolerance; package validates`, async () => {
      const pkg = buildFacts({ format: fr.format, files: await loadFixtureInputs(fr), options: fr.options });
      const exp = JSON.parse(readFileSync(new URL(`../__fixtures__/expected/${fr.race}.json`, import.meta.url), "utf8"));
      const r = compareRace(pkg, exp);
      const got = r.mismatches.map((m) => `${m.key} ${m.field}`).sort();
      const known = Object.keys(gaps.passages[fr.race] ?? {}).sort();
      expect(got).toEqual(known);
      const gotRace = r.raceLevel.map((m) => `${m.key} ${m.field}`).sort();
      expect(gotRace).toEqual(Object.keys(gaps.raceLevel[fr.race] ?? {}).sort());
      const rep = validatePackage(pkg, { publish: false });
      expect(rep.errors).toEqual([]);
      // T12 determinism: a second build is byte-identical.
      const again = buildFacts({ format: fr.format, files: await loadFixtureInputs(fr), options: fr.options });
      expect(JSON.stringify(again)).toEqual(JSON.stringify(pkg));
    }, 120_000);
  }
});
