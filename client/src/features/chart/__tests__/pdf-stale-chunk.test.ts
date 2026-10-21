import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "../pdf/DownloadPdfButton";

describe("isStaleChunkError", () => {
  it("knows each browser's words for a part of the site that is gone", () => {
    for (const m of [
      "Failed to fetch dynamically imported module: https://racetrace.tedderengineering.com/assets/index-FJdophnl.js", // Chrome
      "error loading dynamically imported module: https://x/assets/kit.js", // Firefox
      "Importing a module script failed.", // Safari
      "Unable to preload CSS for /assets/x.css", // Vite
    ])
      expect(isStaleChunkError(new TypeError(m))).toBe(true);
  });
  it("leaves other failures alone", () => {
    expect(isStaleChunkError(new Error("This race has no published story."))).toBe(false);
    expect(isStaleChunkError(new RangeError("Invalid array length"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
