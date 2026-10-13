/**
 * The 8 Stage 1 races: file names (relative to $RACETRACE_FIXTURE_DATA/<race>/), format and build
 * options. Raw files are third-party data and are never committed; tests skip when the folder is unset.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SourceFormat } from "../schema/package-types.js";
import type { BuildOptions } from "../types.js";
import { loadInputFile } from "../inputs.js";
import type { InputFile } from "../types.js";

export interface FixtureRace {
  race: string;
  format: SourceFormat;
  /** File-name patterns (regex) selected from the race folder; roles are detected from the names. */
  files: RegExp[];
  options: BuildOptions;
}

const GEN = "2026-10-13T00:00:00Z";

export const FIXTURE_RACES: FixtureRace[] = [
  {
    race: "mpc_road_atlanta",
    format: "alkamel-imsa",
    files: [/23_Time Cards_Race\.CSV$/, /20_Pit Stops Time Cards_Race\.JSON$/, /20_Drive Time_Race\.CSV$/, /25_FlagsAnalysisWithRCMessages_Race\.CSV$/, /03_Results_Race_Official\.JSON$/, /05_Results by Class_Race_Official\.JSON$/, /26_Weather_Race\.CSV$/],
    options: {
      series: "IMSA Michelin Pilot Challenge",
      season: 2026,
      event: "Road Atlanta",
      session: "Race",
      track: { id: "road-atlanta", name: "Road Atlanta", timezone: "America/New_York" },
      rulebook: { id: "imsa-mpc-2026", version: "0.1.0", pitCycleModel: "rounds", scheduledDurationS: 7200 },
      packageId: "imsa-mpc-2026-road-atlanta-race",
      generatedAt: GEN,
    },
  },
  ...[1, 2].map((r) => ({
    race: `gt4_indy_r${r}`,
    format: "alkamel-sro" as SourceFormat,
    files: [
      new RegExp(`23_AnalysisEnduranceWithSections_Race ${r}\\.CSV$`),
      new RegExp(`20_Pit Stops Time Cards_Race ${r}\\.PDF$`),
      new RegExp(`20_Drive Time_Race ${r}\\.CSV$`),
      new RegExp(`25_FlagsAnalysisWithRCMessages_Race ${r}\\.CSV$`),
      new RegExp(`03_Results_Race ${r}_Provisional\\.CSV$`),
      new RegExp(`05_Results by Class_Race ${r}_Provisional\\.CSV$`),
      new RegExp(`26_Weather_Race ${r}\\.CSV$`),
    ],
    options: {
      series: "GT4 America",
      season: 2026,
      event: "Indianapolis",
      session: `Race ${r}`,
      track: { id: "indianapolis-road-course", name: "Indianapolis Motor Speedway", timezone: "America/Indiana/Indianapolis", layout: "Road course" },
      rulebook: { id: "sro-gt4-america-2026", version: "0.1.0", pitCycleModel: "rounds" as const, scheduledDurationS: 3600 },
      packageId: `gt4a-2026-indianapolis-r${r}`,
      generatedAt: GEN,
    },
  })),
  {
    race: "sro_cota_r1",
    format: "alkamel-sro",
    files: [/23_AnalysisEnduranceWithSections_Race_1_COTA\.csv$/, /20_Pit_Stops_Time_Cards_Race_1_COTA\.pdf$/, /05_Provisional_Results_by_Class_Race_1_COTA\.csv$/],
    options: {
      series: "GT4 America",
      event: "Circuit of the Americas",
      session: "Race 1",
      track: { id: "cota", name: "Circuit of the Americas", timezone: "America/Chicago" },
      rulebook: { id: "sro-gt4-america-2026", version: "0.1.0", pitCycleModel: "rounds" },
      packageId: "sro-cota-r1",
      generatedAt: GEN,
    },
  },
  {
    race: "grcup_cota_r1",
    format: "alkamel-grcup",
    files: [/23_AnalysisEnduranceWithSections_Race_1_GRCUP_COTA\.csv$/, /20_Pit_Stops_Time_Cards_Race_1_GRCUP_COTA\.pdf$/, /00_Results_GR_Cup_Race_1_Official_COTA\.csv$/],
    options: {
      series: "Toyota GR Cup",
      event: "Circuit of the Americas",
      session: "Race 1",
      track: { id: "cota", name: "Circuit of the Americas", timezone: "America/Chicago" },
      rulebook: { pitCycleModel: "singleton" },
      packageId: "grcup-cota-r1",
      generatedAt: GEN,
    },
  },
  {
    race: "barber",
    format: "speedhive",
    files: [/Barber.*_all_laps\.csv$/, /Barber.*_summary\.csv$/],
    options: {
      series: "World Racing League",
      event: "Barber 8 Hour",
      session: "Saturday 8 Hour",
      track: { id: "barber-motorsports-park", name: "Barber Motorsports Park", timezone: "America/Chicago" },
      rulebook: { id: "wrl-2026", version: "0.1.0", pitCycleModel: "windows" },
      packageId: "wrl-2026-barber-sat-8h",
      generatedAt: GEN,
    },
  },
  {
    race: "cota_sat",
    format: "wrl-website",
    files: [/COTA.*_all_laps\.csv$/, /COTA.*_summary\.csv$/],
    options: {
      series: "World Racing League",
      event: "COTA Championship",
      session: "Saturday 8 Hour",
      track: { id: "cota", name: "Circuit of the Americas", timezone: "America/Chicago" },
      raceDate: "2025-12-06",
      rulebook: { id: "wrl-2026", version: "0.1.0", pitCycleModel: "windows" },
      packageId: "wrl-2025-cota-sat-8h",
      generatedAt: GEN,
    },
  },
  {
    race: "sunday7",
    format: "speedhive",
    files: [/Sunday_7_hour.*_all_laps\.csv$/, /Sunday_7_hour.*_summary\.csv$/],
    options: {
      series: "World Racing League",
      event: "COTA Championship",
      session: "Sunday 7 Hour",
      track: { id: "cota", name: "Circuit of the Americas", timezone: "America/Chicago" },
      rulebook: { id: "wrl-2026", version: "0.1.0", pitCycleModel: "windows" },
      packageId: "wrl-2025-cota-sun-7h",
      generatedAt: GEN,
    },
  },
];

export const FIXTURE_DATA = process.env.RACETRACE_FIXTURE_DATA ?? "";

export function fixtureAvailable(race: string): boolean {
  return !!FIXTURE_DATA && existsSync(join(FIXTURE_DATA, race));
}

export async function loadFixtureInputs(fr: FixtureRace, root = FIXTURE_DATA): Promise<InputFile[]> {
  const dir = join(root, fr.race);
  const names = readdirSync(dir);
  const out: InputFile[] = [];
  for (const re of fr.files) {
    const name = names.find((n) => re.test(n));
    if (!name) throw new Error(`${fr.race}: no file matching ${re}`);
    out.push(await loadInputFile(join(dir, name), { archivedAt: GEN }));
  }
  return out;
}
