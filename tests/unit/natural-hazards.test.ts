import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { stepWorld } from "../../src/sim/engine.ts";
import { societyStage } from "../../src/sim/society/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import type { WorldDelta } from "../../src/sim/types.ts";
import { createWorld } from "../../src/sim/world.ts";
import { naturalHazardDelta } from "../../src/sim/environment/hazards.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

describe("natural hazard society bridge", () => {
  it("derives geological hazards from authoritative plate evidence", () => {
    const state = createWorld(990, { width: 8, height: 8, formation: "formed" });
    state.fields.elevation.values.fill(0.5);
    state.fields.temperature.values.fill(0.5);
    state.fields.humidity.values.fill(0.5);
    state.fields.water.values.fill(0.5);
    state.tectonics.plateIndex.values.set(Array.from({ length: 64 }, (_, index) => index % 2));
    state.tectonics.boundaryStress.values.fill(1);
    state.tectonics.boundaryActivity.values.fill(0.8);

    const result = naturalHazardDelta(state, 1_000_000);
    const geological = result.delta.eventDrafts.filter((event) => event.kind === "volcano" || event.kind === "earthquake");

    expect(geological.length).toBeGreaterThan(0);
    expect(geological.every((event) => event.sourceIds.length === 2
      && typeof event.evidence.plateId === "string"
      && typeof event.evidence.peerPlateId === "string"
      && event.evidence.boundaryType === "convergent")).toBe(true);
  });

  it("emits environmental hazards through the authoritative world step", () => {
    const state = createWorld(992, { width: 8, height: 8, formation: "formed" });
    state.fields.elevation.values.fill(0.02);
    state.fields.temperature.values.fill(0.5);
    state.fields.humidity.values.fill(0.99);
    state.fields.water.values.fill(0.99);

    const result = stepWorld(state, { elapsedYears: 10_000, externalEvents: [] }, { computeDigest: false });
    const floods = result.events.filter((event) => event.kind === "flood");

    expect(floods.length).toBeGreaterThan(0);
    expect(floods.every((event) => event.source === "natural" && event.ruleId === "environment:natural-flood")).toBe(true);
    expect(floods.every((event) => event.sourceIds.length === 0)).toBe(true);
    expect(result.state.fields.water.values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });

  it("passes a same-step natural flood into facility damage exactly once", () => {
    const state = createWorld(1, { width: 8, height: 8, formation: "formed" });
    state.tick = 10;
    const regionId = "region:0:0" as never;
    const species = createSpecies("hazard-workers", "consumer");
    const population = { id: "population:hazard-workers" as never, speciesId: species.id, regionId, count: 240, energy: 1 };
    const agents = Array.from({ length: 32 }, (_, index) => createAgent(population, species, index, "hazard-workers"));
    const owner = createOrganization("city", regionId, agents.map((agent) => agent.id));
    state.species = [species];
    state.populations = [population];
    state.agents = agents;
    state.organizations = [owner];
    state.facilities = [{
      id: "facility:hazard-farm",
      type: "subsistence",
      regionId,
      ownerOrganizationId: owner.id,
      level: 1,
      condition: 1,
      status: "active",
      workforceIds: agents.slice(0, 2).map((agent) => agent.id),
      materialInvested: 2,
      plannedTick: 1,
      builtTick: 2,
      lastMaintainedTick: 2,
      lastIncidentTick: 0,
    }];
    const environment = emptyDelta();
    environment.eventDrafts.push({
      kind: "flood",
      ruleId: "environment:natural-flood",
      sourceIds: [],
      probability: 0.9,
      roll: 0.1,
      evidence: { regionId, intensity: 1 },
      payload: { regionId, intensity: 1 },
      source: "natural",
    });

    const delta = societyStage.run(state, { elapsedYears: 1, externalEvents: [] }, new Map([["environment", environment]]));
    const damaged = delta.eventDrafts.find((event) => event.kind === "facility-damaged");
    const facility = delta.entityEffects.find((effect) => effect.collection === "facilities" && effect.id === "facility:hazard-farm" && effect.value);

    expect(damaged?.evidence.incidentKinds).toBe("flood");
    expect(facility?.value).toMatchObject({ status: "damaged", lastIncidentTick: 11, lastInspectedEventTick: 11 });
  });
});
