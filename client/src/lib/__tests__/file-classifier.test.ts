/**
 * Classifier tests for the Alkamel exports that IMSA, SRO GT4 and Toyota GR Cup
 * all publish under near-identical filenames.
 *
 * The three per-lap CSVs share their first 26 columns and the three results CSVs
 * share their whole layout, so these tests pin the content signals that tell the
 * series apart — and pin that the SRO and GR Cup routes are unchanged.
 */
import { describe, it, expect } from "vitest";
import { classifyFile, classifyFiles, type RaceGroup, type DetectedFile } from "../file-classifier";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Columns shared by every Alkamel per-lap export. */
const LAP_COLUMNS_SHARED =
  "NUMBER; DRIVER_NUMBER; LAP_NUMBER; LAP_TIME; LAP_IMPROVEMENT; CROSSING_FINISH_LINE_IN_PIT; " +
  "S1; S1_IMPROVEMENT; S2; S2_IMPROVEMENT; S3; S3_IMPROVEMENT; KPH; ELAPSED; HOUR;" +
  "S1_LARGE;S2_LARGE;S3_LARGE;TOP_SPEED;DRIVER_NAME;PIT_TIME;CLASS;GROUP;TEAM;MANUFACTURER;FLAG_AT_FL;";

/** SRO / GR Cup add per-section timing after FLAG_AT_FL; IMSA stops there. */
const LAP_COLUMNS_SECTIONS =
  "S1_SECONDS;S2_SECONDS;S3_SECONDS;IM1a_time;IM1a_elapsed;IM1_time;IM1_elapsed;" +
  "IM2a_time;IM2a_elapsed;IM2_time;IM2_elapsed;IM3a_time;IM3a_elapsed;FL_time;FL_elapsed;";

const IMSA_TIME_CARDS_CSV =
  LAP_COLUMNS_SHARED +
  "\n12;2;1;2:00.735;0;;27.290;0;49.816;0;43.629;0;156.9;2:00.735;14:17:29.521;" +
  "0:27.290;0:49.816;0:43.629;245.7;Varun Choksey;;GS;;RAFA Racing;Toyota;GF;\n";

const SRO_LAPS_CSV =
  LAP_COLUMNS_SHARED +
  LAP_COLUMNS_SECTIONS +
  "\n007;1;1;2:38.197;0;;43.680;0;57.535;0;56.982;0;124.5;2:38.197;17:02:37.817;" +
  "0:43.680;0:57.535;0:56.982;233.8;Dwayne Moses;;Am;;ProSport Competition;Aston Martin;GF;" +
  "43.680;57.535;56.982;;;;43.680;24.706;1:08.386;32.829;1:41.215;27.877;2:09.092;29.105;2:38.197;\n";

/** Results columns up to the id block, which is where the series shows itself. */
const RESULTS_COLUMNS_SHARED =
  "POSITION;NUMBER;STATUS;LAPS;TOTAL_TIME;GAP_FIRST;GAP_PREVIOUS;FL_LAPNUM;FL_TIME;FL_KPH;" +
  "TEAM;CLASS;GROUP;DIVISION;VEHICLE;TIRES;";

const IMSA_RESULTS_CSV =
  RESULTS_COLUMNS_SHARED +
  "IMSA_CarId;IMSA_TeamId;IMSA_ClassId;IMSA_CarTypeId;IMSA_ManufacturerId;IMSA_TireId;" +
  "IMSA_SponsorId;IMSA_EventEntryId;*Extra 9;*Extra 10;" +
  "DRIVER1_FIRSTNAME;DRIVER1_SECONDNAME;DRIVER1_LICENSE;DRIVER1_HOMETOWN;DRIVER1_COUNTRY;" +
  "DRIVER1_SHORTNAME;DRIVER1_IMSA_DriverId;DRIVER1_IMSA_DriverPlugId;DRIVER1_IMSA_DriverRatingLong;" +
  "DRIVER1_*Extra 4;DRIVER1_*Extra 5;" +
  "\n1;19;Classified;58;2:02:06.175;-;-;24;1:54.154;166.0;Stephen Cameron Racing;GS;;;" +
  "Ford Mustang GT4;M;;;;;;;;;;;Sean;Quinlan;Bronze;Palo Alto, CA;USA;;;;;;;\n";

