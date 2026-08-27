import "./styles.css";
import { createWorkerClient } from "./worker/client.ts";
import type { WorkerMessage, WorldSnapshot } from "./worker/protocol.ts";
import type { WorldEvent } from "./sim/types.ts";
import { createMapCanvas, type CellSelection } from "./ui/map-canvas.ts";
import { mapSceneLodLabel } from "./ui/map-lod.ts";
import { layerLabels, type MapLayer } from "./ui/layers.ts";
import { renderStatusPanel, phaseForSnapshot } from "./ui/status-panel.ts";
import { renderInspector, type InspectorDetail } from "./ui/inspector.ts";
import { renderTimeline } from "./ui/timeline.ts";
import { bindTimeControls, downloadSave } from "./ui/controls.ts";
import { createGodEvent, godToolLabels, type GodTool } from "./ui/god-mode.ts";
import { formatSimulationAge } from "./ui/formatters.ts";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Application root was not found");

const layers = Object.entries(layerLabels) as Array<[MapLayer, string]>;
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true"></span>
        <div><p>自主世界观测站</p><h1>虚拟地球</h1></div>
      </div>
      <div class="time-readout"><span>世界时间</span><strong id="world-year">0 年 0 天</strong><small>1×：现实 1 分钟 = 世界 1 天</small></div>
      <div class="transport" aria-label="模拟控制">
        <button id="play-button" class="icon-button primary" type="button" title="开始模拟" aria-label="开始模拟">▶</button>
        <button id="pause-button" class="icon-button" type="button" title="暂停模拟" aria-label="暂停模拟">Ⅱ</button>
        <button id="step-button" class="icon-button" type="button" title="单步推进" aria-label="单步推进">›</button>
      </div>
      <div class="speed-control" aria-label="模拟速度">
        ${([1, 4, 16, 64] as const).map((speed, index) => `<button type="button" data-speed="${speed}" class="speed-button${index === 0 ? " active" : ""}">${speed}×</button>`).join("")}
      </div>
      <output id="simulation-status" class="connection-status" aria-live="polite">正在连接模拟核心</output>
    </header>
    <nav class="layer-bar" aria-label="地图图层">
      <span>图层</span>
      <div class="segmented-control">
        ${layers.map(([id, label], index) => `<button type="button" data-layer="${id}" class="layer-button${index === 0 ? " active" : ""}">${label}</button>`).join("")}
      </div>
      <div class="legend" aria-label="当前图层图例"><i></i><span id="legend-low">海洋</span><b></b><span id="legend-high">高地</span></div>
    </nav>
    <main class="workspace">
      <section class="map-workspace" aria-label="世界地图">
        <canvas id="world-map" aria-label="虚拟地球奇幻 3D 地图"></canvas>
        <div class="map-tools" aria-label="地图镜头控制">
          <div class="map-tool-group" aria-label="地图缩放控制">
            <button id="zoom-out" type="button" title="缩小地图" aria-label="缩小地图">−</button>
            <output id="zoom-level" aria-live="polite">100%</output>
            <button id="zoom-in" type="button" title="放大地图" aria-label="放大地图">+</button>
            <button id="zoom-reset" type="button" title="复位地图缩放" aria-label="复位地图缩放">↺</button>
          </div>
          <div class="map-tool-group camera-tools" aria-label="地图旋转控制">
            <button id="rotate-left" type="button" title="向左旋转镜头" aria-label="向左旋转镜头">↶</button>
            <button id="rotate-right" type="button" title="向右旋转镜头" aria-label="向右旋转镜头">↷</button>
            <button id="tilt-up" type="button" title="提高镜头俯角" aria-label="提高镜头俯角">▲</button>
            <button id="tilt-down" type="button" title="降低镜头俯角" aria-label="降低镜头俯角">▼</button>
            <button id="camera-reset" type="button" title="镜头朝北" aria-label="镜头朝北">N</button>
          </div>
        </div>
        <div class="map-caption"><span id="phase-label">原始地质</span><span id="map-scale-level">全球观察</span><span id="digest-label">等待首个快照</span><label>画质 <select id="render-quality" aria-label="地图画质"><option value="480" selected>480p 标清</option><option value="720">720p 高清</option><option value="1080">1080p 超清</option></select></label></div>
      </section>
      <aside class="right-rail" aria-label="世界信息">
        <section class="rail-section"><header><span>01</span><h2>世界状态</h2></header><div id="status-panel"></div></section>
        <section class="rail-section inspector-section"><header><span>02</span><h2>区域检查</h2></header><div id="inspector"></div></section>
        <section class="rail-section timeline-section"><header><span>03</span><h2>演化记录</h2></header><div id="timeline"></div></section>
        <section class="rail-section god-section"><header><span>04</span><h2>上帝模式</h2></header>
          <div class="god-controls"><select id="god-tool" aria-label="选择世界事件">${(Object.entries(godToolLabels) as Array<[GodTool, string]>).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select><button id="god-apply" type="button">施加事件</button></div>
          <div class="file-controls"><button id="save-button" type="button">保存世界</button><label for="load-input">加载世界</label><input id="load-input" type="file" accept="application/json" /></div>
        </section>
      </aside>
    </main>
  </div>
`;

const query = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const emptySnapshot: WorldSnapshot = {
  seed: 1,
  fields: {
    elevation: { width: 1, height: 1, values: new Float32Array(1) },
    temperature: { width: 1, height: 1, values: new Float32Array(1) },
    humidity: { width: 1, height: 1, values: new Float32Array(1) },
    water: { width: 1, height: 1, values: new Float32Array(1) },
    nutrients: { width: 1, height: 1, values: new Float32Array(1) },
    biomass: { width: 1, height: 1, values: new Float32Array(1) },
  },
  chemistry: {
    carbon: { width: 1, height: 1, values: new Float32Array(1) },
    nitrogen: { width: 1, height: 1, values: new Float32Array(1) },
    phosphorus: { width: 1, height: 1, values: new Float32Array(1) },
    organics: { width: 1, height: 1, values: new Float32Array(1) },
    oxygen: { width: 1, height: 1, values: new Float32Array(1) },
  },
  tick: 0,
  years: 0,
  formation: {
    phase: "dust-cloud", progress: 0, dustDensity: 1, bodyCount: 120_000,
    planetaryMass: 0, collisionEnergy: 0, coreFraction: 0.04, surfaceHeat: 0.12,
    atmosphere: 0, volatileFraction: 0,
  },
  digest: "",
  metrics: {},
  foodSecurityByRegion: {},
};
const client = createWorkerClient();
const canvas = query<HTMLCanvasElement>("#world-map");
const statusPanel = query<HTMLElement>("#status-panel");
const inspector = query<HTMLElement>("#inspector");
const timeline = query<HTMLElement>("#timeline");
const status = query<HTMLOutputElement>("#simulation-status");
const year = query<HTMLElement>("#world-year");
const phase = query<HTMLElement>("#phase-label");
const digest = query<HTMLElement>("#digest-label");
const legendLow = query<HTMLElement>("#legend-low");
const legendHigh = query<HTMLElement>("#legend-high");
const renderQuality = query<HTMLSelectElement>("#render-quality");
const zoomLevel = query<HTMLOutputElement>("#zoom-level");
const mapScaleLevel = query<HTMLElement>("#map-scale-level");
let snapshot: WorldSnapshot | undefined;
let selection: CellSelection | undefined;
let detail: InspectorDetail = { level: "region" };
let events: WorldEvent[] = [];
let userEventOrdinal = 0;

const map = createMapCanvas(canvas, (nextSelection) => {
  selection = nextSelection;
  detail = { level: "region" };
  if (snapshot) renderInspector(inspector, snapshot, selection, detail);
  client.send({ type: "focusRegion", regionId: nextSelection.regionId });
}, (nextZoom) => {
  zoomLevel.textContent = `${Math.round(nextZoom * 100)}%`;
  mapScaleLevel.textContent = mapSceneLodLabel(nextZoom);
});
renderInspector(inspector, emptySnapshot);
renderTimeline(timeline, []);

inspector.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-detail-level]");
  if (!button || !snapshot) return;
  detail = { level: button.dataset.detailLevel as InspectorDetail["level"] };
  renderInspector(inspector, snapshot, selection, detail);
});
inspector.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (!target.matches("[data-detail-target]") || !snapshot) return;
  detail = target.value ? { ...detail, id: target.value } : { level: detail.level };
  renderInspector(inspector, snapshot, selection, detail);
});

document.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach((button) => {
  button.addEventListener("click", () => {
    const layer = button.dataset.layer as MapLayer;
    map.setLayer(layer);
    document.querySelectorAll("[data-layer]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    const legend: [string, string] = layer === "natural"
      ? ["海洋", "高地"]
      : layer === "foodSecurity"
        ? ["低保障", "高保障"]
        : layer === "substances"
          ? ["稀少", "富集"]
          : layer === "culture"
            ? ["未形成", "文化特征强"]
          : ["低", "高"];
    legendLow.textContent = legend[0];
    legendHigh.textContent = legend[1];
  });
});
renderQuality.value = "480";
map.setQuality(480);
renderQuality.addEventListener("change", () => map.setQuality(Number(renderQuality.value) as 480 | 720 | 1080));
const syncZoomLabel = (): void => {
  const currentZoom = map.getZoom();
  zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
  mapScaleLevel.textContent = mapSceneLodLabel(currentZoom);
};
query<HTMLButtonElement>("#zoom-in").addEventListener("click", () => { map.zoomIn(); syncZoomLabel(); });
query<HTMLButtonElement>("#zoom-out").addEventListener("click", () => { map.zoomOut(); syncZoomLabel(); });
query<HTMLButtonElement>("#zoom-reset").addEventListener("click", () => { map.resetZoom(); syncZoomLabel(); });
query<HTMLButtonElement>("#rotate-left").addEventListener("click", map.rotateLeft);
query<HTMLButtonElement>("#rotate-right").addEventListener("click", map.rotateRight);
query<HTMLButtonElement>("#tilt-up").addEventListener("click", map.tiltUp);
query<HTMLButtonElement>("#tilt-down").addEventListener("click", map.tiltDown);
query<HTMLButtonElement>("#camera-reset").addEventListener("click", map.resetCamera);
bindTimeControls(document, client);
query<HTMLButtonElement>("#god-apply").addEventListener("click", () => {
  const regionId = selection?.regionId ?? "region:0:0" as never;
  const tool = query<HTMLSelectElement>("#god-tool").value as GodTool;
  userEventOrdinal += 1;
  client.send({ type: "applyEvent", event: createGodEvent(`user:${tool}:${snapshot?.tick ?? 0}:${userEventOrdinal}`, tool, regionId, 0.5, 1) });
});
query<HTMLButtonElement>("#save-button").addEventListener("click", () => client.send({ type: "save" }));
query<HTMLInputElement>("#load-input").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    events = [];
    renderTimeline(timeline, events, snapshot?.eventArchive?.milestones ?? []);
    client.send({ type: "load", payload: await file.text() });
  }
});

const applyMessage = (message: WorkerMessage): void => {
  if (message.type === "error") {
    status.textContent = message.message;
    status.dataset.state = "error";
    return;
  }
  if (message.type === "events") {
    const seen = new Set<string>();
    events = [...events, ...message.events].filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    }).slice(-64);
    renderTimeline(timeline, events, snapshot?.eventArchive?.milestones ?? []);
    return;
  }
  if (message.type === "saved") {
    downloadSave(message.payload);
    status.textContent = `已保存 ${message.digest.slice(0, 8)}`;
    return;
  }
  if (message.type !== "snapshot") return;
  snapshot = message.snapshot;
  map.setAnimating(!message.paused && message.speed <= 4);
  if (message.snapshot.focusRegionId) {
    const match = /^region:(\d+):(\d+)$/.exec(message.snapshot.focusRegionId);
    if (match) {
      const x = Number(match[1] ?? 0);
      const y = Number(match[2] ?? 0);
      selection = { x, y, index: y * message.snapshot.fields.elevation.width + x, regionId: message.snapshot.focusRegionId };
    }
  }
  map.setSelection(selection);
  map.update(snapshot, message.paused, message.speed <= 4);
  renderStatusPanel(statusPanel, snapshot);
  renderInspector(inspector, snapshot, selection, detail);
  renderTimeline(timeline, events, message.snapshot.eventArchive?.milestones ?? []);
  year.textContent = formatSimulationAge(snapshot.years);
  phase.textContent = phaseForSnapshot(snapshot);
  digest.textContent = `状态 ${snapshot.digest.slice(0, 8)}`;
  status.textContent = message.paused ? "模拟已暂停" : `${message.speed}× 自主演化中`;
  status.dataset.state = message.paused ? "paused" : "running";
};

client.subscribe(applyMessage);
client.send({ type: "pause" });
