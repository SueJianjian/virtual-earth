import { forkRandom, hashString, nextRandom } from "../random.ts";
import { ABIOGENESIS_WATER_THRESHOLD, PREBIOTIC_ORGANICS_THRESHOLD } from "../environment/thresholds.ts";
import { createSpeciesBlueprint, mutateSpeciesBlueprint, speciesBlueprintFor, speciesNameFor } from "./blueprints.ts";
import type {
  EntityId,
  PopulationState,
  RegionId,
  RuleContext,
  RuleOutcome,
  SpeciesRole,
  SpeciesState,
  WorldDelta,
} from "../types.ts";
import type { PopulationGeneticSample } from "../agents/genetics.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const asEntityId = (value: string): EntityId => value as EntityId;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const originRegionFor = (
  state: RuleContext["state"],
  species: SpeciesState,
): PopulationState["regionId"] => {
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < state.fields.elevation.values.length; index += 1) {
    const water = state.fields.water.values[index] ?? 0;
    const nutrients = state.fields.nutrients.values[index] ?? 0;
    const temperature = state.fields.temperature.values[index] ?? 0;
    const humidity = state.fields.humidity.values[index] ?? 0;
    const temperatureFit = Math.max(0, 1 - Math.abs(temperature - (species.traits.temperatureOptimum ?? 0.5)) * 1.7);
    const humidityFit = Math.max(0, 1 - Math.abs(humidity - (species.traits.humidityOptimum ?? 0.5)) * 1.2);
    const score = water * (0.4 + nutrients) * temperatureFit * humidityFit;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  const width = state.fields.elevation.width;
  return `region:${bestIndex % width}:${Math.floor(bestIndex / width)}` as never;
};

export const createSpecies = (
  seed: string,
  role: SpeciesRole,
  parentId?: EntityId,
  origin?: { regionId: RegionId; tick: number; years: number; timelineStep?: string },
): SpeciesState => ({
  id: asEntityId(`species:${hashString(seed).toString(16)}`),
  name: speciesNameFor(seed, role),
  role,
  traits: {
    energyUse: role === "producer" ? 0.2 : role === "consumer" ? 0.45 : 0.3,
    reproduction: role === "producer" ? 0.52 : role === "consumer" ? 0.28 : 0.34,
    temperatureOptimum: 0.35 + (hashString(`${seed}:temperature`) % 45) / 100,
    humidityOptimum: 0.3 + (hashString(`${seed}:humidity`) % 50) / 100,
    mobility: 0.15 + (hashString(`${seed}:mobility`) % 65) / 100,
    cognitivePotential: role === "consumer" ? (hashString(`${seed}:mind`) % 70) / 100 : 0,
    marineAffinity: (hashString(`${seed}:marine`) % 1_001) / 1_000,
  },
  ...(parentId ? { parentId } : {}),
  ...(origin ? {
    originRegionId: origin.regionId,
    originTick: origin.tick,
    ...(origin.timelineStep === undefined ? {} : { originTimelineStep: origin.timelineStep }),
    originYears: origin.years,
  } : {}),
  blueprint: createSpeciesBlueprint(seed, role),
});

