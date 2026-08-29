import { forkRandom, hashString, randomFloat } from "../random.ts";
import type { AgentHealthState, AgentState, EntityEffect, EntityId, PathogenKind, PathogenRegionalOutbreakState, PathogenState, RegionHealthSummary, RegionId, WorldEvent, WorldEventDraft, WorldState } from "../types.ts";
import { technologyProfilesForState } from "../culture/technology.ts";
import { facilityEffectProfilesForState } from "../society/facilities.ts";
import { addPersistentTotal } from "../numeric.ts";
import { eventsForTimelineStep } from "../events/index.ts";
import { compareSimulationSteps, nextSimulationStep, nextSimulationTick, projectedYearsAfterStep, simulationStepForWorld } from "../time.ts";

export const MAX_PATHOGENS = 128;
export const MAX_INFECTIONS_PER_AGENT = 4;
export const MAX_IMMUNITY_IDS_PER_AGENT = 24;
export const MAX_PATHOGEN_EMERGENCES_PER_STEP = 2;
export const MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN = 32;

const pathogenKinds: PathogenKind[] = ["virus-like", "bacterial-colony", "fungal-spore", "parasitic-cell"];
const namePrefixes = ["雾", "晶", "潮", "灰", "脉", "荧", "岚", "壳"];
const nameStems = ["环", "丝", "斑", "热", "息", "蚀", "眠", "震"];
const nameSuffixes = ["症", "疫", "病", "群"];
const statusRank: Record<PathogenState["status"], number> = { outbreak: 3, endemic: 2, dormant: 1 };

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const annualProbability = (rate: number, years: number): number => 1 - Math.pow(1 - clamp(rate), Math.max(0, years));
const statusForPrevalence = (prevalence: number): PathogenState["status"] => prevalence >= 0.2 ? "outbreak" : prevalence > 0.001 ? "endemic" : "dormant";
const compareInfectionsForRetention = (left: AgentHealthState["infections"][number], right: AgentHealthState["infections"][number]): number =>
  compareSimulationSteps(right.infectedTimelineStep ?? String(right.infectedTick), left.infectedTimelineStep ?? String(left.infectedTick))
  || left.pathogenId.localeCompare(right.pathogenId);

const compareRegionalOutbreaks = (left: PathogenRegionalOutbreakState, right: PathogenRegionalOutbreakState): number =>
  statusRank[right.status] - statusRank[left.status]
  || right.lastActiveTick - left.lastActiveTick
  || compareSimulationSteps(right.lastActiveTimelineStep ?? String(right.lastActiveTick), left.lastActiveTimelineStep ?? String(left.lastActiveTick))
  || right.prevalence - left.prevalence
  || left.regionId.localeCompare(right.regionId);

const validRegionalOutbreak = (outbreak: PathogenRegionalOutbreakState): boolean =>
  typeof outbreak?.regionId === "string"
  && /^region:\d+:\d+$/.test(outbreak.regionId)
  && statusRank[outbreak.status] !== undefined
  && Number.isFinite(outbreak.prevalence)
  && outbreak.prevalence >= 0
  && outbreak.prevalence <= 1
  && Number.isSafeInteger(outbreak.firstDetectedTick)
  && outbreak.firstDetectedTick >= 0
  && (outbreak.firstDetectedTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(outbreak.firstDetectedTimelineStep))
  && Number.isSafeInteger(outbreak.lastActiveTick)
  && outbreak.lastActiveTick >= 0
  && (outbreak.lastActiveTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(outbreak.lastActiveTimelineStep));

export const isCanonicalPathogenState = (pathogen: PathogenState): boolean => {
  if (!Array.isArray(pathogen.regionalOutbreaks)
    || pathogen.regionalOutbreaks.length === 0
    || pathogen.regionalOutbreaks.length > MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN
    || !Number.isFinite(pathogen.prevalence)
    || pathogen.prevalence < 0
    || pathogen.prevalence > 1
    || !Number.isSafeInteger(pathogen.lastActiveTick)
    || pathogen.lastActiveTick < 0) return false;
  let previousRegionId = "";
  let hasOrigin = false;
  let maximumPrevalence = 0;
  let latestRegionalStep = "0";
  let hasActive = false;
  let hasOutbreak = false;
  for (const outbreak of pathogen.regionalOutbreaks) {
    if (!validRegionalOutbreak(outbreak)
      || outbreak.status !== statusForPrevalence(outbreak.prevalence)
      || (previousRegionId && previousRegionId >= outbreak.regionId)) return false;
    previousRegionId = outbreak.regionId;
    hasOrigin ||= outbreak.regionId === pathogen.regionId;
    maximumPrevalence = Math.max(maximumPrevalence, outbreak.prevalence);
    if (compareSimulationSteps(outbreak.lastActiveTimelineStep ?? String(outbreak.lastActiveTick), latestRegionalStep) > 0) latestRegionalStep = outbreak.lastActiveTimelineStep ?? String(outbreak.lastActiveTick);
    hasActive ||= outbreak.status !== "dormant";
    hasOutbreak ||= outbreak.status === "outbreak";
  }
  const status = hasOutbreak ? "outbreak" : hasActive ? "endemic" : "dormant";
  return hasOrigin
    && pathogen.prevalence === maximumPrevalence
    && pathogen.status === status
    && compareSimulationSteps(pathogen.lastActiveTimelineStep ?? String(pathogen.lastActiveTick), latestRegionalStep) >= 0;
};

