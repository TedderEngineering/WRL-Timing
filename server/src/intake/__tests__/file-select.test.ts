import { describe, it, expect } from "vitest";
import { classifyAlkamelFile, resultsStatusRank, selectAlkamelFiles } from "../file-select.js";
import { buildFactsArgs, factFiles, packageIdFor } from "../facts-args.js";
import { getParser } from "../../utils/parsers/index.js";
import type { Manifest, ManifestFile, RemoteFile } from "../types.js";

const rf = (name: string, subdir?: string): RemoteFile => ({ url: `https://x/${subdir ? subdir + "/" : ""}${name}`, name, ...(subdir ? { subdir } : {}) });
const keysOf = (format: "imsa" | "sro" | "grcup", names: (string | RemoteFile)[]) =>
  Object.fromEntries(selectAlkamelFiles(format, names.map((n) => (typeof n === "string" ? rf(n) : n))).files.map((s) => [s.key, s.file.name]));

describe("classifyAlkamelFile", () => {
  it.each([
    ["23_AnalysisEnduranceWithSections_Race 1.CSV", "laps", undefined],
    ["23_Time Cards_Race.JSON", "time_cards", undefined],
    ["23_Time Cards_Race.CSV", "time_cards", undefined],
    ["20_Pit Stops Time Cards_Race.JSON", "pit_cards_json", undefined],
    ["20_Pit Stops Time Cards_Race 1.PDF", "pit_cards_pdf", undefined],
    ["20_Drive Time_Race 1.CSV", "drive_time", undefined],
    ["25_FlagsAnalysisWithRCMessages_Race.JSON", "flags", undefined],
    ["25_FlagsAnalysis_Race.PDF", "flags", undefined],
    ["03_Results_Race_Official.CSV", "results", "official"],
    ["03_Results_Race 1_Provisional.CSV", "results", "provisional"],
    ["03_Results_Race_Unofficial.JSON", "results", "unofficial"],
    ["03_Results_Race.CSV", "results", "unknown"],
    ["00_Results GR Cup Race 1 Official COTA.csv", "results", "official"],
    ["05_Provisional Results by Class_Race 2.CSV", "results_by_class", "provisional"],
    ["12_Lap Chart_Race.JSON", "lap_chart", undefined],
    ["26_Weather_Race 1.CSV", "weather", undefined],
  ])("%s → %s", (name, role, mark) => {
    const c = classifyAlkamelFile(name)!;
    expect(c.role).toBe(role);
    expect(c.mark).toBe(mark);
  });

  it.each(["00_Grid_Race.PDF", "03_Results_Race_Official.PDF", "07_Results by Hour_Race.CSV", "17_Best Sectors_Race.PDF", "Championship Points.PDF", "notes.txt"])(
    "%s is not fetched",
    (name) => expect(classifyAlkamelFile(name)).toBeNull()
  );
});

