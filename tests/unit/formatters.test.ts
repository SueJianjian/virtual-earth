import { describe, expect, it } from "vitest";
import { formatCount, formatElevation, formatIndex, formatModelTemperature, formatPercent, formatRegionCoordinates, formatResource } from "../../src/ui/formatters.ts";

describe("observation metric formatters", () => {
  it("formats zero, small percentages and normalized indices without false precision", () => {
    expect(formatPercent(0)).toEqual({ value: "0", unit: "%" });
    expect(formatPercent(0.0009)).toEqual({ value: "<0.1", unit: "%" });
    expect(formatIndex(0.0571)).toEqual({ value: "5.7", unit: "/100" });
  });

  it("uses Chinese compact scales while retaining the counting unit", () => {
    expect(formatCount(999, "个")).toEqual({ value: "999", unit: "个" });
    expect(formatCount(1_250, "个")).toEqual({ value: "1.25", unit: "千个" });
    expect(formatCount(12_500, "户")).toEqual({ value: "1.25", unit: "万户" });
    expect(formatCount(250_000_000, "人次")).toEqual({ value: "2.5", unit: "亿人次" });
    expect(formatResource(24_000)).toEqual({ value: "2.4", unit: "万食物单位" });
    expect(formatResource(-24_000)).toEqual({ value: "-2.4", unit: "万食物单位" });
  });

  it("converts normalized model temperature and terrain height into readable units", () => {
    expect(formatModelTemperature(0.5)).toEqual({ value: "0", unit: "°C" });
    expect(formatModelTemperature(0.72)).toEqual({ value: "22", unit: "°C" });
    expect(formatElevation(0.48)).toEqual({ value: "0", unit: "m" });
    expect(formatElevation(0.58)).toEqual({ value: "900", unit: "m" });
  });

  it("describes a selected cell as synthetic planetary coordinates", () => {
    expect(formatRegionCoordinates(0, 0, 4, 2)).toBe("行星坐标 135°W · 45°N");
    expect(formatRegionCoordinates(3, 1, 4, 2)).toBe("行星坐标 135°E · 45°S");
  });
});