const normalizedRegionalOutbreaks = (pathogen: PathogenState): PathogenRegionalOutbreakState[] => {
  const supplied = Array.isArray(pathogen.regionalOutbreaks)
    ? pathogen.regionalOutbreaks.filter(validRegionalOutbreak)
    : [];
  const originIndex = supplied.findIndex((outbreak) => outbreak.regionId === pathogen.regionId);
  if (originIndex < 0) {
    supplied.push({
      regionId: pathogen.regionId,
      status: pathogen.status,
      prevalence: clamp(pathogen.prevalence),
      firstDetectedTick: pathogen.originTick,
      ...(pathogen.originTimelineStep === undefined ? {} : { firstDetectedTimelineStep: pathogen.originTimelineStep }),
      lastActiveTick: pathogen.lastActiveTick,
      ...(pathogen.lastActiveTimelineStep === undefined ? {} : { lastActiveTimelineStep: pathogen.lastActiveTimelineStep }),
    });
  } else if (supplied.length === 1 && pathogen.prevalence > supplied[originIndex]!.prevalence) {
    supplied[originIndex] = {
      ...supplied[originIndex]!,
      prevalence: clamp(pathogen.prevalence),
      status: pathogen.status,
      lastActiveTick: Math.max(supplied[originIndex]!.lastActiveTick, pathogen.lastActiveTick),
      ...(pathogen.lastActiveTimelineStep === undefined ? {} : { lastActiveTimelineStep: pathogen.lastActiveTimelineStep }),
    };
  }
  const byRegion = new Map<RegionId, PathogenRegionalOutbreakState>();
  for (const outbreak of supplied) {
    const normalized = { ...outbreak, prevalence: clamp(outbreak.prevalence), status: statusForPrevalence(outbreak.prevalence) };
    const current = byRegion.get(normalized.regionId);
    if (!current || compareRegionalOutbreaks(normalized, current) < 0) byRegion.set(normalized.regionId, normalized);
  }
  const origin = byRegion.get(pathogen.regionId);
  const retained = [...byRegion.values()].filter((outbreak) => outbreak.regionId !== pathogen.regionId).sort(compareRegionalOutbreaks).slice(0, MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN - 1);
  return [...(origin ? [origin] : []), ...retained].sort((left, right) => left.regionId.localeCompare(right.regionId));
};

const summarizePathogen = (pathogen: PathogenState, regionalOutbreaks: PathogenRegionalOutbreakState[]): PathogenState => {
  const active = regionalOutbreaks.filter((outbreak) => outbreak.status !== "dormant");
  const prevalence = regionalOutbreaks.reduce((maximum, outbreak) => Math.max(maximum, outbreak.prevalence), 0);
  const status: PathogenState["status"] = active.some((outbreak) => outbreak.status === "outbreak") ? "outbreak" : active.length > 0 ? "endemic" : "dormant";
  let lastActiveTick = pathogen.lastActiveTick;
  let lastActiveTimelineStep = pathogen.lastActiveTimelineStep;
  for (const outbreak of regionalOutbreaks) {
    const currentStep = lastActiveTimelineStep ?? String(lastActiveTick);
    const outbreakStep = outbreak.lastActiveTimelineStep ?? String(outbreak.lastActiveTick);
    if (compareSimulationSteps(outbreakStep, currentStep) > 0) {
      lastActiveTick = outbreak.lastActiveTick;
      lastActiveTimelineStep = outbreak.lastActiveTimelineStep;
    }
  }
  const result = { ...pathogen, regionalOutbreaks, prevalence, status, lastActiveTick: Math.max(pathogen.lastActiveTick, lastActiveTick) };
  if (lastActiveTimelineStep === undefined) delete result.lastActiveTimelineStep;
  else result.lastActiveTimelineStep = lastActiveTimelineStep;
  return result;
};

export const normalizePathogenState = (pathogen: PathogenState): PathogenState => summarizePathogen(pathogen, normalizedRegionalOutbreaks(pathogen));

export const pathogenOutbreakForRegion = (pathogen: PathogenState, regionId: string): PathogenRegionalOutbreakState | undefined => {
  const outbreak = pathogen.regionalOutbreaks?.find((candidate) => candidate.regionId === regionId);
  if (outbreak) return outbreak;
  return pathogen.regionId === regionId
    ? { regionId: pathogen.regionId, status: pathogen.status, prevalence: pathogen.prevalence, firstDetectedTick: pathogen.originTick, ...(pathogen.originTimelineStep === undefined ? {} : { firstDetectedTimelineStep: pathogen.originTimelineStep }), lastActiveTick: pathogen.lastActiveTick, ...(pathogen.lastActiveTimelineStep === undefined ? {} : { lastActiveTimelineStep: pathogen.lastActiveTimelineStep }) }
    : undefined;
};

export const pathogenPrevalenceForRegion = (pathogen: PathogenState, regionId: string): number => pathogenOutbreakForRegion(pathogen, regionId)?.prevalence ?? 0;

export const healthyAgentState = (): AgentHealthState => ({ vitality: 1, infections: [], immunityIds: [] });

export const normalizeAgentHealth = (agent: AgentState, validPathogenIds?: ReadonlySet<string>): AgentHealthState => {
  const health = agent.health;
  const infections = (health?.infections ?? [])
    .filter((infection) => typeof infection.pathogenId === "string"
      && (!validPathogenIds || validPathogenIds.has(infection.pathogenId))
      && Number.isFinite(infection.infectedTick)
      && (infection.infectedTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(infection.infectedTimelineStep))
      && Number.isFinite(infection.severity))
    .sort(compareInfectionsForRetention)
    .filter((infection, index, values) => values.findIndex((candidate) => candidate.pathogenId === infection.pathogenId) === index)
    .slice(0, MAX_INFECTIONS_PER_AGENT)
    .map((infection) => ({ ...infection, severity: clamp(infection.severity) }));
  const immunityIds = [...new Set((health?.immunityIds ?? [])
    .filter((id) => typeof id === "string" && (!validPathogenIds || validPathogenIds.has(id))))]
    .sort()
    .slice(-MAX_IMMUNITY_IDS_PER_AGENT);
  return {
    vitality: clamp(Number.isFinite(health?.vitality) ? health!.vitality : 1),
    infections,
    immunityIds,
  };
};

const comparePathogensForRetention = (left: PathogenState, right: PathogenState): number =>
  statusRank[right.status] - statusRank[left.status]
  || right.lastActiveTick - left.lastActiveTick
  || compareSimulationSteps(right.lastActiveTimelineStep ?? String(right.lastActiveTick), left.lastActiveTimelineStep ?? String(left.lastActiveTick))
  || right.prevalence - left.prevalence
  || left.id.localeCompare(right.id);

const healthReferencesAreValid = (agent: AgentState, pathogenIds: ReadonlySet<string>): boolean => Boolean(agent.health)
  && Number.isFinite(agent.health!.vitality)
  && agent.health!.vitality >= 0
  && agent.health!.vitality <= 1
  && agent.health!.infections.length <= MAX_INFECTIONS_PER_AGENT
  && agent.health!.immunityIds.length <= MAX_IMMUNITY_IDS_PER_AGENT
  && new Set(agent.health!.infections.map((infection) => infection.pathogenId)).size === agent.health!.infections.length
  && agent.health!.infections.every((infection) => pathogenIds.has(infection.pathogenId) && Number.isFinite(infection.infectedTick) && Number.isFinite(infection.severity) && infection.severity >= 0 && infection.severity <= 1)
  && new Set(agent.health!.immunityIds).size === agent.health!.immunityIds.length
  && agent.health!.immunityIds.every((id) => pathogenIds.has(id));

