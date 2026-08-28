import { describe, expect, it } from "vitest";
import { compactFacilityRecords, facilityEffectProfileForRegion, facilityOperationalEffect, stepFacilities } from "../../src/sim/society/facilities.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import type { EntityId, FacilityState, KnowledgeDomain, RegionId, WorldEvent, WorldState } from "../../src/sim/types.ts";
import { createWorld } from "../../src/sim/world.ts";

const regionId = "region:2:2" as RegionId;
const members = Array.from({ length: 40 }, (_, index) => `agent:facility:${index}` as EntityId);

const worldWithTechnology = (domains: KnowledgeDomain[], seed = 501): WorldState => {
  const state = createWorld(seed, { width: 8, height: 8, formation: "formed" });
  state.organizations = [createOrganization("city", regionId, members)];
  state.knowledge = domains.map((domain, index) => ({
    id: `knowledge:${domain}:${index}`,
    kind: `innovation:${domain}:${index}`,
    domain,
    sourceIds: [members[0]!],
    credibility: 0.9,
    transmissionCost: 0.1,
    forgettingRate: 0.01,
  }));
  state.cultures = [{
    id: "culture:facility" as never,
    regionId,
    knowledgeIds: state.knowledge.map((knowledge) => knowledge.id),
    beliefIds: [],
    transmissionRate: 0.8,
  }];
  const localIndex = 2 * state.fields.elevation.width + 2;
  state.fields.nutrients.values[localIndex] = 1;
  state.chemistry.organics.values[localIndex] = 1;
  state.chemistry.oxygen.values[localIndex] = 1;
  return state;
};

const facilityFor = (state: WorldState, overrides: Partial<FacilityState> = {}): FacilityState => ({
  id: "facility:subsistence:test",
  type: "subsistence",
  regionId,
  ownerOrganizationId: state.organizations[0]!.id,
  level: 1,
  condition: 1,
  status: "active",
  workforceIds: members.slice(0, 2),
  materialInvested: 2.4,
  plannedTick: 1,
  builtTick: 2,
  lastMaintainedTick: 2,
  lastIncidentTick: 2,
  ...overrides,
});

const updatedFacility = (delta: ReturnType<typeof stepFacilities>, id: string): FacilityState | undefined =>
  delta.entityEffects.find((effect) => effect.collection === "facilities" && effect.operation === "update" && effect.id === id)?.value as FacilityState | undefined;

