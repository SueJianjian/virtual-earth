import type { KnowledgeDomain, RegionId, WorldState } from "../types.ts";

export type TechnologyProfile = Record<KnowledgeDomain, number>;

const domains: KnowledgeDomain[] = [
  "subsistence",
  "construction",
  "navigation",
  "medicine",
  "governance",
  "energy",
];

const emptyProfile = (): TechnologyProfile => ({
  subsistence: 0,
  construction: 0,
  navigation: 0,
  medicine: 0,
  governance: 0,
  energy: 0,
});

const levelFor = (knowledgeCount: number): number => Math.min(1, knowledgeCount / 6);

type TechnologySource = Pick<WorldState, "cultures" | "knowledge">;
const profileCache = new WeakMap<WorldState["cultures"], { knowledge: WorldState["knowledge"]; profiles: ReadonlyMap<RegionId, TechnologyProfile> }>();

const buildProfiles = (state: TechnologySource): ReadonlyMap<RegionId, TechnologyProfile> => {
  if (state.cultures.length === 0 || state.knowledge.length === 0) return new Map();
  const knowledgeById = new Map(state.knowledge.map((knowledge) => [knowledge.id, knowledge]));
  const knownByRegion = new Map<RegionId, Set<string>>();
  for (const culture of state.cultures) {
    const known = knownByRegion.get(culture.regionId) ?? new Set<string>();
    for (const id of culture.knowledgeIds) known.add(id);
    knownByRegion.set(culture.regionId, known);
  }
  const profiles = new Map<RegionId, TechnologyProfile>();
  for (const [regionId, knownIds] of knownByRegion) {
    const counts = emptyProfile();
    for (const id of knownIds) {
      const domain = knowledgeById.get(id)?.domain;
      if (domain) counts[domain] += 1;
    }
    for (const domain of domains) counts[domain] = levelFor(counts[domain]);
    profiles.set(regionId, counts);
  }
  return profiles;
};

const cachedProfiles = (state: TechnologySource): ReadonlyMap<RegionId, TechnologyProfile> => {
  const cached = profileCache.get(state.cultures);
  if (cached?.knowledge === state.knowledge) return cached.profiles;
  const profiles = buildProfiles(state);
  profileCache.set(state.cultures, { knowledge: state.knowledge, profiles });
  return profiles;
};

export const technologyProfileForRegion = (
  state: TechnologySource,
  regionId: RegionId,
): TechnologyProfile => cachedProfiles(state).get(regionId) ?? emptyProfile();

export const technologyProfilesForState = (
  state: TechnologySource,
): ReadonlyMap<RegionId, TechnologyProfile> => cachedProfiles(state);

export const technologyDomainLevels = (
  state: Pick<WorldState, "cultures" | "knowledge">,
  regionId: RegionId,
): Array<{ domain: KnowledgeDomain; level: number }> => {
  const profile = technologyProfileForRegion(state, regionId);
  return domains.map((domain) => ({ domain, level: profile[domain] }));
};

export const technologyAdoptionKey = (regionId: RegionId, domain: KnowledgeDomain): string =>
  `technology-adoption:${regionId}:${domain}`;

export const technologyDomainLabels: Record<KnowledgeDomain, string> = {
  subsistence: "生计技术",
  construction: "建造技术",
  navigation: "航行技术",
  medicine: "医养技术",
  governance: "治理技术",
  energy: "能量技术",
};