export const compactPathogenRecords = (state: WorldState): number => {
  const previousCount = state.pathogens.length;
  const speciesIds = new Set(state.species.map((species) => species.id));
  const currentIds = new Set(state.pathogens.map((pathogen) => pathogen.id));
  if (state.pathogens.length <= MAX_PATHOGENS
    && currentIds.size === state.pathogens.length
    && state.pathogens.every((pathogen) => speciesIds.has(pathogen.hostSpeciesId))
    && state.pathogens.every(isCanonicalPathogenState)
    && state.agents.every((agent) => healthReferencesAreValid(agent, currentIds))) return 0;
  const byId = new Map<string, PathogenState>();
  for (const pathogen of state.pathogens) {
    if (!speciesIds.has(pathogen.hostSpeciesId)) continue;
    const normalized = normalizePathogenState(pathogen);
    const current = byId.get(pathogen.id);
    if (!current || comparePathogensForRetention(normalized, current) < 0) byId.set(pathogen.id, normalized);
  }
  state.pathogens = [...byId.values()].sort(comparePathogensForRetention).slice(0, MAX_PATHOGENS);
  const retainedIds = new Set(state.pathogens.map((pathogen) => pathogen.id));
  for (const agent of state.agents) agent.health = normalizeAgentHealth(agent, retainedIds);
  return previousCount - state.pathogens.length;
};

const cellIndexForRegion = (state: WorldState, regionId: string): number => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  if (!match) return 0;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Math.max(0, Math.min(state.fields.elevation.values.length - 1, y * state.fields.elevation.width + x));
};

const environmentPressure = (state: WorldState, regionId: string): number => {
  const index = cellIndexForRegion(state, regionId);
  return clamp(
    (state.fields.humidity.values[index] ?? 0) * 0.28
    + (state.fields.water.values[index] ?? 0) * 0.18
    + (state.chemistry.organics.values[index] ?? 0) * 0.34
    + (state.fields.temperature.values[index] ?? 0) * 0.2,
  );
};

const pathogenName = (signature: number): string => `${namePrefixes[signature % namePrefixes.length]}${nameStems[Math.floor(signature / 7) % nameStems.length]}${nameSuffixes[Math.floor(signature / 31) % nameSuffixes.length]}`;

export const derivePathogen = (
  state: WorldState,
  regionId: PathogenState["regionId"],
  hostSpeciesId: EntityId,
): PathogenState => {
  const signature = hashString(`${state.seed}:${regionId}:${hostSpeciesId}:${simulationStepForWorld(state)}:pathogen`);
  const trait = (label: string): number => (hashString(`${signature}:${label}`) % 10_000) / 10_000;
  return {
    id: `pathogen:${hashString(`${regionId}:${hostSpeciesId}:${simulationStepForWorld(state)}:${signature}`).toString(16)}`,
    name: pathogenName(signature),
    kind: pathogenKinds[signature % pathogenKinds.length]!,
    status: "dormant",
    regionId,
    hostSpeciesId,
    originTick: nextSimulationTick(state),
    originTimelineStep: nextSimulationStep(state),
    originYears: projectedYearsAfterStep(state, 1),
    transmission: clamp(0.18 + trait("transmission") * 0.62),
    severity: clamp(0.06 + trait("severity") * 0.5),
    persistence: clamp(0.12 + trait("persistence") * 0.76),
    prevalence: 0,
    regionalOutbreaks: [{
      regionId,
      status: "dormant",
      prevalence: 0,
      firstDetectedTick: nextSimulationTick(state),
      firstDetectedTimelineStep: nextSimulationStep(state),
      lastActiveTick: nextSimulationTick(state),
      lastActiveTimelineStep: nextSimulationStep(state),
    }],
    cumulativeCases: 0,
    cumulativeRecoveries: 0,
    cumulativeDeaths: 0,
    lastActiveTick: nextSimulationTick(state),
    lastActiveTimelineStep: nextSimulationStep(state),
    noveltySignature: signature.toString(16).padStart(8, "0"),
  };
};

type AgentHealthStep = {
  pathogens: Map<string, PathogenState>;
  mortalityRiskByAgent: Map<EntityId, number>;
  caseIncrements: Map<string, number>;
  recoveryIncrements: Map<string, number>;
  aggregateOutbreakKeys: Set<string>;
  events: WorldEventDraft[];
};

const hostSpeciesForAgent = (
  agent: AgentState,
  populationSpecies: ReadonlyMap<string, EntityId>,
): EntityId | undefined => populationSpecies.get(agent.populationId);

const outbreakKey = (pathogenId: string, regionId: string): string => `${pathogenId}|${regionId}`;

const upsertRegionalOutbreak = (
  pathogen: PathogenState,
  regionId: RegionId,
  prevalence: number,
  tick: number,
  timelineStep?: string,
): PathogenRegionalOutbreakState | undefined => {
  const existing = pathogen.regionalOutbreaks.find((outbreak) => outbreak.regionId === regionId);
  if (existing) {
    existing.prevalence = clamp(Math.max(existing.prevalence, prevalence));
    existing.status = statusForPrevalence(existing.prevalence);
    if (existing.prevalence > 0) {
      existing.lastActiveTick = tick;
      if (timelineStep !== undefined) existing.lastActiveTimelineStep = timelineStep;
    }
    return existing;
  }
  if (pathogen.regionalOutbreaks.length >= MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN) {
    const removable = pathogen.regionalOutbreaks
      .filter((outbreak) => outbreak.regionId !== pathogen.regionId && outbreak.status === "dormant")
      .sort((left, right) => compareSimulationSteps(
        left.lastActiveTimelineStep ?? String(left.lastActiveTick),
        right.lastActiveTimelineStep ?? String(right.lastActiveTick),
      ) || left.regionId.localeCompare(right.regionId))[0];
    if (!removable) return undefined;
    pathogen.regionalOutbreaks = pathogen.regionalOutbreaks.filter((outbreak) => outbreak !== removable);
  }
  const outbreak: PathogenRegionalOutbreakState = {
    regionId,
    status: statusForPrevalence(prevalence),
    prevalence: clamp(prevalence),
    firstDetectedTick: tick,
    ...(timelineStep === undefined ? {} : { firstDetectedTimelineStep: timelineStep }),
    lastActiveTick: tick,
    ...(timelineStep === undefined ? {} : { lastActiveTimelineStep: timelineStep }),
  };
  pathogen.regionalOutbreaks.push(outbreak);
  pathogen.regionalOutbreaks.sort((left, right) => left.regionId.localeCompare(right.regionId));
  return outbreak;
};

