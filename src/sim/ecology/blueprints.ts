import { hashString } from "../random.ts";
import type {
  BodyStructure,
  BodySymmetry,
  CellArchitecture,
  GeneticCarrier,
  LifeBiochemistry,
  LocomotionMode,
  MetabolismMode,
  ReproductionMode,
  SensoryMode,
  SpeciesBlueprint,
  SpeciesRole,
  SpeciesState,
} from "../types.ts";

const biochemistries: LifeBiochemistry[] = ["carbon-nitrogen", "phosphorus-lattice", "silicate-organic", "metal-organic", "crystal-colloid"];
const geneticCarriers: GeneticCarrier[] = ["double-ribbon", "triple-ribbon", "branched-polymer", "vesicle-lattice", "mineral-template"];
const cellArchitectures: CellArchitecture[] = ["membrane-cell", "porous-cell", "syncytial-web", "crystal-cell", "modular-colony"];
const symmetries: BodySymmetry[] = ["bilateral", "radial", "spiral", "fractal", "asymmetric"];
const structures: BodyStructure[] = ["membrane", "segmented", "shell", "filament", "network"];
const locomotionModes: LocomotionMode[] = ["rooted", "gliding", "contractile", "ciliary", "jet", "drifting"];
const senses: SensoryMode[] = ["chemical-gradient", "thermal-field", "polarized-light", "vibration", "electric-field", "pressure-wave"];
const reproductions: ReproductionMode[] = ["fission", "budding", "spore-cycle", "paired-fusion", "brood-pod", "colony-fragmentation"];
const metabolisms: Record<SpeciesRole, MetabolismMode[]> = {
  producer: ["radiant-harvesting", "mineral-chemosynthesis", "thermal-gradient"],
  consumer: ["ingestive-predation", "osmotic-parasitism", "symbiotic-exchange"],
  decomposer: ["detrital-catalysis", "mineral-recycling", "anaerobic-fermentation"],
};

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const fraction = (seed: string): number => hashString(seed) / 0xffffffff;
const choice = <T>(values: readonly T[], seed: string): T => values[hashString(seed) % values.length]!;
const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const senseSet = (seed: string): SensoryMode[] => {
  const first = choice(senses, `${seed}:sense:0`);
  const second = choice(senses, `${seed}:sense:1`);
  const third = choice(senses, `${seed}:sense:2`);
  const count = 1 + (hashString(`${seed}:sense-count`) % 3);
  return [...new Set([first, second, third])].slice(0, count).sort();
};

export const createSpeciesBlueprint = (seed: string, role: SpeciesRole): SpeciesBlueprint => {
  const geneticCarrier = choice(geneticCarriers, `${seed}:carrier`);
  const structure = choice(structures, `${seed}:structure`);
  const locomotion = role === "producer" && fraction(`${seed}:rooted`) > 0.35
    ? "rooted"
    : choice(locomotionModes.filter((mode) => mode !== "rooted"), `${seed}:locomotion`);
  const mutationRate = rounded(0.002 + fraction(`${seed}:mutation`) * 0.058);
  return {
    biochemistry: choice(biochemistries, `${seed}:biochemistry`),
    geneticCarrier,
    cellArchitecture: choice(cellArchitectures, `${seed}:cell`),
    metabolism: choice(metabolisms[role], `${seed}:metabolism`),
    bodyPlan: {
      symmetry: choice(symmetries, `${seed}:symmetry`),
      structure,
      locomotion,
      appendagePairs: structure === "filament" || locomotion === "rooted" ? 0 : hashString(`${seed}:appendages`) % 5,
      colonial: fraction(`${seed}:colonial`) >= 0.62,
    },
    senses: senseSet(seed),
    reproduction: choice(reproductions, `${seed}:reproduction`),
    lifespanYears: rounded(2 + fraction(`${seed}:lifespan`) * (role === "producer" ? 180 : 110)),
    adultScale: rounded(0.08 + Math.pow(fraction(`${seed}:scale`), 1.7) * 12),
    metabolicEfficiency: rounded(0.28 + fraction(`${seed}:efficiency`) * 0.62),
    fecundity: rounded(0.18 + fraction(`${seed}:fecundity`) * 0.72),
    thermalTolerance: rounded(0.12 + fraction(`${seed}:thermal-tolerance`) * 0.78),
    hydrationRetention: rounded(0.12 + fraction(`${seed}:hydration`) * 0.78),
    mutationRate,
    inheritanceFidelity: rounded(clamp(0.995 - mutationRate * 1.7, 0.88, 0.995)),
    noveltySignature: hashString(`life:${seed}:${role}:${geneticCarrier}`).toString(16).padStart(8, "0"),
  };
};

