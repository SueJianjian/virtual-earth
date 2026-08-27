import type { CultureState, KnowledgeDomain, KnowledgeState, WorldState } from "../types.ts";

export const MAX_KNOWLEDGE_RECORDS = 2_048;
export const MAX_KNOWLEDGE_PER_CULTURE = 48;
export const MAX_KNOWLEDGE_PER_AGENT = 64;
export const MAX_CULTURE_RECORDS = 512;
export const MAX_BELIEFS_PER_CULTURE = 64;

const domains: KnowledgeDomain[] = ["subsistence", "construction", "navigation", "medicine", "governance", "energy"];

const compareKnowledge = (left: KnowledgeState, right: KnowledgeState): number =>
  Number(Boolean(right.domain)) - Number(Boolean(left.domain))
  || (right.originYears ?? -1) - (left.originYears ?? -1)
  || right.credibility - left.credibility
  || left.id.localeCompare(right.id);

const retainedIdsForHolder = (
  ids: readonly string[],
  knowledgeById: ReadonlyMap<string, KnowledgeState>,
  limit: number,
): string[] => {
  const records = [...new Set(ids)]
    .map((id) => knowledgeById.get(id))
    .filter((knowledge): knowledge is KnowledgeState => Boolean(knowledge))
    .sort(compareKnowledge);
  if (records.length <= limit) return records.map((knowledge) => knowledge.id).sort();
  const retained = new Set<string>();
  for (const domain of domains) {
    for (const knowledge of records.filter((candidate) => candidate.domain === domain).slice(0, 6)) retained.add(knowledge.id);
  }
  for (const knowledge of records) {
    if (retained.size >= limit) break;
    retained.add(knowledge.id);
  }
  return [...retained].sort();
};

const beliefIdsForCulture = (
  ids: readonly string[],
  phenomenaById: ReadonlyMap<string, { originTick: number }>,
): string[] => [...new Set(ids)]
  .sort((left, right) => {
    const leftPhenomenon = left.startsWith("belief:") ? phenomenaById.get(left.slice("belief:".length)) : undefined;
    const rightPhenomenon = right.startsWith("belief:") ? phenomenaById.get(right.slice("belief:".length)) : undefined;
    return Number(Boolean(rightPhenomenon)) - Number(Boolean(leftPhenomenon))
      || (rightPhenomenon?.originTick ?? -1) - (leftPhenomenon?.originTick ?? -1)
      || left.localeCompare(right);
  })
  .slice(0, MAX_BELIEFS_PER_CULTURE);

export const compactCultureRecords = (state: WorldState): number => {
  const phenomenaById = new Map(state.worldview.phenomena.map((phenomenon) => [phenomenon.id, phenomenon]));
  for (const culture of state.cultures) {
    const beliefIds = beliefIdsForCulture(culture.beliefIds, phenomenaById);
    if (beliefIds.length !== culture.beliefIds.length || beliefIds.some((id, index) => id !== culture.beliefIds[index])) {
      culture.beliefIds = beliefIds;
    }
  }
  if (state.cultures.length <= MAX_CULTURE_RECORDS) return 0;

  const agentCountsByRegion = new Map<string, number>();
  for (const agent of state.agents) agentCountsByRegion.set(agent.regionId, (agentCountsByRegion.get(agent.regionId) ?? 0) + 1);
  const activeOrganizationRegions = new Set(state.organizations
    .filter((organization) => organization.status === "active")
    .map((organization) => organization.regionId));
  const summarizedRegions = new Set(state.lod.summaries
    .filter((summary) => summary.population > 0 || summary.organizations.length > 0)
    .map((summary) => summary.regionId));
  const ordered = [...state.cultures].sort((left, right) => {
    const activity = (culture: CultureState): number =>
      (agentCountsByRegion.get(culture.regionId) ?? 0) * 8
      + Number(activeOrganizationRegions.has(culture.regionId)) * 4
      + Number(summarizedRegions.has(culture.regionId)) * 2
      + Math.min(1, culture.knowledgeIds.length) + Math.min(1, culture.beliefIds.length);
    return activity(right) - activity(left)
      || (right.identity?.originTick ?? -1) - (left.identity?.originTick ?? -1)
      || left.id.localeCompare(right.id);
  });
  const retainedIds = new Set(ordered.slice(0, MAX_CULTURE_RECORDS).map((culture) => culture.id));
  const removed = state.cultures.length - retainedIds.size;
  state.cultures = state.cultures.filter((culture) => retainedIds.has(culture.id));
  state.eventArchive.archivedCultureCount += removed;
  return removed;
};