export const attemptAbiogenesis = (
  context: RuleContext,
): RuleOutcome<SpeciesState> => {
  const { state, metrics } = context;
  const producerIds = new Set(state.species.filter((species) => species.role === "producer").map((species) => species.id));
  const hasLivingProducer = state.populations.some((population) => producerIds.has(population.speciesId) && population.count > 0.001);
  const water = metrics.waterCoverage;
  const nutrients = metrics.nutrientLevel;
  const temperature = metrics.meanTemperature;
  const organics = state.chemistry.organics.values.reduce((sum, value) => sum + value, 0) /
    Math.max(1, state.chemistry.organics.values.length);
  // Each planet's mineral residue has a deterministic catalyst availability.
  // This preserves genuinely different evolutionary histories instead of
  // forcing every suitable world to produce life on the same schedule.
  const catalystAvailability = hashString(`prebiotic-catalysts:${state.seed}`) / 0xffffffff;
  const originSuitability = state.formation.phase === "stable-crust" ? catalystAvailability : 1;
  const eligible = !hasLivingProducer
    && water >= ABIOGENESIS_WATER_THRESHOLD
    && originSuitability >= 0.2
    && nutrients >= 0.04
    && temperature >= 0.2
    && temperature <= 0.9
    && organics >= PREBIOTIC_ORGANICS_THRESHOLD;
  const probability = eligible
    ? Math.min(0.85, 0.02 + water * nutrients * Math.max(0.1, organics) * 2 * originSuitability)
    : 0;
  const [roll] = nextRandom(forkRandom(context.random, "abiogenesis"));
  const success = roll < probability;
  if (!eligible || !success) {
    return {
      status: "skipped",
      delta: emptyDelta(),
    };
  }
  const seed = `abiogenesis:${roll}`;
  const provisionalSpecies = createSpecies(seed, "producer");
  const originRegionId = originRegionFor(state, provisionalSpecies);
  const species = createSpecies(seed, "producer", undefined, {
    regionId: originRegionId,
    tick: context.tick ?? 0,
    years: context.years ?? 0,
    timelineStep: context.state.timeline?.step ?? String(context.tick ?? 0),
  });
  const population: PopulationState = {
    id: asEntityId(`population:${hashString(`${species.id}:origin`).toString(16)}`),
    speciesId: species.id,
    regionId: originRegionId,
    count: 1,
    energy: 0.25,
  };
  const delta = emptyDelta();
  delta.entityEffects.push(
    { collection: "species", operation: "create", id: species.id, value: species },
    { collection: "populations", operation: "create", id: population.id, value: population },
  );
  delta.eventDrafts.push({
    kind: "abiogenesis",
    ruleId: "life-origin",
    sourceIds: [],
    probability,
    roll,
    evidence: {
      water,
      nutrients,
      temperature,
      organics,
      catalystAvailability,
      geneticCarrier: species.blueprint?.geneticCarrier ?? "unknown",
      metabolism: species.blueprint?.metabolism ?? "unknown",
      noveltySignature: species.blueprint?.noveltySignature ?? "unknown",
    },
    payload: { speciesId: species.id, name: species.name ?? species.id, role: species.role, regionId: originRegionId },
    source: "natural",
  });
  return { status: "applied", value: species, delta };
};

export const attemptTrophicSpecies = (
  context: RuleContext,
  role: Exclude<SpeciesRole, "producer">,
  foodAvailability: number,
): RuleOutcome<SpeciesState> => {
  const producerIds = new Set(context.state.species.filter((species) => species.role === "producer").map((species) => species.id));
  const parentPopulation = context.state.populations
    .filter((population) => producerIds.has(population.speciesId) && population.count >= 1)
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))[0];
  const parent = parentPopulation
    ? context.state.species.find((species) => species.id === parentPopulation.speciesId)
    : undefined;
  const eligible = Boolean(parent && parentPopulation) && foodAvailability >= 12 && context.metrics.populationCount > 0;
  const probability = eligible ? Math.min(0.45, foodAvailability * 0.08) : 0;
  const [roll] = nextRandom(forkRandom(context.random, `trophic:${role}`));
  const success = roll < probability;
  if (!eligible || !success) return { status: "skipped", delta: emptyDelta() };

  const seed = `trophic:${role}:${roll}`;
  const species = createSpecies(seed, role, parent?.id, {
    regionId: parentPopulation!.regionId,
    tick: context.tick ?? 0,
    years: context.years ?? 0,
    timelineStep: context.state.timeline?.step ?? String(context.tick ?? 0),
  });
  if (parentPopulation) {
    const match = /^region:(\d+):(\d+)$/.exec(parentPopulation.regionId);
    const x = Number(match?.[1] ?? 0);
    const y = Number(match?.[2] ?? 0);
    const index = Math.max(0, Math.min(context.state.fields.temperature.values.length - 1, y * context.state.fields.temperature.width + x));
    const localTemperature = context.state.fields.temperature.values[index] ?? 0.5;
    const localHumidity = context.state.fields.humidity.values[index] ?? 0.5;
    species.traits.temperatureOptimum = clamp01(localTemperature * 0.7 + (species.traits.temperatureOptimum ?? localTemperature) * 0.3);
    species.traits.humidityOptimum = clamp01(localHumidity * 0.7 + (species.traits.humidityOptimum ?? localHumidity) * 0.3);
    if (parent) {
      species.blueprint = mutateSpeciesBlueprint(speciesBlueprintFor(parent), seed, role, {
        temperature: localTemperature,
        humidity: localHumidity,
      });
    }
  }
  const population: PopulationState = {
    id: asEntityId(`population:${hashString(`${species.id}:origin`).toString(16)}`),
    speciesId: species.id,
    regionId: parentPopulation!.regionId,
    count: Math.max(4, Math.min(1_000, foodAvailability * (role === "consumer" ? 0.4 : 0.25))),
    energy: Math.max(0.1, Math.min(1, foodAvailability)),
  };
  const delta = emptyDelta();
  delta.entityEffects.push(
    { collection: "species", operation: "create", id: species.id, value: species },
    { collection: "populations", operation: "create", id: population.id, value: population },
  );
  delta.eventDrafts.push({
    kind: "species-emergence",
    ruleId: `trophic-${role}-emergence`,
    sourceIds: parent ? [parent.id] : [],
    probability,
    roll,
    evidence: {
      foodAvailability,
      populationCount: context.metrics.populationCount,
      geneticCarrier: species.blueprint?.geneticCarrier ?? "unknown",
      metabolism: species.blueprint?.metabolism ?? "unknown",
      noveltySignature: species.blueprint?.noveltySignature ?? "unknown",
    },
    payload: { speciesId: species.id, name: species.name ?? species.id, populationId: population.id, role, regionId: population.regionId },
    source: "natural",
  });
  return { status: "applied", value: species, delta };
};

