import { SEA_LEVEL } from "../sim/environment/terrain.ts";
import { simulationAgeFromYears } from "../sim/time.ts";

export type FormattedMetric = {
  value: string;
  unit: string;
};

const finite = (value: number | undefined): number => Number.isFinite(value) ? value ?? 0 : 0;

export const formatNumber = (value: number | undefined, maximumFractionDigits = 0): string =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(finite(value));

export const formatSimulationAge = (elapsedYears: number | undefined): string => {
  const age = simulationAgeFromYears(finite(elapsedYears));
  return `${formatNumber(age.years)} 年 ${formatNumber(age.days)} 天`;
};

export const formatSimulationAgeMetric = (elapsedYears: number | undefined): FormattedMetric => {
  const age = simulationAgeFromYears(finite(elapsedYears));
  return { value: formatNumber(age.years), unit: `年 ${formatNumber(age.days)} 天` };
};

export const formatCount = (value: number | undefined, unit: string): FormattedMetric => {
  const amount = finite(value);
  const magnitude = Math.abs(amount);
  const scale = magnitude >= 100_000_000
    ? { divisor: 100_000_000, label: "亿" }
    : magnitude >= 10_000
      ? { divisor: 10_000, label: "万" }
      : magnitude >= 1_000
        ? { divisor: 1_000, label: "千" }
        : { divisor: 1, label: "" };
  return {
    value: formatNumber(amount / scale.divisor, scale.divisor === 1 ? 0 : 2),
    unit: `${scale.label}${unit}`,
  };
};

export const formatPercent = (value: number | undefined): FormattedMetric => {
  const percent = Math.max(0, finite(value)) * 100;
  return {
    value: percent > 0 && percent < 0.1 ? "<0.1" : formatNumber(percent, 1),
    unit: "%",
  };
};

export const formatIndex = (value: number | undefined): FormattedMetric => ({
  value: formatNumber(Math.max(0, finite(value)) * 100, 1),
  unit: "/100",
});

export const formatModelTemperature = (value: number | undefined): FormattedMetric => ({
  value: formatNumber(-50 + finite(value) * 100, 1),
  unit: "°C",
});

export const formatElevation = (value: number | undefined): FormattedMetric => ({
  value: formatNumber((finite(value) - SEA_LEVEL) * 9_000),
  unit: "m",
});

export const formatResource = (value: number | undefined): FormattedMetric =>
  formatCount(value, "食物单位");

export const formatRegionCoordinates = (
  x: number,
  y: number,
  width: number,
  height: number,
): string => {
  const longitude = ((x + 0.5) / Math.max(1, width)) * 360 - 180;
  const latitude = 90 - ((y + 0.5) / Math.max(1, height)) * 180;
  const longitudeLabel = `${formatNumber(Math.abs(longitude), 1)}°${longitude < 0 ? "W" : "E"}`;
  const latitudeLabel = `${formatNumber(Math.abs(latitude), 1)}°${latitude < 0 ? "S" : "N"}`;
  return `行星坐标 ${longitudeLabel} · ${latitudeLabel}`;
};
