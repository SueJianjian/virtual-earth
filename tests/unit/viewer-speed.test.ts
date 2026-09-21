import { describe, expect, it } from "vitest";
import {
  BACKGROUND_SIMULATION_SPEED,
  OBSERVED_SIMULATION_SPEED,
  simulationSpeedForViewerCount,
} from "../../server/viewer-speed.ts";

describe("cloud viewer speed policy", () => {
  it("runs at 64x while nobody is observing", () => {
    expect(BACKGROUND_SIMULATION_SPEED).toBe(64);
    expect(simulationSpeedForViewerCount(0)).toBe(64);
  });

  it("runs at 1x while one or more webpages are connected", () => {
    expect(OBSERVED_SIMULATION_SPEED).toBe(1);
    expect(simulationSpeedForViewerCount(1)).toBe(1);
    expect(simulationSpeedForViewerCount(8)).toBe(1);
  });
});
