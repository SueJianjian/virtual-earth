import { forkRandom, hashString, nextRandom } from "../random.ts";
import type {
  EntityId,
  PopulationState,
  RuleContext,
  RuleOutcome,
  SpeciesRole,
  SpeciesState,
  WorldDelta,
} from "../types.ts";

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
): SpeciesState => ({
  id: asEntityId(`species:${hashString(seed).toString(16)}`),
  role,
  traits: {
    energyUse: role === "producer" ? 0.2 : role === "consumer" ? 0.45 : 0.3,
    reproduction: role === "producer" ? 0.52 : role === "consumer" ? 0.28 : 0.34,
    temperatureOptimum: 0.35 + (hashString(`${seed}:temperature`) % 45) / 100,
    humidityOptimum: 0.3 + (hashString(`${seed}:humidity`) % 50) / 100,
    mobility: 0.15 + (hashString(`${seed}:mobility`) % 65) / 100,
    cognitivePotential: role === "consumer" ? (hashString(`${seed}:mind`) % 70) / 100 : 0,
  },
  ...(parentId ? { parentId } : {}),
});

export const attemptAbiogenesis = (
  context: RuleContext,
): RuleOutcome<SpeciesState> => {
  const { state, metrics } = context;
  const hasProducer = state.species.some((species) => species.role === "producer");
  const water = metrics.waterCoverage;
  const nutrients = metrics.nutrientLevel;
  const temperature = metrics.meanTemperature;
  const organics = state.chemistry.organics.values.reduce((sum, value) => sum + value, 0) /
    Math.max(1, state.chemistry.organics.values.length);
  const eligible = !hasProducer && water >= 0.1 && nutrients >= 0.04 && temperature >= 0.2 && temperature <= 0.9 && organics >= 0.001;
  const probability = eligible
    ? Math.min(0.85, 0.02 + water * nutrients * Math.max(0.1, organics) * 2)
    : 0;
  const [roll] = nextRandom(forkRandom(context.random, "abiogenesis"));
  const success = roll < probability;
  if (!eligible || !success) {
    return {
      status: "skipped",
      delta: emptyDelta(),
    };
  }
  const species = createSpecies(`abiogenesis:${roll}`, "producer");
  const population: PopulationState = {
    id: asEntityId(`population:${hashString(`${species.id}:origin`).toString(16)}`),
    speciesId: species.id,
    regionId: originRegionFor(state, species),
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
    evidence: { water, nutrients, temperature, organics },
    payload: { speciesId: species.id, role: species.role },
    source: "natural",
  });
  return { status: "applied", value: species, delta };
};

export const attemptTrophicSpecies = (
  context: RuleContext,
  role: Exclude<SpeciesRole, "producer">,
  foodAvailability: number,
): RuleOutcome<SpeciesState> => {
  const eligible = foodAvailability >= 0.12 && context.metrics.populationCount > 0;
  const probability = eligible ? Math.min(0.45, foodAvailability * 0.08) : 0;
  const [roll] = nextRandom(forkRandom(context.random, `trophic:${role}`));
  const success = roll < probability;
  if (!eligible || !success) return { status: "skipped", delta: emptyDelta() };

  const parent = context.state.species.find((species) => species.role === "producer");
  const species = createSpecies(`trophic:${role}:${roll}`, role, parent?.id);
  const parentPopulation = parent
    ? context.state.populations.find((population) => population.speciesId === parent.id)
    : undefined;
  const population: PopulationState = {
    id: asEntityId(`population:${hashString(`${species.id}:origin`).toString(16)}`),
    speciesId: species.id,
    regionId: parentPopulation?.regionId ?? "region:origin" as never,
    count: Math.max(1, Math.min(1_000, foodAvailability * (role === "consumer" ? 0.4 : 0.25))),
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
    evidence: { foodAvailability, populationCount: context.metrics.populationCount },
    payload: { speciesId: species.id, populationId: population.id, role },
    source: "natural",
  });
  return { status: "applied", value: species, delta };
};
