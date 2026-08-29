import type { CellSelection } from "./map-canvas.ts";
import { summarizeLineage } from "../sim/lod/lineage.ts";
import type { AgentState, AggregateKnowledgeSummary, ArchivedOrganizationSummary, ArchivedSpeciesSummary, CultureIdentity, EcologicalRelationshipKind, EcologicalRelationshipState, EventMilestone, FacilityState, FamilyLineageSummary, KnowledgeDomain, KnowledgeState, OrganizationState, OrganizationType, PathogenState, RegionCultureSummary, RegionId, RegionLineageSummary, RegionSocietySummary, SpeciesBlueprint, SpeciesState, StrategicRouteSummary, SubstanceState, WorldviewEntityState, WorldviewInteractionState } from "../sim/types.ts";
import { governanceForOrganization } from "../sim/society/organization.ts";
import { speciesBlueprintFor } from "../sim/ecology/blueprints.ts";
import { facilityOperationalEffect, facilityWorkforceRequiredFor } from "../sim/society/facilities.ts";
import { technologyProfileForRegion } from "../sim/culture/technology.ts";
import type { OrganizationDirectoryEntry, RecentRegionEvent, WorldSnapshot } from "../worker/protocol.ts";
import { formatElevation, formatIndex, formatModelTemperature, formatNumber, formatPercent, formatRegionCoordinates, formatResource, formatSimulationAge, formatSimulationAgeFromDays, type FormattedMetric } from "./formatters.ts";
import { pathogenOutbreakForRegion, pathogenPrevalenceForRegion } from "../sim/health/disease.ts";
import { geneticEnvironmentFitness, HERITABLE_AGENT_TRAITS } from "../sim/agents/genetics.ts";
import { substanceReserveRatio } from "../sim/environment/substances.ts";
import { seasonalTemperatureOffset } from "../sim/environment/orbit.ts";
import { compareSimulationSteps } from "../sim/time.ts";

const format = (value: number): string => formatNumber(value);
const worldviewInteractionLocation = (interaction: WorldviewInteractionState): string => interaction.targetRegionId
  ? `${interaction.regionId} -> ${interaction.targetRegionId}`
  : interaction.regionId;
const worldviewInteractionEffect = (interaction: WorldviewInteractionState): string => [
  interaction.transmittedBeliefId ? "形成接收地信仰" : "",
  interaction.transmittedPracticeId ? "建立跨区修行传承" : "",
  interaction.governanceEffect === "stabilizing" ? "治理趋稳" : interaction.governanceEffect === "destabilizing" ? "治理承压" : interaction.governanceEffect === "integrating" ? "治理整合" : "",
].filter(Boolean).join(" · ") || "仅记录体系接触";
const relationshipLabels: Array<[keyof RegionLineageSummary["relationshipCounts"], string]> = [
  ["partner", "伴侣"],
  ["parent", "亲子"],
  ["caregiver", "照护"],
  ["sibling", "同胞"],
];
const organizationLabels: Record<OrganizationType, string> = {
  family: "家庭",
  clan: "氏族",
  tribe: "部落",
  settlement: "聚落",
  city: "城市",
  state: "国家",
  federation: "联盟",
  empire: "帝国",
};
const speciesRoleLabels = { producer: "生产者", consumer: "消费者", decomposer: "分解者" } as const;
const lifeBiochemistryLabels: Record<SpeciesBlueprint["biochemistry"], string> = {
  "carbon-nitrogen": "碳氮有机基",
  "phosphorus-lattice": "磷晶格基",
  "silicate-organic": "硅氧有机基",
  "metal-organic": "金属有机基",
  "crystal-colloid": "晶体胶态基",
};
const geneticCarrierLabels: Record<SpeciesBlueprint["geneticCarrier"], string> = {
  "double-ribbon": "双链带状载体",
  "triple-ribbon": "三链带状载体",
  "branched-polymer": "分枝聚合载体",
  "vesicle-lattice": "囊泡晶格载体",
  "mineral-template": "矿物模板载体",
};
const cellArchitectureLabels: Record<SpeciesBlueprint["cellArchitecture"], string> = {
  "membrane-cell": "膜性细胞",
  "porous-cell": "多孔细胞",
  "syncytial-web": "合胞网络",
  "crystal-cell": "晶格细胞",
  "modular-colony": "模块群体",
};
const metabolismLabels: Record<SpeciesBlueprint["metabolism"], string> = {
  "radiant-harvesting": "辐射采集",
  "mineral-chemosynthesis": "矿物化能合成",
  "thermal-gradient": "热差代谢",
  "ingestive-predation": "摄食捕食",
  "osmotic-parasitism": "渗透寄生",
  "symbiotic-exchange": "共生交换",
  "detrital-catalysis": "腐屑催化",
  "mineral-recycling": "矿物循环",
  "anaerobic-fermentation": "厌氧发酵",
};
const bodyStructureLabels: Record<SpeciesBlueprint["bodyPlan"]["structure"], string> = {
  membrane: "膜囊体",
  segmented: "节段体",
  shell: "壳体",
  filament: "丝状体",
  network: "网状体",
};
const bodySymmetryLabels: Record<SpeciesBlueprint["bodyPlan"]["symmetry"], string> = {
  bilateral: "两侧对称",
  radial: "辐射对称",
  spiral: "螺旋对称",
  fractal: "分形对称",
  asymmetric: "非对称",
};
const locomotionLabels: Record<SpeciesBlueprint["bodyPlan"]["locomotion"], string> = {
  rooted: "固着",
  gliding: "滑翔",
  contractile: "收缩爬行",
  ciliary: "纤毛推进",
  jet: "喷射推进",
  drifting: "漂游",
};
const sensoryLabels: Record<SpeciesBlueprint["senses"][number], string> = {
  "chemical-gradient": "化学梯度",
  "thermal-field": "热场",
  "polarized-light": "偏振光",
  vibration: "振动",
  "electric-field": "电场",
  "pressure-wave": "压力波",
};
const reproductionLabels: Record<SpeciesBlueprint["reproduction"], string> = {
  fission: "分裂繁殖",
  budding: "出芽繁殖",
  "spore-cycle": "孢子循环",
  "paired-fusion": "配对融合",
  "brood-pod": "育囊繁殖",
  "colony-fragmentation": "群体分片",
};
const epistemicLabels = {
  observed: "已观测",
  hypothesized: "文明理论",
  believed: "神话信仰",
  verified: "已验证",
} as const;
const worldviewEntityLabels = { deity: "神话实体", sect: "研修流派", "cultivation-path": "修行路径" } as const;
const worldviewInteractionLabels: Record<WorldviewInteractionState["kind"], string> = { propagation: "跨体系传播", conflict: "体系冲突", fusion: "传统融合" };
const worldviewInteractionStatusLabels: Record<WorldviewInteractionState["status"], string> = { active: "持续接触", dormant: "接触沉寂", resolved: "融合完成" };
const substanceKindLabels: Record<SubstanceState["kind"], string> = {
  mineral: "原创矿物",
  crystal: "原创晶体",
  "organic-compound": "原创有机化合物",
  "engineered-composite": "文明复合材料",
};
const substanceFormationLabels: Record<SubstanceState["formation"], string> = {
  geological: "地质结晶",
  hydrothermal: "水热形成",
  biochemical: "生化聚合",
  engineered: "文明工程",
};
const pathogenKindLabels: Record<PathogenState["kind"], string> = {
  "virus-like": "类病毒体",
  "bacterial-colony": "菌落体",
  "fungal-spore": "孢子体",
  "parasitic-cell": "寄生细胞",
};
const pathogenStatusLabels: Record<PathogenState["status"], string> = {
  outbreak: "区域暴发",
  endemic: "地方流行",
  dormant: "传播沉寂",
};
const ecologicalRelationshipLabels: Record<EcologicalRelationshipKind, string> = {
  predation: "捕食",
  competition: "竞争",
  mutualism: "共生",
  parasitism: "寄生",
};
const cultureLanguageLabels: Record<CultureIdentity["languageFamily"], string> = {
  "pulse-tonal": "脉冲声调语系",
  "scent-glyph": "气味符号语系",
  "gesture-lattice": "手势格网语系",
  "resonant-vowel": "共鸣元音语系",
  "light-pattern": "光纹语系",
};
const cultureCommunicationLabels: Record<CultureIdentity["communicationStyle"], string> = {
  consensus: "共识协商",
  council: "议会决策",
  lineage: "谱系传递",
  merit: "功绩评议",
  ritual: "仪式见证",
};
const cultureValueLabels: Array<[keyof CultureIdentity["values"], string]> = [
  ["cooperation", "合作"],
  ["reciprocity", "互惠"],
  ["hierarchy", "层级"],
  ["curiosity", "好奇"],
  ["tradition", "传统"],
  ["stewardship", "环境守护"],
];
type DetailLevel = "region" | "substance" | "pathogen" | "species" | "population" | "agent" | "culture" | "facility" | "worldview" | OrganizationType;
const detailLevels: DetailLevel[] = ["region", "substance", "pathogen", "species", "population", "agent", "culture", "family", "clan", "tribe", "settlement", "city", "state", "federation", "empire", "facility", "worldview"];
export type InspectorDetail = { level: DetailLevel; id?: string };
const isOrganizationDetailLevel = (level: DetailLevel): level is OrganizationType => ["family", "clan", "tribe", "settlement", "city", "state", "federation", "empire"].includes(level);

const detailLevelLabel = (level: DetailLevel): string => {
  if (level === "region") return "区域";
  if (level === "substance") return "物质";
  if (level === "pathogen") return "病原体";
  if (level === "species") return "物种";
  if (level === "population") return "种群";
  if (level === "agent") return "个人";
  if (level === "culture") return "文化";
  if (level === "facility") return "设施";
  if (level === "worldview") return "流派";
  return organizationLabels[level];
};

type SpeciesRecord = SpeciesState | ArchivedSpeciesSummary;
const allSpeciesForSnapshot = (snapshot: WorldSnapshot): SpeciesRecord[] => [
  ...(snapshot.species ?? []),
  ...(snapshot.eventArchive?.archivedSpeciesSummaries ?? []),
];
const speciesName = (species: SpeciesRecord): string => species.name ?? species.id.slice(-8);
const isArchivedSpecies = (species: SpeciesRecord): species is ArchivedSpeciesSummary => "archivedTick" in species;

type OrganizationDetail = OrganizationState | OrganizationDirectoryEntry | ArchivedOrganizationSummary;
const organizationMemberIds = (organization: OrganizationDetail): string[] => organization.memberIds ?? [];
const organizationChildIds = (organization: OrganizationDetail): string[] => "childIds" in organization ? organization.childIds : organization.childOrganizationIds;
const isArchivedOrganization = (organization: OrganizationDetail): organization is ArchivedOrganizationSummary => "archiveReason" in organization;
const allOrganizationDetails = (snapshot: WorldSnapshot): OrganizationDetail[] => {
  const selectedRegion = snapshot.selectedRegion;
  const byId = new Map<string, OrganizationDetail>();
  for (const organization of snapshot.projection?.organizations ?? []) byId.set(organization.id, organization);
  for (const organization of snapshot.organizationDirectory ?? []) if (!byId.has(organization.id)) byId.set(organization.id, organization);
  if (selectedRegion) {
    for (const organization of selectedRegion.organizations) if (!byId.has(organization.id)) {
      byId.set(organization.id, {
        id: organization.id,
        type: organization.type,
        regionId: selectedRegion.regionId,
        memberCount: organization.memberCount,
        memberIds: [...organization.memberIds],
        childIds: [...organization.childIds],
        resourceIds: [...organization.resourceIds],
        historyCount: organization.historyIds.length,
        archivedHistoryCount: organization.archivedHistoryCount ?? 0,
        relationshipCount: 0,
        territoryRegionIds: [...organization.territoryRegionIds],
        ...(organization.governance ? { governance: { ...organization.governance } } : {}),
        ...(organization.diplomacy ? { diplomacy: { ...organization.diplomacy } } : {}),
      });
    }
  }
  for (const organization of snapshot.eventArchive?.archivedOrganizationSummaries ?? []) {
    if (!byId.has(organization.id)) byId.set(organization.id, organization);
  }
  return [...byId.values()];
};
const organizationDetailTargets = (snapshot: WorldSnapshot): OrganizationDetail[] => {
  const byId = new Map(allOrganizationDetails(snapshot).map((organization) => [organization.id, organization]));
  const focusRegionId = snapshot.focusRegionId;
  return [...byId.values()].filter((organization) => !focusRegionId || organization.regionId === focusRegionId || organization.territoryRegionIds.includes(focusRegionId));
};
const organizationForSnapshot = (snapshot: WorldSnapshot, id: string): OrganizationDetail | undefined =>
  allOrganizationDetails(snapshot).find((organization) => organization.id === id);
const organizationParentForSnapshot = (snapshot: WorldSnapshot, id: string): OrganizationDetail | undefined =>
  allOrganizationDetails(snapshot).find((organization) => organizationChildIds(organization).includes(id));
