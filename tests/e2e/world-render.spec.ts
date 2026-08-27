import { expect, test } from "@playwright/test";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createCultureIdentity } from "../../src/sim/culture/identity.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import { serializeWorld } from "../../src/persistence/serialize.ts";

test("renders a non-empty world map and interactive observation panels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "虚拟地球" })).toBeVisible();
  await expect(page.locator("#simulation-status")).toContainText("暂停");
  await expect(page.locator("#status-panel")).toContainText("世界年龄");
  await expect(page.locator("#status-panel")).toContainText("模型均温");
  await expect(page.locator("#status-panel")).toContainText("°C");
  await expect(page.locator("#status-panel")).toContainText("生命个体");
  await expect(page.locator("#status-panel")).toContainText("个");
  await expect(page.locator("#status-panel")).toContainText("户");
  await expect(page.locator("#status-panel")).toContainText("食物单位");
  await expect(page.locator("#status-panel")).toContainText("运行监测");
  await expect(page.locator("#status-panel")).toContainText("历史归档");
  const canvas = page.locator("#world-map");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-render-style", "fantasy-3d");
  await expect(canvas).toHaveAttribute("data-formation-phase", "dust-cloud");
  await expect(canvas).toHaveAttribute("data-formation-progress", "0.00");
  await expect(canvas).toHaveAttribute("data-formation-body-scale", "0.070");
  await expect(canvas).toHaveAttribute("data-terrain-patch", "formation-body");
  await expect(canvas).toHaveAttribute("data-surface-mode", "forming-body");
  await expect(canvas).toHaveAttribute("aria-label", "虚拟地球奇幻 3D 地图");
  await expect(canvas).toHaveAttribute("data-scene-lod", "global");
  await expect(canvas).toHaveAttribute("data-max-zoom", "64");
  await expect(canvas).toHaveAttribute("data-world-scope", "forming-body");
  await expect(page.locator("#map-scale-level")).toHaveText("全球观察");
  await expect(page.locator("#render-quality")).toHaveValue("480");
  await expect(canvas).toHaveJSProperty("height", 480);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(600);
  await page.locator("#render-quality").selectOption("720");
  await expect(canvas).toHaveJSProperty("height", 720);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(900);
  await page.locator("#render-quality").selectOption("1080");
  await expect(canvas).toHaveJSProperty("height", 1080);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(1_400);
  await page.locator("#render-quality").selectOption("480");
  await expect(canvas).toHaveJSProperty("height", 480);
  const aspectError = await canvas.evaluate((element: HTMLCanvasElement) => Math.abs(element.width / element.height - element.clientWidth / element.clientHeight));
  expect(aspectError).toBeLessThan(0.01);
  await expect(page.locator("#zoom-level")).toHaveText("100%");
  await page.getByRole("button", { name: "放大地图" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("125%");
  await page.getByRole("button", { name: "缩小地图" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("100%");
  const mapBox = await canvas.boundingBox();
  if (!mapBox) throw new Error("Map canvas is not measurable");
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(page.locator("#zoom-level")).toHaveText("112%");
  await page.getByRole("button", { name: "复位地图缩放" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("100%");
  const beforePan = await canvas.boundingBox();
  if (!beforePan) throw new Error("Map canvas is not measurable");
  await page.getByRole("button", { name: "放大地图" }).click();
  await page.mouse.move(beforePan.x + 250, beforePan.y + 250);
  await page.mouse.down();
  await page.mouse.move(beforePan.x + 320, beforePan.y + 290);
  await page.mouse.up();
  await expect(page.locator("#zoom-level")).toHaveText("125%");
  for (let click = 0; click < 21; click += 1) await page.getByRole("button", { name: "放大地图" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("6400%");
  await expect(canvas).toHaveAttribute("data-scene-lod", "individual");
  await expect(page.locator("#map-scale-level")).toHaveText("个人观察");
  await expect(canvas).toHaveJSProperty("height", 1080);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(1_400);
  await page.getByRole("button", { name: "复位地图缩放" }).click();
  await expect(canvas).toHaveAttribute("data-scene-lod", "global");
  const webglSignal = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context || element.width === 0 || element.height === 0) return 0;
    const pixels = new Uint8Array(4 * 16);
    let signal = 0;
    for (let sample = 0; sample < 16; sample += 1) {
      const x = Math.floor(element.width * ((sample % 4) + 0.5) / 4);
      const y = Math.floor(element.height * (Math.floor(sample / 4) + 0.5) / 4);
      context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixels, sample * 4);
      signal += pixels[sample * 4] ?? 0;
    }
    return signal;
  });
  expect(webglSignal).toBeGreaterThan(100);
  await page.getByRole("button", { name: "温度" }).click();
  await expect(page.getByRole("button", { name: "温度" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "碳循环" }).click();
  await expect(page.getByRole("button", { name: "碳循环" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "氧气" }).click();
  await expect(page.getByRole("button", { name: "氧气" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "食物保障" }).click();
  await expect(page.getByRole("button", { name: "食物保障" })).toHaveClass(/active/);
  await expect(page.locator("#legend-low")).toHaveText("低保障");
  await expect(page.locator("#legend-high")).toHaveText("高保障");
  await canvas.click({ position: { x: 120, y: 100 } });
  await expect(page.locator("#inspector")).toContainText("region:");
  await expect(page.locator("#inspector")).toContainText("行星坐标");
  await expect(page.locator("#inspector")).toContainText("模拟海拔");
  await expect(page.locator("#inspector")).toContainText("m");
  await expect(page.locator("#inspector")).toContainText("°C");
  await expect(page.locator("#inspector")).toContainText("相对浓度");
  await expect(page.getByRole("region", { name: "认知与传说" })).toBeVisible();
  await expect(page.getByRole("region", { name: "认知与传说" })).toContainText("观测、理论、信仰与验证严格分离");
  await expect(page.getByRole("region", { name: "规律训练" })).toBeVisible();
  await expect(page.getByRole("region", { name: "规律训练" })).toContainText("只在已验证规律后出现");
  await expect(page.getByRole("region", { name: "知识与技术" })).toBeVisible();
  await expect(page.getByRole("region", { name: "知识与技术" })).toContainText("由当地条件自主产生");
  await expect(page.locator("#inspector")).toContainText("有机物");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toBeVisible();
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("知识承继");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("代际知识传承");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("食物保障");
  await expect(page.getByRole("region", { name: "层级详情" })).toBeVisible();
  await expect(page.locator("[data-detail-level=region]")).toHaveClass(/active/);
  await page.getByRole("button", { name: "单步推进" }).click();
  await expect(page.locator("#world-year")).toContainText("0 年 1 天");
  await expect(canvas).toHaveAttribute("data-formation-progress", "0.27");
  await page.getByRole("button", { name: "4×", exact: true }).click();
  await expect(page.getByRole("button", { name: "4×", exact: true })).toHaveClass(/active/);
});

test("keeps the map and panels usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#world-map")).toBeVisible();
  await expect(page.locator(".right-rail")).toBeVisible();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-state", "paused");
  await page.locator("#world-map").click({ position: { x: 120, y: 100 } });
  await expect(page.locator("#inspector")).toContainText("region:");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const metricOverflow = await page.locator(".lineage-metrics > div").evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth + 1));
  expect(metricOverflow).toBe(false);
  const observationOverflow = await page.locator(".metric-row, .observation-row").evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth + 1));
  expect(observationOverflow).toBe(false);
  const worldviewOverflow = await page.locator(".worldview-list li").evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth + 1));
  expect(worldviewOverflow).toBe(false);
});

