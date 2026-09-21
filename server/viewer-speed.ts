import type { SimulationSpeed } from "../src/worker/scheduler.ts";

export const BACKGROUND_SIMULATION_SPEED: SimulationSpeed = 64;
export const OBSERVED_SIMULATION_SPEED: SimulationSpeed = 1;

export const simulationSpeedForViewerCount = (viewerCount: number): SimulationSpeed =>
  viewerCount > 0 ? OBSERVED_SIMULATION_SPEED : BACKGROUND_SIMULATION_SPEED;
