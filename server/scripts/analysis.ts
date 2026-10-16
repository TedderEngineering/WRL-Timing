/**
 * Writing an analysis (racetrace-ingest steps 8–9) on a facts package made by
 * `intake analyze --no-upload` (or `intake facts` + run-rule-checks):
 *
 *   npx tsx scripts/analysis.ts digest <package.json> [--out <dir>]
 *       race.md and one <class>.md per class: every fact with its id and the field names to cite.
 *   npx tsx scripts/analysis.ts merge <package.json> <patches dir> --out <draft.json> [--skill <name>]
 *       merges patches/*.json (analysis-patch/1), fills each ref's value, unit and display from its
 *       fact, then validates (stage "analysis", publish gate) and prints every problem.
 *   npx tsx scripts/analysis.ts check <package.json> <patch.json>
 *       one class patch on its own: merged alone and validated for its class only.
 *
 * Upload a clean draft with `intake upload <raceId> <draft.json>`. Nothing here publishes.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { classDigest, mergePatches, raceDigest, type AnalysisPatch } from "../src/analysis/patches.js";
import { validatePackage } from "../src/analysis/validate-package.js";
import type { RaceAnalysisPackage } from "../src/analysis/schema/package-types.js";

const read = <T>(p: string): T => JSON.parse(readFileSync(resolve(p), "utf-8")) as T;
const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = (s: string) => s.replace(/[^A-Za-z0-9+_-]+/g, "_");

function report(rep: ReturnType<typeof validatePackage>, problems: string[]): boolean {
  for (const p of problems) console.log("MERGE", p);
  for (const w of rep.warnings) console.log("WARN", w);
  for (const e of rep.errors) console.log("ERROR", e);
  const ok = rep.ok && problems.length === 0;
  console.log(ok ? "PASS" : `FAIL (${rep.errors.length} validator error(s), ${problems.length} merge problem(s))`);
  return ok;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "digest") {
    const P = read<RaceAnalysisPackage>(args[0]);
    const out = resolve(flag(args, "out") ?? join(resolve(args[0], ".."), "digest"));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "race.md"), raceDigest(P));
    for (const c of P.metadata.classes) writeFileSync(join(out, `${slug(c.id)}.md`), classDigest(P, c.id));
    console.log(`digest: ${out} (race.md + ${P.metadata.classes.length} class file(s))`);
    return;
  }
  if (cmd === "merge") {
    const base = read<RaceAnalysisPackage>(args[0]);
    const dir = resolve(args[1]);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const patches = files.map((f) => read<AnalysisPatch>(join(dir, f)));
    const { pkg, problems } = mergePatches(base, patches, { skill: flag(args, "skill") ?? "racetrace-ingest" });
    const out = resolve(flag(args, "out") ?? join(dir, "..", "draft.json"));
    writeFileSync(out, JSON.stringify(pkg, null, 1));
    console.log(`merged ${files.length} patch(es) → ${out}`);
    const rep = validatePackage(pkg, { stage: "analysis", publish: true, base });
    if (!report(rep, problems)) process.exitCode = 1;
    return;
  }
  if (cmd === "check") {
    const base = read<RaceAnalysisPackage>(args[0]);
    const patch = read<AnalysisPatch>(args[1]);
    const { pkg, problems } = mergePatches(base, [patch]);
    const scope = patch.scope.kind === "class" ? patch.scope.class : undefined;
    const rep = validatePackage(pkg, { stage: "analysis", base, ...(scope ? { scopeClass: scope } : {}) });
    // A class patch alone has no summary and other classes' stories: those rules are not its errors.
    const own = scope ? rep.errors.filter((e) => !/summary|A19|A18|story for car|classSummaries/.test(e)) : rep.errors;
    console.log(`check ${basename(args[1])} (${scope ? `class ${scope}` : "race"})`);
    if (!report({ ...rep, ok: own.length === 0, errors: own }, problems)) process.exitCode = 1;
    return;
  }
  console.error("Usage: analysis.ts digest <package.json> [--out dir] | merge <package.json> <patches dir> --out <draft.json> | check <package.json> <patch.json>");
  process.exitCode = 2;
}

main();
