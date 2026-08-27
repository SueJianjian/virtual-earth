import { technologyProfilesForState } from "../culture/technology.ts";
import { substanceEffectProfilesForState } from "../environment/substances.ts";
import { forkRandom, hashString, randomFloat } from "../random.ts";
import type {
  FacilityState,
  KnowledgeDomain,
  OrganizationId,
  OrganizationType,
  RegionId,
  SocietyDelta,
  WorldDelta,
  WorldEvent,
  WorldState,
} from "../types.ts";

const domains: KnowledgeDomain[] = ["subsistence", "construction", "navigation", "medicine", "governance", "energy"];
const civicTypes = new Set<OrganizationType>(["settlement", "city", "state", "federation", "empire"]);
const organizationRank: Record<OrganizationType, number> = {
  family: 0,
  clan: 1,
  tribe: 2,
  settlement: 3,
  city: 4,
  state: 5,
  federation: 6,
  empire: 7,
};
const workforceRequired: Record<KnowledgeDomain, number> = {
  subsistence: 2,
  construction: 3,
  navigation: 3,
  medicine: 2,
  governance: 4,
  energy: 4,
};
export const facilityWorkforceRequiredFor = (type: KnowledgeDomain): number => workforceRequired[type];
const constructionCost: Record<KnowledgeDomain, number> = {
  subsistence: 2.4,
  construction: 3,
  navigation: 3.4,
  medicine: 3.2,
  governance: 4,
  energy: 4.5,
};

type FacilityOwner = {
  id: OrganizationId;
  type: OrganizationType;
  regionId: RegionId;
  memberIds: WorldState["agents"][number]["id"][];
};

type WorkerRecord = {
  id: WorldState["agents"][number]["id"];
  regionId?: RegionId;
  age?: number;
  skills: Record<string, number>;
  traits: Record<string, number>;
};

type WorkforceAssignment = {
  ids: FacilityState["workforceIds"];
  efficiency: number;
  required: number;
};

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const ABANDONED_FACILITY_RETENTION_TICKS = 100;

export type FacilityEffectProfile = Record<KnowledgeDomain, number>;
const emptyEffectProfile = (): FacilityEffectProfile => ({
  subsistence: 0,
  construction: 0,
  navigation: 0,
  medicine: 0,
  governance: 0,
  energy: 0,
});
type FacilitySource = Pick<WorldState, "facilities">;
const effectCache = new WeakMap<WorldState["facilities"], ReadonlyMap<RegionId, FacilityEffectProfile>>();

export const facilityOperationalEffect = (facility: FacilityState): number => {
  if (facility.status !== "active" && facility.status !== "damaged") return 0;
  const statusFactor = facility.status === "damaged" ? 0.65 : 1;
  const required = facility.workforceRequired ?? facilityWorkforceRequiredFor(facility.type);
  const staffing = clamp(facility.workforceIds.length / Math.max(1, required));
  const skillFactor = 0.55 + clamp(facility.workforceEfficiency ?? 1) * 0.45;
  return clamp((facility.level / 3) * clamp(facility.condition) * statusFactor * staffing * skillFactor);
};

export const facilityEffectProfilesForState = (state: FacilitySource): ReadonlyMap<RegionId, FacilityEffectProfile> => {
  const cached = effectCache.get(state.facilities);
  if (cached) return cached;
  const profiles = new Map<RegionId, FacilityEffectProfile>();
  for (const facility of state.facilities) {
    const effect = facilityOperationalEffect(facility);
    if (effect <= 0) continue;
    const profile = profiles.get(facility.regionId) ?? emptyEffectProfile();
    profile[facility.type] = clamp(profile[facility.type] + effect);
    profiles.set(facility.regionId, profile);
  }
  effectCache.set(state.facilities, profiles);
  return profiles;
};

export const facilityEffectProfileForRegion = (state: FacilitySource, regionId: RegionId): FacilityEffectProfile =>
  facilityEffectProfilesForState(state).get(regionId) ?? emptyEffectProfile();

export const facilityIdFor = (regionId: RegionId, type: KnowledgeDomain, ownerId: OrganizationId): string =>
  `facility:${type}:${hashString(`${regionId}:${ownerId}`).toString(16)}`;