const mutateChoice = <T>(current: T, values: readonly T[], seed: string, mutationRate: number): T => {
  if (fraction(`${seed}:roll`) >= clamp(0.08 + mutationRate * 3, 0.08, 0.32)) return current;
  const alternatives = values.filter((value) => value !== current);
  return choice(alternatives, `${seed}:choice`);
};

export const mutateSpeciesBlueprint = (
  parent: SpeciesBlueprint,
  seed: string,
  role: SpeciesRole,
  environment: { temperature: number; humidity: number },
): SpeciesBlueprint => {
  const mutationRate = rounded(clamp(parent.mutationRate + (fraction(`${seed}:mutation`) - 0.5) * 0.012, 0.002, 0.08));
  const numericMutation = (key: string, value: number, scale: number): number =>
    rounded(clamp(value + (fraction(`${seed}:${key}`) - 0.5) * scale));
  const inheritedSenses = [...parent.senses];
  if (fraction(`${seed}:sense-add`) < 0.16 + mutationRate) inheritedSenses.push(choice(senses, `${seed}:new-sense`));
  if (inheritedSenses.length > 1 && fraction(`${seed}:sense-drop`) < mutationRate) inheritedSenses.splice(hashString(`${seed}:drop-index`) % inheritedSenses.length, 1);
  const lifespanFactor = 0.86 + fraction(`${seed}:lifespan`) * 0.28;
  return {
    biochemistry: mutateChoice(parent.biochemistry, biochemistries, `${seed}:biochemistry`, mutationRate * 0.35),
    geneticCarrier: mutateChoice(parent.geneticCarrier, geneticCarriers, `${seed}:carrier`, mutationRate * 0.22),
    cellArchitecture: mutateChoice(parent.cellArchitecture, cellArchitectures, `${seed}:cell`, mutationRate),
    metabolism: mutateChoice(parent.metabolism, metabolisms[role], `${seed}:metabolism`, mutationRate),
    bodyPlan: {
      symmetry: mutateChoice(parent.bodyPlan.symmetry, symmetries, `${seed}:symmetry`, mutationRate),
      structure: mutateChoice(parent.bodyPlan.structure, structures, `${seed}:structure`, mutationRate),
      locomotion: mutateChoice(parent.bodyPlan.locomotion, locomotionModes, `${seed}:locomotion`, mutationRate),
      appendagePairs: Math.max(0, Math.min(6, parent.bodyPlan.appendagePairs + (hashString(`${seed}:appendages`) % 3) - 1)),
      colonial: fraction(`${seed}:colonial`) < mutationRate ? !parent.bodyPlan.colonial : parent.bodyPlan.colonial,
    },
    senses: [...new Set(inheritedSenses)].sort(),
    reproduction: mutateChoice(parent.reproduction, reproductions, `${seed}:reproduction`, mutationRate),
    lifespanYears: rounded(Math.max(0.25, Math.min(300, parent.lifespanYears * lifespanFactor))),
    adultScale: rounded(Math.max(0.02, Math.min(20, parent.adultScale * (0.82 + fraction(`${seed}:scale`) * 0.36)))),
    metabolicEfficiency: numericMutation("efficiency", parent.metabolicEfficiency, 0.12),
    fecundity: numericMutation("fecundity", parent.fecundity, 0.14),
    thermalTolerance: rounded(clamp(parent.thermalTolerance * 0.82 + (1 - Math.abs(environment.temperature - 0.5)) * 0.18 + (fraction(`${seed}:thermal`) - 0.5) * 0.08)),
    hydrationRetention: rounded(clamp(parent.hydrationRetention * 0.82 + (1 - environment.humidity) * 0.18 + (fraction(`${seed}:hydration`) - 0.5) * 0.08)),
    mutationRate,
    inheritanceFidelity: rounded(clamp(0.995 - mutationRate * 1.7, 0.86, 0.995)),
    noveltySignature: hashString(`life-branch:${parent.noveltySignature}:${seed}`).toString(16).padStart(8, "0"),
  };
};