type RegionalContact = { fromRegion: RegionId; toRegion: RegionId; kind: WorldEvent["kind"]; intensity: number; eventId: string };
const contactEventKinds = new Set(["interregional-trade", "population-migration", "population-dispersal", "war-displacement"]);
const asRegionId = (value: unknown): RegionId | undefined => typeof value === "string" && /^region:\d+:\d+$/.test(value) ? value as RegionId : undefined;

const regionalContactsForCurrentTick = (state: WorldState): RegionalContact[] => {
  const contacts = new Map<string, RegionalContact>();
  const currentStep = simulationStepForWorld(state);
  for (const event of eventsForTimelineStep(state.events, currentStep)) {
    if (!contactEventKinds.has(event.kind)) continue;
    const fromRegion = asRegionId(event.payload.fromRegion ?? event.evidence.fromRegion);
    const toRegion = asRegionId(event.payload.toRegion ?? event.evidence.toRegion);
    if (!fromRegion || !toRegion || fromRegion === toRegion) continue;
    const amount = Number(event.payload.amount ?? event.evidence.amount ?? event.evidence.displaced ?? event.evidence.branchCount ?? 1);
    const base = event.kind === "interregional-trade" ? 0.42 : event.kind === "war-displacement" ? 0.82 : 0.68;
    const intensity = clamp(base * (0.7 + Math.min(1, Math.log1p(Math.max(0, Number.isFinite(amount) ? amount : 1)) / 4) * 0.3));
    const key = `${fromRegion}|${toRegion}|${event.kind}`;
    const current = contacts.get(key);
    if (!current || current.intensity < intensity) contacts.set(key, { fromRegion, toRegion, kind: event.kind, intensity, eventId: event.id });
  }
  return [...contacts.values()].sort((left, right) => left.fromRegion.localeCompare(right.fromRegion) || left.toRegion.localeCompare(right.toRegion) || left.kind.localeCompare(right.kind));
};