test("renders a formed crust as a global map with expandable local detail", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#world-map");
  const formed = createWorld(42, { width: 96, height: 48, formation: "formed" });
  await page.locator("#load-input").setInputFiles({
    name: "formed-world.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeWorld(formed)),
  });

  await expect(canvas).toHaveAttribute("data-formation-phase", "stable-crust");
  await expect(canvas).toHaveAttribute("data-formation-body-scale", "1.000");
  await expect(canvas).toHaveAttribute("data-terrain-patch", "global");
  await expect(canvas).toHaveAttribute("data-formation-progress", "100.00");
  await expect(canvas).toHaveAttribute("data-world-scope", "planetary");
  await expect(canvas).toHaveAttribute("data-world-grid", "96x48");
  await expect(canvas).toHaveAttribute("data-surface-mode", "planet-globe");
  await expect(canvas).toHaveAttribute("data-world-coverage", "100%");
  await expect(canvas).toHaveAttribute("data-visible-region-span", "96.00x48.00");

  const globeBox = await canvas.boundingBox();
  if (!globeBox) throw new Error("Planet globe is not measurable");
  await canvas.click({ position: { x: globeBox.width / 2, y: globeBox.height / 2 } });
  await expect(page.locator("#inspector")).toContainText("region:");
  const globeSignal = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context || element.width === 0 || element.height === 0) return 0;
    const pixel = new Uint8Array(4);
    let signal = 0;
    for (let y = 1; y <= 5; y += 1) for (let x = 1; x <= 7; x += 1) {
      context.readPixels(Math.floor(element.width * x / 8), Math.floor(element.height * y / 6), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      signal += Math.max(pixel[0]!, pixel[1]!, pixel[2]!) - Math.min(pixel[0]!, pixel[1]!, pixel[2]!);
    }
    return signal;
  });
  expect(globeSignal).toBeGreaterThan(200);
  const initialGlobeYaw = await canvas.getAttribute("data-globe-yaw");
  await page.mouse.move(globeBox.x + globeBox.width / 2, globeBox.y + globeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(globeBox.x + globeBox.width / 2 + 60, globeBox.y + globeBox.height / 2 + 10);
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("data-globe-yaw", initialGlobeYaw ?? "");
  await canvas.screenshot({ path: "test-results/formed-globe-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await canvas.screenshot({ path: "test-results/formed-globe-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });

  for (let click = 0; click < 22; click += 1) await page.getByRole("button", { name: "放大地图" }).click();
  await expect(canvas).toHaveAttribute("data-surface-mode", "local-surface");
  await expect(canvas).toHaveAttribute("data-scene-lod", "individual");
  await expect(canvas).toHaveAttribute("data-terrain-detail", "16");
  await expect(canvas).toHaveAttribute("data-terrain-patch", /\d+:\d+:\d+:\d+/);
  await expect(canvas).toHaveAttribute("data-visible-region-span", "1.50x0.75");
  await expect(page.locator("#zoom-level")).toHaveText("6400%");
  await expect(page.locator("#map-scale-level")).toHaveText("个人观察");
});

