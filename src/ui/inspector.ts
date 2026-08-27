import type { CellSelection } from "./map-canvas.ts";
import { summarizeLineage } from "../sim/lod/lineage.ts";
import type { AggregateKnowledgeSummary, CultureIdentity, FacilityState, FamilyLineageSummary, KnowledgeDomain, KnowledgeState, OrganizationState, OrganizationType, RegionCultureSummary, RegionId, RegionLineageSummary, RegionSocietySummary, SpeciesBlueprint, SubstanceState, WorldviewEntityState } from "../sim/types.ts";
import { governanceForOrganization } from "../sim/society/organization.ts";
import { speciesBlueprintFor } from "../sim/ecology/blueprints.ts";
import { facilityOperationalEffect, facilityWorkforceRequiredFor } from "../sim/society/facilities.ts";
import { technologyProfileForRegion } from "../sim/culture/technology.ts";
import type { OrganizationDirectoryEntry, RecentRegionEvent, WorldSnapshot } from "../worker/protocol.ts";
import { formatElevation, formatIndex, formatModelTemperature, formatNumber, formatPercent, formatRegionCoordinates, formatResource, formatSimulationAge, type FormattedMetric } from "./formatters.ts";

const format = (value: number): string => formatNumber(value);
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
type DetailLevel = "region" | "substance" | "species" | "population" | "agent" | "culture" | "worldview" | OrganizationType;
const detailLevels: DetailLevel[] = ["region", "substance", "species", "population", "agent", "culture", "family", "clan", "tribe", "settlement", "city", "state", "federation", "empire", "worldview"];
export type InspectorDetail = { level: DetailLevel; id?: string };
const isOrganizationDetailLevel = (level: DetailLevel): level is OrganizationType => ["family", "clan", "tribe", "settlement", "city", "state", "federation", "empire"].includes(level);

const detailLevelLabel = (level: DetailLevel): string => {
  if (level === "region") return "区域";
  if (level === "substance") return "物质";
  if (level === "species") return "物种";
  if (level === "population") return "种群";
  if (level === "agent") return "个人";
  if (level === "culture") return "文化";
  if (level === "worldview") return "流派";
  return organizationLabels[level];
};

type OrganizationDetail = OrganizationState | OrganizationDirectoryEntry;
const organizationMemberIds = (organization: OrganizationDetail): string[] => organization.memberIds ?? [];
const organizationChildIds = (organization: OrganizationDetail): string[] => "childIds" in organization ? organization.childIds : organization.childOrganizationIds;
const organizationDetailTargets = (snapshot: WorldSnapshot): OrganizationDetail[] => {
  const byId = new Map<string, OrganizationDetail>();
  for (const organization of snapshot.projection?.organizations ?? []) byId.set(organization.id, organization);
  const focusRegionId = snapshot.focusRegionId;
  for (const organization of snapshot.organizationDirectory ?? []) {
    if (!focusRegionId || organization.regionId === focusRegionId || organization.territoryRegionIds.includes(focusRegionId)) {
      if (!byId.has(organization.id)) byId.set(organization.id, organization);
    }
  }
  return [...byId.values()];
};
const organizationForSnapshot = (snapshot: WorldSnapshot, id: string): OrganizationDetail | undefined =>
  snapshot.projection?.organizations.find((organization) => organization.id === id)
  ?? snapshot.organizationDirectory?.find((organization) => organization.id === id);