const SRO_RESULTS_CSV =
  RESULTS_COLUMNS_SHARED +
  "ECM Participant Id;ECM Team Id;ECM Category Id;ECM Car Id;ECM Brand Id;ECM Country Id;" +
  "*Extra 7;*Extra 8;*Extra 9;Sort Key;" +
  "DRIVER1_FIRSTNAME;DRIVER1_SECONDNAME;DRIVER1_LICENSE;DRIVER1_HOMETOWN;DRIVER1_COUNTRY;" +
  "DRIVER1_SHORTNAME;DRIVER1_ECM Driver Id;DRIVER1_ECM Country Id;DRIVER1_*Extra 3;" +
  "DRIVER1_*Extra 4;DRIVER1_*Extra 5;" +
  "\n1;68;Classified;72;3:01:32.386;-;-;17;2:15.187;145.7;RAFA Racing Team;Silver;;;" +
  "Toyota GR Supra GT4 EVO2;M;;;;;;;;;;;Gresham;Wagner;;;USA;;;;;;;\n";

const GRCUP_RESULTS_CSV =
  RESULTS_COLUMNS_SHARED +
  "ECM Participant Id;ECM Team Id;ECM Category Id;ECM Car Id;ECM Brand Id;ECM Country Id;" +
  "*Extra 7;*Extra 8;*Extra 9;Sort Key;" +
  "DRIVER_FIRSTNAME;DRIVER_SECONDNAME;DRIVER_LICENSE;DRIVER_HOMETOWN;DRIVER_COUNTRY;" +
  "DRIVER_SHORTNAME;DRIVER_ECM Driver Id;DRIVER_ECM Country Id;DRIVER_*Extra 3;" +
  "DRIVER_*Extra 4;DRIVER_*Extra 5;" +
  "\n1;46;Classified;17;45:57.575;-;-;8;2:28.630;132.5;Lucas Racing;Am;;GR Cup;" +
  "Toyota GR86;;;;;;;;;;;;Lucas;Weisenberg;;;USA;;;;;;;\n";

/** Both series publish a Race 1 at COTA, so their laps files collide on race number and venue. */
const SRO_RESULTS_05_CSV =
  "CLASS_TYPE;POS;PIC;NUMBER;TEAM;VEHICLE;DRIVERS;LAPS;ELAPSED;GAP_FIRST;GAP_PREVIOUS;BEST_LAP_NUM;BEST_LAP_TIME;BEST_LAP_KPH;\n" +
  "Silver;1;1;68;RAFA Racing Team;Toyota GR Supra GT4 EVO2;Gresham Wagner / Tyler Gonzalez;72;3:01:32.386;;;17;2:15.187;145.7;\n";

const IMSA_FLAGS_CSV =
  "TIME;ELAPSED;REC_TYPE;FLAG;SECTOR;MESSAGE;FLAG_TIME;ACCUM_TIME;LAP\n" +
  "14:15:28.786;-;GF;GREEN FLAG;;;20:13.603;20:13.603;1\n" +
  "14:35:42.389;20:13.603;FCY;FULL COURSE YELLOW;;;8:18.562;8:18.562;11\n" +
  "14:44:00.951;28:32.165;GF;GREEN FLAG;;;1:19:19.445;1:39:33.048;13\n" +
  "14:22:46.393;7:17.607;RCMessage;;;Car 4: Penalty - False Start  - Drive Through;-;-;0\n";

function file(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

function pdf(name: string): File {
  return new File(["%PDF-1.4 stub"], name, { type: "application/pdf" });
}

// classifyFiles reads PDFs as data URLs via FileReader, which Node does not
// provide. PDF routing is decided by the filename and by which group the file
// lands in — the bytes are never inspected — so an empty payload is enough.
if (typeof (globalThis as any).FileReader === "undefined") {
  (globalThis as any).FileReader = class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(_blob: Blob) {
      this.result = "data:application/pdf;base64,";
      queueMicrotask(() => this.onload?.());
    }
  };
}

// ─── Per-lap CSVs ────────────────────────────────────────────────────────────