describe("IMSA selection", () => {
  const all = [
    "03_Results_Race_Official.CSV", "03_Results_Race_Official.JSON", "03_Results_Race_Provisional.CSV", "03_Results_Race_Provisional.JSON",
    "05_Results by Class_Race_Official.JSON", "05_Results by Class_Race_Official.CSV", "12_Lap Chart_Race.JSON", "20_Drive Time_Race.CSV",
    "20_Pit Stops Time Cards_Race.JSON", "20_Pit Stops Time Cards_Race.PDF", "23_Time Cards_Race.CSV", "23_Time Cards_Race.JSON",
    "25_FlagsAnalysisWithRCMessages_Race.CSV", "25_FlagsAnalysisWithRCMessages_Race.JSON", "25_FlagsAnalysis_Race.PDF", "26_Weather_Race.CSV",
  ];

  it("official over provisional; JSON and CSV go to the IMSA parser's own slots; extras are archive-only", () => {
    expect(keysOf("imsa", all)).toEqual({
      driveTimeCsv: "20_Drive Time_Race.CSV",
      flagsCsv: "25_FlagsAnalysisWithRCMessages_Race.CSV",
      flagsJson: "25_FlagsAnalysisWithRCMessages_Race.JSON",
      lapChartJson: "12_Lap Chart_Race.JSON",
      pitStopJson: "20_Pit Stops Time Cards_Race.JSON",
      resultsByClassCsv: "05_Results by Class_Race_Official.CSV",
      resultsByClassJson: "05_Results by Class_Race_Official.JSON",
      resultsCsv: "03_Results_Race_Official.CSV",
      resultsJson: "03_Results_Race_Official.JSON",
      timeCardsCsv: "23_Time Cards_Race.CSV",
      timeCardsJson: "23_Time Cards_Race.JSON",
      weatherCsv: "26_Weather_Race.CSV",
    });
    const sel = selectAlkamelFiles("imsa", all.map((n) => rf(n)));
    expect(sel.resultsStatus).toBe("official");
    expect(sel.missing).toEqual([]);
  });

  it("every parser-slot key exists on the IMSA parser; archive-only keys do not", () => {
    const slots = new Set(getParser("imsa")!.fileSlots.map((s) => s.key));
    for (const s of selectAlkamelFiles("imsa", all.map((n) => rf(n))).files) expect(slots.has(s.key)).toBe(s.parserSlot);
  });

  it("uses the pit PDF only without the pit JSON, and the flags PDF only without JSON or CSV", () => {
    expect(keysOf("imsa", ["23_Time Cards_Race.CSV", "20_Pit Stops Time Cards_Race.PDF", "25_FlagsAnalysis_Race.PDF"])).toEqual({
      flagsJson: "25_FlagsAnalysis_Race.PDF",
      pitStopPdf: "20_Pit Stops Time Cards_Race.PDF",
      timeCardsCsv: "23_Time Cards_Race.CSV",
    });
  });

  it("records provisional results and reports what is missing", () => {
    const sel = selectAlkamelFiles("imsa", ["23_Time Cards_Race.JSON", "03_Results_Race_Provisional.JSON"].map((n) => rf(n)));
    expect(sel.resultsStatus).toBe("provisional");
    expect(sel.missing.map((m) => m.role)).toEqual(["pit_cards_json", "flags", "drive_time", "weather"]);
    expect(selectAlkamelFiles("imsa", [rf("23_Time Cards_Race.JSON")]).resultsStatus).toBe("none");
  });

  it("endurance: the last hour folder wins; earlier hours are ignored; root files are kept", () => {
    const files = [
      rf("23_Time Cards_Race_Hour 1.CSV", "01_Hour 1"),
      rf("03_Results_Race_Official.CSV", "01_Hour 1"),
      rf("23_Time Cards_Race.CSV", "10_Hour 10"),
      rf("03_Results_Race_Provisional.CSV", "10_Hour 10"),
      rf("25_FlagsAnalysisWithRCMessages_Race.JSON"),
    ];
    const sel = selectAlkamelFiles("imsa", files);
    expect(sel.files.map((s) => `${s.key}:${s.file.subdir ?? "root"}`)).toEqual(["flagsJson:root", "resultsCsv:10_Hour 10", "timeCardsCsv:10_Hour 10"]);
    expect(sel.resultsStatus).toBe("provisional");
  });
});