describe("facility lifecycle", () => {
  it("assigns each local adult to at most one facility and favors relevant skills", () => {
    const state = worldWithTechnology(["construction", "subsistence", "medicine"]);
    const owner = state.organizations[0]!;
    const worker = (id: EntityId, skills: Record<string, number>) => ({
      id, populationId: "population:workers" as never, regionId, age: 24, lifespan: 70, parentIds: [],
      traits: { cooperation: 1, curiosity: 1, sociality: 1 }, skills,
      needs: { food: 1, safety: 1, belonging: 1 }, memoryIds: [], knowledgeIds: [], beliefIds: [], relationshipIds: [],
    });
    state.agents = [
      worker(members[0]!, { toolUse: 1, observation: 1, "profession:construction": 1 }),
      worker(members[1]!, { toolUse: 1, observation: 0.8, "profession:construction": 1 }),
      worker(members[2]!, { observation: 1, communication: 1, "profession:medicine": 1 }),
      worker(members[3]!, { observation: 0.9, communication: 1, "profession:medicine": 1 }),
    ];
    state.facilities = [
      facilityFor(state, { id: "facility:construction:staff", type: "construction", workforceIds: [] }),
      facilityFor(state, { id: "facility:medicine:staff", type: "medicine", workforceIds: [] }),
    ];

    const delta = stepFacilities(state);
    const construction = updatedFacility(delta, "facility:construction:staff")!;
    const medicine = updatedFacility(delta, "facility:medicine:staff")!;
    const assigned = [...construction.workforceIds, ...medicine.workforceIds];

    expect(new Set(assigned).size).toBe(assigned.length);
    expect(construction.workforceIds).toContain(members[0]);
    expect(medicine.workforceIds).toContain(members[2]);
    expect(construction.workforceRequired).toBe(3);
    expect(medicine.workforceRequired).toBe(2);
    expect(delta.eventDrafts).toContainEqual(expect.objectContaining({ kind: "facility-workforce-changed" }));
  });

  it("does not double-book a worker across overlapping organizations", () => {
    const state = worldWithTechnology(["construction", "subsistence", "medicine"]);
    const city = state.organizations[0]!;
    const stateOrganization = createOrganization("state", regionId, city.memberIds);
    state.organizations.push(stateOrganization);
    state.facilities = [
      facilityFor(state, { id: "facility:city:farm", type: "subsistence", ownerOrganizationId: city.id, workforceIds: [] }),
      facilityFor(state, { id: "facility:state:clinic", type: "medicine", ownerOrganizationId: stateOrganization.id, workforceIds: [] }),
    ];

    const delta = stepFacilities(state);
    const farm = updatedFacility(delta, "facility:city:farm")!;
    const clinic = updatedFacility(delta, "facility:state:clinic")!;
    const assigned = [...farm.workforceIds, ...clinic.workforceIds];

    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("rebuilds workforce scores after skills change between simulation steps", () => {
    const state = worldWithTechnology(["construction"]);
    state.organizations[0]!.memberIds = members.slice(0, 4);
    state.agents = members.slice(0, 4).map((id, index) => ({
      id, populationId: "population:workers" as never, regionId, age: 24, lifespan: 70, parentIds: [],
      traits: { cooperation: 0, curiosity: 0 },
      skills: { toolUse: index === 0 ? 1 : index === 3 ? 0 : 0.5, observation: 0 },
      needs: {}, memoryIds: [], knowledgeIds: [], beliefIds: [], relationshipIds: [],
    }));
    const facility = facilityFor(state, { id: "facility:construction:score-refresh", type: "construction", workforceIds: [] });
    state.facilities = [facility];

    const first = updatedFacility(stepFacilities(state), facility.id)!;
    expect(first.workforceIds).toContain(members[0]);
    expect(first.workforceIds).not.toContain(members[3]);

    state.agents[0]!.skills.toolUse = 0;
    state.agents[3]!.skills.toolUse = 1;
    const second = updatedFacility(stepFacilities(state), facility.id)!;
    expect(second.workforceIds).not.toContain(members[0]);
    expect(second.workforceIds).toContain(members[3]);
  });

  it("removes migrated workers, fills vacancies, and scales effects under persistent shortages", () => {
    const state = worldWithTechnology(["construction", "subsistence"]);
    const facility = facilityFor(state, { level: 3, workforceIds: [members[0]!, members[1]!], workforceRequired: 2, workforceEfficiency: 1 });
    state.facilities = [facility];
    state.organizations[0]!.memberIds = [members[0]!, members[1]!, members[2]!];
    state.agents = [members[0]!, members[1]!, members[2]!].map((id, index) => ({
      id, populationId: "population:workers" as never, regionId: index === 0 ? "region:3:2" as RegionId : regionId, age: 25, lifespan: 70, parentIds: [],
      traits: { cooperation: 0.8, curiosity: 0.8 }, skills: { toolUse: 0.8 - index * 0.1, observation: 0.7 },
      needs: {}, memoryIds: [], knowledgeIds: [], beliefIds: [], relationshipIds: [],
    }));

    const refilled = updatedFacility(stepFacilities(state), facility.id)!;
    expect(refilled.workforceIds).not.toContain(members[0]);
    expect(refilled.workforceIds).toContain(members[2]);

    state.organizations[0]!.memberIds = [members[1]!];
    state.agents = state.agents.filter((agent) => agent.id === members[1]);
    const understaffed = updatedFacility(stepFacilities(state), facility.id)!;
    expect(understaffed.status).toBe("damaged");
    expect(understaffed.workforceIds).toHaveLength(1);
    expect(facilityOperationalEffect(understaffed)).toBeLessThan(facilityOperationalEffect(facility));
  });

  it("derives bounded operational effects from level, condition, and lifecycle status", () => {
    const state = worldWithTechnology(["construction", "subsistence"]);
    const active = facilityFor(state, { level: 3, condition: 1, status: "active" });
    const damaged = facilityFor(state, { id: "facility:subsistence:damaged", level: 3, condition: 0.5, status: "damaged" });
    const planned = facilityFor(state, { id: "facility:subsistence:planned", level: 3, condition: 1, status: "planned" });
    const abandoned = facilityFor(state, { id: "facility:subsistence:abandoned", level: 3, condition: 1, status: "abandoned" });

    expect(facilityOperationalEffect(active)).toBe(1);
    expect(facilityOperationalEffect(damaged)).toBeCloseTo(0.325, 8);
    expect(facilityOperationalEffect(planned)).toBe(0);
    expect(facilityOperationalEffect(abandoned)).toBe(0);
    state.facilities = [active, damaged, planned, abandoned];
    expect(facilityEffectProfileForRegion(state, regionId).subsistence).toBe(1);
  });

  it("uses construction and energy facilities to increase auditable material production", () => {
    const base = worldWithTechnology(["construction"]);
    const owner = base.organizations[0]!;
    const baseProduction = stepFacilities(base).resourceTransactions.find((transaction) => transaction.causeRuleId === "society:material-production")?.amount ?? 0;
    const supported = structuredClone(base);
    supported.facilities = [
      facilityFor(supported, { id: "facility:construction:support", type: "construction", level: 3, condition: 1, workforceIds: owner.memberIds.slice(0, 3) }),
      facilityFor(supported, { id: "facility:energy:support", type: "energy", level: 3, condition: 1, workforceIds: owner.memberIds.slice(0, 4) }),
    ];
    const supportedProduction = stepFacilities(supported).resourceTransactions.find((transaction) => transaction.causeRuleId === "society:material-production")?.amount ?? 0;

    expect(baseProduction).toBeGreaterThan(0);
    expect(supportedProduction).toBeCloseTo(baseProduction * 1.7, 5);
    expect(stepFacilities(base).fieldChanges).toContainEqual(expect.objectContaining({
      field: "nutrients",
      operation: "add",
      causeRuleId: "society:mineral-extraction",
      value: expect.any(Number),
    }));
    expect(stepFacilities(supported).resourceTransactions).toContainEqual(expect.objectContaining({
      resourceId: "energy",
      operation: "mint",
      causeRuleId: "society:facility-energy-production",
    }));

    const materialSupported = structuredClone(supported);
    materialSupported.substances = [{
      id: "substance:construction:test",
      name: "曜脉合材",
      kind: "engineered-composite",
      formation: "engineered",
      status: "known",
      regionId,
      originTick: 1,
      originYears: 1,
      parentIds: [],
      composition: { carbon: 0.2, nitrogen: 0.2, phosphorus: 0.2, organics: 0.2, oxygen: 0.2 },
      properties: { hardness: 1, density: 0.7, reactivity: 0.1, conductivity: 1, energyPotential: 1, biologicalAffinity: 0.2, stability: 1 },
      reserveCapacity: 0,
      remainingReserve: 0,
      extractedTotal: 0,
      discoveredByIds: members.slice(0, 2),
      discoveryTick: 1,
      discoveryYears: 1,
    }];
    const materialProduction = stepFacilities(materialSupported).resourceTransactions.find((transaction) => transaction.causeRuleId === "society:material-production")?.amount ?? 0;
    const materialEnergy = stepFacilities(materialSupported).resourceTransactions.find((transaction) => transaction.causeRuleId === "society:facility-energy-production")?.amount ?? 0;
    const supportedEnergy = stepFacilities(supported).resourceTransactions.find((transaction) => transaction.causeRuleId === "society:facility-energy-production")?.amount ?? 0;

    expect(materialProduction).toBeGreaterThan(supportedProduction);
    expect(materialEnergy).toBeGreaterThan(supportedEnergy);
  });

  it("depletes a small natural deposit and stops its later material output", () => {
    const state = worldWithTechnology(["construction"]);
    const index = 2 * state.fields.elevation.width + 2;
    state.fields.nutrients.values[index] = 0;
    state.substances = [{
      id: "substance:finite-deposit",
      name: "微量棱矿",
      kind: "mineral",
      formation: "geological",
      status: "known",
      regionId,
      originTick: 1,
      originYears: 1,
      parentIds: [],
      composition: { carbon: 0.2, nitrogen: 0.2, phosphorus: 0.2, organics: 0.2, oxygen: 0.2 },
      properties: { hardness: 1, density: 0.8, reactivity: 0.1, conductivity: 0.4, energyPotential: 0.3, biologicalAffinity: 0.2, stability: 1 },
      reserveCapacity: 0.05,
      remainingReserve: 0.05,
      extractedTotal: 0,
      discoveredByIds: members.slice(0, 2),
    }];

    const delta = stepFacilities(state);
    const depleted = delta.entityEffects.find((effect) => effect.collection === "substances" && effect.id === state.substances[0]!.id)?.value as WorldState["substances"][number];
    expect(delta.resourceTransactions).toContainEqual(expect.objectContaining({ resourceId: "materials", operation: "mint", amount: 0.05 }));
    expect(depleted).toMatchObject({ remainingReserve: 0, extractedTotal: 0.05 });
    expect(delta.eventDrafts.filter((event) => event.kind === "substance-depletion")).toHaveLength(1);

    state.substances = [depleted];
    const afterDepletion = stepFacilities(state);
    expect(afterDepletion.resourceTransactions.some((transaction) => transaction.causeRuleId === "society:material-production")).toBe(false);
    expect(afterDepletion.eventDrafts.some((event) => event.kind === "substance-depletion")).toBe(false);
  });

  it("converts finite organic feedstock into energy with local chemistry feedback", () => {
    const state = worldWithTechnology(["energy"]);
    const index = 2 * state.fields.elevation.width + 2;
    state.chemistry.organics.values[index] = 0.000001;
    state.facilities = [facilityFor(state, { id: "facility:energy:feedstock", type: "energy", level: 2, workforceIds: members.slice(0, 4) })];

    const delta = stepFacilities(state);
    expect(delta.resourceTransactions).toContainEqual(expect.objectContaining({ resourceId: "energy", operation: "mint", amount: expect.any(Number) }));
    expect(delta.chemistryChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "organics", value: expect.any(Number), causeRuleId: "society:energy-feedstock-conversion" }),
      expect.objectContaining({ field: "oxygen", value: expect.any(Number), causeRuleId: "society:energy-feedstock-conversion" }),
      expect.objectContaining({ field: "carbon", value: expect.any(Number), causeRuleId: "society:energy-feedstock-conversion" }),
    ]));
    expect(delta.chemistryChanges.find((change) => change.field === "organics")?.value).toBeLessThan(0);
    expect(delta.chemistryChanges.find((change) => change.field === "oxygen")?.value).toBeLessThan(0);
    expect(delta.chemistryChanges.find((change) => change.field === "carbon")?.value).toBeGreaterThan(0);
  });

  it("plans facilities from technology but does not construct without existing materials", () => {
    const state = worldWithTechnology(["construction", "subsistence"]);

    const delta = stepFacilities(state);

    expect(delta.resourceTransactions).toContainEqual(expect.objectContaining({ resourceId: "materials", operation: "mint" }));
    expect(delta.resourceTransactions.some((transaction) => transaction.operation === "consume")).toBe(false);
    expect(delta.entityEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: "facilities", operation: "create", value: expect.objectContaining({ type: "construction", status: "planned" }) }),
      expect.objectContaining({ collection: "facilities", operation: "create", value: expect.objectContaining({ type: "subsistence", status: "planned" }) }),
    ]));
  });

  it("constructs a planned facility with labor and auditable material consumption", () => {
    const state = worldWithTechnology(["construction", "subsistence"]);
    const facility = facilityFor(state, { condition: 0, status: "planned", materialInvested: 0, builtTick: -1 });
    state.facilities = [facility];
    state.resources = [{ id: "materials:test", resourceId: "materials", regionId, holderId: facility.ownerOrganizationId, amount: 8, cap: 100, originEventId: "test" }];

    const delta = stepFacilities(state);
    const updated = updatedFacility(delta, facility.id);

    expect(updated).toMatchObject({ status: "active", condition: 1, materialInvested: 2.4, builtTick: state.tick });
    expect(delta.resourceTransactions).toContainEqual(expect.objectContaining({ operation: "consume", resourceId: "materials", amount: 2.4, fromHolderId: facility.ownerOrganizationId }));
    expect(delta.eventDrafts).toContainEqual(expect.objectContaining({ kind: "facility-constructed", sourceIds: [facility.id, facility.ownerOrganizationId] }));
  });

  it("upgrades facilities when domain knowledge, condition, labor and materials permit it", () => {
    const state = worldWithTechnology(["construction", "construction", "construction", "subsistence", "subsistence", "subsistence"]);
    const facility = facilityFor(state);
    state.facilities = [facility];
    state.resources = [{ id: "materials:test", resourceId: "materials", regionId, holderId: facility.ownerOrganizationId, amount: 20, cap: 100, originEventId: "test" }];

    const delta = stepFacilities(state);

    expect(updatedFacility(delta, facility.id)).toMatchObject({ level: 2, status: "active" });
    expect(delta.eventDrafts).toContainEqual(expect.objectContaining({ kind: "facility-upgraded", payload: expect.objectContaining({ level: 2 }) }));
  });

  it("applies a local disaster once and can maintain the resulting damage", () => {
    const state = worldWithTechnology(["construction", "construction", "construction", "construction", "construction", "construction", "subsistence"], 503);
    const facility = facilityFor(state, { lastIncidentTick: 0 });
    state.facilities = [facility];
    state.tick = 20;
    state.resources = [{ id: "materials:test", resourceId: "materials", regionId, holderId: facility.ownerOrganizationId, amount: 10, cap: 100, originEventId: "test" }];
    const event = (kind: string): WorldEvent => ({ id: `event:${kind}`, tick: 10, years: 10, kind, ruleId: `user:${kind}`, source: "user", sourceIds: [], probability: 1, roll: 0, evidence: { regionId, intensity: 1 }, payload: { regionId } });
    const incidents = [event("volcano"), event("earthquake"), event("meteor")];

    const delta = stepFacilities(state, incidents);
    const updated = updatedFacility(delta, facility.id);

    expect(delta.eventDrafts).toContainEqual(expect.objectContaining({ kind: "facility-damaged" }));
    expect(delta.eventDrafts.some((draft) => draft.kind === "facility-maintained")).toBe(false);
    expect(updated?.lastIncidentTick).toBe(10);
    expect(updated?.status).toBe("damaged");

    const replayState = structuredClone(state);
    replayState.facilities = [updated!];
    const replay = stepFacilities(replayState);
    expect(replay.eventDrafts.some((draft) => draft.kind === "facility-damaged")).toBe(false);
    expect(replay.eventDrafts).toContainEqual(expect.objectContaining({ kind: "facility-maintained" }));
    expect(updatedFacility(replay, facility.id)?.materialInvested).toBeGreaterThan(facility.materialInvested);
  });

  it("abandons assets whose owning organization has collapsed", () => {
    const state = worldWithTechnology(["construction", "subsistence"]);
    const facility = facilityFor(state);
    state.facilities = [facility];
    state.organizations[0]!.status = "collapsed";

    const delta = stepFacilities(state);

    expect(updatedFacility(delta, facility.id)).toMatchObject({ status: "abandoned", workforceIds: [], abandonedTick: state.tick });
    expect(delta.eventDrafts).toContainEqual(expect.objectContaining({ kind: "facility-abandoned", evidence: expect.objectContaining({ reason: "owner-unavailable" }) }));
  });

  it("retires abandoned facility records after their audit window", () => {
    const state = worldWithTechnology(["construction", "subsistence"]);
    state.tick = 100;
    state.facilities = [facilityFor(state, { status: "abandoned", abandonedTick: 0 })];

    const delta = stepFacilities(state);

    expect(delta.entityEffects).toContainEqual(expect.objectContaining({ collection: "facilities", operation: "remove", id: state.facilities[0]!.id }));
    expect(delta.eventDrafts).toContainEqual(expect.objectContaining({ kind: "facility-retired" }));
  });

  it("keeps one strongest facility record per region and domain", () => {
    const state = worldWithTechnology(["construction"]);
    const active = facilityFor(state, { id: "facility:construction:active", type: "construction", level: 2, condition: 0.8 });
    const damaged = facilityFor(state, { id: "facility:construction:damaged", type: "construction", status: "damaged", condition: 1 });
    const otherDomain = facilityFor(state, { id: "facility:subsistence:other", type: "subsistence" });
    state.facilities = [damaged, otherDomain, active];

    const removed = compactFacilityRecords(state);

    expect(removed).toBe(1);
    expect(state.facilities.map((facility) => facility.id)).toEqual([
      "facility:construction:active",
      "facility:subsistence:other",
    ]);
  });

  it("is deterministic for the same authoritative state", () => {
    const state = worldWithTechnology(["construction", "subsistence"], 505);
    state.facilities = [facilityFor(state, { condition: 0.5 })];
    state.resources = [{ id: "materials:test", resourceId: "materials", regionId, holderId: state.organizations[0]!.id, amount: 5, cap: 100, originEventId: "test" }];

    expect(stepFacilities(structuredClone(state))).toEqual(stepFacilities(structuredClone(state)));
  });
});