const ownerRecords = (state: WorldState): FacilityOwner[] => {
  const collapsedIds = new Set(state.organizations.filter((organization) => organization.status === "collapsed").map((organization) => organization.id));
  const byId = new Map<OrganizationId, FacilityOwner>();
  for (const organization of state.organizations) {
    if (organization.status === "collapsed" || !civicTypes.has(organization.type)) continue;
    byId.set(organization.id, {
      id: organization.id,
      type: organization.type,
      regionId: organization.regionId,
      memberIds: [...organization.memberIds],
    });
  }
  for (const summary of state.lod.summaries) {
    for (const organization of summary.organizations) {
      if (byId.has(organization.id) || collapsedIds.has(organization.id) || !civicTypes.has(organization.type)) continue;
      byId.set(organization.id, {
        id: organization.id,
        type: organization.type,
        regionId: summary.regionId,
        memberIds: [...organization.memberIds],
      });
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const primaryOwnersByRegion = (owners: FacilityOwner[]): Map<RegionId, FacilityOwner> => {
  const result = new Map<RegionId, FacilityOwner>();
  for (const owner of owners) {
    const current = result.get(owner.regionId);
    if (!current
      || organizationRank[owner.type] > organizationRank[current.type]
      || (organizationRank[owner.type] === organizationRank[current.type] && owner.memberIds.length > current.memberIds.length)
      || (organizationRank[owner.type] === organizationRank[current.type] && owner.memberIds.length === current.memberIds.length && owner.id.localeCompare(current.id) < 0)) {
      result.set(owner.regionId, owner);
    }
  }
  return result;
};

const resourceKey = (resourceId: string, regionId: RegionId, holderId?: string): string =>
  `${resourceId}|${regionId}|${holderId ?? "world"}`;

const professionSkillKey = (type: KnowledgeDomain): string => `profession:${type}`;

const workerRecordsFor = (state: WorldState): ReadonlyMap<string, WorkerRecord> => {
  const records = new Map<string, WorkerRecord>();
  for (const agent of state.agents) records.set(agent.id, { id: agent.id, regionId: agent.regionId, age: agent.age, skills: agent.skills, traits: agent.traits });
  for (const summary of state.lod.summaries) {
    for (const record of summary.agentRecords) {
      if (!records.has(record.id)) records.set(record.id, { id: record.id, regionId: summary.regionId, age: record.age, skills: record.skills, traits: {} });
    }
  }
  return records;
};

const workerScore = (worker: WorkerRecord | undefined, type: KnowledgeDomain): number => {
  if (!worker) return 0.5;
  const skill = (name: string): number => clamp(worker.skills[name] ?? 0);
  const trait = (name: string): number => clamp(worker.traits[name] ?? 0);
  const profession = skill(professionSkillKey(type));
  const general: Record<KnowledgeDomain, number> = {
    subsistence: skill("toolUse") * 0.38 + skill("observation") * 0.24 + trait("cooperation") * 0.2 + trait("curiosity") * 0.18,
    construction: skill("toolUse") * 0.58 + skill("observation") * 0.12 + trait("cooperation") * 0.2 + trait("curiosity") * 0.1,
    navigation: skill("observation") * 0.42 + skill("communication") * 0.18 + skill("toolUse") * 0.12 + trait("curiosity") * 0.28,
    medicine: skill("observation") * 0.48 + skill("communication") * 0.2 + trait("cooperation") * 0.2 + trait("curiosity") * 0.12,
    governance: skill("communication") * 0.46 + skill("observation") * 0.08 + trait("cooperation") * 0.28 + trait("sociality") * 0.18,
    energy: skill("toolUse") * 0.5 + skill("observation") * 0.26 + trait("curiosity") * 0.16 + trait("cooperation") * 0.08,
  };
  return clamp(general[type] * 0.65 + profession * 0.35);
};

const workforceAssignmentsFor = (
  state: WorldState,
  owners: FacilityOwner[],
  primaryOwners: ReadonlyMap<RegionId, FacilityOwner>,
  technology: ReturnType<typeof technologyProfilesForState>,
): ReadonlyMap<string, WorkforceAssignment> => {
  const workers = workerRecordsFor(state);
  const facilitiesByOwner = new Map<OrganizationId, Array<{ id: string; type: KnowledgeDomain; existingIds: Set<string>; priority: number }>>();
  for (const facility of state.facilities.filter((candidate) => candidate.status !== "abandoned")) {
    const entries = facilitiesByOwner.get(facility.ownerOrganizationId) ?? [];
    entries.push({ id: facility.id, type: facility.type, existingIds: new Set(facility.workforceIds), priority: facility.status === "active" ? 0 : facility.status === "damaged" ? 1 : 2 });
    facilitiesByOwner.set(facility.ownerOrganizationId, entries);
  }
  for (const owner of primaryOwners.values()) {
    const profile = technology.get(owner.regionId);
    if (!profile || profile.construction <= 0) continue;
    const entries = facilitiesByOwner.get(owner.id) ?? [];
    const existingTypes = new Set(entries.map((entry) => entry.type));
    for (const type of domains) {
      if (profile[type] <= 0 || existingTypes.has(type)) continue;
      entries.push({ id: facilityIdFor(owner.regionId, type, owner.id), type, existingIds: new Set(), priority: 3 });
    }
    facilitiesByOwner.set(owner.id, entries);
  }
  const assignments = new Map<string, WorkforceAssignment>();
  const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
  const globallyAssigned = new Set<string>();
  const orderedOwners = [...facilitiesByOwner.entries()].sort(([left], [right]) => {
    const leftOwner = ownersById.get(left);
    const rightOwner = ownersById.get(right);
    return (rightOwner ? organizationRank[rightOwner.type] : -1) - (leftOwner ? organizationRank[leftOwner.type] : -1) || left.localeCompare(right);
  });
  for (const [ownerId, entries] of orderedOwners) {
    const owner = ownersById.get(ownerId);
    if (!owner) continue;
    const available = new Set(owner.memberIds);
    for (const entry of entries.sort((left, right) => left.priority - right.priority || domains.indexOf(left.type) - domains.indexOf(right.type) || left.id.localeCompare(right.id))) {
      const required = workforceRequired[entry.type];
      const candidates = [...available]
        .filter((id) => !globallyAssigned.has(id))
        .filter((id) => {
          const worker = workers.get(id);
          return (worker?.regionId === undefined || worker.regionId === owner.regionId) && (worker?.age === undefined || worker.age >= 14);
        })
        .map((id) => ({ id, score: workerScore(workers.get(id), entry.type), retained: entry.existingIds.has(id) }))
        .sort((left, right) => (right.score + Number(right.retained) * 0.03) - (left.score + Number(left.retained) * 0.03) || left.id.localeCompare(right.id))
        .slice(0, required);
      for (const candidate of candidates) {
        available.delete(candidate.id);
        globallyAssigned.add(candidate.id);
      }
      assignments.set(entry.id, {
        ids: candidates.map((candidate) => candidate.id),
        efficiency: candidates.length > 0 ? candidates.reduce((sum, candidate) => sum + candidate.score, 0) / candidates.length : 0,
        required,
      });
    }
  }
  return assignments;
};

const eventRegions = (event: WorldEvent): string[] => [
  event.payload.regionId,
  event.payload.fromRegion,
  event.payload.toRegion,
  event.evidence.regionId,
].filter((value): value is string => typeof value === "string");

const incidentSeverity = (facility: FacilityState, events: WorldEvent[]): { severity: number; lastTick: number; kinds: string[] } => {
  const naturalSeverity: Record<string, number> = { volcano: 0.32, earthquake: 0.28, meteor: 0.42, drought: 0.12, flood: 0.22 };
  const conflictKinds = new Set(["organization-conflict", "border-conflict", "organization-war"]);
  let severity = 0;
  let lastTick = facility.lastIncidentTick;
  const inspectedThrough = facility.lastInspectedEventTick ?? facility.lastIncidentTick;
  const kinds = new Set<string>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (event.tick <= inspectedThrough || event.tick < facility.plannedTick) break;
    const local = eventRegions(event).includes(facility.regionId)
      || event.sourceIds.includes(facility.ownerOrganizationId)
      || event.sourceIds.includes(facility.id);
    if (!local) continue;
    const base = naturalSeverity[event.kind] ?? (conflictKinds.has(event.kind) ? 0.2 : 0);
    if (base <= 0) continue;
    const intensity = clamp(Number(event.evidence.intensity ?? event.payload.intensity ?? event.probability ?? 0.5));
    severity += base * (0.55 + intensity * 0.9);
    lastTick = Math.max(lastTick, event.tick);
    kinds.add(event.kind);
  }
  return { severity: Math.min(0.85, severity), lastTick, kinds: [...kinds].sort() };
};

const lifecycleEvent = (
  delta: WorldDelta,
  facility: FacilityState,
  kind: string,
  ruleId: string,
  evidence: Record<string, number | string | boolean>,
): void => {
  delta.eventDrafts.push({
    kind,
    ruleId,
    sourceIds: [facility.id, facility.ownerOrganizationId],
    probability: 1,
    roll: 0,
    evidence: { regionId: facility.regionId, facilityType: facility.type, ...evidence },
    payload: {
      regionId: facility.regionId,
      facilityId: facility.id,
      ownerOrganizationId: facility.ownerOrganizationId,
      facilityType: facility.type,
      level: facility.level,
      status: facility.status,
    },
    source: "natural",
  });
};

const consumeMaterials = (
  delta: WorldDelta,
  state: WorldState,
  facility: FacilityState,
  amount: number,
  purpose: string,
): void => {
  delta.resourceTransactions.push({
    id: `resource:materials:${purpose}:${state.tick}:${facility.id}`,
    resourceId: "materials",
    regionId: facility.regionId,
    amount: rounded(amount),
    operation: "consume",
    source: "culture",
    sourceId: facility.id,
    fromHolderId: facility.ownerOrganizationId,
    causeRuleId: `society:facility-${purpose}`,
  });
};

export const stepFacilities = (state: WorldState, incidentEvents: WorldEvent[] = state.events): SocietyDelta => {
  const delta = emptyDelta();
  const balances = new Map<string, number>();
  for (const resource of state.resources) {
    const key = resourceKey(resource.resourceId, resource.regionId, resource.holderId);
    balances.set(key, (balances.get(key) ?? 0) + resource.amount);
  }
  const materialBalanceFor = (regionId: RegionId, holderId: OrganizationId): number =>
    balances.get(resourceKey("materials", regionId, holderId)) ?? 0;
  const owners = ownerRecords(state);
  const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
  const primaryOwners = primaryOwnersByRegion(owners);
  const technology = technologyProfilesForState(state);
  const facilityEffects = facilityEffectProfilesForState(state);
  const substanceEffects = substanceEffectProfilesForState(state);
  const workforceAssignments = workforceAssignmentsFor(state, owners, primaryOwners, technology);
  const plannedBalances = new Map<OrganizationId, number>();

  for (const owner of [...primaryOwners.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const profile = technology.get(owner.regionId);
    if (!profile || profile.construction <= 0 || owner.memberIds.length < workforceRequired.construction) continue;
    const [xText, yText] = owner.regionId.replace("region:", "").split(":");
    const x = Number(xText);
    const y = Number(yText);
    const index = Number.isInteger(x) && Number.isInteger(y) ? y * state.fields.elevation.width + x : -1;
    const elevation = index >= 0 ? state.fields.elevation.values[index] ?? 0 : 0;
    const nutrients = index >= 0 ? state.fields.nutrients.values[index] ?? 0 : 0;
    const geologyFactor = 0.78 + clamp(elevation) * 0.25 + clamp(nutrients) * 0.18;
    const localFacilities = facilityEffects.get(owner.regionId) ?? emptyEffectProfile();
    const localSubstances = substanceEffects.get(owner.regionId);
    const productionFactor = 1 + localFacilities.construction * 0.45 + localFacilities.energy * 0.25 + (localSubstances?.materialYield ?? 0) * 0.35;
    const amount = rounded((0.45 + profile.construction * 2 + Math.log2(owner.memberIds.length + 1) * 0.1) * geologyFactor * productionFactor);
    delta.resourceTransactions.push({
      id: `resource:materials:production:${state.tick}:${owner.id}`,
      resourceId: "materials",
      regionId: owner.regionId,
      amount,
      operation: "mint",
      source: "culture",
      sourceId: owner.id,
      toHolderId: owner.id,
      causeRuleId: "society:material-production",
    });
    plannedBalances.set(owner.id, materialBalanceFor(owner.regionId, owner.id));
  }

  for (const owner of [...primaryOwners.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const profile = technology.get(owner.regionId);
    const localFacilities = facilityEffects.get(owner.regionId) ?? emptyEffectProfile();
    const energyOutput = rounded(localFacilities.energy * (0.3 + (profile?.energy ?? 0) * 1.4 + Math.log2(owner.memberIds.length + 1) * 0.08) * (1 + (substanceEffects.get(owner.regionId)?.energyEfficiency ?? 0) * 0.3));
    if (energyOutput <= 0) continue;
    delta.resourceTransactions.push({
      id: `resource:energy:production:${state.tick}:${owner.id}`,
      resourceId: "energy",
      regionId: owner.regionId,
      amount: energyOutput,
      operation: "mint",
      source: "culture",
      sourceId: owner.id,
      toHolderId: owner.id,
      causeRuleId: "society:facility-energy-production",
    });
  }

  const existingTypesByRegion = new Set(
    state.facilities
      .filter((facility) => facility.status !== "abandoned")
      .map((facility) => `${facility.regionId}:${facility.type}`),
  );
  for (const owner of [...primaryOwners.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const profile = technology.get(owner.regionId);
    if (!profile || profile.construction <= 0) continue;
    for (const type of domains) {
      if (profile[type] <= 0 || owner.memberIds.length < workforceRequired[type]) continue;
      const regionType = `${owner.regionId}:${type}`;
      if (existingTypesByRegion.has(regionType)) continue;
      const assignment = workforceAssignments.get(facilityIdFor(owner.regionId, type, owner.id));
      if (!assignment || assignment.ids.length < assignment.required) continue;
      const facility: FacilityState = {
        id: facilityIdFor(owner.regionId, type, owner.id),
        type,
        regionId: owner.regionId,
        ownerOrganizationId: owner.id,
        level: 1,
        condition: 0,
        status: "planned",
        workforceIds: assignment.ids,
        workforceRequired: assignment.required,
        workforceEfficiency: assignment.efficiency,
        materialInvested: 0,
        plannedTick: state.tick,
        builtTick: -1,
        lastMaintainedTick: state.tick,
        lastIncidentTick: state.tick,
        lastInspectedEventTick: state.tick,
      };
      delta.entityEffects.push({ collection: "facilities", operation: "create", id: facility.id, value: facility });
      lifecycleEvent(delta, facility, "facility-planned", "society:facility-planning", { technologyLevel: profile[type], workforce: facility.workforceIds.length });
      existingTypesByRegion.add(regionType);
    }
  }

  for (const current of [...state.facilities].sort((left, right) => left.id.localeCompare(right.id))) {
    if (current.status === "abandoned") {
      const abandonedTick = current.abandonedTick ?? current.lastIncidentTick;
      if (state.tick - abandonedTick >= ABANDONED_FACILITY_RETENTION_TICKS) {
        delta.entityEffects.push({ collection: "facilities", operation: "remove", id: current.id });
        lifecycleEvent(delta, current, "facility-retired", "society:facility-history-archive", { abandonedTick });
      }
      continue;
    }
    const owner = ownersById.get(current.ownerOrganizationId);
    let facility = structuredClone(current);
    if (!owner) {
      facility.status = "abandoned";
      facility.abandonedTick = state.tick;
      facility.workforceIds = [];
      lifecycleEvent(delta, facility, "facility-abandoned", "society:facility-abandonment", { reason: "owner-unavailable", condition: facility.condition });
      delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
      continue;
    }
    const previousWorkforce = new Set(facility.workforceIds);
    const assignment = workforceAssignments.get(facility.id) ?? { ids: [], efficiency: 0, required: workforceRequired[facility.type] };
    facility.workforceIds = assignment.ids;
    facility.workforceRequired = assignment.required;
    facility.workforceEfficiency = assignment.efficiency;
    const availableWorkforce = facility.workforceIds.length;
    const requiredWorkforce = assignment.required;
    const workforceChanged = facility.workforceIds.length !== previousWorkforce.size || facility.workforceIds.some((id) => !previousWorkforce.has(id));
    if (workforceChanged) {
      lifecycleEvent(delta, facility, "facility-workforce-changed", "society:facility-workforce", {
        previousWorkforce: previousWorkforce.size,
        workforce: availableWorkforce,
        workforceRequired: requiredWorkforce,
        workforceEfficiency: rounded(facility.workforceEfficiency),
      });
    }
    let available = plannedBalances.get(owner.id) ?? materialBalanceFor(owner.regionId, owner.id);
    plannedBalances.set(owner.id, available);

    if (facility.status === "planned") {
      const cost = constructionCost[facility.type];
      if (availableWorkforce >= requiredWorkforce && available >= cost) {
        consumeMaterials(delta, state, facility, cost, "construction");
        available -= cost;
        plannedBalances.set(owner.id, available);
        facility = {
          ...facility,
          condition: 1,
          status: "active",
          materialInvested: rounded(cost),
          builtTick: state.tick,
          lastMaintainedTick: state.tick,
        };
        lifecycleEvent(delta, facility, "facility-constructed", "society:facility-construction", { materialCost: cost, workforce: availableWorkforce });
      }
      delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
      continue;
    }

    facility.condition = clamp(facility.condition - (availableWorkforce < requiredWorkforce ? 0.018 : 0.006));
    const incident = incidentSeverity(facility, incidentEvents);
    facility.lastInspectedEventTick = Math.max(state.tick, incident.lastTick);
    let damagedThisStep = false;
    if (incident.lastTick > facility.lastIncidentTick) {
      facility.lastIncidentTick = incident.lastTick;
      const probability = clamp(0.28 + incident.severity * 0.8);
      const [roll] = randomFloat(forkRandom(state.random, `facility-incident:${facility.id}:${incident.lastTick}`));
      if (roll < probability) {
        const resistance = 0.08 * (facility.level - 1)
          + (technology.get(facility.regionId)?.construction ?? 0) * 0.12
          + (substanceEffects.get(facility.regionId)?.structuralStrength ?? 0) * 0.12;
        const damage = Math.max(0.04, incident.severity * (1 - resistance));
        facility.condition = clamp(facility.condition - damage);
        facility.status = "damaged";
        damagedThisStep = true;
        lifecycleEvent(delta, facility, "facility-damaged", "society:facility-incident", {
          incidentKinds: incident.kinds.join(","), probability, roll, damage: rounded(damage), condition: rounded(facility.condition),
        });
      }
    }

    if (facility.condition <= 0.08) {
      facility.status = "abandoned";
      facility.abandonedTick = state.tick;
      facility.workforceIds = [];
      lifecycleEvent(delta, facility, "facility-abandoned", "society:facility-abandonment", { reason: "structural-failure", condition: rounded(facility.condition) });
      delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
      continue;
    }

    if (!damagedThisStep && facility.condition < 0.86 && availableWorkforce >= requiredWorkforce) {
      const maintenanceCost = rounded(0.18 + facility.level * 0.12);
      if (available >= maintenanceCost) {
        consumeMaterials(delta, state, facility, maintenanceCost, "maintenance");
        available -= maintenanceCost;
        plannedBalances.set(owner.id, available);
        const previousCondition = facility.condition;
        facility.condition = clamp(facility.condition + 0.22 + (technology.get(facility.regionId)?.construction ?? 0) * 0.08);
        facility.status = facility.condition >= 0.62 ? "active" : "damaged";
        facility.lastMaintainedTick = state.tick;
        facility.materialInvested = rounded(facility.materialInvested + maintenanceCost);
        lifecycleEvent(delta, facility, "facility-maintained", "society:facility-maintenance", { materialCost: maintenanceCost, restored: rounded(facility.condition - previousCondition), condition: rounded(facility.condition) });
      } else {
        facility.status = "damaged";
      }
    } else if (facility.condition < 0.62 || availableWorkforce < requiredWorkforce) {
      facility.status = "damaged";
    } else {
      facility.status = "active";
    }

    const profile = technology.get(facility.regionId);
    const nextLevel = facility.level < 3 ? facility.level + 1 as 2 | 3 : undefined;
    const requiredTechnology = nextLevel === 2 ? 0.5 : nextLevel === 3 ? 5 / 6 : 1;
    const upgradeCost = nextLevel ? rounded(constructionCost[facility.type] * nextLevel * 0.8) : 0;
    if (nextLevel && profile && profile[facility.type] >= requiredTechnology && facility.condition >= 0.78 && available >= upgradeCost) {
      consumeMaterials(delta, state, facility, upgradeCost, "upgrade");
      available -= upgradeCost;
      plannedBalances.set(owner.id, available);
      facility.level = nextLevel;
      facility.condition = clamp(facility.condition + 0.08);
      facility.materialInvested = rounded(facility.materialInvested + upgradeCost);
      facility.lastMaintainedTick = state.tick;
      lifecycleEvent(delta, facility, "facility-upgraded", "society:facility-upgrade", { materialCost: upgradeCost, technologyLevel: profile[facility.type], condition: rounded(facility.condition) });
    }
    delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
  }
  return delta;
};
