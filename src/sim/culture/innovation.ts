import { forkRandom, hashString, randomFloat } from "../random.ts";
import type { AgentState, CultureState, KnowledgeDomain, KnowledgeState, OrganizationState, RegionId, WorldEventDraft, WorldState } from "../types.ts";
import { createKnowledge, knowledgeIdFor } from "./knowledge.ts";
import { culturalCompatibility, cultureIdentityFor } from "./identity.ts";

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

const parseRegion = (regionId: RegionId): { x: number; y: number } | undefined => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  return match ? { x: Number(match[1] ?? 0), y: Number(match[2] ?? 0) } : undefined;
};

const mean = (members: AgentState[], valueFor: (agent: AgentState) => number): number =>
  members.reduce((sum, member) => sum + valueFor(member), 0) / Math.max(1, members.length);

const domainNames: Record<KnowledgeDomain, string[]> = {
  subsistence: ["沃痕培育法", "苔谷储养术", "潮壤轮作律", "风籽驯育法"],
  construction: ["叠岩承重法", "晶泥拱筑术", "风脊榫构法", "浮壤固基律"],
  navigation: ["潮星定向法", "雾脉航迹术", "风纹测路法", "深泉定位律"],
  medicine: ["光苔调养法", "雾叶净创术", "晶息复元法", "潮根辨毒律"],
  governance: ["环议协约法", "谷印公议制", "潮盟记契法", "群炬共治律"],
  energy: ["岩鸣蓄能法", "晶息导流术", "光壤转化法", "潮热回收律"],
};

const domainScores = (
  state: WorldState,
  culture: CultureState,
  members: AgentState[],
  knowledgeById: ReadonlyMap<string, KnowledgeState>,
): Array<{ domain: KnowledgeDomain; score: number }> => {
  const point = parseRegion(culture.regionId);
  const cell = point ? point.y * state.fields.elevation.width + point.x : 0;
  const elevation = state.fields.elevation.values[cell] ?? 0;
  const water = state.fields.water.values[cell] ?? 0;
  const humidity = state.fields.humidity.values[cell] ?? 0;
  const nutrients = state.fields.nutrients.values[cell] ?? 0;
  const biomass = state.fields.biomass.values[cell] ?? 0;
  const organics = state.chemistry.organics.values[cell] ?? 0;
  const carbon = state.chemistry.carbon.values[cell] ?? 0;
  const oxygen = state.chemistry.oxygen.values[cell] ?? 0;
  const curiosity = mean(members, (agent) => agent.traits.curiosity ?? 0);
  const cooperation = mean(members, (agent) => agent.traits.cooperation ?? 0);
  const observation = mean(members, (agent) => agent.skills.observation ?? 0);
  const communication = mean(members, (agent) => agent.skills.communication ?? 0);
  const toolUse = mean(members, (agent) => agent.skills.toolUse ?? 0);
  const mobility = mean(members, (agent) => agent.traits.sociality ?? 0);
  const organizationRank = state.organizations
    .filter((organization) => organization.status === "active" && organization.regionId === culture.regionId)
    .reduce((rank, organization) => Math.max(rank, ({ family: 0, clan: 0.15, tribe: 0.25, settlement: 0.45, city: 0.65, state: 0.8, federation: 0.9, empire: 1 } as const)[organization.type]), 0);
  const priorCount = (domain: KnowledgeDomain): number => culture.knowledgeIds
    .filter((knowledgeId) => knowledgeById.get(knowledgeId)?.domain === domain)
    .length;
  const novelty = (domain: KnowledgeDomain): number => priorCount(domain) * 0.12;
  const scores: Array<{ domain: KnowledgeDomain; score: number }> = [
    { domain: "subsistence", score: biomass * 0.32 + nutrients * 0.25 + observation * 0.18 + toolUse * 0.12 + curiosity * 0.13 - novelty("subsistence") },
    { domain: "construction", score: elevation * 0.2 + toolUse * 0.34 + cooperation * 0.18 + organizationRank * 0.28 - novelty("construction") },
    { domain: "navigation", score: water * 0.26 + humidity * 0.12 + mobility * 0.28 + observation * 0.22 + communication * 0.12 - novelty("navigation") },
    { domain: "medicine", score: biomass * 0.2 + organics * 0.2 + observation * 0.3 + curiosity * 0.2 + cooperation * 0.1 - novelty("medicine") },
    { domain: "governance", score: organizationRank * 0.34 + cooperation * 0.28 + communication * 0.25 + curiosity * 0.13 - novelty("governance") },
    { domain: "energy", score: Math.abs(carbon - oxygen) * 0.22 + organics * 0.16 + toolUse * 0.3 + observation * 0.18 + curiosity * 0.14 - novelty("energy") },
  ];
  return scores.sort((left, right) => right.score - left.score || left.domain.localeCompare(right.domain));
};

export type InnovationOutcome = { knowledge: KnowledgeState; event: WorldEventDraft } | undefined;

