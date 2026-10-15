import { describe, expect, it } from "vitest";
import { seriesFamilyKey } from "../SeriesBadge";

describe("series badge", () => {
  it("shows every stored series spelling as its family, so a weekend looks the same on every page", () => {
    expect(seriesFamilyKey("GR_CUP")).toBe("GR_CUP");
    expect(seriesFamilyKey("GR CUP")).toBe("GR_CUP");
    expect(seriesFamilyKey("GR Cup")).toBe("GR_CUP");
    expect(seriesFamilyKey("Porsche Carrera Cup North America")).toBe("IMSA");
    expect(seriesFamilyKey("Mustang Challenge North America")).toBe("IMSA");
    expect(seriesFamilyKey("Lamborghini Super Trofeo")).toBe("IMSA");
    expect(seriesFamilyKey("GTWC")).toBe("SRO");
    expect(seriesFamilyKey("WRL")).toBe("WRL");
    expect(seriesFamilyKey("Something else")).toBeNull();
  });
});