export const stepAgentHealth = (
  state: WorldState,
  agents: Map<EntityId, AgentState>,
  elapsedYears: number,
): AgentHealthStep => {
  const years = Math.max(0, elapsedYears);
  const retainedPathogens = state.pathogens.map((pathogen) => isCanonicalPathogenState(pathogen)
    ? { ...pathogen, regionalOutbreaks: pathogen.regionalOutbreaks.map((outbreak) => ({ ...outbreak })) }
    : normalizePathogenState(pathogen)).sort(comparePathogensForRetention).slice(0, MAX_PATHOGENS);
  const validPathogenIds = new Set(retainedPathogens.map((pathogen) => pathogen.id));
  for (const agent of agents.values()) {
    if (!healthReferencesAreValid(agent, validPathogenIds)) agent.health = normalizeAgentHealth(agent, validPathogenIds);
  }

  const pathogens = new Map(retainedPathogens.map((pathogen) => [pathogen.id, pathogen]));
  const populationSpecies = new Map<string, EntityId>();
  const ecologicalHostsByRegionSpecies = new Map<string, number>();
  for (const population of state.populations) {
    populationSpecies.set(String(population.id), population.speciesId);
    const key = `${population.regionId}|${population.speciesId}`;
    ecologicalHostsByRegionSpecies.set(key, (ecologicalHostsByRegionSpecies.get(key) ?? 0) + Math.max(0, population.count));
  }
  const agentsByRegionSpecies = new Map<string, AgentState[]>();
  for (const agent of agents.values()) {
    const speciesId = hostSpeciesForAgent(agent, populationSpecies);
    if (!speciesId) continue;
    const key = `${agent.regionId}|${speciesId}`;
    const members = agentsByRegionSpecies.get(key) ?? [];
    members.push(agent);
    agentsByRegionSpecies.set(key, members);
  }
  for (const members of agentsByRegionSpecies.values()) members.sort((left, right) => left.id.localeCompare(right.id));

  const events: WorldEventDraft[] = [];
  const caseIncrements = new Map<string, number>();
  let created = 0;
  const activePathogenCount = retainedPathogens.filter((pathogen) => pathogen.status !== "dormant").length;
  const emergenceLimit = Math.min(MAX_PATHOGEN_EMERGENCES_PER_STEP, Math.max(0, MAX_PATHOGENS - activePathogenCount));
  for (const [key, members] of [...agentsByRegionSpecies.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (created >= emergenceLimit) break;
    if (members.length < 4) continue;
    const separator = key.lastIndexOf("|");
    const regionId = key.slice(0, separator) as PathogenState["regionId"];
    const hostSpeciesId = key.slice(separator + 1) as EntityId;
    if ([...pathogens.values()].some((pathogen) => pathogen.regionId === regionId && pathogen.hostSpeciesId === hostSpeciesId && pathogen.status !== "dormant")) continue;
    const pressure = clamp(environmentPressure(state, regionId) * 0.72 + Math.min(1, members.length / 18) * 0.28);
    const probability = annualProbability(clamp((pressure - 0.3) * 0.045, 0, 0.06), years);
    const [roll] = randomFloat(forkRandom(state.random, `pathogen-emergence:${key}:${simulationStepForWorld(state)}`));
    if (roll >= probability) continue;
    const pathogen = derivePathogen(state, regionId, hostSpeciesId);
    pathogens.set(pathogen.id, pathogen);
    validPathogenIds.add(pathogen.id);
    const patient = [...members].sort((left, right) => left.id.localeCompare(right.id))[hashString(`${pathogen.id}:patient-zero`) % members.length]!;
    patient.health = normalizeAgentHealth(patient, validPathogenIds);
    patient.health.infections.push({ pathogenId: pathogen.id, infectedTick: nextSimulationTick(state), infectedTimelineStep: nextSimulationStep(state), severity: pathogen.severity });
    caseIncrements.set(pathogen.id, 1);
    created += 1;
    events.push({
      kind: "pathogen-emergence",
      ruleId: "health:environmental-pathogen-emergence",
      sourceIds: [pathogen.id, patient.id, hostSpeciesId],
      probability,
      roll,
      evidence: { regionId, pressure, transmission: pathogen.transmission, severity: pathogen.severity, persistence: pathogen.persistence, name: pathogen.name },
      payload: { pathogenId: pathogen.id, regionId, hostSpeciesId, patientZeroId: patient.id, name: pathogen.name, kind: pathogen.kind },
      source: "natural",
    });
  }

  const infectedByPathogen = new Map<string, Set<EntityId>>();
  const infectedByPathogenRegion = new Map<string, Set<EntityId>>();
  for (const agent of agents.values()) {
    for (const infection of agent.health?.infections ?? []) {
      const infected = infectedByPathogen.get(infection.pathogenId) ?? new Set<EntityId>();
      infected.add(agent.id);
      infectedByPathogen.set(infection.pathogenId, infected);
      const regionalKey = outbreakKey(infection.pathogenId, agent.regionId);
      const regional = infectedByPathogenRegion.get(regionalKey) ?? new Set<EntityId>();
      regional.add(agent.id);
      infectedByPathogenRegion.set(regionalKey, regional);
    }
  }
  const outbreakByPathogenRegion = new Map<string, PathogenRegionalOutbreakState>();
  for (const pathogen of pathogens.values()) {
    for (const outbreak of pathogen.regionalOutbreaks) {
      outbreakByPathogenRegion.set(outbreakKey(pathogen.id, outbreak.regionId), outbreak);
    }
  }
  const outbreakForRegion = (pathogen: PathogenState, regionId: RegionId): PathogenRegionalOutbreakState | undefined =>
    outbreakByPathogenRegion.get(outbreakKey(pathogen.id, regionId));
  const upsertOutbreak = (
    pathogen: PathogenState,
    regionId: RegionId,
    prevalence: number,
  ): PathogenRegionalOutbreakState | undefined => {
    const outbreak = upsertRegionalOutbreak(pathogen, regionId, prevalence, nextSimulationTick(state), nextSimulationStep(state));
    if (outbreak) {
      for (const [key, candidate] of outbreakByPathogenRegion) {
        if (key.startsWith(`${pathogen.id}|`) && !pathogen.regionalOutbreaks.includes(candidate)) outbreakByPathogenRegion.delete(key);
      }
      outbreakByPathogenRegion.set(outbreakKey(pathogen.id, regionId), outbreak);
    }
    return outbreak;
  };
  for (const [key, infectedIds] of infectedByPathogenRegion) {
    const separator = key.indexOf("|");
    const pathogen = pathogens.get(key.slice(0, separator));
    const regionId = key.slice(separator + 1) as RegionId;
    const existingOutbreak = pathogen ? outbreakForRegion(pathogen, regionId) : undefined;
    if (!pathogen || (existingOutbreak && existingOutbreak.prevalence > 0)) continue;
    const localHosts = agentsByRegionSpecies.get(`${regionId}|${pathogen.hostSpeciesId}`)?.length
      ?? ecologicalHostsByRegionSpecies.get(`${regionId}|${pathogen.hostSpeciesId}`)
      ?? 0;
    const source = [...pathogen.regionalOutbreaks].filter((outbreak) => outbreak.status !== "dormant").sort(compareRegionalOutbreaks)[0];
    const outbreak = upsertOutbreak(pathogen, regionId, infectedIds.size / Math.max(1, localHosts));
    if (!outbreak) continue;
    events.push({
      kind: "disease-regional-spread",
      ruleId: "health:infected-carrier-spread",
      sourceIds: [pathogen.id, ...[...infectedIds].sort().slice(0, 4)],
      probability: 1,
      roll: 0,
      evidence: { fromRegion: source?.regionId ?? pathogen.regionId, toRegion: regionId, prevalence: outbreak.prevalence, route: "infected-carrier" },
      payload: { pathogenId: pathogen.id, fromRegion: source?.regionId ?? pathogen.regionId, toRegion: regionId, hostSpeciesId: pathogen.hostSpeciesId, route: "infected-carrier", name: pathogen.name },
      source: "natural",
    });
  }
  const contactsByAgent = new Map<EntityId, Set<EntityId>>();
  for (const relationship of state.relationships) {
    const from = contactsByAgent.get(relationship.fromId) ?? new Set<EntityId>();
    const to = contactsByAgent.get(relationship.toId) ?? new Set<EntityId>();
    from.add(relationship.toId);
    to.add(relationship.fromId);
    contactsByAgent.set(relationship.fromId, from);
    contactsByAgent.set(relationship.toId, to);
  }

  const facilityEffects = facilityEffectProfilesForState(state);
  const technologyProfiles = technologyProfilesForState(state);
  const medicineByRegion = new Map<string, number>();
  const medicineForRegion = (regionId: PathogenState["regionId"]): number => {
    const cached = medicineByRegion.get(regionId);
    if (cached !== undefined) return cached;
    const medicine = clamp((technologyProfiles.get(regionId)?.medicine ?? 0) * 0.55 + (facilityEffects.get(regionId)?.medicine ?? 0) * 0.45);
    medicineByRegion.set(regionId, medicine);
    return medicine;
  };
  const environmentByRegion = new Map<string, number>();
  const pressureForRegion = (regionId: PathogenState["regionId"]): number => {
    const cached = environmentByRegion.get(regionId);
    if (cached !== undefined) return cached;
    const pressure = environmentPressure(state, regionId);
    environmentByRegion.set(regionId, pressure);
    return pressure;
  };
  const regionalContacts = regionalContactsForCurrentTick(state);
  const orderedPathogens = [...pathogens.values()].sort((left, right) => left.id.localeCompare(right.id));
  const activePathogensByRegion = new Map<RegionId, PathogenState[]>();
  const activePathogenRegionKeys = new Set<string>();
  const addActivePathogen = (regionId: RegionId, pathogen: PathogenState): void => {
    const key = outbreakKey(pathogen.id, regionId);
    if (activePathogenRegionKeys.has(key)) return;
    const active = activePathogensByRegion.get(regionId) ?? [];
    let insertionIndex = active.length;
    while (insertionIndex > 0 && active[insertionIndex - 1]!.id.localeCompare(pathogen.id) > 0) insertionIndex -= 1;
    active.splice(insertionIndex, 0, pathogen);
    activePathogensByRegion.set(regionId, active);
    activePathogenRegionKeys.add(key);
  };
  for (const pathogen of orderedPathogens) {
    for (const outbreak of pathogen.regionalOutbreaks) {
      if (outbreak.status !== "dormant" && outbreak.prevalence > 0) addActivePathogen(outbreak.regionId, pathogen);
    }
  }
  for (const contact of regionalContacts) {
    for (const pathogen of activePathogensByRegion.get(contact.fromRegion) ?? []) {
      const sourceOutbreak = outbreakForRegion(pathogen, contact.fromRegion);
      if (!sourceOutbreak || sourceOutbreak.status === "dormant" || sourceOutbreak.prevalence <= 0) continue;
      const targetKey = `${contact.toRegion}|${pathogen.hostSpeciesId}`;
      const targetAgents = agentsByRegionSpecies.get(targetKey) ?? [];
      const aggregateHosts = ecologicalHostsByRegionSpecies.get(targetKey) ?? 0;
      if (targetAgents.length === 0 && aggregateHosts <= 0) continue;
      const medicine = medicineForRegion(contact.toRegion);
      const routeRate = pathogen.transmission * sourceOutbreak.prevalence * contact.intensity * 0.46 * (1 - medicine * 0.72);
      const probability = annualProbability(routeRate, years);
      let seeded = false;
      for (const agent of targetAgents) {
        if (agent.health?.infections.some((infection) => infection.pathogenId === pathogen.id) || agent.health?.immunityIds.includes(pathogen.id)) continue;
        const resistance = clamp(agent.traits.diseaseResistance ?? 0.5);
        const agentProbability = annualProbability(routeRate * (1 - resistance * 0.62), years);
        const [roll] = randomFloat(forkRandom(state.random, `disease-route:${contact.eventId}:${agent.id}:${pathogen.id}:${simulationStepForWorld(state)}`));
        if (roll >= agentProbability) continue;
        agent.health = normalizeAgentHealth(agent, validPathogenIds);
        if (agent.health.infections.length >= MAX_INFECTIONS_PER_AGENT) continue;
        agent.health.infections.push({ pathogenId: pathogen.id, infectedTick: nextSimulationTick(state), infectedTimelineStep: nextSimulationStep(state), severity: clamp(pathogen.severity * (1 - resistance * 0.38)) });
        const infected = infectedByPathogen.get(pathogen.id) ?? new Set<EntityId>();
        infected.add(agent.id);
        infectedByPathogen.set(pathogen.id, infected);
        const regionalKey = outbreakKey(pathogen.id, contact.toRegion);
        const regional = infectedByPathogenRegion.get(regionalKey) ?? new Set<EntityId>();
        regional.add(agent.id);
        infectedByPathogenRegion.set(regionalKey, regional);
        caseIncrements.set(pathogen.id, (caseIncrements.get(pathogen.id) ?? 0) + 1);
        seeded = true;
      }
      if (targetAgents.length === 0) {
        const [roll] = randomFloat(forkRandom(state.random, `disease-route:${contact.eventId}:${pathogen.id}:${simulationStepForWorld(state)}`));
        if (roll < probability) {
          const seededPrevalence = clamp(Math.max(0.002, sourceOutbreak.prevalence * contact.intensity * 0.12));
          const outbreak = upsertOutbreak(pathogen, contact.toRegion, seededPrevalence);
          if (outbreak) {
            caseIncrements.set(pathogen.id, (caseIncrements.get(pathogen.id) ?? 0) + seededPrevalence * aggregateHosts);
            addActivePathogen(contact.toRegion, pathogen);
            seeded = true;
          }
        }
      }
      if (seeded) {
        events.push({
          kind: "disease-regional-spread",
          ruleId: "health:interregional-contact-spread",
          sourceIds: [pathogen.id, contact.eventId],
          probability,
          roll: 0,
          evidence: { fromRegion: contact.fromRegion, toRegion: contact.toRegion, route: contact.kind, sourcePrevalence: sourceOutbreak.prevalence, intensity: contact.intensity },
          payload: { pathogenId: pathogen.id, fromRegion: contact.fromRegion, toRegion: contact.toRegion, hostSpeciesId: pathogen.hostSpeciesId, route: contact.kind, name: pathogen.name },
          source: "natural",
        });
      }
    }
  }
  const pathogensByRegionSpecies = new Map<string, PathogenState[]>();
  for (const pathogen of pathogens.values()) {
    for (const outbreak of pathogen.regionalOutbreaks) {
      if (outbreak.status === "dormant") continue;
      const key = `${outbreak.regionId}|${pathogen.hostSpeciesId}`;
      const local = pathogensByRegionSpecies.get(key) ?? [];
      local.push(pathogen);
      pathogensByRegionSpecies.set(key, local);
    }
  }
  const mortalityRiskByAgent = new Map<EntityId, number>();
  const recoveryIncrements = new Map<string, number>();
  const orderedAgents = [...agents.values()].sort((left, right) => left.id.localeCompare(right.id));
  for (const agent of orderedAgents) {
    const speciesId = hostSpeciesForAgent(agent, populationSpecies);
    if (!speciesId || !agent.health) continue;
    const medicine = medicineForRegion(agent.regionId);
    const resistance = clamp(agent.traits.diseaseResistance ?? 0.5);
    const immunity = new Set(agent.health.immunityIds);
    const retained = [] as AgentHealthState["infections"];
    for (const infection of agent.health.infections) {
      const pathogen = pathogens.get(infection.pathogenId);
      if (!pathogen) continue;
      const recoveryProbability = annualProbability(clamp(0.1 + medicine * 0.48 + resistance * 0.24 + (1 - pathogen.persistence) * 0.22), years);
      const [roll] = randomFloat(forkRandom(state.random, `disease-recovery:${agent.id}:${pathogen.id}:${simulationStepForWorld(state)}`));
      if (roll < recoveryProbability) {
        immunity.add(pathogen.id);
        recoveryIncrements.set(pathogen.id, (recoveryIncrements.get(pathogen.id) ?? 0) + 1);
      } else {
        retained.push({ ...infection, severity: clamp(infection.severity * (1 - medicine * 0.18) * (1 - resistance * 0.08)) });
      }
    }

    for (const pathogen of pathogensByRegionSpecies.get(`${agent.regionId}|${speciesId}`) ?? []) {
      if (retained.length >= MAX_INFECTIONS_PER_AGENT) break;
      if (pathogen.hostSpeciesId !== speciesId || outbreakForRegion(pathogen, agent.regionId)?.status === "dormant") continue;
      if (retained.some((infection) => infection.pathogenId === pathogen.id) || immunity.has(pathogen.id)) continue;
      const infected = infectedByPathogenRegion.get(outbreakKey(pathogen.id, agent.regionId));
      const localHosts = agentsByRegionSpecies.get(`${agent.regionId}|${speciesId}`)?.length ?? 1;
      const regional = outbreakForRegion(pathogen, agent.regionId);
      const prevalence = Math.max((infected?.size ?? 0) / Math.max(1, localHosts), regional?.prevalence ?? 0);
      let infectedContacts = 0;
      if (infected) {
        for (const id of contactsByAgent.get(agent.id) ?? []) {
          if (infected.has(id)) infectedContacts += 1;
        }
      }
      if (prevalence <= 0 && infectedContacts <= 0) continue;
      const contactPressure = Math.min(1, infectedContacts * 0.22 + prevalence * 0.5 + 0.02);
      const susceptibility = clamp((0.78 + (1 - (agent.traits.cooperation ?? 0.5)) * 0.16 + (1 - agent.health.vitality) * 0.22) * (1 - resistance * 0.62));
      const probability = annualProbability(pathogen.transmission * contactPressure * (0.65 + pressureForRegion(agent.regionId) * 0.35) * susceptibility * (1 - medicine * 0.72), years);
      const [roll] = randomFloat(forkRandom(state.random, `disease-exposure:${agent.id}:${pathogen.id}:${simulationStepForWorld(state)}`));
      if (roll >= probability) continue;
      retained.push({ pathogenId: pathogen.id, infectedTick: nextSimulationTick(state), infectedTimelineStep: nextSimulationStep(state), severity: clamp(pathogen.severity * (0.8 + roll * 0.35) * (1 - resistance * 0.38)) });
      caseIncrements.set(pathogen.id, (caseIncrements.get(pathogen.id) ?? 0) + 1);
    }

    const burden = retained.reduce((sum, infection) => sum + infection.severity, 0);
    agent.health = {
      vitality: clamp(agent.health.vitality + years * (retained.length === 0 ? 0.045 + medicine * 0.025 : -burden * 0.09 + medicine * 0.035)),
      infections: retained.sort(compareInfectionsForRetention),
      immunityIds: [...immunity].sort().slice(-MAX_IMMUNITY_IDS_PER_AGENT),
    };
    mortalityRiskByAgent.set(agent.id, clamp(burden * (1 - medicine * 0.68) * (1 - resistance * 0.42) * 0.045 + (1 - agent.health.vitality) * 0.018, 0, 0.72));
  }

  const aggregateOutbreakKeys = new Set<string>();
  for (const pathogen of pathogens.values()) {
    for (const regional of pathogen.regionalOutbreaks) {
      const detailedHosts = agentsByRegionSpecies.get(`${regional.regionId}|${pathogen.hostSpeciesId}`)?.length ?? 0;
      if (detailedHosts > 0) continue;
      const ecologicalHosts = ecologicalHostsByRegionSpecies.get(`${regional.regionId}|${pathogen.hostSpeciesId}`) ?? 0;
      aggregateOutbreakKeys.add(outbreakKey(pathogen.id, regional.regionId));
      if (ecologicalHosts <= 0) {
        regional.prevalence = 0;
        regional.status = "dormant";
        continue;
      }
      const medicine = medicineForRegion(regional.regionId);
      const before = clamp(regional.prevalence);
      const growth = pathogen.transmission * (0.35 + pressureForRegion(regional.regionId) * 0.45) * before * (1 - before);
      const recovery = (0.12 + medicine * 0.32 + (1 - pathogen.persistence) * 0.12) * before;
      const after = clamp(before + (growth - recovery) * Math.min(4, years) * 0.18);
      regional.prevalence = after;
      regional.status = statusForPrevalence(after);
      if (after > 0) {
        regional.lastActiveTick = nextSimulationTick(state);
        regional.lastActiveTimelineStep = nextSimulationStep(state);
      }
      caseIncrements.set(pathogen.id, (caseIncrements.get(pathogen.id) ?? 0) + Math.max(0, after - before) * ecologicalHosts);
      recoveryIncrements.set(pathogen.id, (recoveryIncrements.get(pathogen.id) ?? 0) + Math.max(0, before - after) * ecologicalHosts);
    }
    const summarized = summarizePathogen(pathogen, pathogen.regionalOutbreaks);
    pathogen.prevalence = summarized.prevalence;
    pathogen.status = summarized.status;
    pathogen.lastActiveTick = summarized.lastActiveTick;
  }

  return { pathogens, mortalityRiskByAgent, caseIncrements, recoveryIncrements, aggregateOutbreakKeys, events };
};

export const finalizeAgentHealth = (
  state: WorldState,
  step: AgentHealthStep,
  agents: ReadonlyMap<EntityId, AgentState>,
  deadIds: ReadonlySet<EntityId>,
): { effects: EntityEffect[]; events: WorldEventDraft[] } => {
  const effects: EntityEffect[] = [];
  const events: WorldEventDraft[] = [];
  const populationSpecies = new Map(state.populations.map((population) => [String(population.id), population.speciesId]));
  const previousById = new Map(state.pathogens.map((pathogen) => [pathogen.id, pathogen]));
  const hostsByRegionSpecies = new Map<string, AgentState[]>();
  for (const agent of agents.values()) {
    const speciesId = populationSpecies.get(agent.populationId);
    if (!speciesId) continue;
    const key = `${agent.regionId}|${speciesId}`;
    const hosts = hostsByRegionSpecies.get(key) ?? [];
    hosts.push(agent);
    hostsByRegionSpecies.set(key, hosts);
  }
  const livingInfectedByOutbreak = new Map<string, AgentState[]>();
  const deadInfectedByOutbreak = new Map<string, number>();
  for (const agent of agents.values()) {
    for (const infection of agent.health?.infections ?? []) {
      const key = outbreakKey(infection.pathogenId, agent.regionId);
      if (deadIds.has(agent.id)) {
        deadInfectedByOutbreak.set(key, (deadInfectedByOutbreak.get(key) ?? 0) + 1);
      } else {
        const infected = livingInfectedByOutbreak.get(key) ?? [];
        infected.push(agent);
        livingInfectedByOutbreak.set(key, infected);
      }
    }
  }
  const hostGroupsBySpecies = new Map<string, Array<{ regionId: RegionId; livingHosts: AgentState[] }>>();
  const livingHostsByRegionSpecies = new Map<string, AgentState[]>();
  for (const [key, hosts] of [...hostsByRegionSpecies.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const separator = key.lastIndexOf("|");
    const regionId = key.slice(0, separator) as RegionId;
    const speciesId = key.slice(separator + 1);
    const groups = hostGroupsBySpecies.get(speciesId) ?? [];
    const livingHosts = hosts.filter((agent) => !deadIds.has(agent.id));
    livingHostsByRegionSpecies.set(key, livingHosts);
    groups.push({ regionId, livingHosts });
    hostGroupsBySpecies.set(speciesId, groups);
  }
  const recordedSpreadKeys = new Set(step.events
    .filter((event) => event.kind === "disease-regional-spread")
    .map((event) => `${event.payload.pathogenId}|${event.payload.toRegion}`));
  for (const pathogen of [...step.pathogens.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const previous = previousById.get(pathogen.id);
    let next = pathogen;
    for (const { regionId, livingHosts } of hostGroupsBySpecies.get(pathogen.hostSpeciesId) ?? []) {
      const infected = livingInfectedByOutbreak.get(outbreakKey(pathogen.id, regionId)) ?? [];
      if (infected.length === 0) continue;
      const existing = pathogenOutbreakForRegion(next, regionId);
      if (existing && existing.prevalence > 0) continue;
      const source = [...next.regionalOutbreaks].filter((outbreak) => outbreak.status !== "dormant").sort(compareRegionalOutbreaks)[0];
      const outbreak = upsertRegionalOutbreak(next, regionId, infected.length / Math.max(1, livingHosts.length), nextSimulationTick(state), nextSimulationStep(state));
      const alreadyRecorded = recordedSpreadKeys.has(`${pathogen.id}|${regionId}`);
      if (!outbreak || alreadyRecorded) continue;
      events.push({
        kind: "disease-regional-spread",
        ruleId: "health:infected-carrier-spread",
        sourceIds: [pathogen.id, ...infected.map((agent) => agent.id).sort().slice(0, 4)],
        probability: 1,
        roll: 0,
        evidence: { fromRegion: source?.regionId ?? pathogen.regionId, toRegion: regionId, prevalence: outbreak.prevalence, route: "infected-carrier" },
        payload: { pathogenId: pathogen.id, fromRegion: source?.regionId ?? pathogen.regionId, toRegion: regionId, hostSpeciesId: pathogen.hostSpeciesId, route: "infected-carrier", name: pathogen.name },
        source: "natural",
      });
    }
    let diseaseDeaths = 0;
    for (const regional of next.regionalOutbreaks) {
      if (step.aggregateOutbreakKeys.has(outbreakKey(pathogen.id, regional.regionId))) continue;
      const livingHosts = livingHostsByRegionSpecies.get(`${regional.regionId}|${pathogen.hostSpeciesId}`) ?? [];
      const key = outbreakKey(pathogen.id, regional.regionId);
      const infected = livingInfectedByOutbreak.get(key) ?? [];
      diseaseDeaths += deadInfectedByOutbreak.get(key) ?? 0;
      const prevalence = infected.length / Math.max(1, livingHosts.length);
      regional.prevalence = prevalence;
      regional.status = statusForPrevalence(prevalence);
      if (prevalence > 0) {
        regional.lastActiveTick = nextSimulationTick(state);
        regional.lastActiveTimelineStep = nextSimulationStep(state);
      }
    }
    next.cumulativeCases = addPersistentTotal(next.cumulativeCases, step.caseIncrements.get(pathogen.id) ?? 0);
    next.cumulativeRecoveries = addPersistentTotal(next.cumulativeRecoveries, step.recoveryIncrements.get(pathogen.id) ?? 0);
    next.cumulativeDeaths = addPersistentTotal(next.cumulativeDeaths, diseaseDeaths);
    next = summarizePathogen(next, next.regionalOutbreaks);
    effects.push({ collection: "pathogens", operation: previous ? "update" : "create", id: next.id, value: next });
    for (const regional of next.regionalOutbreaks) {
      const previousRegional = previous ? pathogenOutbreakForRegion(previous, regional.regionId) : undefined;
      if (previous && (previousRegional?.prevalence ?? 0) < 0.2 && regional.prevalence >= 0.2) {
      events.push({
        kind: "disease-outbreak",
        ruleId: "health:regional-outbreak-threshold",
        sourceIds: [next.id, next.hostSpeciesId],
        probability: 1,
        roll: 0,
        evidence: { regionId: regional.regionId, prevalence: regional.prevalence, severity: next.severity, name: next.name },
        payload: { pathogenId: next.id, regionId: regional.regionId, hostSpeciesId: next.hostSpeciesId, name: next.name },
        source: "natural",
      });
      } else if (previous && (previousRegional?.prevalence ?? 0) > 0 && regional.prevalence === 0) {
      events.push({
        kind: "disease-contained",
        ruleId: "health:regional-containment",
        sourceIds: [next.id, next.hostSpeciesId],
        probability: 1,
        roll: 0,
        evidence: { regionId: regional.regionId, recoveries: next.cumulativeRecoveries, deaths: next.cumulativeDeaths, name: next.name },
        payload: { pathogenId: next.id, regionId: regional.regionId, hostSpeciesId: next.hostSpeciesId, name: next.name },
        source: "natural",
      });
      }
    }
  }
  return { effects, events };
};

export const diseasePrevalenceForRegion = (state: Pick<WorldState, "agents" | "pathogens">, regionId: string): number => {
  const localAgents = state.agents.filter((agent) => agent.regionId === regionId);
  if (localAgents.length > 0) {
    return localAgents.filter((agent) => (agent.health?.infections.length ?? 0) > 0).length / localAgents.length;
  }
  return Math.max(0, ...state.pathogens.map((pathogen) => pathogenPrevalenceForRegion(pathogen, regionId)));
};

export const healthSummaryForRegion = (state: Pick<WorldState, "agents" | "pathogens">, regionId: string): RegionHealthSummary => {
  const localAgents = state.agents.filter((agent) => agent.regionId === regionId);
  const localPathogens = state.pathogens.filter((pathogen) => pathogenPrevalenceForRegion(pathogen, regionId) > 0
    || pathogen.regionId === regionId
    || localAgents.some((agent) => agent.health?.infections.some((infection) => infection.pathogenId === pathogen.id)));
  const infectedCount = localAgents.filter((agent) => (agent.health?.infections.length ?? 0) > 0).length;
  return {
    activePathogenIds: localPathogens.filter((pathogen) => pathogenOutbreakForRegion(pathogen, regionId)?.status !== "dormant").map((pathogen) => pathogen.id).sort(),
    infectedCount,
    immuneCount: localAgents.filter((agent) => (agent.health?.immunityIds.length ?? 0) > 0).length,
    prevalence: localAgents.length > 0 ? infectedCount / localAgents.length : diseasePrevalenceForRegion(state, regionId),
    meanVitality: localAgents.length > 0
      ? localAgents.reduce((sum, agent) => sum + (agent.health?.vitality ?? 1), 0) / localAgents.length
      : Math.max(0, 1 - diseasePrevalenceForRegion(state, regionId) * 0.35),
  };
};