test("rotates and tilts the constrained 2.5d camera", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#world-map");
  await expect(canvas).toHaveAttribute("data-camera-yaw", "45");
  await expect(canvas).toHaveAttribute("data-camera-pitch", "42");
  await page.getByRole("button", { name: "向右旋转镜头" }).click();
  await expect(canvas).toHaveAttribute("data-camera-yaw", "60");
  await page.getByRole("button", { name: "提高镜头俯角" }).click();
  await expect(canvas).toHaveAttribute("data-camera-pitch", "47");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas is not measurable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 - 30);
  await page.mouse.up({ button: "right" });
  await expect(canvas).not.toHaveAttribute("data-camera-yaw", "60");
  await page.getByRole("button", { name: "镜头朝北" }).click();
  await expect(canvas).toHaveAttribute("data-camera-yaw", "0");
  await expect(canvas).toHaveAttribute("data-camera-pitch", "42");
});

test("renders the complete society as detailed fantasy 3d models", async ({ page }) => {
  const state = createWorld(90_210, { width: 64, height: 40, formation: "formed" });
  const species = createSpecies("fantasy-world", "consumer");
  const regionId = "region:32:20" as never;
  const population = { id: "population:fantasy-world" as never, speciesId: species.id, regionId, count: 48, energy: 1 };
  const agents = Array.from({ length: 48 }, (_, index) => createAgent(population, species, index, "fantasy-world"));
  state.species = [species];
  state.populations = [population];
  state.agents = agents;
  state.cultures = [{
    id: "culture:e2e" as never,
    regionId,
    knowledgeIds: [],
    beliefIds: [],
    transmissionRate: 0.86,
    identity: createCultureIdentity("e2e:fantasy-culture", regionId, 6, 6),
  }];
  state.relationships = Array.from({ length: 24 }, (_, index) => createRelationship("partner", agents[index * 2]!.id, agents[index * 2 + 1]!.id, 0, 0.8));
  state.organizations = ([
    ["family", "region:31:19", 6],
    ["clan", "region:32:19", 12],
    ["tribe", "region:33:19", 18],
    ["settlement", "region:31:20", 24],
    ["city", "region:32:20", 36],
    ["state", "region:33:20", 40],
    ["federation", "region:31:21", 44],
    ["empire", "region:33:21", 48],
  ] as const).map(([type, organizationRegionId, count]) => createOrganization(type, organizationRegionId as never, agents.slice(0, count).map((agent) => agent.id)));
  state.worldview.phenomena = [{
    id: "phenomenon:e2e-principle",
    packId: "emergence.original-worldview",
    kind: "verified-principle",
    epistemicStatus: "verified",
    name: "风弦转化原理",
    regionId,
    originTick: 4,
    parentIds: [],
    causeRuleId: "test",
    evidence: {},
  }];
  state.worldview.entities = [{
    id: "worldview:e2e-sect" as never,
    packId: "emergence.original-worldview",
    kind: "sect",
    name: "风弦观测院",
    regionId,
    influence: 0.58,
    resourceBalances: { "attunement-energy": 0.4 },
    originTick: 8,
    sourcePhenomenonId: "phenomenon:e2e-principle",
    founderId: agents[0]!.id,
    memberIds: agents.slice(0, 5).map((agent) => agent.id),
    sponsorOrganizationId: state.organizations.find((organization) => organization.type === "city")!.id,
    status: "active",
  }];
  state.substances = [{
    id: "substance:e2e-composite",
    name: "辉棱复晶",
    kind: "engineered-composite",
    formation: "engineered",
    status: "known",
    regionId,
    originTick: 12,
    originYears: 12 / 365,
    parentIds: ["substance:e2e-crystal"],
    composition: { carbon: 0.3, nitrogen: 0.1, phosphorus: 0.2, organics: 0.2, oxygen: 0.2 },
    properties: { hardness: 0.9, density: 0.72, reactivity: 0.12, conductivity: 0.88, energyPotential: 0.82, biologicalAffinity: 0.3, stability: 0.94 },
    discoveredByIds: agents.slice(0, 3).map((agent) => agent.id),
    discoveryTick: 14,
    discoveryYears: 14 / 365,
  }, {
    id: "substance:e2e-crystal",
    name: "澜脉晶",
    kind: "crystal",
    formation: "hydrothermal",
    status: "known",
    regionId,
    originTick: 3,
    originYears: 3 / 365,
    parentIds: [],
    composition: { carbon: 0.2, nitrogen: 0.2, phosphorus: 0.3, organics: 0.1, oxygen: 0.2 },
    properties: { hardness: 0.8, density: 0.64, reactivity: 0.2, conductivity: 0.68, energyPotential: 0.62, biologicalAffinity: 0.24, stability: 0.86 },
    discoveredByIds: agents.slice(0, 2).map((agent) => agent.id),
    discoveryTick: 7,
    discoveryYears: 7 / 365,
  }];
  state.observation = { focusRegionId: regionId };

  await page.goto("/");
  await page.locator("#load-input").setInputFiles({
    name: "fantasy-world.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeWorld(state)),
  });
  const canvas = page.locator("#world-map");
  await expect(canvas).toHaveAttribute("data-scene-entity-count", "58");
  await expect(canvas).toHaveAttribute("data-scene-link-count", "24");
  await expect(canvas).toHaveAttribute("data-scene-worldview-count", "1");
  await expect(canvas).toHaveAttribute("data-scene-lifeform-count", "49");
  await page.locator('[data-layer="substances"]').click();
  await expect(page.locator('[data-layer="substances"]')).toHaveClass(/active/);
  await expect(page.locator("#legend-low")).toHaveText("稀少");
  await expect(page.locator("#legend-high")).toHaveText("富集");
  await expect(page.locator("#status-panel")).toContainText("原创物质");
  await expect(page.locator("#status-panel")).toContainText("原创文化");
  await page.locator('[data-layer="culture"]').click();
  await expect(page.locator('[data-layer="culture"]')).toHaveClass(/active/);
  await expect(page.locator("#legend-low")).toHaveText("未形成");
  await expect(page.locator("#legend-high")).toHaveText("文化特征强");
  await page.locator("[data-detail-level=culture]").click();
  await page.locator("[data-detail-target]").selectOption("culture:e2e");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("文化报告");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("文化价值");
  await page.locator("[data-detail-level=substance]").click();
  await page.locator("[data-detail-target]").selectOption("substance:e2e-composite");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("物质报告");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("辉棱复晶");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("澜脉晶");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("导电性");
  await page.locator("[data-detail-level=species]").click();
  await page.locator("[data-detail-target]").selectOption({ index: 1 });
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("物种报告");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("认知潜力");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("遗传载体");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("代谢方式");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("身体结构");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("感官系统");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("创新签名");
  await page.locator("[data-detail-level=population]").click();
  await page.locator("[data-detail-target]").selectOption({ index: 1 });
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("种群报告");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("能量状态");
  await page.locator("[data-detail-level=worldview]").click();
  await page.locator("[data-detail-target]").selectOption({ index: 1 });
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("流派报告");
  await expect(page.getByRole("region", { name: "层级详情" })).toContainText("风弦观测院");
  await page.locator("#render-quality").selectOption("1080");
  await expect(canvas).toHaveAttribute("data-terrain-detail", "2");
  for (let click = 0; click < 22; click += 1) await page.getByRole("button", { name: "\u653e\u5927\u5730\u56fe" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("6400%");
  await expect(canvas).toHaveAttribute("data-scene-lod", "individual");
  await expect(canvas).toHaveAttribute("data-terrain-detail", "16");
  await expect(canvas).toHaveAttribute("data-terrain-patch", /\d+:\d+:\d+:\d+/);
  await expect(canvas).toHaveAttribute("data-visible-scene-entity-count", /^(?:[1-9]|[12]\d)$/);
  await page.screenshot({ path: "test-results/fantasy-3d-suite.png", fullPage: true });
});

test("renders local technology facilities and their observable effects", async ({ page }) => {
  const state = createWorld(90_211, { width: 64, height: 40, formation: "formed" });
  const regionId = "region:32:20" as never;
  const domains = ["subsistence", "construction", "navigation", "medicine", "governance", "energy"] as const;
  state.knowledge = domains.map((domain) => ({
    id: `knowledge:facility:${domain}`,
    kind: `innovation:${domain}:1`,
    name: `${domain}-tech`,
    domain,
    sourceIds: [],
    credibility: 0.85,
    transmissionCost: 0.1,
    forgettingRate: 0.01,
  }));
  state.cultures = [{ id: "culture:facility" as never, regionId, knowledgeIds: state.knowledge.map((record) => record.id), beliefIds: [], transmissionRate: 0.85 }];
  const owner = createOrganization("city", regionId, Array.from({ length: 40 }, (_, index) => `agent:facility:${index}` as never));
  state.organizations = [owner];
  state.facilities = domains.map((domain, index) => ({
    id: `facility:e2e:${domain}`,
    type: domain,
    regionId,
    ownerOrganizationId: owner.id,
    level: index % 3 === 0 ? 2 as const : 1 as const,
    condition: domain === "construction" ? 0.58 : 0.92,
    status: domain === "construction" ? "damaged" as const : "active" as const,
    workforceIds: owner.memberIds.slice(0, 4),
    materialInvested: 4 + index,
    plannedTick: 2,
    builtTick: 4 + index,
    lastMaintainedTick: 10,
    lastIncidentTick: 12,
  }));
  state.observation = { focusRegionId: regionId };

  await page.goto("/");
  await page.locator("#load-input").setInputFiles({
    name: "technology-facilities.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeWorld(state)),
  });
  const canvas = page.locator("#world-map");
  await expect(canvas).toHaveAttribute("data-scene-facility-count", "6");
  for (let click = 0; click < 22; click += 1) await page.getByRole("button", { name: "放大地图" }).click();
  await expect(canvas).toHaveAttribute("data-scene-lod", "individual");
  await expect(canvas).toHaveAttribute("data-visible-scene-entity-count", /[6-9]|1\d|2\d/);
  const colorSignal = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context || element.width === 0 || element.height === 0) return 0;
    const pixel = new Uint8Array(4);
    let signal = 0;
    for (let y = 1; y <= 5; y += 1) for (let x = 1; x <= 7; x += 1) {
      context.readPixels(Math.floor(element.width * x / 8), Math.floor(element.height * y / 6), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      signal += Math.max(pixel[0]!, pixel[1]!, pixel[2]!) - Math.min(pixel[0]!, pixel[1]!, pixel[2]!);
    }
    return signal;
  });
  expect(colorSignal).toBeGreaterThan(200);
  await expect(page.locator("#inspector")).toContainText("技术反馈");
  await expect(page.locator("#inspector")).toContainText("食物产出");
  await expect(page.locator("#inspector")).toContainText("化学转化级别");
  await expect(page.locator("#inspector")).toContainText("资产记录");
  await expect(page.locator("#inspector")).toContainText("6 项在役");
  await expect(page.locator("#inspector")).toContainText("岗位效率");
  await expect(page.locator("#inspector")).toContainText("运行贡献");
  await page.screenshot({ path: "test-results/technology-facilities.png", fullPage: true });
});