export const compactKnowledgeRecords = (state: WorldState): number => {
  const knowledgeById = new Map(state.knowledge.map((knowledge) => [knowledge.id, knowledge]));
  const holderListsAreValid = state.cultures.every((culture) => culture.knowledgeIds.length <= MAX_KNOWLEDGE_PER_CULTURE
      && culture.knowledgeIds.every((id) => knowledgeById.has(id)))
    && state.agents.every((agent) => agent.knowledgeIds.length <= MAX_KNOWLEDGE_PER_AGENT
      && agent.knowledgeIds.every((id) => knowledgeById.has(id)));
  if (state.knowledge.length <= MAX_KNOWLEDGE_RECORDS && holderListsAreValid) return 0;

  for (const culture of state.cultures) {
    culture.knowledgeIds = retainedIdsForHolder(culture.knowledgeIds, knowledgeById, MAX_KNOWLEDGE_PER_CULTURE);
  }
  for (const agent of state.agents) {
    agent.knowledgeIds = retainedIdsForHolder(agent.knowledgeIds, knowledgeById, MAX_KNOWLEDGE_PER_AGENT);
  }
  if (state.knowledge.length <= MAX_KNOWLEDGE_RECORDS) return 0;

  const referenceCounts = new Map<string, number>();
  for (const ids of [...state.cultures.map((culture) => culture.knowledgeIds), ...state.agents.map((agent) => agent.knowledgeIds)]) {
    for (const id of ids) referenceCounts.set(id, (referenceCounts.get(id) ?? 0) + 1);
  }
  const retained = new Set<string>();
  const activeAgentsByRegion = new Map<string, number>();
  for (const agent of state.agents) activeAgentsByRegion.set(agent.regionId, (activeAgentsByRegion.get(agent.regionId) ?? 0) + 1);
  const cultures = [...state.cultures].sort((left, right) =>
    (activeAgentsByRegion.get(right.regionId) ?? 0) - (activeAgentsByRegion.get(left.regionId) ?? 0)
    || left.id.localeCompare(right.id));
  for (const culture of cultures) {
    const records = culture.knowledgeIds.map((id) => knowledgeById.get(id)).filter((knowledge): knowledge is KnowledgeState => Boolean(knowledge));
    for (const domain of domains) {
      const representative = records.filter((knowledge) => knowledge.domain === domain).sort(compareKnowledge)[0];
      if (representative && retained.size < MAX_KNOWLEDGE_RECORDS) retained.add(representative.id);
    }
    const practice = records.filter((knowledge) => !knowledge.domain).sort(compareKnowledge)[0];
    if (practice && retained.size < MAX_KNOWLEDGE_RECORDS) retained.add(practice.id);
  }
  const candidates = [...state.knowledge].sort((left, right) =>
    (referenceCounts.get(right.id) ?? 0) - (referenceCounts.get(left.id) ?? 0)
    || compareKnowledge(left, right));
  for (const knowledge of candidates) {
    if (retained.size >= MAX_KNOWLEDGE_RECORDS) break;
    retained.add(knowledge.id);
  }

  const previousIds = new Set(state.knowledge.map((knowledge) => knowledge.id));
  state.knowledge = state.knowledge
    .filter((knowledge) => retained.has(knowledge.id))
    .map((knowledge) => ({
      ...knowledge,
      ...(knowledge.parentIds ? { parentIds: knowledge.parentIds.filter((id) => retained.has(id)) } : {}),
    }));
  for (const culture of state.cultures) culture.knowledgeIds = culture.knowledgeIds.filter((id) => retained.has(id));
  for (const agent of state.agents) {
    agent.knowledgeIds = agent.knowledgeIds.filter((id) => retained.has(id));
    agent.memoryIds = agent.memoryIds.filter((id) => !previousIds.has(id) || retained.has(id));
  }
  for (const summary of state.lod.summaries) {
    for (const agent of summary.agentRecords) agent.knowledgeIds = agent.knowledgeIds.filter((id) => retained.has(id));
  }
  const removed = previousIds.size - state.knowledge.length;
  state.eventArchive.archivedKnowledgeCount += removed;
  return removed;
};
