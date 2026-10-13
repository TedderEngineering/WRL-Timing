/**
 * Feature switches for Race Analysis Packages (RaceTrace 2.0, G5).
 *
 * Both are read from process.env on every call, like GRIP_PRICING, so a
 * redeploy with a changed variable (or a test) takes effect without a code
 * change. config/env.ts validates the same variables at boot.
 */

export type RuleFlagsStage = "R0" | "R1" | "R2";

/** RACETRACE_PACKAGES=on|off. Anything but "on" is off: the safe default. */
export function packagesFlagOn(): boolean {
  return (process.env.RACETRACE_PACKAGES ?? "off").trim().toLowerCase() === "on";
}

/**
 * Whether ordinary viewers get the package for this race. Off globally is the
 * one-step fallback to the legacy chartData; `packagesDisabled` keeps a single
 * race on the legacy view while the rest use packages.
 */
export function packagesEnabledFor(race: { packagesDisabled?: boolean | null }): boolean {
  return packagesFlagOn() && race.packagesDisabled !== true;
}

/** RACETRACE_RULE_FLAGS=R0|R1|R2 (GUI_SYSTEM_SPEC OD-3). Unknown values fall back to R0. */
export function ruleFlagsStage(): RuleFlagsStage {
  const v = (process.env.RACETRACE_RULE_FLAGS ?? "R0").trim().toUpperCase();
  return v === "R1" || v === "R2" ? v : "R0";
}

/**
 * Whether a viewer may see `ruleChecks` and `ruleFindings`.
 * R0: admins only. R1: admins and the Team plan. R2: every signed-in user.
 */
export function canSeeRuleFlags(
  viewer: { role: string | null; plan: string | null; signedIn: boolean },
  stage: RuleFlagsStage = ruleFlagsStage()
): boolean {
  if (viewer.role === "ADMIN") return true;
  if (stage === "R1") return viewer.plan === "TEAM";
  if (stage === "R2") return viewer.signedIn;
  return false;
}
