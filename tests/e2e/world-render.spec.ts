import { expect, test } from "@playwright/test";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
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
  const canvas = page.locator("#world-map");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-render-style", "fantasy-3d");
  await expect(canvas).toHaveAttribute("aria-label", "虚拟地球奇幻 3D 地图");
  await expect(canvas).toHaveAttribute("data-scene-lod", "global");
  await expect(page.locator("#render-quality")).toHaveValue("480");
  await expect(canvas).toHaveJSProperty("width", 854);
  await expect(canvas).toHaveJSProperty("height", 480);
  await page.locator("#render-quality").selectOption("720");
  await expect(canvas).toHaveJSProperty("width", 1280);
  await expect(canvas).toHaveJSProperty("height", 720);
  await page.locator("#render-quality").selectOption("1080");
  await expect(canvas).toHaveJSProperty("width", 1920);
  await expect(canvas).toHaveJSProperty("height", 1080);
  await page.locator("#render-quality").selectOption("480");
  await expect(canvas).toHaveJSProperty("width", 854);
  await expect(canvas).toHaveJSProperty("height", 480);
  await expect(page.locator("#zoom-level")).toHaveText("100%");
  await page.getByRole("button", { name: "放大地图" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("125%");
  await page.getByRole("button", { name: "缩小地图" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("100%");
  const mapBox = await canvas.boundingBox();
  if (!mapBox) throw new Error("Map canvas is not measurable");
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(page.locator("#zoom-level")).toHaveText("110%");
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
  for (let click = 0; click < 12; click += 1) await page.getByRole("button", { name: "放大地图" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("800%");
  await expect(canvas).toHaveAttribute("data-scene-lod", "individual");
  await expect(canvas).toHaveJSProperty("width", 1920);
  await expect(canvas).toHaveJSProperty("height", 1080);
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
  await expect(page.locator("#inspector")).toContainText("有机物");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toBeVisible();
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("知识承继");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("代际知识传承");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("食物保障");
  await expect(page.getByRole("region", { name: "层级详情" })).toBeVisible();
  await expect(page.locator("[data-detail-level=region]")).toHaveClass(/active/);
  await page.getByRole("button", { name: "单步推进" }).click();
  await expect(page.locator("#world-year")).toContainText("1 年");
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
  const state = createWorld(90_210, { width: 64, height: 40 });
  const species = createSpecies("fantasy-world", "consumer");
  const regionId = "region:32:20" as never;
  const population = { id: "population:fantasy-world" as never, speciesId: species.id, regionId, count: 48, energy: 1 };
  const agents = Array.from({ length: 48 }, (_, index) => createAgent(population, species, index, "fantasy-world"));
  state.species = [species];
  state.populations = [population];
  state.agents = agents;
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
  state.observation = { focusRegionId: regionId };

  await page.goto("/");
  await page.locator("#load-input").setInputFiles({
    name: "fantasy-world.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeWorld(state)),
  });
  const canvas = page.locator("#world-map");
  await expect(canvas).toHaveAttribute("data-scene-entity-count", "57");
  await expect(canvas).toHaveAttribute("data-scene-link-count", "24");
  await page.locator("#render-quality").selectOption("1080");
  for (let click = 0; click < 8; click += 1) await page.getByRole("button", { name: "\u653e\u5927\u5730\u56fe" }).click();
  await expect(page.locator("#zoom-level")).toHaveText("400%");
  await expect(canvas).toHaveAttribute("data-scene-lod", "individual");
  await page.screenshot({ path: "test-results/fantasy-3d-suite.png", fullPage: true });
});
