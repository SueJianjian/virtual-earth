import { performance } from "node:perf_hooks";
import { stepWorld } from "../src/sim/engine.ts";
import { createWorld, worldDigest } from "../src/sim/world.ts";

const seed = 42;
const steps = 900;
const width = 16;
const height = 8;
let state = createWorld(seed, { width, height });
const started = performance.now();
for (let index = 0; index < steps; index += 1) {
  state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }).state;
}
const elapsed = performance.now() - started;
const averageStep = elapsed / steps;
const hotspotCount = state.lod.summaries.length;
const populationCount = state.agents.length;

console.log(JSON.stringify({
  seed,
  steps,
  grid: `${width}x${height}`,
  elapsedMs: Number(elapsed.toFixed(2)),
  averageStepMs: Number(averageStep.toFixed(4)),
  hotspots: hotspotCount,
  agents: populationCount,
  species: state.species.length,
  events: state.events.length,
  digest: worldDigest(state),
}, null, 2));