export const attemptKnowledgeInnovation = (
  state: WorldState,
  culture: CultureState,
  members: AgentState[],
  knowledgeById: ReadonlyMap<string, KnowledgeState>,
): InnovationOutcome => {
  const inheritedKnowledge = culture.knowledgeIds.filter((knowledgeId) => knowledgeById.has(knowledgeId));
  const innovations = inheritedKnowledge.filter((knowledgeId) => knowledgeById.get(knowledgeId)?.domain);
  const curiosity = mean(members, (agent) => agent.traits.curiosity ?? 0);
  const observation = mean(members, (agent) => agent.skills.observation ?? 0);
  const communication = mean(members, (agent) => agent.skills.communication ?? 0);
  if (members.length < 4 || inheritedKnowledge.length < 3 || innovations.length >= 24 || curiosity + observation < 0.55) return undefined;

  const candidate = domainScores(state, culture, members, knowledgeById)[0];
  if (!candidate || candidate.score < 0.16) return undefined;
  const domainLevel = innovations.filter((knowledgeId) => knowledgeById.get(knowledgeId)?.domain === candidate.domain).length + 1;
  if (domainLevel > 6) return undefined;
  const probability = clamp(0.025 + curiosity * 0.055 + observation * 0.06 + communication * 0.025 + candidate.score * 0.035, 0, 0.16);
  const [roll] = randomFloat(forkRandom(state.random, `innovation:${culture.id}:${candidate.domain}:${domainLevel}:${state.tick}`));
  if (roll >= probability) return undefined;

  const sources = [...members]
    .sort((left, right) => ((right.traits.curiosity ?? 0) + (right.skills.observation ?? 0) + (right.skills.toolUse ?? 0))
      - ((left.traits.curiosity ?? 0) + (left.skills.observation ?? 0) + (left.skills.toolUse ?? 0))
      || left.id.localeCompare(right.id))
    .slice(0, 4);
  const parentIds = inheritedKnowledge
    .sort((left, right) => (knowledgeById.get(right)?.credibility ?? 0) - (knowledgeById.get(left)?.credibility ?? 0) || left.localeCompare(right))
    .slice(0, 3);
  const names = domainNames[candidate.domain];
  const nameIndex = hashString(`${state.seed}:${culture.regionId}:${candidate.domain}:${domainLevel}:${parentIds.join(":")}`);
  const baseName = names[nameIndex % names.length] ?? "原创技术";
  const name = domainLevel === 1 ? baseName : `${baseName}·${domainLevel}型`;
  const kind = `innovation:${candidate.domain}:${domainLevel}:${hashString(name).toString(16)}`;
  const base = createKnowledge(culture.regionId, kind, sources);
  const knowledge: KnowledgeState = {
    ...base,
    id: knowledgeIdFor(culture.regionId, kind),
    name,
    domain: candidate.domain,
    originRegionId: culture.regionId,
    originTick: state.tick + 1,
    originYears: Math.floor(state.years) + 1,
    parentIds,
    credibility: clamp(base.credibility * 0.65 + candidate.score * 0.35),
    transmissionCost: clamp(base.transmissionCost + domainLevel * 0.025, 0.06, 0.72),
    forgettingRate: clamp(base.forgettingRate / (1 + domainLevel * 0.12), 0.001, 0.04),
  };
  return {
    knowledge,
    event: {
      kind: "knowledge-innovation",
      ruleId: "culture:autonomous-innovation",
      sourceIds: sources.map((source) => source.id),
      probability,
      roll,
      evidence: {
        regionId: culture.regionId,
        domain: candidate.domain,
        domainScore: candidate.score,
        domainLevel,
        curiosity,
        observation,
        communication,
        priorKnowledge: inheritedKnowledge.length,
      },
      payload: { knowledgeId: knowledge.id, name, domain: candidate.domain, originRegionId: culture.regionId, parentIds },
      source: "natural",
    },
  };
};

type DiffusionRoute = { first: RegionId; second: RegionId; kind: "trade" | "alliance" | "migration" | "war"; strength: number; sourceIds: string[] };

const organizationRegion = (organizations: ReadonlyMap<string, OrganizationState>, id: unknown): RegionId | undefined =>
  typeof id === "string" ? organizations.get(id)?.regionId : undefined;

const routeKey = (first: RegionId, second: RegionId): string => [first, second].sort().join("|");