const resourcesForOrganization = (snapshot: WorldSnapshot, organizationId: string): NonNullable<WorldSnapshot["resources"]> => {
  const resources = snapshot.resources ?? snapshot.selectedRegion?.resources ?? [];
  return resources.filter((resource) => resource.holderId === organizationId);
};
const resourceBalancesForOrganization = (snapshot: WorldSnapshot, organization: OrganizationDetail): Record<string, number> => {
  const balances: Record<string, number> = {};
  for (const resource of resourcesForOrganization(snapshot, organization.id)) balances[resource.resourceId] = (balances[resource.resourceId] ?? 0) + resource.amount;
  if (isArchivedOrganization(organization)) {
    for (const [resourceId, amount] of Object.entries(organization.resources)) balances[resourceId] = Math.max(balances[resourceId] ?? 0, amount);
  }
  return balances;
};
const knowledgeForRegions = (snapshot: WorldSnapshot, regionIds: readonly RegionId[]): KnowledgeState[] => {
  const regions = new Set(regionIds);
  const ids = (snapshot.cultures ?? []).filter((culture) => regions.has(culture.regionId)).flatMap((culture) => culture.knowledgeIds);
  return knowledgeForIds(snapshot, ids);
};
const technologyForOrganization = (snapshot: WorldSnapshot, organization: OrganizationDetail) => {
  const regions = new Set<RegionId>([organization.regionId, ...organization.territoryRegionIds]);
  const profile = { ...technologyProfileForRegion({ cultures: snapshot.cultures ?? [], knowledge: snapshot.knowledge ?? [] }, organization.regionId) };
  for (const regionId of regions) {
    const regional = technologyProfileForRegion({ cultures: snapshot.cultures ?? [], knowledge: snapshot.knowledge ?? [] }, regionId);
    for (const domain of Object.keys(profile) as KnowledgeDomain[]) profile[domain] = Math.max(profile[domain], regional[domain]);
  }
  return profile;
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
const regionEventLabels: Record<string, string> = {
  volcano: "火山喷发",
  earthquake: "构造地震",
  drought: "区域干旱",
  flood: "区域洪水",
  "population-migration": "人口迁徙",
  "population-dispersal": "种群扩散",
  "organization-migration": "组织迁徙",
  "organization-formation": "组织形成",
  "organization-split": "组织分裂",
  "interregional-trade": "区域贸易",
  "organization-trade": "组织贸易",
  "border-conflict": "边境冲突",
  "organization-war": "跨区域战争",
  "territory-expansion": "疆域扩张",
  "territory-transfer": "领土转移",
  "war-displacement": "战争迁徙",
  "diplomatic-alliance": "跨区域联盟",
  "knowledge-innovation": "自主技术诞生",
  "knowledge-diffusion": "知识跨区域传播",
  "culture-emergence": "文化形成",
  "culture-evolution": "文化演化",
  "aggregate-culture-innovation": "聚合文化创新",
  "aggregate-belief-emergence": "聚合信念形成",
  "aggregate-organization-formation": "聚合组织形成",
  "aggregate-organization-dissolution": "聚合组织解体",
  "species-emergence": "物种出现",
  "species-divergence": "物种分化",
  "agent-birth": "个体出生",
  "genetic-mutation": "遗传变异出现",
  "pathogen-emergence": "病原体出现",
  "disease-outbreak": "区域疫情暴发",
  "disease-contained": "区域疫情受控",
  "disease-regional-spread": "疫情跨区域传播",
};
const geneticTraitLabels: Record<typeof HERITABLE_AGENT_TRAITS[number], string> = {
  cognitivePotential: "认知潜力",
  sociality: "社会性",
  cooperation: "合作性",
  curiosity: "好奇心",
  fertility: "繁殖力",
  metabolicEfficiency: "代谢效率",
  thermalTolerance: "温度耐受",
  hydrationRetention: "保水能力",
  diseaseResistance: "抗病性",
};
const regionEventContext = (event: RecentRegionEvent): string => {
  const parts: string[] = [];
  if (event.name) parts.push(event.name);
  if (event.intensity !== undefined) parts.push(`强度 ${formatPercent(event.intensity).value}%`);
  if (event.resourceId) parts.push(`${event.resourceId} ${event.amount === undefined ? "" : `${formatNumber(event.amount, 2)} 单位`}`.trim());
  if (event.result) parts.push(`结果 ${event.result}`);
  if (event.route) parts.push(`路径 ${event.route}`);
  if (event.destinationRegionId) parts.push(`前往 ${event.destinationRegionId}`);
  return parts.length > 0 ? parts.map(escapeHtml).join(" · ") : "未记录额外结果";
};
const regionalHistoryReport = (snapshot: WorldSnapshot, organizationId?: string): string => {
  const events = (snapshot.recentRegionEvents ?? []).filter((event) => !organizationId || event.organizationIds.includes(organizationId));
  const summaryOrganization = organizationId ? snapshot.selectedRegion?.organizations.find((organization) => organization.id === organizationId) : undefined;
  const directoryOrganization = organizationId ? snapshot.organizationDirectory?.find((organization) => organization.id === organizationId) : undefined;
  const archivedOrganization = organizationId ? snapshot.eventArchive?.archivedOrganizationSummaries.find((organization) => organization.id === organizationId) : undefined;
  const archiveCount = organizationId
    ? Math.max(0, summaryOrganization?.archivedHistoryCount ?? 0, directoryOrganization?.archivedHistoryCount ?? 0, archivedOrganization?.historyCount ?? 0)
    : Math.max(0, snapshot.selectedRegion?.archivedHistoryCount ?? 0);
  const scope = organizationId ? "该组织在当前区域内" : "当前区域";
  return `<section class="worldview-records regional-history" aria-label="区域因果历史"><div class="worldview-heading"><strong>区域因果历史</strong><span>${scope}最近 ${format(events.length)} 条${archiveCount > 0 ? `，另有 ${format(archiveCount)} 条已归档` : ""}</span></div><ol class="worldview-list">${events.length > 0 ? events.map((event) => `<li data-event-kind="${escapeHtml(event.kind)}"><div><span>${escapeHtml(regionEventLabels[event.kind] ?? event.kind)}</span><small>${event.timelineDays === undefined ? formatSimulationAge(event.years ?? event.tick) : formatSimulationAgeFromDays(event.timelineDays)} · ${event.archived ? "历史档案" : "近期账本"}</small></div><strong>${regionEventContext(event)}</strong><p>${event.source === "user" ? "用户事件" : "自然演化"} · 规则 ${escapeHtml(event.ruleId)} · 触发概率 ${formatPercent(event.probability).value}%</p>${historyRelatedLinks(snapshot, event)}</li>`).join("") : `<li class="worldview-empty">${archiveCount > 0 ? "近期事件已归档；当前保留账本中没有该范围的可读记录" : "尚未形成可追溯事件"}</li>`}</ol></section>`;
};
type InspectorHistoryEvent = RecentRegionEvent | EventMilestone;
const historyEventIds = (event: InspectorHistoryEvent): string[] => {
  const ids = new Set<string>([
    ...event.sourceIds,
    ...event.organizationIds,
    ...("relatedIds" in event ? event.relatedIds ?? [] : []),
  ]);
  if ("details" in event) {
    for (const value of Object.values(event.details)) if (typeof value === "string") ids.add(value);
  }
  return [...ids];
};
const historyEventValue = (event: InspectorHistoryEvent, key: string): string | number | boolean | undefined => {
  if ("details" in event) {
    const value = event.details[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
  }
  const value = event[key as keyof RecentRegionEvent];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
};
const historyEventContext = (event: InspectorHistoryEvent): string => {
  const parts: string[] = [];
  const name = historyEventValue(event, "name");
  const intensity = historyEventValue(event, "intensity");
  const resourceId = historyEventValue(event, "resourceId");
  const amount = historyEventValue(event, "amount");
  const result = historyEventValue(event, "result") ?? historyEventValue(event, "outcome");
  const route = historyEventValue(event, "route");
  const destinationRegionId = historyEventValue(event, "toRegion") ?? historyEventValue(event, "destinationRegionId");
  if (typeof name === "string") parts.push(name);
  if (typeof intensity === "number") parts.push(`强度 ${formatPercent(intensity).value}%`);
  if (typeof resourceId === "string") parts.push(`${resourceId}${typeof amount === "number" ? ` ${formatNumber(amount, 2)} 单位` : ""}`);
  if (typeof result === "string") parts.push(`结果 ${result}`);
  if (typeof route === "string") parts.push(`路径 ${route}`);
  if (typeof destinationRegionId === "string") parts.push(`前往 ${destinationRegionId}`);
  if (parts.length === 0 && "details" in event) {
    for (const [key, value] of Object.entries(event.details).slice(0, 3)) parts.push(`${key} ${String(value)}`);
  }
  return parts.length > 0 ? parts.map(escapeHtml).join(" · ") : "未记录额外结果";
};
const detailHistoryIds = (snapshot: WorldSnapshot, detail: InspectorDetail): string[] => {
  if (!detail.id) return [];
  const detailId = detail.id;
  const ids = new Set<string>([detailId]);
  if (detail.level === "agent") {
    const agent = snapshot.projection?.agents.find((candidate) => candidate.id === detailId);
    if (agent?.sourceId) ids.add(agent.sourceId);
    const family = snapshot.projection?.organizations.find((organization) => organization.type === "family" && organization.memberIds.includes(detailId as AgentState["id"]));
    if (family) ids.add(family.id);
  } else if (detail.level === "population") {
    const population = snapshot.populations?.find((candidate) => candidate.id === detailId);
    if (population) ids.add(population.speciesId);
  } else if (detail.level === "species") {
    for (const population of snapshot.populations ?? []) if (population.speciesId === detailId) ids.add(population.id);
  } else if (detail.level === "worldview") {
    const entity = snapshot.worldviewEntities?.find((candidate) => candidate.id === detailId);
    if (entity?.sourcePhenomenonId) ids.add(entity.sourcePhenomenonId);
  }
  return [...ids];
};
const objectHistoryReport = (snapshot: WorldSnapshot, detail: InspectorDetail): string => {
  if (detail.level === "region" || !detail.id) return "";
  const targetIds = new Set(detailHistoryIds(snapshot, detail));
  const events = new Map<string, { event: InspectorHistoryEvent; archived: boolean }>();
  for (const event of snapshot.eventArchive?.milestones ?? []) {
    if (historyEventIds(event).some((id) => targetIds.has(id))) events.set(event.id, { event, archived: true });
  }
  for (const event of snapshot.recentRegionEvents ?? []) {
    if (historyEventIds(event).some((id) => targetIds.has(id))) events.set(event.id, { event, archived: event.archived ?? false });
  }
  const ordered = [...events.values()]
    .sort((left, right) => compareSimulationSteps(right.event.timelineStep ?? String(right.event.tick), left.event.timelineStep ?? String(left.event.tick)) || right.event.id.localeCompare(left.event.id))
    .slice(0, 24);
  const label = detailLevelLabel(detail.level);
  return `<section class="worldview-records entity-history" data-history-level="${detail.level}" data-history-id="${escapeHtml(detail.id)}" aria-label="对象演化时间轴"><div class="worldview-heading"><strong>对象演化时间轴</strong><span>${escapeHtml(label)} ${escapeHtml(detail.id.slice(-12))} · 显示 ${format(ordered.length)} 条关联记录</span></div><ol class="worldview-list">${ordered.length > 0 ? ordered.map(({ event, archived }) => `<li data-event-kind="${escapeHtml(event.kind)}"><div><span>${escapeHtml(regionEventLabels[event.kind] ?? event.kind)}</span><small>${event.timelineDays === undefined ? formatSimulationAge(event.years ?? event.tick) : formatSimulationAgeFromDays(event.timelineDays)} · ${archived ? "历史档案" : "近期账本"}</small></div><strong>${historyEventContext(event)}</strong><p>${event.source === "user" ? "用户事件" : "自然演化"} · 规则 ${escapeHtml(event.ruleId)} · 关联 ${format(historyEventIds(event).filter((id) => targetIds.has(id)).length)} 个对象</p>${historyRelatedLinks(snapshot, event, targetIds)}</li>`).join("") : "<li class=\"worldview-empty\">尚未形成该对象的可追溯演化记录</li>"}</ol></section>`;
};
const organizationName = (organization: { id: string; type: OrganizationType }): string => `${organizationLabels[organization.type]} · ${organization.id.slice(-8)}`;
const detailLink = (level: DetailLevel, id: string, label: string, regionId?: RegionId): string => `<button type="button" class="detail-link" data-detail-link data-detail-level="${level}" data-detail-id="${escapeHtml(id)}"${regionId ? ` data-detail-region="${escapeHtml(regionId)}"` : ""}>${escapeHtml(label)}</button>`;
type HistoryTarget = { level: DetailLevel; id: string; label: string; regionId?: RegionId };
const historyTargetFor = (snapshot: WorldSnapshot, id: string): HistoryTarget | undefined => {
  if (id.startsWith("agent:")) {
    const agent = snapshot.projection?.agents.find((candidate) => candidate.id === id);
    return agent ? { level: "agent", id, label: `个体 · ${id.slice(-8)} · ${format(agent.age)} 岁`, regionId: agent.regionId } : undefined;
  }
  if (id.startsWith("population:")) {
    const population = snapshot.populations?.find((candidate) => candidate.id === id);
    if (!population) return undefined;
    const species = allSpeciesForSnapshot(snapshot).find((candidate) => candidate.id === population.speciesId);
    return { level: "population", id, label: `种群 · ${species ? speciesName(species) : id.slice(-8)}`, regionId: population.regionId };
  }
  if (id.startsWith("species:")) {
    const species = allSpeciesForSnapshot(snapshot).find((candidate) => candidate.id === id);
    return species
      ? { level: "species", id, label: `物种 · ${speciesName(species)}`, ...(species.originRegionId ? { regionId: species.originRegionId } : {}) }
      : undefined;
  }
  if (id.startsWith("culture:")) {
    const culture = (snapshot.cultures ?? []).find((candidate) => candidate.id === id);
    if (!culture) return undefined;
    return { level: "culture", id, label: `文化 · ${snapshot.cultureIdentityByRegion?.[culture.regionId]?.name ?? id.slice(-8)}`, regionId: culture.regionId };
  }
  if (id.startsWith("facility:")) {
    const facility = (snapshot.facilities ?? []).find((candidate) => candidate.id === id);
    return facility ? { level: "facility", id, label: `设施 · ${knowledgeDomainLabels[facility.type]} · ${id.slice(-8)}`, regionId: facility.regionId } : undefined;
  }
  if (id.startsWith("substance:")) {
    const substance = (snapshot.substances ?? []).find((candidate) => candidate.id === id);
    return substance ? { level: "substance", id, label: `物质 · ${substance.name}`, regionId: substance.regionId } : undefined;
  }
  if (id.startsWith("pathogen:")) {
    const pathogen = (snapshot.pathogens ?? []).find((candidate) => candidate.id === id);
    return pathogen ? { level: "pathogen", id, label: `病原体 · ${pathogen.name}`, regionId: pathogen.regionId } : undefined;
  }
  if (id.startsWith("worldview:")) {
    const entity = (snapshot.worldviewEntities ?? []).find((candidate) => candidate.id === id);
    return entity ? { level: "worldview", id, label: `${worldviewEntityLabels[entity.kind]} · ${entity.name ?? id.slice(-8)}`, regionId: entity.regionId } : undefined;
  }
  if (id.startsWith("organization:")) {
    const organization = organizationForSnapshot(snapshot, id);
    return organization ? { level: organization.type, id, label: organizationName(organization), regionId: organization.regionId } : undefined;
  }
  return undefined;
};
const historyRelatedLinks = (snapshot: WorldSnapshot, event: InspectorHistoryEvent, excludedIds: ReadonlySet<string> = new Set()): string => {
  const targets = new Map<string, HistoryTarget>();
  for (const id of historyEventIds(event)) {
    if (excludedIds.has(id)) continue;
    const target = historyTargetFor(snapshot, id);
    if (target) targets.set(target.id, target);
  }
  const links = [...targets.values()].slice(0, 5).map((target) => detailLink(target.level, target.id, target.label, target.regionId)).join("");
  return links.length > 0 ? `<div class="history-related"><span>关联对象</span>${links}</div>` : "";
};
const organizationNavigationReport = (snapshot: WorldSnapshot, organization: OrganizationDetail, memberIds: readonly string[], projectedMembers: readonly AgentState[]): string => {
  const parent = organizationParentForSnapshot(snapshot, organization.id);
  const children = organizationChildIds(organization)
    .map((id) => organizationForSnapshot(snapshot, id))
    .filter((candidate): candidate is OrganizationDetail => Boolean(candidate))
    .sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
  const memberLinks = projectedMembers.slice(0, 24).map((agent) => detailLink("agent", agent.id, `${agent.id.slice(-8)} · ${Math.floor(agent.age)}岁`, agent.regionId));
  const memberCount = "memberCount" in organization ? organization.memberCount : memberIds.length;
  const unavailableMemberCount = Math.max(0, memberCount - projectedMembers.length);
  return `<section class="organization-governance detail-navigation" aria-label="组织关系导航"><div class="detail-heading"><strong>关系导航</strong><span>点击对象进入对应详情报告</span></div><div class="detail-navigation-group"><span>所属上级</span>${parent ? detailLink(parent.type, parent.id, organizationName(parent), parent.regionId) : "<em>顶层组织</em>"}</div><div class="detail-navigation-group"><span>下属组织</span>${children.length > 0 ? children.map((child) => detailLink(child.type, child.id, organizationName(child), child.regionId)).join("") : "<em>暂无下属组织记录</em>"}</div><div class="detail-navigation-group"><span>可观察成员</span>${memberLinks.length > 0 ? memberLinks.join("") : "<em>当前投影没有该组织成员</em>"}${unavailableMemberCount > 0 ? `<small>另有 ${format(unavailableMemberCount)} 名成员仅保留聚合记录</small>` : ""}</div></section>`;
};
const diplomaticLabels = { neutral: "中立", trade: "贸易", allied: "盟友", rival: "敌对" } as const;
const knowledgeDomainLabels: Record<KnowledgeDomain, string> = {
  subsistence: "生计",
  construction: "建造",
  navigation: "航行",
  medicine: "医养",
  governance: "治理",
  energy: "能量",
};
const supplyResourceLabels = { food: "食物", materials: "建造材料", energy: "能源" } as const;
const substanceInventoryReport = (substances: SubstanceState[]): string => {
  const ordered = [...substances].sort((left, right) => Number(right.status === "known") - Number(left.status === "known") || right.originYears - left.originYears || left.id.localeCompare(right.id));
  const known = ordered.filter((substance) => substance.status === "known").length;
  return `<section class="worldview-records substance-records" aria-label="原创物质"><div class="worldview-heading"><strong>原创物质</strong><span>${format(ordered.length)} 种形成 · ${format(known)} 种已发现</span></div><ol class="worldview-list">${ordered.length > 0 ? ordered.slice(0, 12).map((substance) => {
    const reserve = substance.formation === "engineered"
      ? "人工制造"
      : substance.remainingReserve <= 0
        ? "天然储量已枯竭"
        : `天然储量剩余 ${formatPercent(substanceReserveRatio(substance)).value}%`;
    return `<li data-substance-kind="${substance.kind}" data-substance-status="${substance.status}"><div><span>${substanceKindLabels[substance.kind]}</span><small>${substance.status === "known" ? "已发现" : "潜藏"}</small></div><strong>${escapeHtml(substance.name)}</strong><p>${substanceFormationLabels[substance.formation]} · ${reserve} · 稳定性 ${formatPercent(substance.properties.stability).value}%</p></li>`;
  }).join("") : '<li class="worldview-empty">当地尚未形成可记录的原创物质</li>'}</ol></section>`;
};
const knowledgeName = (knowledge: KnowledgeState): string => knowledge.name ?? knowledge.kind.replace(/^practice:/, "实践 · ");
const skillLabel = (skill: string): string => {
  if (!skill.startsWith("profession:")) return skill;
  const domain = skill.slice("profession:".length) as KnowledgeDomain;
  return `职业 · ${knowledgeDomainLabels[domain] ?? domain}`;
};
const knowledgeForIds = (snapshot: WorldSnapshot, ids: Iterable<string>): KnowledgeState[] => {
  const idSet = new Set(ids);
  return (snapshot.knowledge ?? [])
    .filter((knowledge) => idSet.has(knowledge.id))
    .sort((left, right) => Number(Boolean(right.domain)) - Number(Boolean(left.domain)) || (right.originYears ?? right.originTick ?? 0) - (left.originYears ?? left.originTick ?? 0) || left.id.localeCompare(right.id));
};
const knowledgeForRegion = (snapshot: WorldSnapshot, regionId: RegionId): KnowledgeState[] => {
  const ids = (snapshot.cultures ?? [])
    .filter((culture) => culture.regionId === regionId)
    .flatMap((culture) => culture.knowledgeIds);
  return knowledgeForIds(snapshot, ids);
};
const technologyForSnapshotRegion = (snapshot: WorldSnapshot, regionId: RegionId) =>
  technologyProfileForRegion({ cultures: snapshot.cultures ?? [], knowledge: snapshot.knowledge ?? [] }, regionId);
const technologyEffectsReport = (profile: ReturnType<typeof technologyProfileForRegion>): string => {
  const effects: Array<[keyof typeof profile, string, string]> = [
    ["subsistence", "\u751f\u8ba1\u6280\u672f", `\u98df\u7269\u4ea7\u51fa +${formatNumber(profile.subsistence * 45, 1)}%`],
    ["construction", "\u5efa\u9020\u6280\u672f", `\u7ec4\u7ec7\u627f\u8f7d +${formatNumber(profile.construction * 22, 1)}%`],
    ["navigation", "\u822a\u884c\u6280\u672f", `\u8fc1\u5f99\u6548\u7387 +${formatNumber(profile.navigation * 12, 1)}%`],
    ["medicine", "\u533b\u517b\u6280\u672f", `\u751f\u5b58\u4fdd\u62a4 ${formatNumber(profile.medicine * 28, 1)}%`],
    ["governance", "\u6cbb\u7406\u6280\u672f", `\u7a33\u5b9a\u4e0e\u516c\u5171\u5efa\u8bbe +${formatNumber(profile.governance * 10, 1)}%`],
    ["energy", "\u80fd\u91cf\u6280\u672f", `\u5316\u5b66\u8f6c\u5316\u7ea7\u522b ${formatNumber(profile.energy * 100, 1)}%`],
  ];
  const active = effects.filter(([domain]) => profile[domain] > 0);
  return `<section class="technology-effects" aria-label="\u6280\u672f\u5f71\u54cd"><div class="detail-heading"><strong>\u6280\u672f\u53cd\u9988</strong><span>\u5df2\u638c\u63e1\u7684\u77e5\u8bc6\u6b63\u5728\u6539\u53d8\u4e16\u754c</span></div><div class="technology-effect-list">${active.length > 0 ? active.map(([domain, label, effect]) => `<span data-technology-domain="${domain}"><b>${label}</b><small>${effect} · \u7b49\u7ea7 ${formatNumber(profile[domain] * 100, 1)}%</small></span>`).join("") : "<span>\u5c1a\u672a\u638c\u63e1\u53ef\u89c2\u6d4b\u6280\u672f</span>"}</div></section>`;
};
const facilityStatusLabels: Record<FacilityState["status"], string> = {
  planned: "待建设",
  active: "运行中",
  damaged: "受损",
  abandoned: "已废弃",
};
const facilityAssetsReport = (facilities: FacilityState[]): string => {
  const ordered = [...facilities].sort((left, right) => Number(left.status === "abandoned") - Number(right.status === "abandoned") || right.level - left.level || left.id.localeCompare(right.id));
  const activeCount = ordered.filter((facility) => facility.status === "active" || facility.status === "damaged").length;
  const totalInvestment = ordered.reduce((sum, facility) => sum + facility.materialInvested, 0);
  const contribution = (facility: FacilityState): string => {
    const effect = facilityOperationalEffect(facility);
    if (effect <= 0) return "当前不产生运行效果";
    const value = formatNumber(effect * 100, 1);
    const labels: Record<KnowledgeDomain, string> = {
      subsistence: `食物增产潜力 ${formatNumber(effect * 65, 1)}%`,
      construction: `材料增产潜力 ${formatNumber(effect * 45, 1)}%`,
      navigation: `迁徙支持强度 ${value}%`,
      medicine: `生存保护强度 ${value}%`,
      governance: `治理支持强度 ${value}%`,
      energy: `能源支持强度 ${value}%`,
    };
    return labels[facility.type];
  };
  return `<section class="organization-governance facility-assets" aria-label="资产记录"><div class="detail-heading"><strong>资产记录</strong><span>${format(activeCount)} 项在役 · 累计投入 ${formatNumber(totalInvestment, 1)} 材料单位</span></div><ol class="worldview-list">${ordered.length > 0 ? ordered.map((facility) => `<li data-facility-status="${facility.status}"><div><span>${knowledgeDomainLabels[facility.type]}设施 · ${facility.level} 级</span><small>${facilityStatusLabels[facility.status]}</small></div><strong>${escapeHtml(facility.id.slice(-8))}</strong><p>耐久 ${formatPercent(facility.condition).value}% · 编制 ${format(facility.workforceIds.length)}/${format(facility.workforceRequired ?? facilityWorkforceRequiredFor(facility.type))} 人 · 岗位效率 ${formatPercent(facility.workforceEfficiency ?? 1).value}%</p><p>材料投入 ${formatNumber(facility.materialInvested, 1)} 单位 · 运行贡献：${contribution(facility)}</p><p>${facility.builtTick >= 0 ? `建成于演化步 ${format(facility.builtTick)}` : `规划于演化步 ${format(facility.plannedTick)}`} · 最近维护 ${format(facility.lastMaintainedTick)} · 所有者 ${escapeHtml(facility.ownerOrganizationId.slice(-8))}</p></li>`).join("") : '<li class="worldview-empty">尚无已规划或已建成设施</li>'}</ol></section>`;
};
const facilityDetailReport = (snapshot: WorldSnapshot, facilityId: string): string => {
  const facility = snapshot.facilities?.find((candidate) => candidate.id === facilityId);
  if (!facility) return `<div class="empty-state"><strong>设施暂不可用</strong><span>该设施可能已在下一次快照中废弃或尚未同步</span></div>`;
  const owner = facility.ownerOrganizationId ? organizationForSnapshot(snapshot, facility.ownerOrganizationId) : undefined;
  const effect = facilityOperationalEffect(facility);
  const requiredWorkforce = facility.workforceRequired ?? facilityWorkforceRequiredFor(facility.type);
  return `<div class="detail-report"><div class="detail-title"><strong>设施报告</strong><span>${escapeHtml(facility.id)}</span></div><dl class="detail-grid"><div><dt>设施类型</dt><dd>${knowledgeDomainLabels[facility.type]}</dd></div><div><dt>生命周期状态</dt><dd>${facilityStatusLabels[facility.status]}</dd></div><div><dt>设施等级</dt><dd>${format(facility.level)} 级</dd></div><div><dt>耐久度</dt><dd>${formatPercent(facility.condition).value}%</dd></div><div><dt>建成时间</dt><dd>${facility.builtTick >= 0 ? `演化步 ${format(facility.builtTick)}` : "尚未建成"}</dd></div><div><dt>最近维护</dt><dd>演化步 ${format(facility.lastMaintainedTick)}</dd></div><div><dt>劳动力</dt><dd>${format(facility.workforceIds.length)} / ${format(requiredWorkforce)} 人</dd></div><div><dt>岗位效率</dt><dd>${formatPercent(facility.workforceEfficiency ?? 1).value}%</dd></div><div><dt>材料投入</dt><dd>${formatNumber(facility.materialInvested, 1)} 材料单位</dd></div><div><dt>所有者</dt><dd>${owner ? escapeHtml(organizationName(owner)) : escapeHtml(facility.ownerOrganizationId)}</dd></div></dl><section class="organization-governance" aria-label="设施运行效果"><div class="detail-heading"><strong>设施运行效果</strong><span>当前状态、维护和劳动力共同决定实际贡献</span></div><div class="detail-tags"><span>运行贡献 ${formatPercent(effect).value}%</span><span>${effect > 0 ? "正在影响当地生产与公共能力" : "当前不产生运行贡献"}</span><span>最近事件 演化步 ${format(facility.lastIncidentTick)}</span></div></section></div>`;
};
const supplyChainReport = (snapshot: WorldSnapshot, organization: { id: string }, balances: Record<keyof typeof supplyResourceLabels, number>): string => {
  const routes = (snapshot.supplyRoutes ?? [])
    .filter((route) => route.fromOrganizationId === organization.id || route.toOrganizationId === organization.id)
    .sort((left, right) => compareSimulationSteps(right.lastTimelineStep ?? String(right.lastTick), left.lastTimelineStep ?? String(left.lastTick)) || left.resourceId.localeCompare(right.resourceId));
  const archivedShipments = routes.reduce((sum, route) => sum + (route.archivedShipmentCount ?? 0), 0);
  const inventory = Object.entries(supplyResourceLabels)
    .map(([resourceId, label]) => `<span>${label}库存 · ${formatNumber(balances[resourceId as keyof typeof supplyResourceLabels], 2)} 单位</span>`)
    .join("");
  return `<section class="organization-governance supply-chain" aria-label="区域供应链"><div class="detail-heading"><strong>区域供应链</strong><span>${format(routes.length)} 条长期路线${archivedShipments > 0 ? ` · ${format(archivedShipments)} 批已归档` : ""}</span></div><div class="detail-tags">${inventory}</div><ol class="worldview-list">${routes.length > 0 ? routes.slice(0, 10).map((route) => {
    const incoming = route.toOrganizationId === organization.id;
    const counterparty = incoming ? route.fromOrganizationId : route.toOrganizationId;
    const region = incoming ? route.fromRegion : route.toRegion;
    return `<li data-supply-resource="${route.resourceId}"><div><span>${incoming ? "输入" : "输出"} · ${supplyResourceLabels[route.resourceId]}</span><small>${format(route.shipmentCount)} 批</small></div><strong>${escapeHtml(counterparty.slice(-8))}</strong><p>累计 ${formatNumber(route.totalAmount, 2)} 单位 · ${escapeHtml(region)}${(route.archivedShipmentCount ?? 0) > 0 ? ` · 归档 ${format(route.archivedShipmentCount ?? 0)} 批` : ""}</p><p>最近运输：${route.lastTimelineDays ? formatSimulationAgeFromDays(route.lastTimelineDays) : formatSimulationAge(route.lastYears ?? route.lastTick)}</p></li>`;
  }).join("") : '<li class="worldview-empty">尚无跨区域运输记录</li>'}</ol></section>`;
};
const strategicRouteLabels: Record<StrategicRouteSummary["kind"], string> = {
  trade: "贸易",
  alliance: "联盟",
  migration: "迁徙",
  "border-conflict": "冲突",
};
const strategicRouteHistoryReport = (snapshot: WorldSnapshot, organization: { id: string }): string => {
  const routes = (snapshot.eventArchive?.strategicRoutes ?? [])
    .filter((route) => route.fromId === organization.id || route.toId === organization.id)
    .sort((left, right) => compareSimulationSteps(right.lastTimelineStep ?? String(right.lastTick), left.lastTimelineStep ?? String(left.lastTick)));
  if (routes.length === 0) return "";
  return `<section class="organization-governance strategic-route-history" aria-label="长期战略路线"><div class="detail-heading"><strong>长期战略路线</strong><span>${format(routes.length)} 条归档脉络 · 事件压缩后继续保留</span></div><ol class="worldview-list">${routes.slice(0, 12).map((route) => {
    const selfMigration = route.fromId === organization.id && route.toId === organization.id;
    const outgoing = route.fromId === organization.id;
    const counterparty = selfMigration ? organization.id : outgoing ? route.toId : route.fromId;
    const region = outgoing ? route.toRegion : route.fromRegion;
    const amount = route.kind === "trade" && route.resourceId
      ? ` · ${supplyResourceLabels[route.resourceId]} ${formatNumber(route.cumulativeAmount, 2)} 单位`
      : "";
    const first = route.firstTimelineDays ? formatSimulationAgeFromDays(route.firstTimelineDays) : formatSimulationAge(route.firstYears ?? route.firstTick);
    const last = route.lastTimelineDays ? formatSimulationAgeFromDays(route.lastTimelineDays) : formatSimulationAge(route.lastYears ?? route.lastTick);
    return `<li data-strategic-route-kind="${route.kind}"><div><span>${strategicRouteLabels[route.kind]} · ${selfMigration ? "本组织迁徙" : outgoing ? "对外" : "来自外部"}</span><small>${format(route.occurrenceCount)} 次</small></div><strong>${escapeHtml(counterparty.slice(-12))}</strong><p>${escapeHtml(region)}${amount}</p><p>${first} 至 ${last}</p></li>`;
  }).join("")}</ol></section>`;
};
const cultureSummaryForSnapshot = (snapshot: WorldSnapshot, cultureId: string): RegionCultureSummary | undefined =>
  snapshot.selectedRegion?.cultureSummary?.id === cultureId ? snapshot.selectedRegion.cultureSummary : undefined;
const cultureIdentityForSnapshot = (snapshot: WorldSnapshot, cultureId: string): CultureIdentity | undefined => {
  const summary = cultureSummaryForSnapshot(snapshot, cultureId);
  const culture = snapshot.cultures?.find((candidate) => candidate.id === cultureId);
  return summary?.identity ?? culture?.identity ?? (culture ? snapshot.cultureIdentityByRegion?.[culture.regionId] : undefined);
};
const aggregateKnowledgeName = (knowledge: AggregateKnowledgeSummary): string => knowledge.name ?? knowledge.kind;
const cultureSummaryReport = (identity: CultureIdentity, summary?: RegionCultureSummary): string => `
  <section class="organization-governance culture-summary" aria-label="本地文化">
    <div class="detail-heading"><strong>本地文化</strong><span>${escapeHtml(identity.name)} · 第 ${format(identity.generation)} 代</span></div>
    <div class="detail-tags"><span>${cultureLanguageLabels[identity.languageFamily]}</span><span>${cultureCommunicationLabels[identity.communicationStyle]}</span><span>传统 ${format(identity.traditions.length)} 项</span>${summary ? `<span>文化记忆 ${formatPercent(summary.memoryStrength).value}%</span><span>知识创新 ${format(summary.innovationCount)} 项</span>` : ""}</div>
  </section>
`;
const cultureDetailReport = (cultureId: string, identity: CultureIdentity, summary?: RegionCultureSummary): string => {
  const knowledge = summary?.knowledge ?? [];
  const knowledgeRows = knowledge.length > 0
    ? knowledge.slice(0, 12).map((record) => `<li><div><span>${record.domain ? knowledgeDomainLabels[record.domain] : "基础实践"}</span><small>形成于 ${formatSimulationAge(record.originYears)}</small></div><strong>${escapeHtml(aggregateKnowledgeName(record))}</strong><p>可信度 ${formatPercent(record.credibility).value}% · 传承成本 ${formatPercent(record.transmissionCost).value}% · 遗忘率 ${formatPercent(record.forgettingRate).value}% · ${record.parentIds.length > 0 ? `源自 ${format(record.parentIds.length)} 条知识` : "当地原生记录"}</p></li>`).join("")
    : "<li class=\"worldview-empty\">尚未形成可记录知识</li>";
  return `
  <div class="detail-report">
    <div class="detail-title"><strong>文化报告</strong><span>${escapeHtml(cultureId)}</span></div>
    <dl class="detail-grid">
      <div><dt>名称</dt><dd>${escapeHtml(identity.name)}</dd></div>
      <div><dt>语言家族</dt><dd>${cultureLanguageLabels[identity.languageFamily]}</dd></div>
      <div><dt>交流制度</dt><dd>${cultureCommunicationLabels[identity.communicationStyle]}</dd></div>
      <div><dt>文化世代</dt><dd>第 ${format(identity.generation)} 代</dd></div>
      <div><dt>起源区域</dt><dd>${escapeHtml(identity.originRegionId)}</dd></div>
      <div><dt>起源时间</dt><dd>${formatSimulationAge(identity.originYears)}</dd></div>
      <div><dt>象征</dt><dd>${escapeHtml(identity.symbol)}</dd></div>
      <div><dt>创新签名</dt><dd>${escapeHtml(identity.noveltySignature)}</dd></div>
      <div><dt>母文化</dt><dd>${identity.parentCultureIds?.length ? identity.parentCultureIds.map(escapeHtml).join("、") : "本地原生文化"}</dd></div>
      ${summary ? `<div><dt>文化记忆</dt><dd>${formatPercent(summary.memoryStrength).value}%</dd></div><div><dt>传承效率</dt><dd>${formatPercent(summary.transmissionRate).value}%</dd></div><div><dt>知识创新</dt><dd>${format(summary.innovationCount)} 项</dd></div><div><dt>信念记录</dt><dd>${format(summary.beliefCount)} 条</dd></div><div><dt>最近变化</dt><dd>${formatSimulationAge(summary.lastChangeTick)}</dd></div>` : ""}
    </dl>
    <section class="organization-governance" aria-label="文化价值">
      <div class="detail-heading"><strong>文化价值</strong><span>会影响组织形成、治理、联盟与冲突</span></div>
      <div class="detail-tags">${cultureValueLabels.map(([field, label]) => `<span>${label} ${formatPercent(identity.values[field]).value}%</span>`).join("")}</div>
    </section>
    <section class="organization-governance" aria-label="文化传统">
      <div class="detail-heading"><strong>传承传统</strong><span>由区域环境、成员特征与知识共同演化</span></div>
      <div class="detail-tags">${identity.traditions.length > 0 ? identity.traditions.map((tradition) => `<span>${escapeHtml(tradition)}</span>`).join("") : "<span>尚未形成稳定传统</span>"}</div>
    </section>
    <section class="worldview-records knowledge-records" aria-label="文化记忆">
      <div class="worldview-heading"><strong>文化记忆</strong><span>保留知识来源、传承成本与遗忘速率</span></div>
      <ol class="worldview-list">${knowledgeRows}</ol>
    </section>
  </div>
`;
};
const aggregateSocietyReport = (society: RegionSocietySummary, ecologicalPopulation: number, socialPopulation: number): string => {
  const organizations = Object.entries(society.organizationCounts)
    .filter(([, count]) => count > 0)
    .sort(([, left], [, right]) => right - left)
    .map(([type, count]) => `<span>${organizationLabels[type as OrganizationType]} ${format(count)} 个</span>`)
    .join("");
  return `<section class="organization-governance aggregate-society" aria-label="社会演化"><div class="detail-heading"><strong>社会演化</strong><span>聚合模型持续记录文化、组织与公共能力</span></div><dl class="detail-grid"><div><dt>生态总量</dt><dd>${format(ecologicalPopulation)} 个体</dd></div><div><dt>社会人口</dt><dd>${format(socialPopulation)} 人</dd></div><div><dt>组织承载</dt><dd>${format(society.organizationCapacity)} 人</dd></div><div><dt>基础设施</dt><dd>${formatPercent(society.infrastructureLevel).value}%</dd></div><div><dt>凝聚力</dt><dd>${formatPercent(society.cohesion).value}%</dd></div><div><dt>稳定度</dt><dd>${formatPercent(society.stability).value}%</dd></div><div><dt>合法性</dt><dd>${formatPercent(society.legitimacy).value}%</dd></div><div><dt>公共资源</dt><dd>${formatPercent(society.publicGoods).value}%</dd></div><div><dt>军力</dt><dd>${formatPercent(society.military).value}%</dd></div><div><dt>贸易累计</dt><dd>${formatNumber(society.tradeVolume, 2)} 单位</dd></div><div><dt>冲突压力</dt><dd>${formatPercent(society.conflictPressure).value}%</dd></div><div><dt>最近变化</dt><dd>${formatSimulationAge(society.lastChangeTick)}</dd></div></dl><div class="detail-tags">${organizations || "<span>尚未形成稳定组织</span>"}</div></section>`;
};
const observationMetric = (label: string, formatted: FormattedMetric, note?: string): string => `
  <div class="observation-row">
    <dt>${label}${note ? `<small>${note}</small>` : ""}</dt>
    <dd><strong>${formatted.value}</strong><small>${formatted.unit}</small></dd>
  </div>
`;

export type InspectorLineage = RegionLineageSummary & {
  householdCount: number;
  population: number;
  relationshipCount: number;
  families: Array<{ id: string; memberCount: number }>;
  familyLineages: FamilyLineageSummary[];
  foodBalance: number;
  foodPerAgent: number;
  foodSecurity: number;
  migrationRate: number;
  source: "aggregate" | "micro";
};

export const lineageForSnapshot = (snapshot: WorldSnapshot): InspectorLineage => {
  const summary = snapshot.selectedRegion;
  const projection = snapshot.projection;
  if (summary?.mode === "aggregate") {
    return {
      ...summary.lineage,
      householdCount: summary.householdCount,
      population: summary.population,
      relationshipCount: summary.relationshipCount,
      families: summary.organizations.filter((organization) => organization.type === "family").map((family) => ({ id: family.id, memberCount: family.memberCount })),
      familyLineages: summary.familyLineages ?? [],
      foodBalance: summary.foodBalance,
      foodPerAgent: summary.foodPerAgent,
      foodSecurity: summary.foodSecurity,
      migrationRate: summary.migrationRate,
      source: "aggregate",
    };
  }
  const agents = projection?.agents ?? [];
  const relationships = projection?.relationships ?? [];
  const lineage = summarizeLineage(agents, relationships);
  const familyLineages = (projection?.organizations ?? [])
    .filter((organization) => organization.type === "family")
    .map((family) => {
      const memberIds = new Set(family.memberIds);
      const familyAgents = agents.filter((agent) => memberIds.has(agent.id));
      const familyRelationships = relationships.filter((relationship) => memberIds.has(relationship.fromId) && memberIds.has(relationship.toId));
      return {
        id: family.id,
        memberCount: family.memberIds.length,
        relationshipCount: familyRelationships.length,
        ...summarizeLineage(familyAgents, familyRelationships),
      };
    });
  return {
    ...lineage,
    householdCount: projection?.organizations.filter((organization) => organization.type === "family").length ?? 0,
    population: agents.length,
    relationshipCount: relationships.length,
    families: projection?.organizations.filter((organization) => organization.type === "family").map((family) => ({ id: family.id, memberCount: family.memberIds.length })) ?? [],
    familyLineages,
    foodBalance: summary?.foodBalance ?? 0,
    foodPerAgent: summary?.foodPerAgent ?? 0,
    foodSecurity: summary?.foodSecurity ?? 0,
    migrationRate: summary?.migrationRate ?? 0,
    source: "micro",
  };
};

const regionalHealthReport = (snapshot: WorldSnapshot, regionId?: RegionId): string => {
  if (!regionId) return "";
  const pathogenRecords = (snapshot.pathogens ?? []).map((pathogen) => ({
    pathogen,
    outbreak: pathogenOutbreakForRegion(pathogen, regionId),
  })).filter((record) => Boolean(record.outbreak));
  const agents = snapshot.projection?.agents.filter((agent) => agent.regionId === regionId) ?? [];
  const summary = snapshot.selectedRegion?.regionId === regionId ? snapshot.selectedRegion.healthSummary : undefined;
  const infectedCount = summary?.infectedCount ?? agents.filter((agent) => (agent.health?.infections.length ?? 0) > 0).length;
  const prevalence = summary?.prevalence ?? (agents.length > 0
    ? infectedCount / agents.length
    : pathogenRecords.reduce((maximum, record) => Math.max(maximum, record.outbreak?.prevalence ?? 0), 0));
  const meanVitality = summary?.meanVitality ?? (agents.length > 0 ? agents.reduce((sum, agent) => sum + (agent.health?.vitality ?? 1), 0) / agents.length : Math.max(0, 1 - prevalence * 0.35));
  const immuneCount = summary?.immuneCount ?? agents.filter((agent) => (agent.health?.immunityIds.length ?? 0) > 0).length;
  return `<section class="organization-governance public-health" aria-label="区域公共健康"><div class="detail-heading"><strong>公共健康</strong><span>${pathogenRecords.length > 0 ? `${format(pathogenRecords.length)} 种病原体有演化记录` : "当前没有已记录病原体"}</span></div><dl class="detail-grid"><div><dt>当前流行率</dt><dd>${formatPercent(prevalence).value}%</dd></div><div><dt>感染个体</dt><dd>${format(infectedCount)} 人</dd></div><div><dt>免疫个体</dt><dd>${format(immuneCount)} 人</dd></div><div><dt>平均活力</dt><dd>${formatPercent(meanVitality).value}%</dd></div></dl><div class="detail-tags">${pathogenRecords.length > 0 ? pathogenRecords.slice(0, 8).map(({ pathogen, outbreak }) => `<span>${escapeHtml(pathogen.name)} · ${pathogenStatusLabels[outbreak!.status]} · ${formatPercent(outbreak!.prevalence).value}%</span>`).join("") : "<span>环境与宿主密度尚未产生可持续传播</span>"}</div></section>`;
};

const regionalTectonicReport = (snapshot: WorldSnapshot, regionId?: RegionId): string => {
  const tectonics = snapshot.tectonics;
  if (!tectonics || !regionId) return "";
  if (snapshot.formation.phase !== "stable-crust") {
    return `<section class="organization-governance tectonic-report" aria-label="区域地质板块"><div class="detail-heading"><strong>地质板块</strong><span>尚未形成</span></div><div class="detail-tags"><span>稳定地壳形成后开始记录板块、边界和应力</span></div></section>`;
  }
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  const x = Number(match?.[1] ?? -1);
  const y = Number(match?.[2] ?? -1);
  if (x < 0 || x >= tectonics.plateIndex.width || y < 0 || y >= tectonics.plateIndex.height) return "";
  const index = y * tectonics.plateIndex.width + x;
  const plateIndex = Math.trunc(tectonics.plateIndex.values[index] ?? -1);
  const plate = tectonics.plates[plateIndex];
  if (!plate) return "";
  const stress = tectonics.boundaryStress.values[index] ?? 0;
  const activity = tectonics.boundaryActivity.values[index] ?? 0;
  const boundary = stress < 0.01
    ? "板块内部"
    : activity >= 0.12
      ? "聚合边界"
      : activity <= -0.12
        ? "离散边界"
        : "转换边界";
  const horizontal = Math.abs(plate.velocityX) < 0.001 ? "" : plate.velocityX > 0 ? "向东" : "向西";
  const vertical = Math.abs(plate.velocityY) < 0.001 ? "" : plate.velocityY > 0 ? "向南" : "向北";
  const direction = [horizontal, vertical].filter(Boolean).join("、") || "近乎静止";
  const kind = { continental: "大陆型", oceanic: "海洋型", mixed: "混合型" }[plate.kind];
  return `<section class="organization-governance tectonic-report" aria-label="区域地质板块"><div class="detail-heading"><strong>地质板块</strong><span>${escapeHtml(plate.name)} · ${kind}</span></div><dl class="detail-grid"><div><dt>板块编号</dt><dd>${escapeHtml(plate.id)}</dd></div><div><dt>局地位置</dt><dd>${boundary}</dd></div><div><dt>边界应力</dt><dd>${formatPercent(stress).value}%</dd></div><div><dt>聚散活动</dt><dd>${formatNumber(activity, 3)}</dd></div><div><dt>运动方向</dt><dd>${direction}</dd></div><div><dt>运动速度</dt><dd>${formatNumber(Math.hypot(plate.velocityX, plate.velocityY) * 1_000, 2)} 格 / 千年</dd></div><div><dt>相对密度</dt><dd>${formatPercent(plate.density).value}%</dd></div><div><dt>相对厚度</dt><dd>${formatPercent(plate.thickness).value}%</dd></div><div><dt>地壳年龄</dt><dd>${formatSimulationAge(plate.crustAgeYears)}</dd></div><div><dt>板块更新</dt><dd>${format(tectonics.updateCount)} 次 · 演化步 ${escapeHtml(tectonics.lastUpdatedTimelineStep ?? String(tectonics.lastUpdatedTick))}</dd></div></dl></section>`;
};

const regionalAtmosphereReport = (snapshot: WorldSnapshot, regionId?: RegionId): string => {
  const atmosphere = snapshot.atmosphere;
  if (!atmosphere || !regionId) return "";
  if (snapshot.formation.phase !== "stable-crust" || atmosphere.updateCount === 0) {
    return `<section class="organization-governance atmosphere-report" aria-label="区域大气环流"><div class="detail-heading"><strong>大气环流</strong><span>尚未建立</span></div><div class="detail-tags"><span>稳定地壳与水汽循环形成后开始记录气压、风场和降水</span></div></section>`;
  }
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  const x = Number(match?.[1] ?? -1);
  const y = Number(match?.[2] ?? -1);
  if (x < 0 || x >= atmosphere.pressure.width || y < 0 || y >= atmosphere.pressure.height) return "";
  const index = y * atmosphere.pressure.width + x;
  const pressure = atmosphere.pressure.values[index] ?? 0;
  const windX = atmosphere.windX.values[index] ?? 0;
  const windY = atmosphere.windY.values[index] ?? 0;
  const precipitation = atmosphere.precipitation.values[index] ?? 0;
  const horizontal = Math.abs(windX) < 0.025 ? "" : windX > 0 ? "向东" : "向西";
  const vertical = Math.abs(windY) < 0.025 ? "" : windY > 0 ? "向南" : "向北";
  const direction = [horizontal, vertical].filter(Boolean).join("、") || "局地静风";
  const rainClass = precipitation >= 0.7 ? "强降水" : precipitation >= 0.35 ? "稳定降水" : precipitation >= 0.08 ? "少量降水" : "干燥";
  return `<section class="organization-governance atmosphere-report" aria-label="区域大气环流"><div class="detail-heading"><strong>大气环流</strong><span>${direction} · ${rainClass}</span></div><dl class="detail-grid"><div><dt>相对气压</dt><dd>${formatPercent(pressure).value}%</dd></div><div><dt>风向</dt><dd>${direction}</dd></div><div><dt>风速指数</dt><dd>${formatPercent(Math.hypot(windX, windY)).value}%</dd></div><div><dt>实际降水</dt><dd>${formatPercent(precipitation).value}%</dd></div><div><dt>东西风分量</dt><dd>${formatNumber(windX, 3)}</dd></div><div><dt>南北风分量</dt><dd>${formatNumber(windY, 3)}</dd></div><div><dt>环流更新</dt><dd>${format(atmosphere.updateCount)} 次</dd></div><div><dt>最后更新</dt><dd>演化步 ${escapeHtml(atmosphere.lastUpdatedTimelineStep ?? String(atmosphere.lastUpdatedTick))}</dd></div></dl></section>`;
};

const regionalOceanReport = (snapshot: WorldSnapshot, regionId?: RegionId): string => {
  const ocean = snapshot.ocean;
  if (!ocean || !regionId) return "";
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  const x = Number(match?.[1] ?? -1);
  const y = Number(match?.[2] ?? -1);
  if (x < 0 || x >= ocean.seaTemperature.width || y < 0 || y >= ocean.seaTemperature.height) return "";
  const index = y * ocean.seaTemperature.width + x;
  const elevation = snapshot.fields.elevation.values[index] ?? 0;
  if (snapshot.formation.phase !== "stable-crust") {
    return `<section class="organization-governance ocean-report" aria-label="区域海洋"><div class="detail-heading"><strong>海洋状态</strong><span>尚未形成稳定海洋</span></div><div class="detail-tags"><span>地壳冷却与水体汇聚后开始记录海温、盐度、洋流和海冰</span></div></section>`;
  }
  if (elevation >= 0.48) {
    return `<section class="organization-governance ocean-report" aria-label="区域海洋"><div class="detail-heading"><strong>海洋状态</strong><span>陆地区域</span></div><div class="detail-tags"><span>该坐标没有海洋水体，海洋网格保持为空</span></div></section>`;
  }
  const seaTemperature = ocean.seaTemperature.values[index] ?? 0;
  const salinity = ocean.salinity.values[index] ?? 0;
  const currentX = ocean.currentX.values[index] ?? 0;
  const currentY = ocean.currentY.values[index] ?? 0;
  const seaIce = ocean.seaIce.values[index] ?? 0;
  const horizontal = Math.abs(currentX) < 0.025 ? "" : currentX > 0 ? "向东" : "向西";
  const vertical = Math.abs(currentY) < 0.025 ? "" : currentY > 0 ? "向南" : "向北";
  const direction = [horizontal, vertical].filter(Boolean).join("、") || "局地静流";
  const iceLabel = seaIce >= 0.7 ? "高覆盖海冰" : seaIce >= 0.15 ? "季节性海冰" : "无明显海冰";
  return `<section class="organization-governance ocean-report" aria-label="区域海洋"><div class="detail-heading"><strong>海洋状态</strong><span>${direction} · ${iceLabel}</span></div><dl class="detail-grid"><div><dt>海表温度</dt><dd>${formatPercent(seaTemperature).value}%</dd></div><div><dt>相对盐度</dt><dd>${formatPercent(salinity).value}%</dd></div><div><dt>洋流方向</dt><dd>${direction}</dd></div><div><dt>洋流速度</dt><dd>${formatPercent(Math.hypot(currentX, currentY)).value}%</dd></div><div><dt>东西流分量</dt><dd>${formatNumber(currentX, 3)}</dd></div><div><dt>南北流分量</dt><dd>${formatNumber(currentY, 3)}</dd></div><div><dt>海冰覆盖</dt><dd>${formatPercent(seaIce).value}%</dd></div><div><dt>海洋更新</dt><dd>${format(ocean.updateCount)} 次</dd></div></dl></section>`;
};

const regionalMarineBiogeochemistryReport = (snapshot: WorldSnapshot, regionId?: RegionId): string => {
  const ocean = snapshot.ocean;
  if (!ocean || !regionId) return "";
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  const x = Number(match?.[1] ?? -1);
  const y = Number(match?.[2] ?? -1);
  if (x < 0 || y < 0 || x >= ocean.primaryProductivity.width || y >= ocean.primaryProductivity.height) return "";
  const index = y * ocean.primaryProductivity.width + x;
  if ((snapshot.fields.elevation.values[index] ?? 1) >= 0.48) return "";
  const productivity = ocean.primaryProductivity.values[index] ?? 0;
  const plankton = ocean.planktonBiomass.values[index] ?? 0;
  const oxygen = ocean.dissolvedOxygen.values[index] ?? 0;
  const nutrients = ocean.dissolvedNutrients.values[index] ?? 0;
  const organicCarbon = ocean.organicCarbon.values[index] ?? 0;
  return `<section class="organization-governance ocean-report" aria-label="海洋生物地球化学"><div class="detail-heading"><strong>海洋生物地球化学</strong><span>固定网格实时状态</span></div><dl class="detail-grid"><div><dt>溶解营养盐</dt><dd>${formatPercent(nutrients).value}%</dd></div><div><dt>溶解氧</dt><dd>${formatPercent(oxygen).value}%</dd></div><div><dt>初级生产力</dt><dd>${formatPercent(productivity).value}%</dd></div><div><dt>浮游生物量</dt><dd>${formatPercent(plankton).value}%</dd></div><div><dt>有机碳</dt><dd>${formatPercent(organicCarbon).value}%</dd></div><div><dt>网格更新</dt><dd>${format(ocean.updateCount)} 次</dd></div></dl></section>`;
};

const detailTargets = (snapshot: WorldSnapshot, level: InspectorDetail["level"]): Array<{ id: string; label: string }> => {
  if (level === "region") return [];
  if (level === "substance") return (snapshot.substances ?? [])
    .filter((substance) => substance.regionId === snapshot.focusRegionId)
    .sort((left, right) => Number(right.status === "known") - Number(left.status === "known") || left.id.localeCompare(right.id))
    .map((substance) => ({ id: substance.id, label: `${substance.name} · ${substanceKindLabels[substance.kind]}` }));
  if (level === "pathogen") return (snapshot.pathogens ?? [])
    .filter((pathogen) => !snapshot.focusRegionId || pathogenPrevalenceForRegion(pathogen, snapshot.focusRegionId) > 0 || pathogen.regionId === snapshot.focusRegionId)
    .sort((left, right) => Number(right.status === "outbreak") - Number(left.status === "outbreak") || pathogenPrevalenceForRegion(right, snapshot.focusRegionId ?? right.regionId) - pathogenPrevalenceForRegion(left, snapshot.focusRegionId ?? left.regionId) || left.id.localeCompare(right.id))
    .map((pathogen) => ({ id: pathogen.id, label: `${pathogen.name} · ${pathogenStatusLabels[pathogen.status]}` }));
  const regionalPopulations = (snapshot.populations ?? []).filter((population) => population.regionId === snapshot.focusRegionId);
  if (level === "species") {
    const speciesIds = new Set(regionalPopulations.map((population) => population.speciesId));
    const targets = new Map<string, { id: string; label: string }>();
    for (const species of snapshot.species ?? []) {
      if (!speciesIds.has(species.id)) continue;
      targets.set(species.id, { id: species.id, label: `${speciesRoleLabels[species.role]} · ${speciesName(species)}` });
    }
    for (const species of snapshot.eventArchive?.archivedSpeciesSummaries ?? []) {
      const inRegion = !snapshot.focusRegionId
        || species.originRegionId === snapshot.focusRegionId
        || species.lastKnownRegionIds.includes(snapshot.focusRegionId);
      if (!inRegion) continue;
      targets.set(species.id, { id: species.id, label: `${speciesRoleLabels[species.role]} · ${speciesName(species)} · 已灭绝` });
    }
    return [...targets.values()]
  }
  if (level === "population") return regionalPopulations.map((population) => {
    const species = snapshot.species?.find((candidate) => candidate.id === population.speciesId);
    return { id: population.id, label: `${species?.name ?? population.id.slice(-8)} · ${format(population.count)} 个体` };
  });
  if (level === "agent") return (snapshot.projection?.agents ?? []).map((agent) => ({ id: agent.id, label: `${agent.id.slice(-8)} · ${Math.floor(agent.age)}岁` }));
  if (level === "facility") return (snapshot.facilities ?? [])
    .filter((facility) => !snapshot.focusRegionId || facility.regionId === snapshot.focusRegionId)
    .sort((left, right) => right.level - left.level || right.condition - left.condition || left.id.localeCompare(right.id))
    .map((facility) => ({ id: facility.id, label: `${knowledgeDomainLabels[facility.type]}设施 · ${facility.id.slice(-8)}` }));
  if (level === "culture") {
    const targets = new Map<string, { id: string; label: string }>();
    const summary = snapshot.selectedRegion?.cultureSummary;
    if (summary && (!snapshot.focusRegionId || summary.identity.originRegionId === snapshot.focusRegionId)) {
      targets.set(summary.id, { id: summary.id, label: `${summary.identity.name} · 聚合文化` });
    }
    for (const culture of snapshot.cultures ?? []) {
      if (culture.regionId !== snapshot.focusRegionId) continue;
      targets.set(culture.id, { id: culture.id, label: cultureIdentityForSnapshot(snapshot, culture.id)?.name ?? culture.id.slice(-8) });
    }
    return [...targets.values()];
  }
  if (level === "worldview") return (snapshot.worldviewEntities ?? [])
    .filter((entity) => entity.regionId === snapshot.focusRegionId)
    .map((entity) => ({ id: entity.id, label: `${worldviewEntityLabels[entity.kind]} · ${entity.name ?? entity.id.slice(-8)}` }));
  return organizationDetailTargets(snapshot)
    .filter((organization) => organization.type === level)
    .map((organization) => ({ id: organization.id, label: `${organizationName(organization)}${isArchivedOrganization(organization) ? " · 已归档" : ""}` }));
};

const ecologicalRelationshipsForSnapshot = (snapshot: WorldSnapshot, regionId?: RegionId): EcologicalRelationshipState[] => {
  const records = [
    ...(snapshot.ecologicalRelationships ?? []),
    ...(snapshot.selectedRegion?.ecologicalRelationships ?? []),
    ...(snapshot.projection?.ecologicalRelationships ?? []),
  ];
  const seen = new Set<string>();
  return records
    .filter((record) => (!regionId || record.regionId === regionId) && !seen.has(record.id) && seen.add(record.id))
    .sort((left, right) => Number(right.status === "active") - Number(left.status === "active") || right.strength - left.strength || left.id.localeCompare(right.id));
};

const ecologicalRelationshipReport = (snapshot: WorldSnapshot, regionId?: RegionId, speciesId?: string): string => {
  const speciesById = new Map((snapshot.species ?? []).map((species) => [species.id, species]));
  const records = ecologicalRelationshipsForSnapshot(snapshot, regionId)
    .filter((record) => !speciesId || record.fromSpeciesId === speciesId || record.toSpeciesId === speciesId)
    .slice(0, 12);
  return `<section class="organization-governance ecological-relationships" aria-label="种间关系"><div class="detail-heading"><strong>种间关系</strong><span>${records.length > 0 ? `当前记录 ${format(records.length)} 条，按活跃度排序` : "当前区域尚未形成稳定种间关系"}</span></div><dl class="detail-grid">${records.map((record) => {
    const from = speciesById.get(record.fromSpeciesId);
    const to = speciesById.get(record.toSpeciesId);
    return `<div><dt>${ecologicalRelationshipLabels[record.kind]}</dt><dd>${escapeHtml(from?.name ?? record.fromSpeciesId.slice(-8))} → ${escapeHtml(to?.name ?? record.toSpeciesId.slice(-8))}</dd></div><div><dt>强度 / 状态</dt><dd>${formatPercent(record.strength).value}% / ${record.status === "active" ? "活跃" : "休眠"}</dd></div><div><dt>累计交互</dt><dd>${format(record.interactionCount)} 次</dd></div><div><dt>累计影响</dt><dd>${formatNumber(record.cumulativeImpact, 2)} 单位</dd></div>`;
  }).join("")}</dl>${records.length > 0 ? `<div class="detail-tags">${records.slice(0, 8).map((record) => `<span>${ecologicalRelationshipLabels[record.kind]} · ${record.regionId} · 最近影响 ${formatNumber(record.lastImpact, 3)}</span>`).join("")}</div>` : ""}</section>`;
};

const detailReport = (snapshot: WorldSnapshot, detail: InspectorDetail, lineage: InspectorLineage): string => {
  const projection = snapshot.projection;
  if (detail.level === "region") {
    const available = detailLevels.slice(1).map((level) => {
      const count = level === "agent"
        ? projection?.agents.length ?? 0
        : level === "substance"
          ? detailTargets(snapshot, "substance").length
        : level === "species"
          ? detailTargets(snapshot, "species").length
        : level === "population"
          ? detailTargets(snapshot, "population").length
          : level === "culture"
            ? detailTargets(snapshot, "culture").length
          : level === "worldview"
              ? detailTargets(snapshot, "worldview").length
          : detailTargets(snapshot, level).length;
      const label = detailLevelLabel(level);
      return `<span><strong>${format(count)}</strong>${label}</span>`;
    }).join("");
    const facilities = (snapshot.facilities ?? []).filter((facility) => facility.regionId === snapshot.focusRegionId);
    const substances = (snapshot.substances ?? []).filter((substance) => substance.regionId === snapshot.focusRegionId);
    const environmentReport = regionalOceanReport(snapshot, snapshot.focusRegionId)
      + regionalAtmosphereReport(snapshot, snapshot.focusRegionId)
      + regionalTectonicReport(snapshot, snapshot.focusRegionId)
      + regionalHealthReport(snapshot, snapshot.focusRegionId)
      + ecologicalRelationshipReport(snapshot, snapshot.focusRegionId);
    const regionalCulture = (snapshot.cultures ?? []).find((culture) => culture.regionId === snapshot.focusRegionId);
    const regionalCultureSummary = snapshot.selectedRegion?.cultureSummary;
    const regionalIdentity = regionalCulture
      ? cultureIdentityForSnapshot(snapshot, regionalCulture.id)
      : regionalCultureSummary?.identity;
    const regionalSocietySummary = snapshot.selectedRegion?.societySummary;
    const aggregateSociety = lineage.source === "aggregate" && regionalSocietySummary
      ? aggregateSocietyReport(regionalSocietySummary, snapshot.selectedRegion?.population ?? 0, snapshot.selectedRegion?.socialPopulation ?? snapshot.selectedRegion?.population ?? 0)
      : "";
    return `<div class="detail-summary"><strong>区域总览</strong><span>${lineage.source === "aggregate" ? "来自聚合摘要，选择下方层级可查看可重建对象" : "来自实时微观投影"}</span><div class="detail-counts">${available}</div>${environmentReport}${regionalIdentity ? cultureSummaryReport(regionalIdentity, regionalCultureSummary) : ""}${aggregateSociety}${substanceInventoryReport(substances)}${facilityAssetsReport(facilities)}</div>`;
  }
  if (!detail.id) return `<div class="empty-state"><strong>请选择${detailLevelLabel(detail.level)}</strong><span>对象选择器会列出当前区域可查看的实体</span></div>`;
  if (detail.level === "culture") {
    const identity = cultureIdentityForSnapshot(snapshot, detail.id);
    const summary = cultureSummaryForSnapshot(snapshot, detail.id);
    return identity
      ? cultureDetailReport(detail.id, identity, summary)
      : `<div class="empty-state"><strong>文化暂不可用</strong><span>该文化记录尚未同步到当前快照</span></div>`;
  }
  if (detail.level === "substance") {
    const substance = snapshot.substances?.find((candidate) => candidate.id === detail.id);
    if (!substance) return `<div class="empty-state"><strong>物质暂不可用</strong><span>该物质记录可能尚未同步到当前快照</span></div>`;
    const parentNames = substance.parentIds.map((id) => snapshot.substances?.find((candidate) => candidate.id === id)?.name ?? id.slice(-8));
    const compositionLabels = { carbon: "碳", nitrogen: "氮", phosphorus: "磷", organics: "有机质", oxygen: "氧" } as const;
    const propertyLabels: Array<[keyof SubstanceState["properties"], string]> = [
      ["hardness", "硬度"],
      ["density", "密度"],
      ["reactivity", "反应性"],
      ["conductivity", "导电性"],
      ["energyPotential", "能量潜力"],
      ["biologicalAffinity", "生物亲和性"],
      ["stability", "稳定性"],
    ];
    const discovered = substance.status === "known"
      ? `已于 ${formatSimulationAge(substance.discoveryYears ?? substance.originYears)} 被 ${format(substance.discoveredByIds.length)} 名个体发现`
      : "仍处于潜藏状态，仅上帝视角可见";
    const depletionMilestone = snapshot.eventArchive?.milestones
      .filter((event) => event.kind === "substance-depletion" && event.sourceIds.includes(substance.id))
      .sort((left, right) => Number(right.tick) - Number(left.tick))[0];
    const depletionTime = depletionMilestone?.timelineDays
      ? formatSimulationAgeFromDays(depletionMilestone.timelineDays)
      : substance.depletedTimelineStep
        ? `时间线步骤 ${escapeHtml(substance.depletedTimelineStep)}`
        : "仍可开采";
    const reserveReport = substance.formation === "engineered"
      ? `<div><dt>天然储量</dt><dd>人工制造，不属于天然矿藏</dd></div>`
      : `<div><dt>初始储量</dt><dd>${formatNumber(substance.reserveCapacity, 2)} 单位</dd></div><div><dt>剩余储量</dt><dd>${formatNumber(substance.remainingReserve, 2)} 单位（${formatPercent(substanceReserveRatio(substance)).value}%）</dd></div><div><dt>累计开采</dt><dd>${formatNumber(substance.extractedTotal, 2)} 单位</dd></div><div><dt>枯竭时间</dt><dd>${depletionTime}</dd></div>`;
    return `<div class="detail-report"><div class="detail-title"><strong>物质报告</strong><span>${escapeHtml(substance.id)}</span></div><dl class="detail-grid"><div><dt>名称</dt><dd>${escapeHtml(substance.name)}</dd></div><div><dt>类型</dt><dd>${substanceKindLabels[substance.kind]}</dd></div><div><dt>形成方式</dt><dd>${substanceFormationLabels[substance.formation]}</dd></div><div><dt>状态</dt><dd>${substance.status === "known" ? substance.formation !== "engineered" && substance.remainingReserve <= 0 ? "已发现但天然储量已枯竭" : "已发现并可利用" : "自然潜藏"}</dd></div><div><dt>形成时间</dt><dd>${formatSimulationAge(substance.originYears)}</dd></div><div><dt>形成区域</dt><dd>${escapeHtml(substance.regionId)}</dd></div><div><dt>母材</dt><dd>${parentNames.length > 0 ? parentNames.map(escapeHtml).join("、") : "自然原生物质"}</dd></div><div><dt>发现记录</dt><dd>${discovered}</dd></div>${reserveReport}</dl><section class="organization-governance"><div class="detail-heading"><strong>性质</strong><span>全部为该世界规则内的相对指标</span></div><div class="detail-tags">${propertyLabels.map(([key, label]) => `<span>${label} ${formatPercent(substance.properties[key]).value}%</span>`).join("")}</div></section><section class="organization-governance"><div class="detail-heading"><strong>组成</strong><span>局地基础化学归一化比例</span></div><div class="detail-tags">${Object.entries(substance.composition).map(([field, value]) => `<span>${compositionLabels[field as keyof typeof compositionLabels]} ${formatPercent(value).value}%</span>`).join("")}</div></section><div class="detail-tags">${substance.discoveredByIds.map((id) => `<span>发现者 · ${escapeHtml(id.slice(-8))}</span>`).join("") || "<span>尚无文明发现记录</span>"}</div></div>`;
  }
  if (detail.level === "pathogen") {
    const pathogen = snapshot.pathogens?.find((candidate) => candidate.id === detail.id);
    if (!pathogen) return `<div class="empty-state"><strong>病原体暂不可用</strong><span>该记录可能尚未同步到当前快照</span></div>`;
    const host = snapshot.species?.find((species) => species.id === pathogen.hostSpeciesId);
    return `<div class="detail-report"><div class="detail-title"><strong>病原体报告</strong><span>${escapeHtml(pathogen.id)}</span></div><dl class="detail-grid"><div><dt>名称</dt><dd>${escapeHtml(pathogen.name)}</dd></div><div><dt>形态</dt><dd>${pathogenKindLabels[pathogen.kind]}</dd></div><div><dt>状态</dt><dd>${pathogenStatusLabels[pathogen.status]}</dd></div><div><dt>宿主谱系</dt><dd>${host ? escapeHtml(host.name ?? host.id.slice(-8)) : escapeHtml(pathogen.hostSpeciesId.slice(-8))}</dd></div><div><dt>起源区域</dt><dd>${escapeHtml(pathogen.regionId)}</dd></div><div><dt>出现时间</dt><dd>${formatSimulationAge(pathogen.originYears)}</dd></div><div><dt>当前流行率</dt><dd>${formatPercent(pathogen.prevalence).value}%</dd></div><div><dt>传播能力</dt><dd>${formatPercent(pathogen.transmission).value}%</dd></div><div><dt>致病强度</dt><dd>${formatPercent(pathogen.severity).value}%</dd></div><div><dt>环境持久性</dt><dd>${formatPercent(pathogen.persistence).value}%</dd></div><div><dt>累计病例</dt><dd>${format(pathogen.cumulativeCases)} 例</dd></div><div><dt>累计康复</dt><dd>${format(pathogen.cumulativeRecoveries)} 例</dd></div><div><dt>累计死亡</dt><dd>${format(pathogen.cumulativeDeaths)} 人</dd></div><div><dt>创新签名</dt><dd>${escapeHtml(pathogen.noveltySignature)}</dd></div></dl><section class="organization-governance" aria-label="疾病因果说明"><div class="detail-heading"><strong>演化依据</strong><span>由当地环境、宿主密度、接触关系和医疗能力共同决定</span></div><div class="detail-tags"><span>环境产生</span><span>接触传播</span><span>康复免疫</span><span>医疗抑制</span></div></section></div>`;
  }
  if (detail.level === "species") {
    const species = allSpeciesForSnapshot(snapshot).find((candidate) => candidate.id === detail.id);
    if (!species) return `<div class="empty-state"><strong>物种暂不可用</strong><span>该谱系没有保留在当前历史摘要容量内</span></div>`;
    const populations = (snapshot.populations ?? []).filter((population) => population.speciesId === species.id);
    const localCount = populations.filter((population) => population.regionId === snapshot.focusRegionId).reduce((sum, population) => sum + population.count, 0);
    const globalCount = isArchivedSpecies(species)
      ? species.lastKnownPopulation
      : populations.reduce((sum, population) => sum + population.count, 0);
    const blueprint = speciesBlueprintFor(species);
    const lineageRecords = allSpeciesForSnapshot(snapshot);
    const parent = species.parentId ? lineageRecords.find((candidate) => candidate.id === species.parentId) : undefined;
    const children = lineageRecords.filter((candidate) => candidate.parentId === species.id);
    const origin = species.originRegionId
      ? `${escapeHtml(species.originRegionId)} · ${species.originTimelineStep ? formatSimulationAgeFromDays(species.originTimelineStep) : formatSimulationAge(species.originYears ?? species.originTick ?? 0)}`
      : "旧历史记录，已补全生命蓝图";
    const archivedTime = isArchivedSpecies(species)
      ? species.archivedTimelineDays
        ? formatSimulationAgeFromDays(species.archivedTimelineDays)
        : formatSimulationAge(species.archivedYears)
      : "持续观测中";
    const populationLabel = isArchivedSpecies(species) ? "最后记录数量" : "全球数量";
    const knownRegions = isArchivedSpecies(species)
      ? species.lastKnownRegionIds
      : [...new Set(populations.map((population) => population.regionId))];
    const parentReport = parent ? detailLink("species", parent.id, speciesName(parent), parent.originRegionId) : species.parentId ? escapeHtml(species.parentId.slice(-8)) : "原生谱系";
    const lineageTags = [
      parent ? `<span>亲本 · ${parentReport}</span>` : "<span>亲本 · 原生谱系</span>",
      ...children.slice(0, 12).map((child) => `<span>后代分支 · ${detailLink("species", child.id, speciesName(child), child.originRegionId)}</span>`),
    ].join("");
    return `<div class="detail-report"><div class="detail-title"><strong>物种报告</strong><span>${escapeHtml(speciesName(species))}</span></div><dl class="detail-grid"><div><dt>生态角色</dt><dd>${speciesRoleLabels[species.role]}</dd></div><div><dt>状态</dt><dd>${isArchivedSpecies(species) ? "已灭绝 · 历史摘要" : "现存谱系"}</dd></div><div><dt>亲本谱系</dt><dd>${parentReport}</dd></div><div><dt>起源</dt><dd>${origin}</dd></div><div><dt>归档时间</dt><dd>${archivedTime}</dd></div><div><dt>局地数量</dt><dd>${format(localCount)} 个体</dd></div><div><dt>${populationLabel}</dt><dd>${format(globalCount)} 个体</dd></div><div><dt>最后活动区域</dt><dd>${knownRegions.length > 0 ? knownRegions.map(escapeHtml).join("、") : "未记录"}</dd></div><div><dt>后代分支</dt><dd>${format(children.length)} 支</dd></div><div><dt>适应温度</dt><dd>${formatPercent(species.traits.temperatureOptimum ?? 0).value}%</dd></div><div><dt>适应湿度</dt><dd>${formatPercent(species.traits.humidityOptimum ?? 0).value}%</dd></div><div><dt>移动性</dt><dd>${formatPercent(species.traits.mobility ?? 0).value}%</dd></div><div><dt>认知潜力</dt><dd>${formatPercent(species.traits.cognitivePotential ?? 0).value}%</dd></div></dl><section class="organization-governance" aria-label="生命谱系"><div class="detail-heading"><strong>演化谱系</strong><span>亲本、后代与最后活动范围</span></div><div class="detail-tags">${lineageTags || "<span>未记录分支</span>"}</div></section><section class="organization-governance" aria-label="生命蓝图"><div class="detail-heading"><strong>原创生命蓝图</strong><span>可遗传、可分化、可追溯</span></div><div class="detail-tags"><span>生化基础 · ${lifeBiochemistryLabels[blueprint.biochemistry]}</span><span>遗传载体 · ${geneticCarrierLabels[blueprint.geneticCarrier]}</span><span>细胞结构 · ${cellArchitectureLabels[blueprint.cellArchitecture]}</span><span>代谢方式 · ${metabolismLabels[blueprint.metabolism]}</span><span>身体结构 · ${bodyStructureLabels[blueprint.bodyPlan.structure]}</span><span>身体对称 · ${bodySymmetryLabels[blueprint.bodyPlan.symmetry]}</span><span>移动方式 · ${locomotionLabels[blueprint.bodyPlan.locomotion]}</span><span>附肢对数 · ${format(blueprint.bodyPlan.appendagePairs)}</span><span>感官系统 · ${blueprint.senses.map((sense) => sensoryLabels[sense]).join("、")}</span><span>繁殖方式 · ${reproductionLabels[blueprint.reproduction]}</span><span>寿命 · ${formatNumber(blueprint.lifespanYears, 1)} 年</span><span>成体尺度 · ${formatNumber(blueprint.adultScale, 2)}</span><span>代谢效率 · ${formatPercent(blueprint.metabolicEfficiency).value}%</span><span>繁殖力 · ${formatPercent(blueprint.fecundity).value}%</span><span>热耐受 · ${formatPercent(blueprint.thermalTolerance).value}%</span><span>保水性 · ${formatPercent(blueprint.hydrationRetention).value}%</span><span>突变率 · ${formatPercent(blueprint.mutationRate).value}%</span><span>遗传保真度 · ${formatPercent(blueprint.inheritanceFidelity).value}%</span><span>创新签名 · ${escapeHtml(blueprint.noveltySignature)}</span></div></section></div>`;
  }
  if (detail.level === "population") {
    const population = snapshot.populations?.find((candidate) => candidate.id === detail.id);
    if (!population) return `<div class="empty-state"><strong>种群暂不可用</strong><span>该种群可能已经迁徙或消亡</span></div>`;
    const species = snapshot.species?.find((candidate) => candidate.id === population.speciesId);
    const blueprint = species ? speciesBlueprintFor(species) : undefined;
    return `<div class="detail-report"><div class="detail-title"><strong>种群报告</strong><span>${escapeHtml(population.id)}</span></div><dl class="detail-grid"><div><dt>物种</dt><dd>${species ? `${speciesRoleLabels[species.role]} · ${escapeHtml(species.name ?? species.id.slice(-8))}` : escapeHtml(population.speciesId.slice(-8))}</dd></div><div><dt>个体数量</dt><dd>${format(population.count)} 个体</dd></div><div><dt>区域</dt><dd>${escapeHtml(population.regionId)}</dd></div><div><dt>能量状态</dt><dd>${formatPercent(population.energy).value}%</dd></div>${blueprint ? `<div><dt>代谢方式</dt><dd>${metabolismLabels[blueprint.metabolism]}</dd></div><div><dt>身体结构</dt><dd>${bodyStructureLabels[blueprint.bodyPlan.structure]}</dd></div><div><dt>感官系统</dt><dd>${blueprint.senses.map((sense) => sensoryLabels[sense]).join("、")}</dd></div><div><dt>繁殖方式</dt><dd>${reproductionLabels[blueprint.reproduction]}</dd></div>` : ""}</dl></div>`;
  }
  if (detail.level === "worldview") {
    const entity = snapshot.worldviewEntities?.find((candidate) => candidate.id === detail.id);
    if (!entity) return `<div class="empty-state"><strong>流派暂不可用</strong><span>该体系可能已在下一次快照中发生演化</span></div>`;
    const phenomenon = snapshot.worldviewPhenomena?.find((candidate) => candidate.id === entity.sourcePhenomenonId);
    const sponsor = entity.sponsorOrganizationId ? organizationForSnapshot(snapshot, entity.sponsorOrganizationId) : undefined;
    const members = entity.memberIds ?? [];
    const status = (entity.status ?? "active") === "active" ? "活跃传承" : "沉寂保留";
    const reserve = entity.resourceBalances["attunement-energy"] ?? 0;
    const interactions = (snapshot.worldviewInteractions ?? [])
      .filter((interaction) => interaction.sourceEntityId === entity.id || interaction.targetEntityId === entity.id)
      .sort((left, right) => right.lastInteractionTick - left.lastInteractionTick || left.id.localeCompare(right.id));
    const interactionReport = `<section class="organization-governance worldview-interaction-report" aria-label="世界观互动记录"><div class="detail-heading"><strong>跨体系互动</strong><span>记录传播、冲突与融合的真实结果</span></div><div class="detail-tags">${interactions.length > 0 ? interactions.slice(0, 12).map((interaction) => `<span>${worldviewInteractionLabels[interaction.kind]} · ${worldviewInteractionStatusLabels[interaction.status]} · ${format(interaction.successes)} 次</span>`).join("") : "<span>尚无跨体系互动记录</span>"}</div>${interactions.length > 0 ? `<p>接触区域 · ${interactions.slice(0, 4).map((interaction) => escapeHtml(worldviewInteractionLocation(interaction))).join(" / ")}</p>` : ""}${entity.derivedFromEntityIds?.length ? `<p>融合来源 · ${entity.derivedFromEntityIds.map((id) => escapeHtml(id.slice(-8))).join(" / ")}</p>` : ""}</section>`;
    return `<div class="detail-report"><div class="detail-title"><strong>流派报告</strong><span>${escapeHtml(entity.id)}</span></div><dl class="detail-grid"><div><dt>名称</dt><dd>${escapeHtml(entity.name ?? worldviewEntityLabels[entity.kind])}</dd></div><div><dt>类型</dt><dd>${worldviewEntityLabels[entity.kind]}</dd></div><div><dt>状态</dt><dd>${status}</dd></div><div><dt>影响力</dt><dd>${formatPercent(entity.influence).value}%</dd></div><div><dt>存续度</dt><dd>${formatPercent(entity.viability ?? entity.influence).value}%</dd></div><div><dt>成员</dt><dd>${format(members.length)} 人</dd></div><div><dt>支持者</dt><dd>${format(entity.supporterCount ?? members.length)} 人</dd></div><div><dt>活跃修行者</dt><dd>${format(entity.activePractitionerCount ?? 0)} 人</dd></div><div><dt>赞助组织</dt><dd>${format(entity.sponsorCount ?? (entity.sponsorOrganizationId ? 1 : 0))} 个</dd></div><div><dt>复兴次数</dt><dd>${format(entity.revivalCount ?? 0)} 次</dd></div><div><dt>创始者</dt><dd>${entity.founderId ? escapeHtml(entity.founderId.slice(-8)) : "集体形成"}</dd></div><div><dt>依据规律</dt><dd>${phenomenon ? escapeHtml(phenomenon.name) : "历史规律记录"}</dd></div><div><dt>赞助组织</dt><dd>${sponsor ? escapeHtml(organizationName(sponsor)) : entity.sponsorOrganizationId ? escapeHtml(entity.sponsorOrganizationId.slice(-8)) : "自主维持"}</dd></div><div><dt>能量储备</dt><dd>${formatNumber(reserve * 100, 1)} 单位</dd></div><div><dt>形成时间</dt><dd>${entity.originTick === undefined ? "旧历史记录" : `演化步 ${format(entity.originTick)}`}</dd></div></dl>${interactionReport}<div class="detail-tags">${members.length > 0 ? members.slice(0, 16).map((id) => `<span>成员 · ${escapeHtml(id.slice(-8))}</span>`).join("") : "<span>当前没有在世传承者</span>"}</div></div>`;
  }
  if (detail.level === "facility") return facilityDetailReport(snapshot, detail.id);
  if (detail.level === "agent") {
    const agent = projection?.agents.find((candidate) => candidate.id === detail.id);
    if (!agent) return `<div class="empty-state"><strong>对象暂不可用</strong><span>该实体可能已在下一次快照中离开当前区域</span></div>`;
    const relationships = projection?.relationships.filter((relationship) => relationship.fromId === agent.id || relationship.toId === agent.id) ?? [];
    const descendants = projection?.agents.filter((candidate) => candidate.parentIds.includes(agent.id)).length ?? 0;
    const family = projection?.organizations.find((organization) => organization.type === "family" && organization.memberIds.includes(agent.id));
    const knowledge = knowledgeForIds(snapshot, agent.knowledgeIds);
    const innovations = knowledge.filter((record) => record.domain);
    const technology = technologyForSnapshotRegion(snapshot, agent.regionId);
    const population = snapshot.populations?.find((candidate) => candidate.id === agent.populationId);
    const species = population ? snapshot.species?.find((candidate) => candidate.id === population.speciesId) : undefined;
    const blueprint = species ? speciesBlueprintFor(species) : undefined;
    const workforceId = agent.sourceId ?? agent.id;
    const workplaces = (snapshot.facilities ?? []).filter((facility) => facility.workforceIds.includes(workforceId));
    const occupationReport = `<section class="organization-governance" aria-label="职业与工作"><div class="detail-heading"><strong>职业与工作</strong><span>${workplaces.length > 0 ? `${format(workplaces.length)} 项在岗记录` : "当前未分配设施岗位"}</span></div><div class="detail-tags">${workplaces.length > 0 ? workplaces.map((facility) => `<span>${knowledgeDomainLabels[facility.type]}岗位 · ${escapeHtml(facility.id.slice(-8))} · 设施效能 ${formatPercent(facilityOperationalEffect(facility)).value}%</span>`).join("") : "<span>无设施岗位</span>"}</div></section>`;
    const geneticFitness = species ? (() => {
      const match = /^region:(\d+):(\d+)$/.exec(agent.regionId);
      const x = Math.max(0, Math.min(snapshot.fields.elevation.width - 1, Number(match?.[1] ?? 0)));
      const y = Math.max(0, Math.min(snapshot.fields.elevation.height - 1, Number(match?.[2] ?? 0)));
      const index = y * snapshot.fields.elevation.width + x;
      return geneticEnvironmentFitness(
        agent,
        species,
        snapshot.fields.temperature.values[index] ?? 0.5,
        snapshot.fields.humidity.values[index] ?? 0.5,
      );
    })() : undefined;
    const genetics = agent.genetics;
    const geneticReport = `<section class="organization-governance personal-genetics" aria-label="个体遗传"><div class="detail-heading"><strong>遗传与适应</strong><span>${genetics ? `第 ${format(genetics.generation)} 代 · 谱系 ${escapeHtml(genetics.lineageSignature)}` : "旧记录尚无遗传摘要"}</span></div><dl class="detail-grid"><div><dt>本代突变</dt><dd>${format(genetics?.mutationCount ?? 0)} 项</dd></div><div><dt>亲本差异</dt><dd>${formatPercent(genetics?.parentDivergence ?? 0).value}%</dd></div><div><dt>遗传保真度</dt><dd>${formatPercent(genetics?.inheritanceFidelity ?? blueprint?.inheritanceFidelity ?? 0).value}%</dd></div><div><dt>当地适应度</dt><dd>${formatPercent(geneticFitness?.fitness ?? 0).value}%</dd></div><div><dt>温度压力</dt><dd>${formatPercent(geneticFitness?.thermalStress ?? 0).value}%</dd></div><div><dt>水分压力</dt><dd>${formatPercent(geneticFitness?.hydrationStress ?? 0).value}%</dd></div></dl><div class="detail-tags">${HERITABLE_AGENT_TRAITS.map((trait) => `<span>${geneticTraitLabels[trait]} ${formatPercent(agent.traits[trait] ?? 0).value}%</span>`).join("")}</div></section>`;
    const infectionRecords = (agent.health?.infections ?? []).map((infection) => ({ infection, pathogen: snapshot.pathogens?.find((pathogen) => pathogen.id === infection.pathogenId) }));
    const personalHealthReport = `<section class="organization-governance personal-health" aria-label="个人健康"><div class="detail-heading"><strong>个人健康</strong><span>${infectionRecords.length > 0 ? `${format(infectionRecords.length)} 项活动感染` : "当前没有活动感染"}</span></div><dl class="detail-grid"><div><dt>生命活力</dt><dd>${formatPercent(agent.health?.vitality ?? 1).value}%</dd></div><div><dt>免疫记录</dt><dd>${format(agent.health?.immunityIds.length ?? 0)} 种</dd></div></dl><div class="detail-tags">${infectionRecords.length > 0 ? infectionRecords.map(({ infection, pathogen }) => `<span>${escapeHtml(pathogen?.name ?? infection.pathogenId.slice(-8))} · 病程强度 ${formatPercent(infection.severity).value}%</span>`).join("") : "<span>健康状态稳定</span>"}</div></section>`;
    return `<div class="detail-report"><div class="detail-title"><strong>个人报告</strong><span>${escapeHtml(agent.id)}</span></div><dl class="detail-grid"><div><dt>年龄 / 寿命</dt><dd>${format(agent.age)} / ${format(agent.lifespan)} 年</dd></div><div><dt>生物谱系</dt><dd>${species ? escapeHtml(species.name ?? species.id.slice(-8)) : "未同步"}</dd></div>${blueprint ? `<div><dt>遗传载体</dt><dd>${geneticCarrierLabels[blueprint.geneticCarrier]}</dd></div><div><dt>代谢方式</dt><dd>${metabolismLabels[blueprint.metabolism]}</dd></div>` : ""}<div><dt>健康活力</dt><dd>${formatPercent(agent.health?.vitality ?? 1).value}%</dd></div><div><dt>活动感染</dt><dd>${format(infectionRecords.length)} 项</dd></div><div><dt>家庭</dt><dd>${family ? escapeHtml(organizationName(family)) : "未归属"}</dd></div><div><dt>父母</dt><dd>${format(agent.parentIds.length)} 人</dd></div><div><dt>后代</dt><dd>${format(descendants)} 人</dd></div><div><dt>关系</dt><dd>${format(relationships.length)} 条</dd></div><div><dt>知识 / 信念</dt><dd>${format(agent.knowledgeIds.length)} 条 / ${format(agent.beliefIds.length)} 条</dd></div><div><dt>原创技术</dt><dd>${format(innovations.length)} 项</dd></div></dl><div class="detail-tags">${Object.entries(agent.skills).map(([skill, value]) => `<span>${escapeHtml(skillLabel(skill))} ${formatPercent(value).value}%</span>`).join("")}${knowledge.slice(0, 8).map((record) => `<span>${record.domain ? `${knowledgeDomainLabels[record.domain]} · ` : ""}${escapeHtml(knowledgeName(record))}</span>`).join("")}</div>${geneticReport}${personalHealthReport}${occupationReport}${technologyEffectsReport(technology)}</div>`;
  }
  const organization = organizationForSnapshot(snapshot, detail.id);
  if (!organization) return `<div class="empty-state"><strong>组织暂不可用</strong><span>该组织可能已在下一次快照中发生演化</span></div>`;
  const summaryOrganization = snapshot.selectedRegion?.organizations.find((candidate) => candidate.id === organization.id);
  const familyLineage = snapshot.selectedRegion?.familyLineages.find((candidate) => candidate.id === organization.id);
  const memberIds = organizationMemberIds(organization);
  const memberCount = summaryOrganization?.memberCount ?? ("memberCount" in organization ? organization.memberCount : memberIds.length);
  const localRelationships = projection?.relationships.filter((relationship) => memberIds.includes(relationship.fromId) && memberIds.includes(relationship.toId)) ?? [];
  const directoryRelationshipCount = "relationshipCount" in organization ? organization.relationshipCount : 0;
  const relationshipCount = localRelationships.length > 0 || projection?.organizations.some((candidate) => candidate.id === organization.id)
    ? localRelationships.length
    : directoryRelationshipCount;
  const organizationBalances = resourceBalancesForOrganization(snapshot, organization);
  const food = organizationBalances.food ?? 0;
  const materials = organizationBalances.materials ?? 0;
  const energy = organizationBalances.energy ?? 0;
  const governance = governanceForOrganization({ type: organization.type, ...(organization.governance ? { governance: organization.governance } : {}) });
  const diplomacy = Object.entries(organization.diplomacy ?? {})
    .filter(([, stance]) => stance !== "neutral")
    .sort(([left], [right]) => left.localeCompare(right));
  const showsGovernance = ["city", "state", "federation", "empire"].includes(organization.type);
  const governanceReport = showsGovernance ? `<section class="organization-governance" aria-label="治理状态"><div class="detail-heading"><strong>治理状态</strong><span>每年根据供给、关系、领土与冲突更新</span></div><dl class="detail-grid"><div><dt>稳定度</dt><dd>${formatPercent(governance.stability).value}%</dd></div><div><dt>合法性</dt><dd>${formatPercent(governance.legitimacy).value}%</dd></div><div><dt>军力</dt><dd>${formatPercent(governance.military).value}%</dd></div><div><dt>凝聚力</dt><dd>${formatPercent(governance.cohesion).value}%</dd></div><div><dt>财政储备</dt><dd>${formatNumber(governance.treasury * 100, 1)} 单位</dd></div><div><dt>公共资源</dt><dd>${formatPercent(governance.publicGoods).value}%</dd></div><div><dt>税率 / 年税收</dt><dd>${formatPercent(governance.taxRate).value}% / ${formatNumber(governance.taxRevenue * 100, 1)}</dd></div><div><dt>战争疲劳</dt><dd>${formatPercent(governance.warWeariness).value}%</dd></div></dl><div class="detail-tags">${diplomacy.length > 0 ? diplomacy.map(([id, stance]) => `<span>${diplomaticLabels[stance]} · ${escapeHtml(id.slice(-8))}</span>`).join("") : "<span>尚无跨区域外交关系</span>"}</div></section>` : "";
  const organizationKnowledge = knowledgeForRegions(snapshot, organization.territoryRegionIds);
  const innovations = organizationKnowledge.filter((knowledge) => knowledge.domain);
  const technologyReport = `<section class="organization-governance" aria-label="知识与技术"><div class="detail-heading"><strong>知识与技术</strong><span>保留来源地区与前置知识</span></div><div class="detail-tags">${organizationKnowledge.length > 0 ? organizationKnowledge.slice(0, 10).map((knowledge) => `<span>${knowledge.domain ? `${knowledgeDomainLabels[knowledge.domain]} · ` : ""}${escapeHtml(knowledgeName(knowledge))}</span>`).join("") : "<span>尚未形成可记录知识</span>"}</div></section>`;
  const technology = technologyForOrganization(snapshot, organization);
  const jurisdiction = new Set(organization.territoryRegionIds);
  const facilities = (snapshot.facilities ?? []).filter((facility) => facility.ownerOrganizationId === organization.id || jurisdiction.has(facility.regionId));
  const substances = (snapshot.substances ?? []).filter((substance) => jurisdiction.has(substance.regionId));
  const jurisdictionPathogenRecords = (snapshot.pathogens ?? []).map((pathogen) => {
    const outbreaks = [...jurisdiction]
      .map((regionId) => pathogenOutbreakForRegion(pathogen, regionId))
      .filter((outbreak): outbreak is NonNullable<typeof outbreak> => Boolean(outbreak))
      .sort((left, right) => right.prevalence - left.prevalence || left.regionId.localeCompare(right.regionId));
    return { pathogen, outbreak: outbreaks[0] };
  }).filter((record) => Boolean(record.outbreak));
  const projectedMembers = projection?.agents.filter((agent) => memberIds.includes(agent.id) || (agent.sourceId ? memberIds.includes(agent.sourceId) : false)) ?? [];
  const infectedMembers = projectedMembers.filter((agent) => (agent.health?.infections.length ?? 0) > 0).length;
  const jurisdictionPrevalence = Math.max(0, ...jurisdictionPathogenRecords.map((record) => record.outbreak?.prevalence ?? 0));
  const publicHealthReport = `<section class="organization-governance public-health" aria-label="组织公共健康"><div class="detail-heading"><strong>公共健康</strong><span>医疗知识和设施会抑制传播、重症与死亡</span></div><dl class="detail-grid"><div><dt>辖区病原体</dt><dd>${format(jurisdictionPathogenRecords.length)} 种</dd></div><div><dt>最高流行率</dt><dd>${formatPercent(jurisdictionPrevalence).value}%</dd></div><div><dt>可观察感染成员</dt><dd>${format(infectedMembers)} 人</dd></div><div><dt>医养技术</dt><dd>${formatPercent(technology.medicine).value}%</dd></div></dl><div class="detail-tags">${jurisdictionPathogenRecords.length > 0 ? jurisdictionPathogenRecords.slice(0, 8).map(({ pathogen, outbreak }) => `<span>${escapeHtml(pathogen.name)} · ${pathogenStatusLabels[outbreak!.status]} · ${formatPercent(outbreak!.prevalence).value}%</span>`).join("") : "<span>辖区尚无已记录疫情</span>"}</div></section>`;
  const recentHistoryCount = summaryOrganization?.historyIds.length ?? ("historyCount" in organization ? organization.historyCount : 0);
  const archivedHistoryCount = isArchivedOrganization(organization)
    ? 0
    : Math.max(summaryOrganization?.archivedHistoryCount ?? 0, organization.archivedHistoryCount ?? 0);
  const childIds = organizationChildIds(organization);
  const status = "status" in organization ? organization.status : "active";
  const statusLabels = { active: "活跃", migrating: "迁徙中", fragmenting: "分裂中", collapsed: "已解体" } as const;
  let archiveReport = isArchivedOrganization(organization)
    ? `<section class="organization-governance organization-archive" aria-label="历史组织摘要"><div class="detail-heading"><strong>历史组织摘要</strong><span>${organization.archiveReason === "capacity" ? "因运行容量限制归档" : "因组织生命周期结束归档"}</span></div><dl class="detail-grid"><div><dt>归档时间</dt><dd>${organization.archivedTimelineDays ? formatSimulationAgeFromDays(organization.archivedTimelineDays) : formatSimulationAge(organization.archivedYears)}</dd></div><div><dt>归档状态</dt><dd>${statusLabels[organization.status]}</dd></div><div><dt>历史事件</dt><dd>${format(organization.historyCount)} 条</dd></div><div><dt>保留成员</dt><dd>${format(organization.memberIds.length)} / ${format(organization.memberCount)} 人</dd></div></dl></section>`
    : "";
  archiveReport += strategicRouteHistoryReport(snapshot, organization);
  return `<div class="detail-report"><div class="detail-title"><strong>${organizationLabels[organization.type]}报告</strong><span>${escapeHtml(organization.id)}</span></div>${archiveReport}<dl class="detail-grid"><div><dt>成员</dt><dd>${format(memberCount)} 人</dd></div><div><dt>状态</dt><dd>${statusLabels[status]}</dd></div><div><dt>领土</dt><dd>${format(organization.territoryRegionIds.length)} 格</dd></div><div><dt>下属组织</dt><dd>${format(childIds.length)} 个</dd></div><div><dt>内部关系</dt><dd>${format(relationshipCount)} 条</dd></div><div><dt>食物资源</dt><dd>${formatResource(food).value} ${formatResource(food).unit}</dd></div><div><dt>建造材料</dt><dd>${formatNumber(materials, 1)} 材料单位</dd></div><div><dt>能源储备</dt><dd>${formatNumber(energy, 2)} 能源单位</dd></div><div><dt>谱系 / 知识</dt><dd>${familyLineage ? `${format(familyLineage.generationDepth)} 代 / ${format(familyLineage.knowledgeInheritanceCount)} 条` : "聚合统计"}</dd></div><div><dt>原创技术</dt><dd>${format(innovations.length)} 项</dd></div><div><dt>原创物质</dt><dd>${format(substances.length)} 种</dd></div><div><dt>病原体记录</dt><dd>${format(jurisdictionPathogenRecords.length)} 种</dd></div><div><dt>可追溯事件</dt><dd>${format(recentHistoryCount + archivedHistoryCount)} 条${archivedHistoryCount > 0 ? `（${format(archivedHistoryCount)} 条已归档）` : ""}</dd></div><div><dt>中心区域</dt><dd>${escapeHtml(organization.regionId)}</dd></div></dl><div class="detail-tags">${organization.territoryRegionIds.slice(0, 12).map((id) => `<span>${escapeHtml(id)}</span>`).join("") || "<span>暂无领土记录</span>"}</div>${organizationNavigationReport(snapshot, organization, memberIds, projectedMembers)}${publicHealthReport}${technologyReport}${technologyEffectsReport(technology)}${substanceInventoryReport(substances)}${facilityAssetsReport(facilities)}${supplyChainReport(snapshot, organization, { food, materials, energy })}${governanceReport}</div>`;
};

const pathogenRegionalSpreadReport = (snapshot: WorldSnapshot, detail: InspectorDetail): string => {
  if (detail.level !== "pathogen" || !detail.id) return "";
  const pathogen = snapshot.pathogens?.find((candidate) => candidate.id === detail.id);
  if (!pathogen) return "";
  const outbreaks = [...pathogen.regionalOutbreaks]
    .sort((left, right) => Number(right.status === "outbreak") - Number(left.status === "outbreak") || right.prevalence - left.prevalence || left.regionId.localeCompare(right.regionId));
  const activeCount = outbreaks.filter((outbreak) => outbreak.status !== "dormant").length;
  return `<section class="organization-governance public-health" aria-label="跨区域疫情"><div class="detail-heading"><strong>跨区域疫情</strong><span>${format(activeCount)} 个活跃区域 · ${format(outbreaks.length)} 个历史落点</span></div><div class="detail-tags">${outbreaks.slice(0, 16).map((outbreak) => `<span>${escapeHtml(outbreak.regionId)} · ${pathogenStatusLabels[outbreak.status]} · ${formatPercent(outbreak.prevalence).value}%</span>`).join("") || "<span>尚未建立区域传播记录</span>"}</div></section>`;
};

export const renderInspector = (element: HTMLElement, snapshot: WorldSnapshot, selection?: CellSelection, detail: InspectorDetail = { level: "region" }): void => {
  if (!selection) {
    element.innerHTML = `<div class="empty-state"><strong>未选择区域</strong><span>环境与社会状态</span></div>`;
    return;
  }
  const fields = snapshot.fields;
  const chemistry = snapshot.chemistry;
  const lineage = lineageForSnapshot(snapshot);
  const worldviewRecords = (snapshot.worldviewPhenomena ?? [])
    .filter((record) => record.regionId === selection.regionId)
    .sort((left, right) => left.originTick - right.originTick || left.id.localeCompare(right.id));
  const worldviewById = new Map((snapshot.worldviewPhenomena ?? []).map((record) => [record.id, record]));
  const worldviewPractices = (snapshot.worldviewPractices ?? [])
    .filter((practice) => practice.regionId === selection.regionId)
    .sort((left, right) => right.attunement - left.attunement || left.id.localeCompare(right.id));
  const worldviewEntities = (snapshot.worldviewEntities ?? [])
    .filter((entity) => entity.regionId === selection.regionId)
    .sort((left, right) => right.influence - left.influence || left.id.localeCompare(right.id));
  const worldviewInteractions = (snapshot.worldviewInteractions ?? [])
    .filter((interaction) => interaction.regionId === selection.regionId || interaction.targetRegionId === selection.regionId)
    .sort((left, right) => right.lastInteractionTick - left.lastInteractionTick || left.id.localeCompare(right.id));
  const regionalKnowledge = knowledgeForRegion(snapshot, selection.regionId);
  const regionalTechnology = technologyForSnapshotRegion(snapshot, selection.regionId);
  const regionalSubstances = (snapshot.substances ?? []).filter((substance) => substance.regionId === selection.regionId);
  const knowledgeById = new Map((snapshot.knowledge ?? []).map((knowledge) => [knowledge.id, knowledge]));
  const agentsById = new Map((snapshot.projection?.agents ?? []).map((agent) => [agent.id, agent]));
  const organizationsById = new Map((snapshot.projection?.organizations ?? []).map((organization) => [organization.id, organization]));
  const targets = detailTargets(snapshot, detail.level);
  const targetOptions = detail.level === "region"
    ? "<option>区域总览</option>"
    : targets.length > 0
      ? `<option value="">选择${detailLevelLabel(detail.level)}</option>${targets.map((target) => `<option value="${escapeHtml(target.id)}"${target.id === detail.id ? " selected" : ""}>${escapeHtml(target.label)}</option>`).join("")}`
      : `<option value="">当前区域暂无${detailLevelLabel(detail.level)}</option>`;
  const familyRows = (lineage.familyLineages.length > 0 ? lineage.familyLineages : lineage.families.map((family) => ({
    id: family.id,
    memberCount: family.memberCount,
    relationshipCount: 0,
    descendantCount: 0,
    generationDepth: 0,
    knowledgeCarrierCount: 0,
    knowledgeInheritanceCount: 0,
    beliefCarrierCount: 0,
    relationshipCounts: {},
  }))).slice(0, 3).map((family, index) => `
    <li><span>家庭 ${String(index + 1).padStart(2, "0")} · ${format(family.relationshipCount)} 关系</span><strong>${format(family.memberCount)} 名成员 · ${format(family.descendantCount)} 后代 · ${format(family.knowledgeInheritanceCount)} 条知识</strong></li>
  `).join("");
  const entityHistory = isOrganizationDetailLevel(detail.level) && detail.id
    ? `${regionalHistoryReport(snapshot, detail.id)}${objectHistoryReport(snapshot, detail)}`
    : objectHistoryReport(snapshot, detail);
  const seasonLabels = { spring: "春季", summer: "夏季", autumn: "秋季", winter: "冬季" } as const;
  const seasonalOffset = snapshot.orbital
    ? seasonalTemperatureOffset(snapshot.orbital, selection.y, fields.elevation.height)
    : undefined;
  const atmosphere = snapshot.atmosphere;
  const windSpeed = atmosphere
    ? Math.hypot(atmosphere.windX.values[selection.index] ?? 0, atmosphere.windY.values[selection.index] ?? 0)
    : undefined;
  const ocean = snapshot.ocean;
  element.innerHTML = `
    <div class="inspector-head"><div><strong>${formatRegionCoordinates(selection.x, selection.y, fields.elevation.width, fields.elevation.height)}</strong><small>${selection.regionId}</small></div><span>${lineage.source === "aggregate" ? "聚合摘要" : "实时微观投影"}</span></div>
    <section class="observation-group" aria-label="区域地表">
      <h3><span>地表</span><small>高度与局地气候</small></h3>
      <dl class="observation-list">
        ${observationMetric("模拟海拔", formatElevation(fields.elevation.values[selection.index]), "海平面为 0 m")}
        ${observationMetric("模型温度", formatModelTemperature(fields.temperature.values[selection.index]), "换算温标")}
        ${observationMetric("地表水量", formatIndex(fields.water.values[selection.index]), "相对指数")}
        ${observationMetric("空气湿度", formatPercent(fields.humidity.values[selection.index]))}
        ${atmosphere ? observationMetric("相对气压", formatPercent(atmosphere.pressure.values[selection.index]), "大气环流场") : ""}
        ${atmosphere ? observationMetric("实际降水", formatPercent(atmosphere.precipitation.values[selection.index]), "气流输送与地形抬升") : ""}
        ${windSpeed === undefined ? "" : observationMetric("风速指数", formatPercent(windSpeed), "东西与南北风场合成")}
        ${snapshot.orbital ? observationMetric("当前季节", { value: seasonLabels[snapshot.orbital.season], unit: "" }) : ""}
        ${seasonalOffset === undefined ? "" : observationMetric("季节温度偏置", { value: formatNumber(seasonalOffset * 100, 1), unit: "模型点" }, "由轴倾角与纬度决定")}
      </dl>
    </section>
    ${ocean ? `<section class="observation-group" aria-label="区域海洋"><h3><span>海洋</span><small>海温、盐度与洋流</small></h3><dl class="observation-list">${(fields.elevation.values[selection.index] ?? 0) < 0.48 ? `${observationMetric("海表温度", formatPercent(ocean.seaTemperature.values[selection.index]), "相对海温")}${observationMetric("相对盐度", formatPercent(ocean.salinity.values[selection.index]), "相对盐度")}${observationMetric("洋流速度", formatPercent(Math.hypot(ocean.currentX.values[selection.index] ?? 0, ocean.currentY.values[selection.index] ?? 0)), "东西与南北流分量")}${observationMetric("海冰覆盖", formatPercent(ocean.seaIce.values[selection.index]), "相对覆盖")}` : `<div class="observation-empty">当前坐标为陆地区域</div>`}</dl></section>` : ""}
    <section class="observation-group" aria-label="区域生态">
      <h3><span>生态</span><small>局地承载状态</small></h3>
      <dl class="observation-list">
        ${observationMetric("养分水平", formatIndex(fields.nutrients.values[selection.index]), "相对指数")}
        ${observationMetric("生物量", formatIndex(fields.biomass.values[selection.index]), "相对指数")}
        ${observationMetric("迁徙活跃度", formatPercent(lineage.migrationRate), "区域事件率")}
      </dl>
    </section>
    <section class="observation-group" aria-label="区域化学">
      <h3><span>化学</span><small>模型相对浓度</small></h3>
      <dl class="observation-list">
        ${observationMetric("碳", formatPercent(chemistry.carbon.values[selection.index]), "相对浓度")}
        ${observationMetric("氧气", formatPercent(chemistry.oxygen.values[selection.index]), "相对浓度")}
        ${observationMetric("氮", formatPercent(chemistry.nitrogen.values[selection.index]), "相对浓度")}
        ${observationMetric("磷", formatPercent(chemistry.phosphorus.values[selection.index]), "相对浓度")}
        ${observationMetric("有机物", formatPercent(chemistry.organics.values[selection.index]), "相对浓度")}
      </dl>
    </section>
    ${substanceInventoryReport(regionalSubstances)}
    <section class="worldview-records knowledge-records" aria-label="知识与技术">
      <div class="worldview-heading"><strong>知识与技术</strong><span>由当地条件自主产生，并可跨文明传播</span></div>
      <ol class="worldview-list">
        ${regionalKnowledge.length > 0 ? regionalKnowledge.slice(0, 12).map((knowledge) => {
          const parentNames = (knowledge.parentIds ?? []).map((id) => knowledgeById.get(id)).filter((parent): parent is KnowledgeState => Boolean(parent)).map(knowledgeName);
          const domain = knowledge.domain ? knowledgeDomainLabels[knowledge.domain] : "基础实践";
          const origin = knowledge.originYears === undefined ? "当地传承记录" : `形成于 ${formatSimulationAge(knowledge.originYears)}`;
          return `<li data-knowledge-domain="${knowledge.domain ?? "practice"}"><div><span>${domain}</span><small>${origin}</small></div><strong>${escapeHtml(knowledgeName(knowledge))}</strong><p>${parentNames.length > 0 ? `源自 ${parentNames.map(escapeHtml).join("、")}` : `来源 ${escapeHtml(knowledge.originRegionId ?? selection.regionId)} · ${format(knowledge.sourceIds.length)} 名首创者`}</p></li>`;
        }).join("") : "<li class=\"worldview-empty\">尚未形成可记录的实践或原创技术</li>"}
      </ol>
    </section>
    ${technologyEffectsReport(regionalTechnology)}
    <section class="worldview-records" aria-label="流派与体系">
      <div class="worldview-heading"><strong>流派与体系</strong><span>由真实实践者、师承与资源共同维持</span></div>
      <ol class="worldview-list">
        ${worldviewEntities.length > 0 ? worldviewEntities.map((entity) => {
          const phenomenon = worldviewById.get(entity.sourcePhenomenonId ?? "");
          const status = (entity.status ?? "active") === "active" ? "活跃传承" : "沉寂保留";
          return `<li data-worldview-entity-kind="${entity.kind}" data-worldview-status="${entity.status ?? "active"}"><div><span>${worldviewEntityLabels[entity.kind]}</span><small>${status}</small></div><strong>${escapeHtml(entity.name ?? entity.id.slice(-8))}</strong><p>${format(entity.memberIds?.length ?? 0)} 名成员 · 支持者 ${format(entity.supporterCount ?? entity.memberIds?.length ?? 0)} 人 · 存续度 ${formatPercent(entity.viability ?? entity.influence).value}%</p><p>影响力 ${formatPercent(entity.influence).value}%${phenomenon ? ` · 依据 ${escapeHtml(phenomenon.name)}` : ""}</p></li>`;
        }).join("") : "<li class=\"worldview-empty\">尚未形成稳定流派、神话实体或修行路径</li>"}
      </ol>
    </section>
    <section class="worldview-records" aria-label="认知与传说">
      <div class="worldview-heading"><strong>认知与传说</strong><span>观测、理论、信仰与验证严格分离</span></div>
      <ol class="worldview-list">
        ${worldviewRecords.length > 0 ? worldviewRecords.map((record) => {
          const parentNames = record.parentIds.map((id) => worldviewById.get(id)?.name).filter((name): name is string => Boolean(name));
          return `<li data-epistemic-status="${record.epistemicStatus}"><div><span>${epistemicLabels[record.epistemicStatus]}</span><small>演化步 ${format(record.originTick)}</small></div><strong>${escapeHtml(record.name)}</strong><p>${parentNames.length > 0 ? `源自 ${parentNames.map(escapeHtml).join("、")}` : "源自当地可重复观测的环境证据"}</p></li>`;
        }).join("") : "<li class=\"worldview-empty\">尚未形成异常观测、文明理论或神话记录</li>"}
      </ol>
    </section>
    <section class="worldview-records" aria-label="世界观互动">
      <div class="worldview-heading"><strong>世界观互动</strong><span>传播、冲突与融合只在真实接触和相容条件下发生</span></div>
      <ol class="worldview-list">
        ${worldviewInteractions.length > 0 ? worldviewInteractions.slice(0, 12).map((interaction) => {
          const source = worldviewEntities.find((entity) => entity.id === interaction.sourceEntityId) ?? (snapshot.worldviewEntities ?? []).find((entity) => entity.id === interaction.sourceEntityId);
          const target = worldviewEntities.find((entity) => entity.id === interaction.targetEntityId) ?? (snapshot.worldviewEntities ?? []).find((entity) => entity.id === interaction.targetEntityId);
          return `<li data-worldview-interaction-kind="${interaction.kind}" data-worldview-interaction-status="${interaction.status}"><div><span>${worldviewInteractionLabels[interaction.kind]}</span><small>${worldviewInteractionStatusLabels[interaction.status]}</small></div><strong>${escapeHtml(source?.name ?? interaction.sourceEntityId.slice(-8))} / ${escapeHtml(target?.name ?? interaction.targetEntityId.slice(-8))}</strong><p>相容度 ${formatPercent(interaction.compatibility).value}% · 强度 ${formatPercent(interaction.intensity).value}% · 发生 ${format(interaction.successes)} 次</p><p>接触区域 · ${escapeHtml(worldviewInteractionLocation(interaction))}</p><p>实际影响 · ${escapeHtml(worldviewInteractionEffect(interaction))}</p></li>`;
        }).join("") : "<li class=\"worldview-empty\">当地尚未发生跨体系传播、冲突或融合</li>"}
      </ol>
    </section>
    <section class="practice-records" aria-label="规律训练">
      <div class="worldview-heading"><strong>规律训练</strong><span>只在已验证规律后出现</span></div>
      <ol class="practice-list">
        ${worldviewPractices.length > 0 ? worldviewPractices.map((practice) => {
          const practitioner = agentsById.get(practice.practitionerId);
          const teacher = practice.teacherId ? agentsById.get(practice.teacherId) : undefined;
          const source = worldviewById.get(practice.phenomenonId);
          const organization = practice.organizationId ? organizationsById.get(practice.organizationId) : undefined;
          const resourceHolderId = practice.organizationId ?? practice.practitionerId;
          const energyReserve = snapshot.selectedRegion?.resources
            .filter((resource) => resource.resourceId === "attunement-energy" && resource.holderId === resourceHolderId)
            .reduce((sum, resource) => sum + resource.amount, 0) ?? 0;
          const statusLabel = practice.status === "active" ? "训练中" : practice.status === "dormant" ? "能量停滞" : "训练失败";
          return `<li data-practice-status="${practice.status}"><div><span>${statusLabel}</span><small>${teacher ? `师承 ${escapeHtml(teacher.id.slice(-8))}` : "自主发现"}</small></div><strong>${escapeHtml(practice.name)}</strong><p>${practitioner ? `实践者 ${escapeHtml(practitioner.id.slice(-8))}` : "实践者已离开当前投影"} · 能量 ${formatNumber(practice.energy * 100, 1)}/100 · 共鸣 ${formatNumber(practice.attunement * 100, 1)}/100</p><p>${organization ? `所属 ${escapeHtml(organizationName(organization))}` : "个体储备"} · 能量储备 ${formatNumber(energyReserve * 100, 1)} 单位</p><p>${source ? `依据 ${escapeHtml(source.name)}` : "依据已失去记录"} · ${formatNumber(practice.attempts)} 次训练 · ${formatNumber(practice.failures)} 次受挫</p></li>`;
        }).join("") : "<li class=\"practice-empty\">尚无个体从已验证规律中形成训练方法</li>"}
      </ol>
    </section>
    <section class="lineage-section" aria-label="家庭谱系">
      <div class="lineage-heading"><strong>家庭谱系</strong><span>${format(lineage.population)} 个体 · ${format(lineage.relationshipCount)} 关系</span></div>
      <dl class="lineage-metrics">
        <div><dt>家庭</dt><dd>${format(lineage.householdCount)} 户</dd></div>
        <div><dt>后代</dt><dd>${format(lineage.descendantCount)} 人</dd></div>
        <div><dt>代际深度</dt><dd>${format(lineage.generationDepth)} 代</dd></div>
        <div><dt>知识承继</dt><dd>${format(lineage.knowledgeCarrierCount)} 人</dd></div>
      </dl>
      <div class="relationship-breakdown" aria-label="亲属关系">
        ${relationshipLabels.map(([kind, label]) => `<span><i data-kind="${kind}"></i>${label}<strong>${format(lineage.relationshipCounts[kind] ?? 0)}</strong></span>`).join("")}
      </div>
      <div class="inheritance-note"><span>代际知识传承</span><strong>${format(lineage.knowledgeInheritanceCount)} 条知识</strong></div>
      <div class="food-security"><span>食物保障</span><strong>${formatResource(lineage.foodBalance).value} ${formatResource(lineage.foodBalance).unit} · 人均 ${formatNumber(lineage.foodPerAgent, 1)} 单位 · ${formatPercent(lineage.foodSecurity).value}%</strong></div>
      <ol class="family-list" aria-label="区域家庭">${familyRows || "<li class=\"family-empty\">尚未形成稳定家庭</li>"}</ol>
    </section>
    ${regionalHistoryReport(snapshot)}
    <section class="detail-section" aria-label="层级详情">
      <div class="detail-heading"><strong>层级详情报告</strong><span>可查看当前区域的社会实体</span></div>
      <nav class="detail-tabs" aria-label="详情层级">${detailLevels.map((level) => `<button type="button" data-detail-level="${level}" class="detail-tab${detail.level === level ? " active" : ""}">${detailLevelLabel(level)}</button>`).join("")}</nav>
      <select class="detail-target" data-detail-target aria-label="选择详情对象">${targetOptions}</select>
      <div class="detail-report-container">${detailReport(snapshot, detail, lineage)}${detail.level === "region" ? "" : ecologicalRelationshipReport(snapshot, snapshot.focusRegionId, detail.level === "species" ? detail.id : undefined)}${pathogenRegionalSpreadReport(snapshot, detail)}${entityHistory}</div>
    </section>
  `;
};