const resourcesForOrganization = (snapshot: WorldSnapshot, organizationId: string): NonNullable<WorldSnapshot["resources"]> => {
  const resources = snapshot.resources ?? snapshot.selectedRegion?.resources ?? [];
  return resources.filter((resource) => resource.holderId === organizationId);
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
  const archiveCount = organizationId
    ? Math.max(0, summaryOrganization?.archivedHistoryCount ?? 0, directoryOrganization?.archivedHistoryCount ?? 0)
    : Math.max(0, snapshot.selectedRegion?.archivedHistoryCount ?? 0);
  const scope = organizationId ? "该组织在当前区域内" : "当前区域";
  return `<section class="worldview-records regional-history" aria-label="区域因果历史"><div class="worldview-heading"><strong>区域因果历史</strong><span>${scope}最近 ${format(events.length)} 条${archiveCount > 0 ? `，另有 ${format(archiveCount)} 条已归档` : ""}</span></div><ol class="worldview-list">${events.length > 0 ? events.map((event) => `<li data-event-kind="${escapeHtml(event.kind)}"><div><span>${escapeHtml(regionEventLabels[event.kind] ?? event.kind)}</span><small>${formatSimulationAge(event.years ?? event.tick)} · ${event.archived ? "历史档案" : "近期账本"}</small></div><strong>${regionEventContext(event)}</strong><p>${event.source === "user" ? "用户事件" : "自然演化"} · 规则 ${escapeHtml(event.ruleId)} · 触发概率 ${formatPercent(event.probability).value}%</p></li>`).join("") : `<li class="worldview-empty">${archiveCount > 0 ? "近期事件已归档；当前保留账本中没有该范围的可读记录" : "尚未形成可追溯事件"}</li>`}</ol></section>`;
};
const organizationName = (organization: { id: string; type: OrganizationType }): string => `${organizationLabels[organization.type]} · ${organization.id.slice(-8)}`;
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
  return `<section class="worldview-records substance-records" aria-label="原创物质"><div class="worldview-heading"><strong>原创物质</strong><span>${format(ordered.length)} 种形成 · ${format(known)} 种已发现</span></div><ol class="worldview-list">${ordered.length > 0 ? ordered.slice(0, 12).map((substance) => `<li data-substance-kind="${substance.kind}" data-substance-status="${substance.status}"><div><span>${substanceKindLabels[substance.kind]}</span><small>${substance.status === "known" ? "已发现" : "潜藏"}</small></div><strong>${escapeHtml(substance.name)}</strong><p>${substanceFormationLabels[substance.formation]} · 稳定性 ${formatPercent(substance.properties.stability).value}% · 能量潜力 ${formatPercent(substance.properties.energyPotential).value}%</p></li>`).join("") : '<li class="worldview-empty">当地尚未形成可记录的原创物质</li>'}</ol></section>`;
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
const supplyChainReport = (snapshot: WorldSnapshot, organization: { id: string }, balances: Record<keyof typeof supplyResourceLabels, number>): string => {
  const routes = (snapshot.supplyRoutes ?? [])
    .filter((route) => route.fromOrganizationId === organization.id || route.toOrganizationId === organization.id)
    .sort((left, right) => right.lastTick - left.lastTick || left.resourceId.localeCompare(right.resourceId));
  const inventory = Object.entries(supplyResourceLabels)
    .map(([resourceId, label]) => `<span>${label}库存 · ${formatNumber(balances[resourceId as keyof typeof supplyResourceLabels], 2)} 单位</span>`)
    .join("");
  return `<section class="organization-governance supply-chain" aria-label="区域供应链"><div class="detail-heading"><strong>区域供应链</strong><span>${format(routes.length)} 条近期路线 · 依据实际供需结算</span></div><div class="detail-tags">${inventory}</div><ol class="worldview-list">${routes.length > 0 ? routes.slice(0, 10).map((route) => {
    const incoming = route.toOrganizationId === organization.id;
    const counterparty = incoming ? route.fromOrganizationId : route.toOrganizationId;
    const region = incoming ? route.fromRegion : route.toRegion;
    return `<li data-supply-resource="${route.resourceId}"><div><span>${incoming ? "输入" : "输出"} · ${supplyResourceLabels[route.resourceId]}</span><small>${format(route.shipmentCount)} 批</small></div><strong>${escapeHtml(counterparty.slice(-8))}</strong><p>累计 ${formatNumber(route.totalAmount, 2)} 单位 · ${escapeHtml(region)}</p><p>最近运输：${formatSimulationAge(route.lastYears ?? route.lastTick)}</p></li>`;
  }).join("") : '<li class="worldview-empty">尚无跨区域运输记录</li>'}</ol></section>`;
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

const detailTargets = (snapshot: WorldSnapshot, level: InspectorDetail["level"]): Array<{ id: string; label: string }> => {
  if (level === "region") return [];
  if (level === "substance") return (snapshot.substances ?? [])
    .filter((substance) => substance.regionId === snapshot.focusRegionId)
    .sort((left, right) => Number(right.status === "known") - Number(left.status === "known") || left.id.localeCompare(right.id))
    .map((substance) => ({ id: substance.id, label: `${substance.name} · ${substanceKindLabels[substance.kind]}` }));
  const regionalPopulations = (snapshot.populations ?? []).filter((population) => population.regionId === snapshot.focusRegionId);
  if (level === "species") {
    const speciesIds = new Set(regionalPopulations.map((population) => population.speciesId));
    return (snapshot.species ?? [])
      .filter((species) => speciesIds.has(species.id))
      .map((species) => ({ id: species.id, label: `${speciesRoleLabels[species.role]} · ${species.name ?? species.id.slice(-8)}` }));
  }
  if (level === "population") return regionalPopulations.map((population) => {
    const species = snapshot.species?.find((candidate) => candidate.id === population.speciesId);
    return { id: population.id, label: `${species?.name ?? population.id.slice(-8)} · ${format(population.count)} 个体` };
  });
  if (level === "agent") return (snapshot.projection?.agents ?? []).map((agent) => ({ id: agent.id, label: `${agent.id.slice(-8)} · ${Math.floor(agent.age)}岁` }));
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
    .map((organization) => ({ id: organization.id, label: organizationName(organization) }));
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
    const regionalCulture = (snapshot.cultures ?? []).find((culture) => culture.regionId === snapshot.focusRegionId);
    const regionalCultureSummary = snapshot.selectedRegion?.cultureSummary;
    const regionalIdentity = regionalCulture
      ? cultureIdentityForSnapshot(snapshot, regionalCulture.id)
      : regionalCultureSummary?.identity;
    const regionalSocietySummary = snapshot.selectedRegion?.societySummary;
    const aggregateSociety = lineage.source === "aggregate" && regionalSocietySummary
      ? aggregateSocietyReport(regionalSocietySummary, snapshot.selectedRegion?.population ?? 0, snapshot.selectedRegion?.socialPopulation ?? snapshot.selectedRegion?.population ?? 0)
      : "";
    return `<div class="detail-summary"><strong>区域总览</strong><span>${lineage.source === "aggregate" ? "来自聚合摘要，选择下方层级可查看可重建对象" : "来自实时微观投影"}</span><div class="detail-counts">${available}</div>${regionalIdentity ? cultureSummaryReport(regionalIdentity, regionalCultureSummary) : ""}${aggregateSociety}${substanceInventoryReport(substances)}${facilityAssetsReport(facilities)}</div>`;
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
    return `<div class="detail-report"><div class="detail-title"><strong>物质报告</strong><span>${escapeHtml(substance.id)}</span></div><dl class="detail-grid"><div><dt>名称</dt><dd>${escapeHtml(substance.name)}</dd></div><div><dt>类型</dt><dd>${substanceKindLabels[substance.kind]}</dd></div><div><dt>形成方式</dt><dd>${substanceFormationLabels[substance.formation]}</dd></div><div><dt>状态</dt><dd>${substance.status === "known" ? "已发现并可利用" : "自然潜藏"}</dd></div><div><dt>形成时间</dt><dd>${formatSimulationAge(substance.originYears)}</dd></div><div><dt>形成区域</dt><dd>${escapeHtml(substance.regionId)}</dd></div><div><dt>母材</dt><dd>${parentNames.length > 0 ? parentNames.map(escapeHtml).join("、") : "自然原生物质"}</dd></div><div><dt>发现记录</dt><dd>${discovered}</dd></div></dl><section class="organization-governance"><div class="detail-heading"><strong>性质</strong><span>全部为该世界规则内的相对指标</span></div><div class="detail-tags">${propertyLabels.map(([key, label]) => `<span>${label} ${formatPercent(substance.properties[key]).value}%</span>`).join("")}</div></section><section class="organization-governance"><div class="detail-heading"><strong>组成</strong><span>局地基础化学归一化比例</span></div><div class="detail-tags">${Object.entries(substance.composition).map(([field, value]) => `<span>${compositionLabels[field as keyof typeof compositionLabels]} ${formatPercent(value).value}%</span>`).join("")}</div></section><div class="detail-tags">${substance.discoveredByIds.map((id) => `<span>发现者 · ${escapeHtml(id.slice(-8))}</span>`).join("") || "<span>尚无文明发现记录</span>"}</div></div>`;
  }
  if (detail.level === "species") {
    const species = snapshot.species?.find((candidate) => candidate.id === detail.id);
    if (!species) return `<div class="empty-state"><strong>物种暂不可用</strong><span>该谱系可能已在下一次快照中灭绝</span></div>`;
    const populations = (snapshot.populations ?? []).filter((population) => population.speciesId === species.id);
    const localCount = populations.filter((population) => population.regionId === snapshot.focusRegionId).reduce((sum, population) => sum + population.count, 0);
    const globalCount = populations.reduce((sum, population) => sum + population.count, 0);
    const blueprint = speciesBlueprintFor(species);
    const parent = species.parentId ? snapshot.species?.find((candidate) => candidate.id === species.parentId) : undefined;
    const origin = species.originRegionId
      ? `${escapeHtml(species.originRegionId)} · ${formatSimulationAge(species.originYears ?? species.originTick ?? 0)}`
      : "旧历史记录，已补全生命蓝图";
    return `<div class="detail-report"><div class="detail-title"><strong>物种报告</strong><span>${escapeHtml(species.name ?? species.id)}</span></div><dl class="detail-grid"><div><dt>生态角色</dt><dd>${speciesRoleLabels[species.role]}</dd></div><div><dt>亲本谱系</dt><dd>${parent ? escapeHtml(parent.name ?? parent.id.slice(-8)) : species.parentId ? escapeHtml(species.parentId.slice(-8)) : "原生谱系"}</dd></div><div><dt>起源</dt><dd>${origin}</dd></div><div><dt>局地数量</dt><dd>${format(localCount)} 个体</dd></div><div><dt>全球数量</dt><dd>${format(globalCount)} 个体</dd></div><div><dt>适应温度</dt><dd>${formatPercent(species.traits.temperatureOptimum ?? 0).value}%</dd></div><div><dt>适应湿度</dt><dd>${formatPercent(species.traits.humidityOptimum ?? 0).value}%</dd></div><div><dt>移动性</dt><dd>${formatPercent(species.traits.mobility ?? 0).value}%</dd></div><div><dt>认知潜力</dt><dd>${formatPercent(species.traits.cognitivePotential ?? 0).value}%</dd></div></dl><section class="organization-governance" aria-label="生命蓝图"><div class="detail-heading"><strong>原创生命蓝图</strong><span>可遗传、可分化、可追溯</span></div><div class="detail-tags"><span>生化基础 · ${lifeBiochemistryLabels[blueprint.biochemistry]}</span><span>遗传载体 · ${geneticCarrierLabels[blueprint.geneticCarrier]}</span><span>细胞结构 · ${cellArchitectureLabels[blueprint.cellArchitecture]}</span><span>代谢方式 · ${metabolismLabels[blueprint.metabolism]}</span><span>身体结构 · ${bodyStructureLabels[blueprint.bodyPlan.structure]}</span><span>身体对称 · ${bodySymmetryLabels[blueprint.bodyPlan.symmetry]}</span><span>移动方式 · ${locomotionLabels[blueprint.bodyPlan.locomotion]}</span><span>附肢对数 · ${format(blueprint.bodyPlan.appendagePairs)}</span><span>感官系统 · ${blueprint.senses.map((sense) => sensoryLabels[sense]).join("、")}</span><span>繁殖方式 · ${reproductionLabels[blueprint.reproduction]}</span><span>寿命 · ${formatNumber(blueprint.lifespanYears, 1)} 年</span><span>成体尺度 · ${formatNumber(blueprint.adultScale, 2)}</span><span>代谢效率 · ${formatPercent(blueprint.metabolicEfficiency).value}%</span><span>繁殖力 · ${formatPercent(blueprint.fecundity).value}%</span><span>热耐受 · ${formatPercent(blueprint.thermalTolerance).value}%</span><span>保水性 · ${formatPercent(blueprint.hydrationRetention).value}%</span><span>突变率 · ${formatPercent(blueprint.mutationRate).value}%</span><span>遗传保真度 · ${formatPercent(blueprint.inheritanceFidelity).value}%</span><span>创新签名 · ${escapeHtml(blueprint.noveltySignature)}</span></div></section></div>`;
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
    return `<div class="detail-report"><div class="detail-title"><strong>流派报告</strong><span>${escapeHtml(entity.id)}</span></div><dl class="detail-grid"><div><dt>名称</dt><dd>${escapeHtml(entity.name ?? worldviewEntityLabels[entity.kind])}</dd></div><div><dt>类型</dt><dd>${worldviewEntityLabels[entity.kind]}</dd></div><div><dt>状态</dt><dd>${status}</dd></div><div><dt>影响力</dt><dd>${formatPercent(entity.influence).value}%</dd></div><div><dt>存续度</dt><dd>${formatPercent(entity.viability ?? entity.influence).value}%</dd></div><div><dt>成员</dt><dd>${format(members.length)} 人</dd></div><div><dt>支持者</dt><dd>${format(entity.supporterCount ?? members.length)} 人</dd></div><div><dt>活跃修行者</dt><dd>${format(entity.activePractitionerCount ?? 0)} 人</dd></div><div><dt>赞助组织</dt><dd>${format(entity.sponsorCount ?? (entity.sponsorOrganizationId ? 1 : 0))} 个</dd></div><div><dt>复兴次数</dt><dd>${format(entity.revivalCount ?? 0)} 次</dd></div><div><dt>创始者</dt><dd>${entity.founderId ? escapeHtml(entity.founderId.slice(-8)) : "集体形成"}</dd></div><div><dt>依据规律</dt><dd>${phenomenon ? escapeHtml(phenomenon.name) : "历史规律记录"}</dd></div><div><dt>赞助组织</dt><dd>${sponsor ? escapeHtml(organizationName(sponsor)) : entity.sponsorOrganizationId ? escapeHtml(entity.sponsorOrganizationId.slice(-8)) : "自主维持"}</dd></div><div><dt>能量储备</dt><dd>${formatNumber(reserve * 100, 1)} 单位</dd></div><div><dt>形成时间</dt><dd>${entity.originTick === undefined ? "旧历史记录" : `演化步 ${format(entity.originTick)}`}</dd></div></dl><div class="detail-tags">${members.length > 0 ? members.slice(0, 16).map((id) => `<span>成员 · ${escapeHtml(id.slice(-8))}</span>`).join("") : "<span>当前没有在世传承者</span>"}</div></div>`;
  }
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
    return `<div class="detail-report"><div class="detail-title"><strong>个人报告</strong><span>${escapeHtml(agent.id)}</span></div><dl class="detail-grid"><div><dt>年龄 / 寿命</dt><dd>${format(agent.age)} / ${format(agent.lifespan)} 年</dd></div><div><dt>生物谱系</dt><dd>${species ? escapeHtml(species.name ?? species.id.slice(-8)) : "未同步"}</dd></div>${blueprint ? `<div><dt>遗传载体</dt><dd>${geneticCarrierLabels[blueprint.geneticCarrier]}</dd></div><div><dt>代谢方式</dt><dd>${metabolismLabels[blueprint.metabolism]}</dd></div>` : ""}<div><dt>家庭</dt><dd>${family ? escapeHtml(organizationName(family)) : "未归属"}</dd></div><div><dt>父母</dt><dd>${format(agent.parentIds.length)} 人</dd></div><div><dt>后代</dt><dd>${format(descendants)} 人</dd></div><div><dt>关系</dt><dd>${format(relationships.length)} 条</dd></div><div><dt>知识 / 信念</dt><dd>${format(agent.knowledgeIds.length)} 条 / ${format(agent.beliefIds.length)} 条</dd></div><div><dt>原创技术</dt><dd>${format(innovations.length)} 项</dd></div></dl><div class="detail-tags">${Object.entries(agent.skills).map(([skill, value]) => `<span>${escapeHtml(skillLabel(skill))} ${formatPercent(value).value}%</span>`).join("")}${knowledge.slice(0, 8).map((record) => `<span>${record.domain ? `${knowledgeDomainLabels[record.domain]} · ` : ""}${escapeHtml(knowledgeName(record))}</span>`).join("")}</div>${occupationReport}${technologyEffectsReport(technology)}</div>`;
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
  const heldResources = resourcesForOrganization(snapshot, organization.id);
  const food = heldResources.filter((resource) => resource.resourceId === "food").reduce((sum, resource) => sum + resource.amount, 0);
  const materials = heldResources.filter((resource) => resource.resourceId === "materials").reduce((sum, resource) => sum + resource.amount, 0);
  const energy = heldResources.filter((resource) => resource.resourceId === "energy").reduce((sum, resource) => sum + resource.amount, 0);
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
  const recentHistoryCount = summaryOrganization?.historyIds.length ?? ("historyCount" in organization ? organization.historyCount : 0);
  const archivedHistoryCount = Math.max(summaryOrganization?.archivedHistoryCount ?? 0, organization.archivedHistoryCount ?? 0);
  const childIds = organizationChildIds(organization);
  const status = "status" in organization ? organization.status : "active";
  return `<div class="detail-report"><div class="detail-title"><strong>${organizationLabels[organization.type]}报告</strong><span>${escapeHtml(organization.id)}</span></div><dl class="detail-grid"><div><dt>成员</dt><dd>${format(memberCount)} 人</dd></div><div><dt>状态</dt><dd>${status === "active" ? "活跃" : status}</dd></div><div><dt>领土</dt><dd>${format(organization.territoryRegionIds.length)} 格</dd></div><div><dt>下属组织</dt><dd>${format(childIds.length)} 个</dd></div><div><dt>内部关系</dt><dd>${format(relationshipCount)} 条</dd></div><div><dt>食物资源</dt><dd>${formatResource(food).value} ${formatResource(food).unit}</dd></div><div><dt>建造材料</dt><dd>${formatNumber(materials, 1)} 材料单位</dd></div><div><dt>能源储备</dt><dd>${formatNumber(energy, 2)} 能源单位</dd></div><div><dt>谱系 / 知识</dt><dd>${familyLineage ? `${format(familyLineage.generationDepth)} 代 / ${format(familyLineage.knowledgeInheritanceCount)} 条` : "聚合统计"}</dd></div><div><dt>原创技术</dt><dd>${format(innovations.length)} 项</dd></div><div><dt>原创物质</dt><dd>${format(substances.length)} 种</dd></div><div><dt>可追溯事件</dt><dd>${format(recentHistoryCount + archivedHistoryCount)} 条${archivedHistoryCount > 0 ? `（${format(archivedHistoryCount)} 条已归档）` : ""}</dd></div><div><dt>中心区域</dt><dd>${escapeHtml(organization.regionId)}</dd></div></dl><div class="detail-tags">${organization.territoryRegionIds.slice(0, 12).map((id) => `<span>${escapeHtml(id)}</span>`).join("") || "<span>暂无领土记录</span>"}</div>${technologyReport}${technologyEffectsReport(technology)}${substanceInventoryReport(substances)}${facilityAssetsReport(facilities)}${supplyChainReport(snapshot, organization, { food, materials, energy })}${governanceReport}</div>`;
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
  const entityHistory = isOrganizationDetailLevel(detail.level) && detail.id ? regionalHistoryReport(snapshot, detail.id) : "";
  element.innerHTML = `
    <div class="inspector-head"><div><strong>${formatRegionCoordinates(selection.x, selection.y, fields.elevation.width, fields.elevation.height)}</strong><small>${selection.regionId}</small></div><span>${lineage.source === "aggregate" ? "聚合摘要" : "实时微观投影"}</span></div>
    <section class="observation-group" aria-label="区域地表">
      <h3><span>地表</span><small>高度与局地气候</small></h3>
      <dl class="observation-list">
        ${observationMetric("模拟海拔", formatElevation(fields.elevation.values[selection.index]), "海平面为 0 m")}
        ${observationMetric("模型温度", formatModelTemperature(fields.temperature.values[selection.index]), "换算温标")}
        ${observationMetric("地表水量", formatIndex(fields.water.values[selection.index]), "相对指数")}
        ${observationMetric("空气湿度", formatPercent(fields.humidity.values[selection.index]))}
      </dl>
    </section>
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
      <div class="detail-report-container">${detailReport(snapshot, detail, lineage)}${entityHistory}</div>
    </section>
  `;
};
