import { describe, it, expect } from "vitest";
import { archiveRaceFiles, fileTypeForKey, type StorageBucketClient } from "../race-archive.js";

function fakeBucket(failKeys: string[] = [], failTimes = Infinity) {
  const calls: string[] = [];
  const failures = new Map<string, number>();
  const bucket: StorageBucketClient = {
    async upload(path) {
      calls.push(path);
      const key = failKeys.find((k) => path.includes(`/${k}.`));
      if (key) {
        const n = failures.get(key) ?? 0;
        failures.set(key, n + 1);
        if (n < failTimes) return { error: { message: "Payload too large" } };
      }
      return { error: null };
    },
  };
  return { bucket, calls };
}

const files = {
  lapsCsv: "NUMBER;LAP_NUMBER\n7;1\n",
  resultsCsv: "POS;NUMBER\n1;7\n",
  pitStopPdf: "data:application/pdf;base64,JVBERi0=",
  emptySlot: "",
};

describe("archiveRaceFiles (F7)", () => {
  it("archives every non-empty file under one import folder", async () => {
    const { bucket, calls } = fakeBucket();
    const r = await archiveRaceFiles(files, { bucket, nodeEnv: "production", archiveId: "abc" });
    expect(r.paths).toEqual({
      lapsCsv: "imports/abc/lapsCsv.csv",
      resultsCsv: "imports/abc/resultsCsv.csv",
      pitStopPdf: "imports/abc/pitStopPdf.pdf",
    });
    expect(calls).toHaveLength(3);
    expect(r.warnings).toEqual([]);
  });

  it("retries once, then succeeds", async () => {
    const { bucket, calls } = fakeBucket(["lapsCsv"], 1);
    const r = await archiveRaceFiles(files, { bucket, nodeEnv: "production", archiveId: "abc" });
    expect(r.paths.lapsCsv).toBe("imports/abc/lapsCsv.csv");
    expect(calls.filter((c) => c.includes("lapsCsv"))).toHaveLength(2);
  });

  it("fails the whole import and names the file when an upload keeps failing", async () => {
    const { bucket } = fakeBucket(["lapsCsv"]);
    await expect(
      archiveRaceFiles(files, { bucket, nodeEnv: "production", archiveId: "abc" })
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "ARCHIVE_FAILED",
      message: expect.stringContaining("lapsCsv"),
    });
  });

  it("refuses imports in production when storage is not configured", async () => {
    await expect(archiveRaceFiles(files, { bucket: null, nodeEnv: "production" })).rejects.toMatchObject({
      code: "ARCHIVE_NOT_CONFIGURED",
    });
  });

  it("allows development without storage, with a warning", async () => {
    const r = await archiveRaceFiles(files, { bucket: null, nodeEnv: "development" });
    expect(r.paths).toEqual({});
    expect(r.warnings[0]).toMatch(/not archived/);
  });

  it("maps slot keys to file types", () => {
    expect(fileTypeForKey("pitStopPdf")).toEqual({ ext: "pdf", contentType: "application/pdf" });
    expect(fileTypeForKey("timeCardsJson").ext).toBe("json");
    expect(fileTypeForKey("lapsCsv").ext).toBe("csv");
  });
});