describe("SRO and GR Cup selection", () => {
  it("SRO: laps from 23_AnalysisEndurance (not Time Cards), results CSV, pit PDF; flags, drive time and weather archive-only", () => {
    expect(
      keysOf("sro", [
        "03_Results_Race 1_Official.CSV", "03_Results_Race 1_Provisional.CSV", "05_Results by Class_Race 1_Official.CSV",
        "20_Drive Time_Race 1.CSV", "20_Pit Stops Time Cards_Race 1.PDF", "23_AnalysisEnduranceWithSections_Race 1.CSV",
        "23_Time Cards_Race 1.CSV", "25_FlagsAnalysisWithRCMessages_Race 1.CSV", "26_Weather_Race 1.CSV",
      ])
    ).toEqual({
      driveTimeCsv: "20_Drive Time_Race 1.CSV",
      flagsCsv: "25_FlagsAnalysisWithRCMessages_Race 1.CSV",
      lapsCsv: "23_AnalysisEnduranceWithSections_Race 1.CSV",
      pitStopPdf: "20_Pit Stops Time Cards_Race 1.PDF",
      resultsByClassCsv: "05_Results by Class_Race 1_Official.CSV",
      resultsCsv: "03_Results_Race 1_Official.CSV",
      timeCardsCsv: "23_Time Cards_Race 1.CSV",
      weatherCsv: "26_Weather_Race 1.CSV",
    });
  });

  it("SRO parser slots match the parser; flagsCsv is archive-only for SRO", () => {
    const slots = new Set(getParser("sro")!.fileSlots.map((s) => s.key));
    const sel = selectAlkamelFiles("sro", ["23_AnalysisEnduranceWithSections_Race 1.CSV", "25_FlagsAnalysisWithRCMessages_Race 1.CSV", "03_Results_Race 1_Official.CSV"].map((n) => rf(n)));
    for (const s of sel.files) expect(slots.has(s.key)).toBe(s.parserSlot);
    expect(sel.files.find((s) => s.key === "flagsCsv")!.parserSlot).toBe(false);
  });

  it("SRO with only by-class results feeds them to the results slot and records the mark", () => {
    const sel = selectAlkamelFiles("sro", ["05_Provisional Results by Class_Race 2.CSV", "23_AnalysisEnduranceWithSections_Race 2.CSV"].map((n) => rf(n)));
    expect(sel.files.find((s) => s.key === "resultsCsv")!.file.name).toBe("05_Provisional Results by Class_Race 2.CSV");
    expect(sel.resultsStatus).toBe("provisional");
    expect(sel.missing.map((m) => m.role)).not.toContain("results");
  });

  it("SRO falls back to the 23_Time Cards CSV as the laps file", () => {
    expect(keysOf("sro", ["23_Time Cards_Race 1.CSV"])).toEqual({ lapsCsv: "23_Time Cards_Race 1.CSV" });
  });

  it("GR Cup: 00_Results and the laps CSV go to the GR Cup parser's slots; the pit PDF is archive-only", () => {
    const sel = selectAlkamelFiles("grcup", ["00_Results_Race 1_Provisional.CSV", "23_AnalysisEnduranceWithSections_Race 1.CSV", "20_Pit Stops Time Cards_Race 1.PDF"].map((n) => rf(n)));
    expect(Object.fromEntries(sel.files.map((s) => [s.key, s.parserSlot]))).toEqual({ lapsCsv: true, pitStopPdf: false, resultsCsv: true });
    const slots = new Set(getParser("grcup")!.fileSlots.map((s) => s.key));
    for (const s of sel.files) expect(slots.has(s.key)).toBe(s.parserSlot);
  });
});

describe("results status order", () => {
  it("official > provisional > unofficial > unknown = none", () => {
    expect(["none", "unknown", "unofficial", "provisional", "official"].map(resultsStatusRank)).toEqual([0, 0, 1, 2, 3]);
  });
});

describe("fact-engine arguments", () => {
  const mf = (name: string, role: ManifestFile["role"]): ManifestFile => ({ name, sourceName: name, url: "u", role, key: name, parserSlot: false, sha256: "0", bytes: 1, fetchedAt: "t" });
  const m = {
    seriesId: "imsa-mpc",
    seriesLabel: "IMSA Michelin Pilot Challenge",
    factFormat: "alkamel-imsa",
    metadata: { raceDate: "2026-10-02", sessionName: "Race", event: "Road Atlanta", season: 2026 },
    files: [
      mf("23_Time Cards_Race.JSON", "time_cards"), mf("23_Time Cards_Race.CSV", "time_cards"),
      mf("03_Results_Race_Official.CSV", "results"), mf("03_Results_Race_Official.JSON", "results"),
      mf("05_Results by Class_Race_Official.CSV", "results_by_class"), mf("05_Results by Class_Race_Official.JSON", "results_by_class"),
      mf("25_FlagsAnalysisWithRCMessages_Race.CSV", "flags"), mf("25_FlagsAnalysisWithRCMessages_Race.JSON", "flags"),
      mf("20_Pit Stops Time Cards_Race.JSON", "pit_cards_json"), mf("26_Weather_Race.CSV", "weather"), mf("sh-raw.json", "other"),
    ],
  } as unknown as Manifest;

  it("gives exactly one lap CSV and one flags file, never 'other'", () => {
    const names = factFiles(m).map((f) => f.name);
    expect(names).toEqual([
      "23_Time Cards_Race.CSV", "03_Results_Race_Official.CSV", "03_Results_Race_Official.JSON",
      "05_Results by Class_Race_Official.JSON", "20_Pit Stops Time Cards_Race.JSON", "25_FlagsAnalysisWithRCMessages_Race.JSON", "26_Weather_Race.CSV",
    ]);
  });

  it("builds role=path arguments and a schema-valid package id", () => {
    expect(packageIdFor(m)).toBe("imsa-mpc-2026-10-02-race");
    const args = buildFactsArgs(m, (n) => `/w/${n}`, "/o/facts.json");
    expect(args.slice(0, 3)).toEqual(["alkamel-imsa", "time_cards=/w/23_Time Cards_Race.CSV", "results=/w/03_Results_Race_Official.CSV"]);
    expect(args).toContain("--package-id");
    expect(args).not.toContain("--date");
  });
});
