import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createCultureIdentity } from "../../src/sim/culture/identity.ts";
import { projectMicroRegion, summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import { lineageForSnapshot, renderInspector } from "../../src/ui/inspector.ts";
import type { RegionCultureSummary, RegionId, RegionSocietySummary } from "../../src/sim/types.ts";
import type { WorldSnapshot } from "../../src/worker/protocol.ts";

const region = "region:0:0" as RegionId;

const lineageSnapshot = (): WorldSnapshot => {
  const state = createWorld(140, { width: 8, height: 8 });
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
    const element = { innerHTML: "" } as HTMLElement;
    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region });

    expect(element.innerHTML).toContain("行星坐标");
    expect(element.innerHTML).toContain("模拟海拔");
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

    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region }, { level: "worldview", id: "worldview:crystal-sect" });
    expect(element.innerHTML).toContain("流派报告");
    expect(element.innerHTML).toContain("晶脉研修会");
    expect(element.innerHTML).toContain("能量储备");
    expect(element.innerHTML).toContain("37 单位");
    expect(element.innerHTML).toContain("支持者");
    expect(element.innerHTML).toContain("存续度");
    expect(element.innerHTML).toContain("复兴次数");
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
      lastTick: 12,
      lastYears: 12,
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
});
