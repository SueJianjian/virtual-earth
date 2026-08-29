import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createCultureIdentity } from "../../src/sim/culture/identity.ts";
import { projectMicroRegion, summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { archiveOrganizationRecords } from "../../src/sim/society/archive.ts";
import { createWorld } from "../../src/sim/world.ts";
import { lineageForSnapshot, renderInspector } from "../../src/ui/inspector.ts";
import { createEventArchive } from "../../src/sim/events/ledger.ts";
import { speciesBlueprintFor } from "../../src/sim/ecology/blueprints.ts";
import type { ArchivedSpeciesSummary, RegionCultureSummary, RegionId, RegionSocietySummary } from "../../src/sim/types.ts";
import type { WorldSnapshot } from "../../src/worker/protocol.ts";
import { derivePathogen } from "../../src/sim/health/disease.ts";

const region = "region:0:0" as RegionId;

const lineageSnapshot = (): WorldSnapshot => {
  const state = createWorld(140, { width: 8, height: 8, formation: "formed" });
  const species = createSpecies("lineage", "consumer");
  const population = { id: "population:lineage" as never, speciesId: species.id, regionId: region, count: 8, energy: 1 };
  const first = createAgent(population, species, 0, "lineage");
  const second = createAgent(population, species, 1, "lineage");
  const older = createAgent(population, species, 2, "lineage", [first.id, second.id]);
  const younger = createAgent(population, species, 3, "lineage", [first.id, second.id]);
  first.knowledgeIds = ["knowledge:fire"];
  older.knowledgeIds = ["knowledge:fire"];
  younger.beliefIds = ["belief:ancestors"];
  state.species = [species];
  state.populations = [population];
  state.agents = [first, second, older, younger];
  state.relationships = [
    createRelationship("partner", first.id, second.id, 1, 0.8),
    createRelationship("parent", first.id, older.id, 2, 0.9),
    createRelationship("caregiver", second.id, younger.id, 2, 0.8),
    createRelationship("sibling", older.id, younger.id, 2, 0.85),
  ];
  state.organizations = [createOrganization("family", region, state.agents.map((agent) => agent.id))];
  return {
    seed: state.seed,
    tick: state.tick,
    years: state.years,
    formation: state.formation,
    tectonics: state.tectonics,
    atmosphere: state.atmosphere,
    digest: "test",
    fields: state.fields,
    chemistry: state.chemistry,
    metrics: {},
    focusRegionId: region,
    species: state.species,
    populations: state.populations,
    projection: projectMicroRegion(state, region),
    selectedRegion: summarizeRegionState(state, region, "micro"),
  };
};

describe("region lineage inspector", () => {
  it("derives live family and inheritance metrics from a micro projection", () => {
    const lineage = lineageForSnapshot(lineageSnapshot());

    expect(lineage).toMatchObject({
      source: "micro",
      householdCount: 1,
      population: 4,
      relationshipCount: 4,
      descendantCount: 2,
      generationDepth: 2,
      knowledgeCarrierCount: 1,
      knowledgeInheritanceCount: 1,
      beliefCarrierCount: 1,
      foodBalance: 0,
      foodPerAgent: 0,
      foodSecurity: 0,
      migrationRate: 0,
    });
    expect(lineage.relationshipCounts).toMatchObject({ partner: 1, parent: 1, caregiver: 1, sibling: 1 });
    expect(lineage.families[0]?.memberCount).toBe(4);
    expect(lineage.familyLineages[0]).toMatchObject({ memberCount: 4, relationshipCount: 4, descendantCount: 2, knowledgeInheritanceCount: 1 });
  });

  it("uses conserved lineage metrics for an aggregate region", () => {
    const snapshot = lineageSnapshot();
    snapshot.selectedRegion = { ...snapshot.selectedRegion!, mode: "aggregate" };
    snapshot.projection = { ...snapshot.projection!, agents: [], relationships: [], organizations: [] };

    const lineage = lineageForSnapshot(snapshot);

    expect(lineage.source).toBe("aggregate");
    expect(lineage.descendantCount).toBe(2);
    expect(lineage.knowledgeCarrierCount).toBe(1);
    expect(lineage.knowledgeInheritanceCount).toBe(1);
    expect(lineage.relationshipCounts.sibling).toBe(1);
  });

  it("renders physical, ecological and social values with explicit units", () => {
    const snapshot = lineageSnapshot();
    snapshot.recentRegionEvents = [{
      id: "event:regional-history",
      tick: 12,
      years: 12,
      kind: "flood",
      ruleId: "environment:basin-flood",
      source: "natural",
      sourceIds: [],
      regionIds: [region],
      organizationIds: [],
      probability: 0.4,
      intensity: 0.62,
    }];
    snapshot.knowledge = [{
      id: "knowledge:crystal-navigation",
      kind: "innovation:navigation:1",
      name: "潮星定向法",
      domain: "navigation",
      sourceIds: [snapshot.projection!.agents[0]!.id],
      credibility: 0.82,
      transmissionCost: 0.2,
      forgettingRate: 0.01,
      originRegionId: region,
      originTick: 10,
      originYears: 3,
      parentIds: [],
    }];
    snapshot.cultures = [{ id: "culture:region-0-0" as never, regionId: region, knowledgeIds: ["knowledge:crystal-navigation"], beliefIds: [], transmissionRate: 0.8 }];
    snapshot.worldviewPhenomena = [{
      id: "phenomenon:observed",
      packId: "emergence.original-worldview",
      kind: "natural-anomaly",
      epistemicStatus: "observed",
      name: "晶息回响",
      regionId: region,
      originTick: 12,
      parentIds: [],
      causeRuleId: "original-anomaly-observation",
      evidence: { anomalyStrength: 0.4 },
    }, {
      id: "phenomenon:theory",
      packId: "emergence.original-worldview",
      kind: "cultural-theory",
      epistemicStatus: "hypothesized",
      name: "晶息观测律",
      regionId: region,
      originTick: 18,
      parentIds: ["phenomenon:observed"],
      causeRuleId: "original-cultural-theory",
      evidence: { knowledgeDiversity: 3 },
    }];
    const practitionerId = snapshot.projection?.agents[0]?.id;
    if (!practitionerId) throw new Error("Expected a projected agent for practice report");
    snapshot.worldviewPractices = [{
      id: "practice:crystal",
      packId: "emergence.original-worldview",
      name: "晶息共鸣法",
      phenomenonId: "phenomenon:theory",
      regionId: region,
      practitionerId,
      originTick: 22,
      lastTrainedTick: 24,
      attunement: 0.31,
      energy: 0.42,
      attempts: 4,
      failures: 1,
      status: "active",
    }];
    snapshot.worldviewEntities = [{
      id: "worldview:crystal-sect" as never,
      packId: "emergence.original-worldview",
      kind: "sect",
      name: "晶脉研修会",
      regionId: region,
      influence: 0.46,
      resourceBalances: { "attunement-energy": 0.37 },
      originTick: 28,
      sourcePhenomenonId: "phenomenon:theory",
      founderId: practitionerId,
      memberIds: [practitionerId],
      status: "dormant",
      supporterCount: 7,
      activePractitionerCount: 1,
      sponsorCount: 0,
      viability: 0.28,
      lastStatusChangeTick: 30,
      dormantSinceTick: 30,
      revivalCount: 2,
    }];
    snapshot.worldviewInteractions = [{
      id: "worldview-interaction:inspector",
      kind: "fusion",
      sourceEntityId: "worldview:crystal-sect" as never,
      targetEntityId: "worldview:mythic-memory" as never,
      sourcePackId: "emergence.original-worldview",
      targetPackId: "mythology.chinese-motif",
      regionId: region,
      originTick: 31,
      lastInteractionTick: 34,
      attempts: 1,
      successes: 1,
      failures: 0,
      compatibility: 0.82,
      intensity: 0.44,
      status: "resolved",
      fusionEntityId: "worldview:fusion-result" as never,
    }];
    const element = { innerHTML: "" } as HTMLElement;
    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region });

    expect(element.innerHTML).toContain("行星坐标");
    expect(element.innerHTML).toContain("模拟海拔");
    expect(element.innerHTML).toContain("地质板块");
    expect(element.innerHTML).toContain("边界应力");
    expect(element.innerHTML).toContain("大气环流");
    expect(element.innerHTML).toContain("相对气压");
    expect(element.innerHTML).toContain("实际降水");
    expect(element.innerHTML).toContain("风速指数");
    expect(element.innerHTML).toContain("°C");
    expect(element.innerHTML).toContain("m");
    expect(element.innerHTML).toContain("相对浓度");
    expect(element.innerHTML).toContain("户");
    expect(element.innerHTML).toContain("食物单位");
    expect(element.innerHTML).toContain("认知与传说");
    expect(element.innerHTML).toContain("已观测");
    expect(element.innerHTML).toContain("文明理论");
    expect(element.innerHTML).toContain("源自 晶息回响");
    expect(element.innerHTML).toContain("规律训练");
    expect(element.innerHTML).toContain("晶息共鸣法");
    expect(element.innerHTML).toContain("训练中");
    expect(element.innerHTML).toContain("能量 42/100");
    expect(element.innerHTML).toContain("迁徙活跃度");
    expect(element.innerHTML).toContain("物种");
    expect(element.innerHTML).toContain("种群");
    expect(element.innerHTML).toContain("知识与技术");
    expect(element.innerHTML).toContain("潮星定向法");
    expect(element.innerHTML).toContain("形成于 3 年 0 天");
    expect(element.innerHTML).toContain("流派与体系");
    expect(element.innerHTML).toContain("晶脉研修会");
    expect(element.innerHTML).toContain("沉寂保留");
    expect(element.innerHTML).toContain("区域因果历史");
    expect(element.innerHTML).toContain("区域洪水");
    expect(element.innerHTML).toContain("强度 62%");
    expect(element.innerHTML).toContain("世界观互动");
    expect(element.innerHTML).toContain("传统融合");

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "worldview", id: "worldview:crystal-sect" });
    expect(element.innerHTML).toContain("流派报告");
    expect(element.innerHTML).toContain("晶脉研修会");
    expect(element.innerHTML).toContain("能量储备");
    expect(element.innerHTML).toContain("37 单位");
    expect(element.innerHTML).toContain("支持者");
    expect(element.innerHTML).toContain("存续度");
    expect(element.innerHTML).toContain("复兴次数");
    expect(element.innerHTML).toContain("跨体系互动");
    expect(element.innerHTML).toContain("融合完成");
  });

  it("renders inspectable species and population reports for the selected region", () => {
    const snapshot = lineageSnapshot();
    const selection = { x: 0, y: 0, index: 0, regionId: region };
    const species = snapshot.species?.[0];
    const population = snapshot.populations?.[0];
    if (!species || !population) throw new Error("Expected regional ecology records");
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, selection, { level: "species", id: species.id });
    expect(element.innerHTML).toContain("物种报告");
    expect(element.innerHTML).toContain("生态角色");
    expect(element.innerHTML).toContain("全球数量");
    expect(element.innerHTML).toContain("认知潜力");
    expect(element.innerHTML).toContain("遗传载体");
    expect(element.innerHTML).toContain("代谢方式");
    expect(element.innerHTML).toContain("身体结构");
    expect(element.innerHTML).toContain("感官系统");
    expect(element.innerHTML).toContain("创新签名");

    renderInspector(element, snapshot, selection, { level: "population", id: population.id });
    expect(element.innerHTML).toContain("种群报告");
    expect(element.innerHTML).toContain("个体数量");
    expect(element.innerHTML).toContain("能量状态");
    expect(element.innerHTML).toContain("代谢方式");
  });

  it("renders a historical report for an archived extinct species", () => {
    const snapshot = lineageSnapshot();
    const parent = snapshot.species?.[0];
    if (!parent) throw new Error("Expected a parent species");
    const extinct = createSpecies("archived-inspector", "producer", parent.id, {
      regionId: region,
      tick: 12,
      years: 12 / 365,
      timelineStep: "12",
    });
    const archived: ArchivedSpeciesSummary = {
      id: extinct.id,
      name: extinct.name!,
      role: extinct.role,
      traits: { ...extinct.traits },
      parentId: extinct.parentId!,
      originRegionId: extinct.originRegionId!,
      originTick: extinct.originTick!,
      originTimelineStep: extinct.originTimelineStep!,
      originYears: extinct.originYears!,
      blueprint: speciesBlueprintFor(extinct),
      lastKnownPopulation: 7,
      lastKnownRegionIds: [region],
      archivedTick: 48,
      archivedTimelineStep: "48",
      archivedTimelineDays: "48",
      archivedYears: 48 / 365,
    };
    snapshot.eventArchive = { ...createEventArchive(), archivedSpeciesSummaries: [archived] };
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "species", id: archived.id });

    expect(element.innerHTML).toContain("已灭绝 · 历史摘要");
    expect(element.innerHTML).toContain("最后记录数量");
    expect(element.innerHTML).toContain("原创生命蓝图");
    expect(element.innerHTML).toContain("后代分支");
    expect(element.innerHTML).toContain("species:");
  });

  it("renders regional emergent matter and a complete substance provenance report", () => {
    const snapshot = lineageSnapshot();
    snapshot.substances = [{
      id: "substance:inspector",
      name: "曜凝复晶",
      kind: "engineered-composite",
      formation: "engineered",
      status: "known",
      regionId: region,
      originTick: 20,
      originYears: 20 / 365,
      parentIds: ["substance:parent"],
      composition: { carbon: 0.3, nitrogen: 0.1, phosphorus: 0.2, organics: 0.2, oxygen: 0.2 },
      properties: { hardness: 0.9, density: 0.7, reactivity: 0.15, conductivity: 0.82, energyPotential: 0.76, biologicalAffinity: 0.34, stability: 0.91 },
      reserveCapacity: 0,
      remainingReserve: 0,
      extractedTotal: 0,
      discoveredByIds: [snapshot.projection!.agents[0]!.id],
      discoveryTick: 21,
      discoveryYears: 21 / 365,
    }, {
      id: "substance:parent",
      name: "澜脉晶",
      kind: "crystal",
      formation: "hydrothermal",
      status: "known",
      regionId: region,
      originTick: 5,
      originYears: 5 / 365,
      parentIds: [],
      composition: { carbon: 0.2, nitrogen: 0.2, phosphorus: 0.3, organics: 0.1, oxygen: 0.2 },
      properties: { hardness: 0.8, density: 0.6, reactivity: 0.2, conductivity: 0.65, energyPotential: 0.6, biologicalAffinity: 0.25, stability: 0.85 },
      reserveCapacity: 240,
      remainingReserve: 180,
      extractedTotal: 60,
      discoveredByIds: [],
    }];
    const element = { innerHTML: "" } as HTMLElement;
    const selection = { x: 0, y: 0, index: 0, regionId: region };

    renderInspector(element, snapshot, selection);
    expect(element.innerHTML).toContain("原创物质");
    expect(element.innerHTML).toContain("曜凝复晶");

    renderInspector(element, snapshot, selection, { level: "substance", id: "substance:inspector" });
    expect(element.innerHTML).toContain("物质报告");
    expect(element.innerHTML).toContain("文明复合材料");
    expect(element.innerHTML).toContain("澜脉晶");
    expect(element.innerHTML).toContain("导电性");
    expect(element.innerHTML).toContain("发现者");
    expect(element.innerHTML).toContain("人工制造，不属于天然矿藏");

    renderInspector(element, snapshot, selection, { level: "substance", id: "substance:parent" });
    expect(element.innerHTML).toContain("剩余储量");
    expect(element.innerHTML).toContain("累计开采");
    expect(element.innerHTML).toContain("75%");
  });

  it("shows a selected individual's facility occupation through its source identity", () => {
    const snapshot = lineageSnapshot();
    const projected = snapshot.projection!.agents[0]!;
    projected.sourceId = "agent:source-worker" as never;
    projected.skills["profession:medicine"] = 0.42;
    snapshot.facilities = [{ id: "facility:clinic:occupation", type: "medicine", regionId: region, ownerOrganizationId: "organization:city:occupation" as never, level: 2, condition: 0.9, status: "active", workforceIds: [projected.sourceId], workforceRequired: 2, workforceEfficiency: 0.7, materialInvested: 7, plannedTick: 1, builtTick: 2, lastMaintainedTick: 3, lastIncidentTick: 3 }];
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "agent", id: projected.id });

    expect(element.innerHTML).toContain("职业与工作");
    expect(element.innerHTML).toContain("医养岗位");
    expect(element.innerHTML).toContain("职业 · 医养 42%");
  });

  it("renders governance and diplomatic status for a nation-scale report", () => {
    const snapshot = lineageSnapshot();
    const stateOrganization = createOrganization("state", region, snapshot.projection!.agents.map((agent) => agent.id));
    stateOrganization.governance = { ...stateOrganization.governance!, stability: 0.72, legitimacy: 0.66, military: 0.58, warWeariness: 0.14 };
    stateOrganization.diplomacy = { ["organization:neighbor" as never]: "allied" };
    snapshot.projection = { ...snapshot.projection!, organizations: [stateOrganization] };
    snapshot.knowledge = [{ id: "knowledge:civic", kind: "innovation:governance:1", name: "环议协约法", domain: "governance", sourceIds: [], credibility: 0.8, transmissionCost: 0.2, forgettingRate: 0.01, originRegionId: region, originTick: 4, originYears: 4, parentIds: [] }];
    snapshot.cultures = [{ id: "culture:civic" as never, regionId: region, knowledgeIds: ["knowledge:civic"], beliefIds: [], transmissionRate: 0.8 }];
    snapshot.facilities = [{ id: "facility:civic-center", type: "governance", regionId: region, ownerOrganizationId: stateOrganization.id, level: 2, condition: 0.74, status: "damaged", workforceIds: stateOrganization.memberIds.slice(0, 2), materialInvested: 11.5, plannedTick: 2, builtTick: 5, lastMaintainedTick: 8, lastIncidentTick: 10 }];
    snapshot.selectedRegion!.resources = [
      { id: "food:state", resourceId: "food", regionId: region, holderId: stateOrganization.id, amount: 3, cap: 100, originEventId: "test" },
      { id: "materials:state", resourceId: "materials", regionId: region, holderId: stateOrganization.id, amount: 7.5, cap: 100, originEventId: "test" },
      { id: "energy:state", resourceId: "energy", regionId: region, holderId: stateOrganization.id, amount: 2.25, cap: 100, originEventId: "test" },
    ];
    snapshot.supplyRoutes = [{
      fromOrganizationId: "organization:source",
      toOrganizationId: stateOrganization.id,
      fromRegion: "region:1:1" as never,
      toRegion: region,
      resourceId: "energy",
      totalAmount: 1.5,
      shipmentCount: 3,
      archivedShipmentCount: 2,
      lastTick: 12,
      lastTimelineDays: "12",
      lastYears: 12,
    }];
    snapshot.eventArchive = createEventArchive();
    snapshot.eventArchive.strategicRoutes = [{
      kind: "migration",
      fromId: stateOrganization.id,
      toId: stateOrganization.id,
      fromRegion: "region:1:1" as never,
      toRegion: region,
      cumulativeAmount: 14,
      occurrenceCount: 2,
      firstTick: 4,
      firstTimelineDays: "4",
      lastTick: 12,
      lastTimelineDays: "12",
    }];
    snapshot.recentRegionEvents = [{
      id: "event:state-history",
      tick: 11,
      years: 11,
      kind: "organization-war",
      ruleId: "society:organization-war",
      source: "natural",
      sourceIds: [stateOrganization.id],
      regionIds: [region],
      organizationIds: [stateOrganization.id],
      probability: 0.3,
      result: "repelled",
    }, {
      id: "event:other-history",
      tick: 10,
      years: 10,
      kind: "organization-war",
      ruleId: "society:organization-war",
      source: "natural",
      sourceIds: ["organization:other"],
      regionIds: [region],
      organizationIds: ["organization:other"],
      probability: 0.3,
      result: "absorbed",
    }];
    snapshot.selectedRegion = {
      ...snapshot.selectedRegion!,
      organizations: [{
        id: stateOrganization.id,
        type: stateOrganization.type,
        memberCount: stateOrganization.memberIds.length,
        memberIds: stateOrganization.memberIds,
        childIds: [],
        resourceIds: [],
        historyIds: ["event:war"],
        territoryRegionIds: stateOrganization.territoryRegionIds,
        governance: stateOrganization.governance,
        diplomacy: stateOrganization.diplomacy,
      }],
    };
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "state", id: stateOrganization.id });

    expect(element.innerHTML).toContain("国家报告");
    expect(element.innerHTML).toContain("治理状态");
    expect(element.innerHTML).toContain("稳定度");
    expect(element.innerHTML).toContain("战争疲劳");
    expect(element.innerHTML).toContain("盟友");
    expect(element.innerHTML).toContain("可追溯事件");
    expect(element.innerHTML).toContain("原创技术");
    expect(element.innerHTML).toContain("环议协约法");
    expect(element.innerHTML).toContain("技术反馈");
    expect(element.innerHTML).toContain("稳定与公共建设");
    expect(element.innerHTML).toContain("资产记录");
    expect(element.innerHTML).toContain("治理设施 · 2 级");
    expect(element.innerHTML).toContain("受损");
    expect(element.innerHTML).toContain("材料投入 11.5 单位");
    expect(element.innerHTML).toContain("运行贡献：治理支持强度");
    expect(element.innerHTML).toContain("3 食物单位");
    expect(element.innerHTML).toContain("7.5 材料单位");
    expect(element.innerHTML).toContain("2.25 能源单位");
    expect(element.innerHTML).toContain("区域供应链");
    expect(element.innerHTML).toContain("输入 · 能源");
    expect(element.innerHTML).toContain("累计 1.5 单位");
    expect(element.innerHTML).toContain("归档 2 批");
    expect(element.innerHTML).toContain("长期战略路线");
    expect(element.innerHTML).toContain('data-strategic-route-kind="migration"');
    expect(element.innerHTML).toContain("跨区域战争");
    expect(element.innerHTML).toContain("结果 repelled");
    expect(element.innerHTML).toContain("该组织在当前区域内最近 1 条");
  });

  it("keeps cross-region organizations inspectable with global balances", () => {
    const snapshot = lineageSnapshot();
    const foreignRegion = "region:2:2" as never;
    const organization = createOrganization("state", foreignRegion, snapshot.projection!.agents.map((agent) => agent.id));
    organization.territoryRegionIds = [foreignRegion, region];
    snapshot.organizationDirectory = [{
      id: organization.id,
      type: organization.type,
      regionId: organization.regionId,
      memberCount: 64,
      memberIds: [],
      childIds: [],
      resourceIds: ["food", "materials", "energy"],
      historyCount: 3,
      archivedHistoryCount: 7,
      relationshipCount: 9,
      territoryRegionIds: organization.territoryRegionIds,
      governance: organization.governance,
      diplomacy: {},
    }];
    snapshot.resources = [
      { id: "food:foreign", resourceId: "food", regionId: foreignRegion, holderId: organization.id, amount: 11, cap: 100, originEventId: "test" },
      { id: "materials:foreign", resourceId: "materials", regionId: foreignRegion, holderId: organization.id, amount: 4, cap: 100, originEventId: "test" },
      { id: "energy:foreign", resourceId: "energy", regionId: foreignRegion, holderId: organization.id, amount: 2, cap: 100, originEventId: "test" },
    ];
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "state", id: organization.id });

    expect(element.innerHTML).toContain(organization.id);
    expect(element.innerHTML).toContain("64 人");
    expect(element.innerHTML).toContain("9 条");
    expect(element.innerHTML).toContain("11 食物单位");
    expect(element.innerHTML).toContain("4 材料单位");
    expect(element.innerHTML).toContain("2 能源单位");
    expect(element.innerHTML).toContain("10 条");
  });

  it("provides stable navigation across organization levels and projected members", () => {
    const snapshot = lineageSnapshot();
    const family = createOrganization("family", region, snapshot.projection!.agents.slice(0, 2).map((agent) => agent.id));
    const city = createOrganization("city", region, snapshot.projection!.agents.map((agent) => agent.id), [family.id]);
    const state = createOrganization("state", region, snapshot.projection!.agents.map((agent) => agent.id), [city.id]);
    snapshot.projection = { ...snapshot.projection!, organizations: [family, city, state] };
    snapshot.organizationDirectory = [{
      id: "organization:state:aggregate" as never,
      type: "state",
      regionId: region,
      memberCount: 120,
      memberIds: [],
      childIds: [],
      resourceIds: [],
      historyCount: 0,
      archivedHistoryCount: 0,
      relationshipCount: 0,
      territoryRegionIds: [region],
    }];
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "city", id: city.id });

    expect(element.innerHTML).toContain(`data-detail-level="state" data-detail-id="${state.id}"`);
    expect(element.innerHTML).toContain(`data-detail-level="family" data-detail-id="${family.id}"`);
    expect((element.innerHTML.match(/data-detail-link data-detail-level="agent"/g) ?? [])).toHaveLength(4);
    expect(element.innerHTML).toContain("关系导航");

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "state", id: "organization:state:aggregate" });

    expect(element.innerHTML).toContain("另有 120 名成员仅保留聚合记录");
    expect(element.innerHTML).not.toContain('data-detail-link data-detail-level="agent"');
  });

  it("renders an archived organization summary as a selectable historical report", () => {
    const snapshot = lineageSnapshot();
    const organization = createOrganization("city", region, snapshot.projection!.agents.map((agent) => agent.id));
    organization.status = "collapsed";
    organization.resources = { food: 8, energy: 2 };
    const state = createWorld(141, { width: 8, height: 8, formation: "formed" });
    archiveOrganizationRecords(state, [organization], "lifecycle");
    snapshot.eventArchive = state.eventArchive;
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "city", id: organization.id });

    expect(element.innerHTML).toContain("organization-archive");
    expect(element.innerHTML).toContain("历史组织摘要");
    expect(element.innerHTML).toContain("生命周期结束归档");
    expect(element.innerHTML).toContain("已解体");
    expect(element.innerHTML).toContain("8 食物单位");
  });

  it("renders a culture report with its origin, values, and inherited traditions", () => {
    const snapshot = lineageSnapshot();
    const identity = createCultureIdentity("inspector:culture", region, 12, 3, [], { water: 0.7, nutrients: 0.6, biomass: 0.5 });
    snapshot.cultures = [{ id: "culture:inspector" as never, regionId: region, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8, identity }];
    snapshot.cultureIdentityByRegion = { [region]: identity };
    const element = { innerHTML: "" } as HTMLElement;

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "culture", id: "culture:inspector" });

    expect(element.innerHTML).toContain("文化报告");
    expect(element.innerHTML).toContain(identity.name);
    expect(element.innerHTML).toContain("语言家族");
    expect(element.innerHTML).toContain("文化价值");
    expect(element.innerHTML).toContain("环境守护");
    expect(element.innerHTML).toContain("传承传统");
    expect(element.innerHTML).toContain(identity.traditions[0]!);
  });

  it("renders aggregate culture memory and society metrics without detailed records", () => {
    const snapshot = lineageSnapshot();
    const identity = createCultureIdentity("aggregate:inspector", region, 12, 3, [], { water: 0.7, nutrients: 0.6, biomass: 0.5 });
    const cultureSummary: RegionCultureSummary = {
      id: "culture:aggregate:inspector" as never,
      identity,
      knowledge: [{
        id: "aggregate-knowledge:construction",
        kind: "aggregate-innovation:construction",
        name: "叠岩承重法",
        domain: "construction",
        credibility: 0.82,
        transmissionCost: 0.22,
        forgettingRate: 0.01,
        originRegionId: region,
        originTick: 18,
        originYears: 18,
        parentIds: [],
      }],
      beliefCount: 4,
      transmissionRate: 0.76,
      memoryStrength: 0.68,
      innovationCount: 3,
      lastChangeTick: 24,
    };
    const societySummary: RegionSocietySummary = {
      organizationCounts: { family: 8, clan: 2, tribe: 1, settlement: 1, city: 1, state: 0, federation: 0, empire: 0 },
      organizationCapacity: 68,
      cohesion: 0.72,
      stability: 0.64,
      legitimacy: 0.61,
      military: 0.28,
      publicGoods: 0.55,
      tradeVolume: 38.5,
      conflictPressure: 0.12,
      infrastructureLevel: 0.48,
      lastChangeTick: 24,
    };
    snapshot.focusRegionId = region;
    snapshot.cultures = [];
    snapshot.projection = { ...snapshot.projection!, agents: [], relationships: [], organizations: [] };
    snapshot.selectedRegion = {
      ...snapshot.selectedRegion!,
      mode: "aggregate",
      population: 420,
      socialPopulation: 68,
      cultureSummary,
      societySummary,
      organizations: [],
    };
    const element = { innerHTML: "" } as HTMLElement;
    const selection = { x: 0, y: 0, index: 0, regionId: region };

    renderInspector(element, snapshot, selection);
    expect(element.innerHTML).toContain("社会演化");
    expect(element.innerHTML).toContain("生态总量");
    expect(element.innerHTML).toContain("社会人口");
    expect(element.innerHTML).toContain("文化记忆");
    expect(element.innerHTML).toContain("城市 1 个");
    expect(element.innerHTML).toContain("基础设施");

    renderInspector(element, snapshot, selection, { level: "culture", id: cultureSummary.id });
    expect(element.innerHTML).toContain("聚合文化");
    expect(element.innerHTML).toContain("叠岩承重法");
    expect(element.innerHTML).toContain("传承成本");
    expect(element.innerHTML).toContain("知识创新");
    expect(element.innerHTML).toContain("信念记录");
  });

  it("renders regional, personal, and pathogen health reports", () => {
    const snapshot = lineageSnapshot();
    const projected = snapshot.projection!.agents[0]!;
    const species = snapshot.species![0]!;
    const state = createWorld(9_002, { width: 8, height: 8, formation: "formed" });
    const pathogen = {
      ...derivePathogen(state, region, species.id),
      name: "雾环疫",
      status: "outbreak" as const,
      prevalence: 0.5,
      cumulativeCases: 12,
      cumulativeRecoveries: 4,
      cumulativeDeaths: 1,
      regionalOutbreaks: [
        { regionId: region, status: "outbreak" as const, prevalence: 0.5, firstDetectedTick: 1, lastActiveTick: 8 },
        { regionId: "region:1:0" as never, status: "endemic" as const, prevalence: 0.08, firstDetectedTick: 6, lastActiveTick: 8 },
      ],
    };
    projected.health = { vitality: 0.62, infections: [{ pathogenId: pathogen.id, infectedTick: 8, severity: 0.44 }], immunityIds: [] };
    snapshot.pathogens = [pathogen];
    snapshot.selectedRegion = {
      ...snapshot.selectedRegion!,
      healthSummary: { activePathogenIds: [pathogen.id], infectedCount: 1, immuneCount: 0, prevalence: 0.25, meanVitality: 0.86 },
    };
    const element = { innerHTML: "" } as HTMLElement;
    const selection = { x: 0, y: 0, index: 0, regionId: region };

    renderInspector(element, snapshot, selection);
    expect(element.innerHTML).toContain("公共健康");
    expect(element.innerHTML).toContain("雾环疫");

    const { selectedRegion: _selectedRegion, ...regionalSnapshotBase } = snapshot;
    const regionalSnapshot: WorldSnapshot = {
      ...regionalSnapshotBase,
      focusRegionId: "region:1:0" as never,
      projection: { ...snapshot.projection!, agents: [], relationships: [], organizations: [] },
    };
    renderInspector(element, regionalSnapshot, { x: 1, y: 0, index: 1, regionId: "region:1:0" as never });
    expect(element.innerHTML).toContain("地方流行 · 8%");
    expect(element.innerHTML).not.toContain("区域暴发 · 50%");

    renderInspector(element, snapshot, selection, { level: "agent", id: projected.id });
    expect(element.innerHTML).toContain("个人健康");
    expect(element.innerHTML).toContain("病程强度");
    expect(element.innerHTML).toContain("遗传与适应");
    expect(element.innerHTML).toContain("当地适应度");
    expect(element.innerHTML).toContain(projected.genetics!.lineageSignature);

    renderInspector(element, snapshot, selection, { level: "pathogen", id: pathogen.id });
    expect(element.innerHTML).toContain("病原体报告");
    expect(element.innerHTML).toContain("累计病例");
    expect(element.innerHTML).toContain("医疗能力");
    expect(element.innerHTML).toContain("跨区域疫情");
    expect(element.innerHTML).toContain("region:1:0");
  });

  it("shows bounded object timelines across detail levels with exact simulation time", () => {
    const snapshot = lineageSnapshot();
    const agent = snapshot.projection!.agents[0]!;
    const family = snapshot.projection!.organizations.find((organization) => organization.type === "family");
    const species = snapshot.species![0]!;
    const population = snapshot.populations![0]!;
    if (!family) throw new Error("Expected a family in the fixture");

    const identity = createCultureIdentity("history-culture", region, 2, 2, [], { water: 0.5, nutrients: 0.5, biomass: 0.5 });
    snapshot.cultures = [{ id: "culture:history" as never, regionId: region, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8, identity }];
    snapshot.cultureIdentityByRegion = { [region]: identity };
    snapshot.substances = [{
      id: "substance:history",
      name: "星髓晶",
      kind: "crystal",
      formation: "hydrothermal",
      status: "known",
      regionId: region,
      originTick: 2,
      originYears: 2,
      parentIds: [],
      composition: { carbon: 0.2, nitrogen: 0.2, phosphorus: 0.2, organics: 0.1, oxygen: 0.3 },
      properties: { hardness: 0.8, density: 0.6, reactivity: 0.2, conductivity: 0.7, energyPotential: 0.5, biologicalAffinity: 0.3, stability: 0.9 },
      reserveCapacity: 100,
      remainingReserve: 100,
      extractedTotal: 0,
      discoveredByIds: [],
    }];
    snapshot.facilities = [{
      id: "facility:history",
      type: "construction",
      regionId: region,
      ownerOrganizationId: family.id,
      level: 1,
      condition: 1,
      status: "active",
      workforceIds: [agent.id],
      workforceRequired: 1,
      workforceEfficiency: 1,
      materialInvested: 4,
      plannedTick: 1,
      builtTick: 2,
      lastMaintainedTick: 3,
      lastIncidentTick: 3,
    }];
    const pathogen = { ...derivePathogen(createWorld(9_003, { width: 8, height: 8, formation: "formed" }), region, species.id), id: "pathogen:history" };
    snapshot.pathogens = [pathogen];
    snapshot.worldviewEntities = [{
      id: "worldview:history" as never,
      packId: "emergence.original-worldview",
      kind: "sect",
      name: "星髓研习会",
      regionId: region,
      influence: 0.4,
      resourceBalances: {},
      originTick: 2,
      founderId: agent.id,
      memberIds: [agent.id],
      status: "active",
      supporterCount: 2,
      activePractitionerCount: 1,
      sponsorOrganizationId: family.id,
    }];

    const relatedEvent = (id: string, kind: string, relatedIds: string[], timelineDays = "9007199254740993") => ({
      id,
      tick: 8,
      timelineStep: "9007199254740993",
      timelineDays,
      kind,
      ruleId: `test:${kind}`,
      source: "natural" as const,
      sourceIds: [],
      relatedIds,
      regionIds: [region],
      organizationIds: relatedIds.filter((relatedId) => relatedId.startsWith("organization:")),
      probability: 1,
      name: "对象发生变化",
    });
    snapshot.recentRegionEvents = [
      relatedEvent("event:agent-history", "agent-birth", [agent.id]),
      relatedEvent("event:family-history", "family-formation", [family.id]),
      relatedEvent("event:species-history", "species-emergence", [species.id]),
      relatedEvent("event:population-history", "population-migration", [population.id]),
      relatedEvent("event:culture-history", "culture-emergence", ["culture:history"]),
      relatedEvent("event:substance-history", "substance-discovery", ["substance:history"]),
      relatedEvent("event:facility-history", "facility-built", ["facility:history"]),
      relatedEvent("event:pathogen-history", "pathogen-emergence", [pathogen.id]),
      relatedEvent("event:worldview-history", "worldview-entity-revived", ["worldview:history"]),
    ];
    snapshot.eventArchive = createEventArchive();
    snapshot.eventArchive.milestones = [{
      id: "event:archived-substance-history",
      tick: 4,
      timelineStep: "4",
      timelineDays: "9007199254740993",
      years: 4,
      kind: "substance-formation",
      ruleId: "test:archived-substance",
      source: "natural",
      sourceIds: [],
      regionIds: [region],
      organizationIds: [],
      probability: 1,
      roll: 0,
      details: { substanceId: "substance:history", name: "星髓晶形成" },
    }];

    const element = { innerHTML: "" } as HTMLElement;
    const selection = { x: 0, y: 0, index: 0, regionId: region };
    renderInspector(element, snapshot, selection);
    expect(element.innerHTML).toContain(`data-detail-link data-detail-level="agent" data-detail-id="${agent.id}"`);
    expect(element.innerHTML).toContain(`data-detail-link data-detail-level="substance" data-detail-id="substance:history"`);
    expect(element.innerHTML).toContain("关联对象");
    const details = [
      ["agent", agent.id],
      ["family", family.id],
      ["species", species.id],
      ["population", population.id],
      ["culture", "culture:history"],
      ["substance", "substance:history"],
      ["facility", "facility:history"],
      ["pathogen", pathogen.id],
      ["worldview", "worldview:history"],
    ] as const;
    for (const [level, id] of details) {
      renderInspector(element, snapshot, selection, { level, id });
      expect(element.innerHTML).toContain(`data-history-level="${level}"`);
      expect(element.innerHTML).toContain(`data-history-id="${id}"`);
    }
    renderInspector(element, snapshot, selection, { level: "substance", id: "substance:history" });
    expect(element.innerHTML).toContain("历史档案");
    expect(element.innerHTML).toContain("24,677,258,232,167 年 38 天");
    expect(element.innerHTML).toContain("对象发生变化");
  });
});
