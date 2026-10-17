import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { lineJson, Recording, type RecordBucket } from "../recorder.js";

function bucket(fail = 0) {
  const uploads: { path: string; lines: Record<string, unknown>[] }[] = [];
  let failures = fail;
  const b: RecordBucket = {
    async upload(path, body) {
      if (failures > 0) {
        failures--;
        return { error: { message: "storage down" } };
      }
      const text = gunzipSync(body).toString("utf8").trim();
      uploads.push({ path, lines: text.split("\n").map((l) => JSON.parse(l)) });
      return { error: null };
    },
  };
  return { b, uploads };
}

const ref = { slug: "sebring-international-raceway-2026-saturday-8-hour", eventId: 7, sessionId: 3 };
const T0 = Date.UTC(2026, 9, 17, 17, 45, 9);

describe("Recording", () => {
  it("uploads what it kept as gzipped JSON lines under the session's slug and the UTC time", async () => {
    const { b, uploads } = bucket();
    const r = new Recording(ref, b, () => T0);
    r.onState(7, 3, [1, "a", [[2, "#119", 27.45, -81.35]]]);
    r.add("hub", { m: "ReceiveCarPatches", a: [[{ n: "119", lat: 27.45 }]] });
    await r.flush();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe("live-recordings/sebring-international-raceway-2026-saturday-8-hour/20261017/174509Z-00000.jsonl.gz");
    expect(uploads[0].lines.map((l) => l.k)).toEqual(["state", "hub"]);
    expect(uploads[0].lines[0]).toEqual({ t: T0, k: "state", d: [1, "a", [[2, "#119", 27.45, -81.35]]] });
    await r.flush(); // nothing new: no empty chunk
    expect(uploads).toHaveLength(1);
  });

  it("keeps only its own session's state reads", async () => {
    const { b, uploads } = bucket();
    const r = new Recording(ref, b, () => T0);
    r.onState(7, 4, ["other session"]);
    r.onState(8, 3, ["other event"]);
    r.onState(7, 3, ["ours"]);
    await r.flush();
    expect(uploads[0].lines.map((l) => l.d)).toEqual([["ours"]]);
  });

  it("keeps a chunk the storage refused and sends it with the next one", async () => {
    const { b, uploads } = bucket(1);
    const r = new Recording(ref, b, () => T0);
    r.add("state", { d: 1 });
    await r.flush();
    expect(uploads).toHaveLength(0);
    r.add("state", { d: 2 });
    await r.flush();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].lines.map((l) => l.d)).toEqual([1, 2]);
    expect(uploads[0].path).toMatch(/-00001\.jsonl\.gz$/);
  });
});

describe("lineJson", () => {
  it("writes a bigint as a string rather than losing the record", () => {
    expect(lineJson({ t: 1, k: "state", d: [BigInt("9007199254740993")] })).toBe('{"t":1,"k":"state","d":["9007199254740993"]}');
  });
});