describe("Alkamel per-lap CSVs", () => {
  it("routes an IMSA Time Cards CSV to the IMSA parser", () => {
    const d = classifyFile(file("23_Time Cards_Race.csv", IMSA_TIME_CARDS_CSV), IMSA_TIME_CARDS_CSV);
    expect(d.type).toBe("timeCardsCsv");
    expect(d.format).toBe("imsa");
    expect(d.metadata.series).toBe("IMSA");
  });

  it("still routes an SRO sections export to the SRO laps slot", () => {
    const name = "23_AnalysisEnduranceWithSections_Race 1 COTA.csv";
    const d = classifyFile(file(name, SRO_LAPS_CSV), SRO_LAPS_CSV);
    expect(d.type).toBe("alkamelLapsCsv");
    expect(d.format).toBe("sro");
  });

  it("treats a sections export as SRO even under an IMSA-looking filename", () => {
    const d = classifyFile(file("23_Time Cards_Race.csv", SRO_LAPS_CSV), SRO_LAPS_CSV);
    expect(d.type).toBe("alkamelLapsCsv");
  });

  it("keeps qualifying ahead of both", () => {
    const name = "23_Time Cards_Qualifying.csv";
    const d = classifyFile(file(name, IMSA_TIME_CARDS_CSV), IMSA_TIME_CARDS_CSV);
    expect(d.type).toBe("qualifyingCsv");
  });
});

// ─── Results CSVs ────────────────────────────────────────────────────────────

describe("Alkamel results CSVs", () => {
  it("routes IMSA results by its IMSA_* id columns", () => {
    const d = classifyFile(file("03_Results_Race_Provisional.csv", IMSA_RESULTS_CSV), IMSA_RESULTS_CSV);
    expect(d.type).toBe("imsaResultsCsv");
    expect(d.format).toBe("imsa");
  });

  it("still routes SRO results to the SRO slot", () => {
    const d = classifyFile(file("03_Results SONOMA.csv", SRO_RESULTS_CSV), SRO_RESULTS_CSV);
    expect(d.type).toBe("sroResultsCsv");
    expect(d.format).toBe("sro");
  });

  it("still routes GR Cup results to the GR Cup slot", () => {
    const name = "00_Results GR Cup Race 1 Official COTA.csv";
    const d = classifyFile(file(name, GRCUP_RESULTS_CSV), GRCUP_RESULTS_CSV);
    expect(d.type).toBe("grResultsCsv");
    expect(d.format).toBe("grcup");
  });
});

// ─── Flags CSV ───────────────────────────────────────────────────────────────

describe("IMSA flags CSV", () => {
  it("is recognised rather than left unmatched", () => {
    const name = "25_FlagsAnalysisWithRCMessages_Race.csv";
    const d = classifyFile(file(name, IMSA_FLAGS_CSV), IMSA_FLAGS_CSV);
    expect(d.type).toBe("imsaFlagsCsv");
    expect(d.format).toBe("imsa");
  });
});

// ─── Grouping ────────────────────────────────────────────────────────────────

describe("GR Cup and SRO laps files dropped together", () => {
  // extractAlkamelEventKey strips "GR Cup", so both laps files reduce to the same
  // RACE_1_COTA key. Ownership must come from the filename, or drop order decides
  // it — which silently files GR86 lap traces under GT4 teams and classes.
  async function classifyBoth(lapsFirst: "sro" | "grcup") {
    const sroLaps = file("23_AnalysisEnduranceWithSections_Race 1 COTA.csv", SRO_LAPS_CSV);
    const grLaps = file("23_AnalysisEnduranceWithSections_Race 1 GRCUP COTA.csv", SRO_LAPS_CSV);
    return classifyFiles(
      [
        file("05_Provisional Results by Class_Race 1 COTA.csv", SRO_RESULTS_05_CSV),
        file("00_Results GR Cup Race 1 Official COTA.csv", GRCUP_RESULTS_CSV),
        ...(lapsFirst === "sro" ? [sroLaps, grLaps] : [grLaps, sroLaps]),
      ],
      new Map<string, RaceGroup>(),
      [] as DetectedFile[],
      [] as DetectedFile[]
    );
  }

  function lapsFileOf(groups: Map<string, RaceGroup>, format: string) {
    const g = Array.from(groups.values()).find((x) => x.format === format);
    return g?.files.get("alkamelLapsCsv")?.file.name;
  }

  it.each(["sro", "grcup"] as const)(
    "files each laps CSV by series regardless of drop order (%s first)",
    async (lapsFirst) => {
      const { groups } = await classifyBoth(lapsFirst);
      expect(Array.from(groups.values()).map((g) => g.format).sort()).toEqual([
        "grcup",
        "sro",
      ]);
      expect(lapsFileOf(groups, "sro")).toBe(
        "23_AnalysisEnduranceWithSections_Race 1 COTA.csv"
      );
      expect(lapsFileOf(groups, "grcup")).toBe(
        "23_AnalysisEnduranceWithSections_Race 1 GRCUP COTA.csv"
      );
    }
  );
});