export const speciesNameFor = (seed: string, role: SpeciesRole): string => {
  const prefixes = ["曜", "澜", "霁", "烬", "岚", "泠", "苍", "璇", "潮", "穹", "棱", "荧"];
  const stems = ["纤", "脉", "甲", "膜", "枝", "羽", "环", "核", "须", "冠", "囊", "纹"];
  const suffixes: Record<SpeciesRole, string[]> = {
    producer: ["藻群", "光植", "晶苔", "芽体"],
    consumer: ["行兽", "游体", "猎群", "翼体"],
    decomposer: ["菌幕", "蚀群", "腐网", "解体"],
  };
  return `${choice(prefixes, `${seed}:name-prefix`)}${choice(stems, `${seed}:name-stem`)}${choice(suffixes[role], `${seed}:name-suffix`)}`;
};

export const speciesBlueprintFor = (species: Pick<SpeciesState, "id" | "role" | "blueprint">): SpeciesBlueprint =>
  species.blueprint ?? createSpeciesBlueprint(String(species.id), species.role);

export const isSpeciesBlueprint = (value: unknown): value is SpeciesBlueprint => {
  if (!value || typeof value !== "object") return false;
  const blueprint = value as Partial<SpeciesBlueprint>;
  const bodyPlan = blueprint.bodyPlan;
  const numericValues = [
    blueprint.lifespanYears,
    blueprint.adultScale,
    blueprint.metabolicEfficiency,
    blueprint.fecundity,
    blueprint.thermalTolerance,
    blueprint.hydrationRetention,
    blueprint.mutationRate,
    blueprint.inheritanceFidelity,
  ];
  return typeof blueprint.biochemistry === "string" && biochemistries.includes(blueprint.biochemistry as LifeBiochemistry)
    && typeof blueprint.geneticCarrier === "string" && geneticCarriers.includes(blueprint.geneticCarrier as GeneticCarrier)
    && typeof blueprint.cellArchitecture === "string" && cellArchitectures.includes(blueprint.cellArchitecture as CellArchitecture)
    && typeof blueprint.metabolism === "string" && metabolisms["producer"].concat(metabolisms["consumer"], metabolisms["decomposer"]).includes(blueprint.metabolism as MetabolismMode)
    && Boolean(bodyPlan)
    && typeof bodyPlan?.symmetry === "string" && symmetries.includes(bodyPlan.symmetry as BodySymmetry)
    && typeof bodyPlan.structure === "string" && structures.includes(bodyPlan.structure as BodyStructure)
    && typeof bodyPlan.locomotion === "string" && locomotionModes.includes(bodyPlan.locomotion as LocomotionMode)
    && Number.isInteger(bodyPlan?.appendagePairs) && bodyPlan.appendagePairs >= 0 && bodyPlan.appendagePairs <= 6
    && typeof bodyPlan?.colonial === "boolean"
    && Array.isArray(blueprint.senses) && blueprint.senses.length > 0 && blueprint.senses.every((sense) => typeof sense === "string" && senses.includes(sense as SensoryMode))
    && typeof blueprint.reproduction === "string" && reproductions.includes(blueprint.reproduction as ReproductionMode)
    && typeof blueprint.noveltySignature === "string"
    && numericValues.every((number) => Number.isFinite(number) && (number as number) >= 0);
};

export const ensureSpeciesIdentity = (species: SpeciesState): SpeciesState => {
  if (species.blueprint && species.name) return species;
  return {
    ...species,
    name: species.name ?? speciesNameFor(String(species.id), species.role),
    blueprint: species.blueprint ?? createSpeciesBlueprint(String(species.id), species.role),
  };
};