export const knowledgeDiffusionRoutes = (state: Pick<WorldState, "organizations" | "events" | "tick">): DiffusionRoute[] => {
  const organizations = new Map(state.organizations.map((organization) => [String(organization.id), organization]));
  const routes = new Map<string, DiffusionRoute>();
  const add = (first: RegionId | undefined, second: RegionId | undefined, kind: DiffusionRoute["kind"], strength: number, sourceIds: string[]): void => {
    if (!first || !second || first === second) return;
    const key = routeKey(first, second);
    const existing = routes.get(key);
    if (!existing || strength > existing.strength) routes.set(key, { first, second, kind, strength, sourceIds });
  };
  for (const organization of state.organizations) {
    if (organization.status !== "active") continue;
    for (const [otherId, stance] of Object.entries(organization.diplomacy ?? {})) {
      const other = organizations.get(otherId);
      if (!other || other.status !== "active") continue;
      if (stance === "allied") add(organization.regionId, other.regionId, "alliance", 0.3, [organization.id, other.id]);
      else if (stance === "trade") add(organization.regionId, other.regionId, "trade", 0.24, [organization.id, other.id]);
      else if (stance === "rival") add(organization.regionId, other.regionId, "war", 0.08, [organization.id, other.id]);
    }
  }
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (!event || state.tick - event.tick > 16) break;
    const first = (event.payload.fromRegion ?? event.evidence.fromRegion ?? event.evidence.leftRegion
      ?? organizationRegion(organizations, event.payload.fromOrganizationId ?? event.payload.leftOrganizationId)) as RegionId | undefined;
    const second = (event.payload.toRegion ?? event.evidence.toRegion ?? event.evidence.rightRegion
      ?? organizationRegion(organizations, event.payload.toOrganizationId ?? event.payload.rightOrganizationId)) as RegionId | undefined;
    if (event.kind === "interregional-trade" || event.kind === "diplomatic-alliance") add(first, second, event.kind === "diplomatic-alliance" ? "alliance" : "trade", event.kind === "diplomatic-alliance" ? 0.3 : 0.24, event.sourceIds);
    else if (event.kind === "population-migration" || event.kind === "population-dispersal" || event.kind === "war-displacement") add(first, second, "migration", 0.16, event.sourceIds);
    else if (event.kind === "organization-war" || event.kind === "territory-transfer") add(first, second, "war", 0.08, event.sourceIds);
  }
  return [...routes.values()].sort((left, right) => routeKey(left.first, left.second).localeCompare(routeKey(right.first, right.second)));
};

export type DiffusionOutcome = { destinationCultureId: CultureState["id"]; knowledgeId: string; event: WorldEventDraft };

export const attemptKnowledgeDiffusion = (
  state: WorldState,
  culturesByRegion: ReadonlyMap<string, CultureState>,
  knowledgeById: ReadonlyMap<string, KnowledgeState>,
  route: DiffusionRoute,
): DiffusionOutcome | undefined => {
  const first = culturesByRegion.get(route.first);
  const second = culturesByRegion.get(route.second);
  if (!first || !second) return undefined;
  const firstNovel = first.knowledgeIds.filter((knowledgeId) => !second.knowledgeIds.includes(knowledgeId));
  const secondNovel = second.knowledgeIds.filter((knowledgeId) => !first.knowledgeIds.includes(knowledgeId));
  if (firstNovel.length === 0 && secondNovel.length === 0) return undefined;
  const fromFirst = firstNovel.length > secondNovel.length || (firstNovel.length === secondNovel.length && first.id.localeCompare(second.id) <= 0);
  const source = fromFirst ? first : second;
  const destination = fromFirst ? second : first;
  const candidates = (fromFirst ? firstNovel : secondNovel)
    .map((knowledgeId) => knowledgeById.get(knowledgeId))
    .filter((knowledge): knowledge is KnowledgeState => Boolean(knowledge))
    .sort((left, right) => Number(Boolean(right.domain)) - Number(Boolean(left.domain)) || right.credibility - left.credibility || left.id.localeCompare(right.id));
  const knowledge = candidates[0];
  if (!knowledge) return undefined;
  const compatibility = culturalCompatibility(cultureIdentityFor(source), cultureIdentityFor(destination));
  const probability = clamp(route.strength * compatibility * (1 - knowledge.transmissionCost * 0.55) * (0.65 + destination.transmissionRate * 0.35), 0.01, 0.32);
  const [roll] = randomFloat(forkRandom(state.random, `knowledge-diffusion:${source.id}:${destination.id}:${knowledge.id}:${state.tick}`));
  if (roll >= probability) return undefined;
  return {
    destinationCultureId: destination.id,
    knowledgeId: knowledge.id,
    event: {
      kind: "knowledge-diffusion",
      ruleId: "culture:cross-region-diffusion",
      sourceIds: [...new Set([...route.sourceIds, ...knowledge.sourceIds])].sort(),
      probability,
      roll,
      evidence: { fromRegion: source.regionId, toRegion: destination.regionId, route: route.kind, routeStrength: route.strength, culturalCompatibility: compatibility, credibility: knowledge.credibility, transmissionCost: knowledge.transmissionCost },
      payload: { knowledgeId: knowledge.id, name: knowledge.name ?? knowledge.kind, domain: knowledge.domain ?? "practice", fromRegion: source.regionId, toRegion: destination.regionId, route: route.kind, culturalCompatibility: compatibility, originRegionId: knowledge.originRegionId ?? source.regionId },
      source: "natural",
    },
  };
};
