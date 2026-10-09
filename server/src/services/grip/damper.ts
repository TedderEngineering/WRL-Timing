/**
 * Finding Grip — damper tuning lookup.
 *
 * The table itself is proprietary and lives only in the database
 * (grip_damper_scenarios), loaded through the admin import endpoint. This file
 * holds the input vocabulary and the validation for an import; it contains no
 * recommendations.
 */
import { z } from "zod";
import { prisma } from "../../models/prisma.js";

export const DAMPER_INPUTS = {
  adjustmentType: ["rebound_only", "two_way"],
  turnDirection: ["left", "right"],
  overUnder: ["oversteer", "understeer"],
  cornerSegment: ["braking", "turn_in", "mid_corner", "corner_exit"],
  cornerSpeed: ["low", "mid", "high"],
} as const;

export const DAMPER_SCENARIO_COUNT =
  DAMPER_INPUTS.adjustmentType.length *
  DAMPER_INPUTS.turnDirection.length *
  DAMPER_INPUTS.overUnder.length *
  DAMPER_INPUTS.cornerSegment.length *
  DAMPER_INPUTS.cornerSpeed.length; // 96

export const damperQuerySchema = z.object({
  type: z.enum(DAMPER_INPUTS.adjustmentType),
  direction: z.enum(DAMPER_INPUTS.turnDirection),
  over_under: z.enum(DAMPER_INPUTS.overUnder),
  segment: z.enum(DAMPER_INPUTS.cornerSegment),
  speed: z.enum(DAMPER_INPUTS.cornerSpeed),
});

const optionText = z.string().trim().min(1).max(120);

export const damperRowSchema = z.object({
  scenarioNumber: z.number().int().min(1).max(DAMPER_SCENARIO_COUNT),
  adjustmentType: z.enum(DAMPER_INPUTS.adjustmentType),
  turnDirection: z.enum(DAMPER_INPUTS.turnDirection),
  overUnder: z.enum(DAMPER_INPUTS.overUnder),
  cornerSegment: z.enum(DAMPER_INPUTS.cornerSegment),
  cornerSpeed: z.enum(DAMPER_INPUTS.cornerSpeed),
  option1: optionText,
  option2: optionText.nullable().optional(),
  option3: optionText.nullable().optional(),
});

export type DamperRow = z.infer<typeof damperRowSchema>;

const inputKey = (
  r: Pick<
    DamperRow,
    "adjustmentType" | "turnDirection" | "overUnder" | "cornerSegment" | "cornerSpeed"
  >
) =>
  [r.adjustmentType, r.turnDirection, r.overUnder, r.cornerSegment, r.cornerSpeed].join(
    "|"
  );

/**
 * Check that an import is a complete, consistent table: every one of the 96
 * input combinations exactly once, scenario numbers 1–96 exactly once, and no
 * option 3 without an option 2. Returns a list of problems (empty when valid).
 */
export function validateDamperTable(rows: DamperRow[]): string[] {
  const problems: string[] = [];
  if (rows.length !== DAMPER_SCENARIO_COUNT) {
    problems.push(`Expected ${DAMPER_SCENARIO_COUNT} scenarios, received ${rows.length}`);
  }

  const numbers = new Map<number, number>();
  const keys = new Map<string, number>();
  for (const r of rows) {
    numbers.set(r.scenarioNumber, (numbers.get(r.scenarioNumber) ?? 0) + 1);
    keys.set(inputKey(r), (keys.get(inputKey(r)) ?? 0) + 1);
    if (r.option3 && !r.option2) {
      problems.push(`Scenario ${r.scenarioNumber} has an option 3 but no option 2`);
    }
  }
  for (const [n, count] of numbers) {
    if (count > 1) problems.push(`Scenario number ${n} appears ${count} times`);
  }
  for (const [k, count] of keys) {
    if (count > 1)
      problems.push(
        `Input combination ${k.replace(/\|/g, " / ")} appears ${count} times`
      );
  }

  let missing = 0;
  for (const adjustmentType of DAMPER_INPUTS.adjustmentType)
    for (const turnDirection of DAMPER_INPUTS.turnDirection)
      for (const overUnder of DAMPER_INPUTS.overUnder)
        for (const cornerSegment of DAMPER_INPUTS.cornerSegment)
          for (const cornerSpeed of DAMPER_INPUTS.cornerSpeed)
            if (
              !keys.has(
                inputKey({
                  adjustmentType,
                  turnDirection,
                  overUnder,
                  cornerSegment,
                  cornerSpeed,
                })
              )
            )
              missing++;
  if (missing > 0) problems.push(`${missing} input combination(s) have no scenario`);

  return problems.slice(0, 25);
}

/** Replace the whole table in one transaction. */
export async function replaceDamperTable(rows: DamperRow[]): Promise<void> {
  await prisma.$transaction([
    prisma.gripDamperScenario.deleteMany({}),
    prisma.gripDamperScenario.createMany({
      data: rows.map((r) => ({
        scenarioNumber: r.scenarioNumber,
        adjustmentType: r.adjustmentType,
        turnDirection: r.turnDirection,
        overUnder: r.overUnder,
        cornerSegment: r.cornerSegment,
        cornerSpeed: r.cornerSpeed,
        option1: r.option1,
        option2: r.option2 ?? null,
        option3: r.option3 ?? null,
      })),
    }),
  ]);
}

export async function lookupDamperScenario(q: z.infer<typeof damperQuerySchema>) {
  const row = await prisma.gripDamperScenario.findUnique({
    where: {
      adjustmentType_turnDirection_overUnder_cornerSegment_cornerSpeed: {
        adjustmentType: q.type,
        turnDirection: q.direction,
        overUnder: q.over_under,
        cornerSegment: q.segment,
        cornerSpeed: q.speed,
      },
    },
  });
  if (!row) return null;
  return {
    scenarioNumber: row.scenarioNumber,
    options: [row.option1, row.option2, row.option3].filter((o): o is string => !!o),
  };
}