export const ACTIVE_ADAPTIVE_SPECIES_LIMITS: Readonly<Record<SpeciesRole, number>> = {
  producer: 3,
  consumer: 5,
  decomposer: 3,
};

export const attemptAdaptiveSpeciation = (
  context: RuleContext,
  parent: SpeciesState,
  parentPopulation: PopulationState,
  localTemperature: number,
  localHumidity: number,
  habitatSuitability: number,
  currentRoleSpeciesCount: number,
  knownRegionalDescendant?: boolean,
  selectedGenetics?: PopulationGeneticSample,
): RuleOutcome<SpeciesState> => {
  const delta = emptyDelta();
  if (parentPopulation.count < 250 || currentRoleSpeciesCount >= ACTIVE_ADAPTIVE_SPECIES_LIMITS[parent.role] || knownRegionalDescendant === true) {
    return { status: "skipped", delta };
  }
  const hasRegionalDescendant = knownRegionalDescendant ?? context.state.species
    .filter((species) => species.parentId === parent.id)
    .some((species) => context.state.populations.some((population) =>
      population.speciesId === species.id && population.regionId === parentPopulation.regionId && population.count >= 1,
    ));
  const eligible = !hasRegionalDescendant;
  const populationOpportunity = Math.min(1, Math.log10(Math.max(1, parentPopulation.count)) / 6);
  const adaptationPressure = Math.max(0, 1 - habitatSuitability);
  const probability = eligible
    ? Math.min(0.06, 0.004 + populationOpportunity * 0.025 + adaptationPressure * 0.018)
    : 0;
  const [roll] = nextRandom(forkRandom(context.random, `speciation:${parent.id}:${parentPopulation.id}:${parentPopulation.regionId}`));
  if (!eligible || roll >= probability) return { status: "skipped", delta };

  const seed = `speciation:${parent.id}:${parentPopulation.regionId}:${roll}`;
  const mutation = (name: string): number => (hashString(`${seed}:${name}`) % 2_001) / 1_000 - 1;
  const species = createSpecies(seed, parent.role, parent.id, {
    regionId: parentPopulation.regionId,
    tick: context.tick ?? 0,
    years: context.years ?? 0,
    timelineStep: context.state.timeline?.step ?? String(context.tick ?? 0),
  });
  species.traits = {
    ...parent.traits,
    energyUse: clamp01((parent.traits.energyUse ?? 0.3) + mutation("energy") * 0.045),
    reproduction: clamp01((parent.traits.reproduction ?? 0.3) + mutation("reproduction") * 0.055),
    temperatureOptimum: clamp01((parent.traits.temperatureOptimum ?? localTemperature) * 0.68 + localTemperature * 0.32 + mutation("temperature") * 0.035),
    humidityOptimum: clamp01((parent.traits.humidityOptimum ?? localHumidity) * 0.68 + localHumidity * 0.32 + mutation("humidity") * 0.035),
    mobility: clamp01((parent.traits.mobility ?? 0.2) + mutation("mobility") * 0.07),
    cognitivePotential: parent.role === "consumer"
      ? clamp01((parent.traits.cognitivePotential ?? 0) + mutation("mind") * 0.09 + 0.01 * populationOpportunity)
      : 0,
    marineAffinity: clamp01((parent.traits.marineAffinity ?? 0.5) + mutation("marine") * 0.08),
  };
  if (parent) {
    const mutatedBlueprint = mutateSpeciesBlueprint(speciesBlueprintFor(parent), seed, parent.role, {
      temperature: localTemperature,
      humidity: localHumidity,
    });
    species.blueprint = selectedGenetics ? {
      ...mutatedBlueprint,
      metabolicEfficiency: clamp01(mutatedBlueprint.metabolicEfficiency * 0.72 + selectedGenetics.means.metabolicEfficiency * 0.28),
      fecundity: clamp01(mutatedBlueprint.fecundity * 0.72 + selectedGenetics.means.fertility * 0.28),
      thermalTolerance: clamp01(mutatedBlueprint.thermalTolerance * 0.72 + selectedGenetics.means.thermalTolerance * 0.28),
      hydrationRetention: clamp01(mutatedBlueprint.hydrationRetention * 0.72 + selectedGenetics.means.hydrationRetention * 0.28),
    } : mutatedBlueprint;
    if (selectedGenetics) {
      species.traits.cognitivePotential = clamp01((species.traits.cognitivePotential ?? 0) * 0.72 + selectedGenetics.means.cognitivePotential * 0.28);
      species.traits.reproduction = clamp01((species.traits.reproduction ?? 0) * 0.72 + selectedGenetics.means.fertility * 0.28);
    }
  }
  const branchCount = Math.max(4, Math.min(500, parentPopulation.count * 0.04));
  const population: PopulationState = {
    id: asEntityId(`population:${hashString(`${species.id}:${parentPopulation.regionId}`).toString(16)}`),
    speciesId: species.id,
    regionId: parentPopulation.regionId,
    count: branchCount,
    energy: Math.max(0.1, parentPopulation.energy * 0.78),
  };
  delta.entityEffects.push(
    { collection: "species", operation: "create", id: species.id, value: species },
    { collection: "populations", operation: "create", id: population.id, value: population },
  );
  delta.eventDrafts.push({
    kind: "species-divergence",
    ruleId: "ecology:adaptive-speciation",
    sourceIds: [parent.id, parentPopulation.id],
    probability,
    roll,
    evidence: {
      regionId: parentPopulation.regionId,
      parentPopulation: parentPopulation.count,
      branchCount,
      habitatSuitability,
      adaptationPressure,
      cognitivePotential: species.traits.cognitivePotential ?? 0,
      geneticCarrier: species.blueprint?.geneticCarrier ?? "unknown",
      metabolism: species.blueprint?.metabolism ?? "unknown",
      noveltySignature: species.blueprint?.noveltySignature ?? "unknown",
      selectedSampleSize: selectedGenetics?.sampleSize ?? 0,
      selectedMetabolicEfficiency: selectedGenetics?.means.metabolicEfficiency ?? 0,
      selectedThermalTolerance: selectedGenetics?.means.thermalTolerance ?? 0,
      selectedHydrationRetention: selectedGenetics?.means.hydrationRetention ?? 0,
    },
    payload: { parentSpeciesId: parent.id, speciesId: species.id, name: species.name ?? species.id, populationId: population.id, role: species.role, regionId: population.regionId, branchCount },
    source: "natural",
  });
  return { status: "applied", value: species, delta };
};