describe("grouping a CSV-only IMSA drop", () => {
  async function classify(files: File[]) {
    return classifyFiles(files, new Map<string, RaceGroup>(), [] as DetectedFile[], [] as DetectedFile[]);
  }

  it("collects the IMSA exports into one complete group", async () => {
    const { groups, unmatched } = await classify([
      file("23_Time Cards_Race.csv", IMSA_TIME_CARDS_CSV),
      file("03_Results_Race_Provisional.csv", IMSA_RESULTS_CSV),
      file("25_FlagsAnalysisWithRCMessages_Race.csv", IMSA_FLAGS_CSV),
    ]);

    expect(unmatched).toHaveLength(0);
    expect(groups.size).toBe(1);

    const group = Array.from(groups.values())[0];
    expect(group.format).toBe("imsa");
    expect(group.complete).toBe(true);
    expect(group.metadata.series).toBe("IMSA");
    expect([...group.files.keys()].sort()).toEqual(
      ["imsaFlagsCsv", "imsaResultsCsv", "timeCardsCsv"]
    );
  });

  it("gives the pit stop PDF to the IMSA group when no SRO group wants it", async () => {
    // 20_Pit Stops Time Cards is named identically across series, so only the
    // company it arrives in can say which parser should get it.
    const { groups, unmatched } = await classify([
      file("23_Time Cards_Race.csv", IMSA_TIME_CARDS_CSV),
      pdf("20_Pit Stops Time Cards_Race.PDF"),
    ]);

    expect(unmatched).toHaveLength(0);
    expect(groups.size).toBe(1);
    const group = Array.from(groups.values())[0];
    expect(group.format).toBe("imsa");
    expect(group.files.has("imsaPitStopPdf")).toBe(true);
  });

  it("does not let the pit stop PDF's SRO-derived name reach the IMSA group", async () => {
    // The PDF branch names the file from its own filename assuming SRO. A "_1"
    // dedup suffix on a download then reads as "SRO Race 1", which must not
    // become the IMSA race's name once the resolver re-homes the file.
    const { groups } = await classify([
      file("23_Time Cards_Race_1.csv", IMSA_TIME_CARDS_CSV),
      pdf("20_Pit Stops Time Cards_Race_1.pdf"),
    ]);

    const group = Array.from(groups.values())[0];
    expect(group.format).toBe("imsa");
    expect(group.metadata.series).toBe("IMSA");
    expect(group.metadata.name).toBe("");
    expect(group.metadata.track).toBe("");
  });

  it("still gives the pit stop PDF to an SRO group when one is present", async () => {
    const { groups } = await classify([
      file("23_AnalysisEnduranceWithSections_Race 1 COTA.csv", SRO_LAPS_CSV),
      file("03_Results Race 1 COTA.csv", SRO_RESULTS_CSV),
      pdf("20_Pit Stops Time Cards_Race 1 COTA.pdf"),
    ]);

    const sro = Array.from(groups.values()).find((g) => g.format === "sro")!;
    expect(sro.files.has("alkamelPitStopPdf")).toBe(true);
    expect(sro.files.has("imsaPitStopPdf")).toBe(false);
  });

  it("does not pull an SRO drop into the IMSA group", async () => {
    const { groups } = await classify([
      file("23_AnalysisEnduranceWithSections_Race 1 COTA.csv", SRO_LAPS_CSV),
      file("05_Provisional Results by Class_Race 1 COTA.csv", SRO_RESULTS_CSV),
      file("23_Time Cards_Race.csv", IMSA_TIME_CARDS_CSV),
      file("03_Results_Race_Provisional.csv", IMSA_RESULTS_CSV),
    ]);

    const formats = Array.from(groups.values()).map((g) => g.format).sort();
    expect(formats).toEqual(["imsa", "sro"]);

    const imsa = Array.from(groups.values()).find((g) => g.format === "imsa")!;
    const sro = Array.from(groups.values()).find((g) => g.format === "sro")!;
    expect(imsa.files.has("timeCardsCsv")).toBe(true);
    expect(imsa.files.has("alkamelLapsCsv")).toBe(false);
    expect(sro.files.has("alkamelLapsCsv")).toBe(true);
    expect(sro.files.has("timeCardsCsv")).toBe(false);
  });
});
