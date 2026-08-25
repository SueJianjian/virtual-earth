import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Application root was not found");
}

app.innerHTML = `
  <section class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">AUTONOMOUS WORLD LAB</p>
        <h1>虚拟地球</h1>
      </div>
      <output id="simulation-status" class="status" aria-live="polite">正在初始化</output>
    </header>
    <section class="workspace">
      <div class="map-panel">
        <canvas id="world-map" aria-label="虚拟地球地图"></canvas>
        <div class="map-placeholder" aria-hidden="true">世界状态即将载入</div>
      </div>
      <aside class="side-panel" aria-label="世界信息">
        <p class="panel-label">当前观测</p>
        <p class="metric-value">原始星球</p>
        <p class="metric-note">模拟核心尚未启动</p>
      </aside>
    </section>
  </section>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#world-map");
if (!canvas) {
  throw new Error("World map canvas was not found");
}

const resizeCanvas = (): void => {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
};

resizeCanvas();
window.addEventListener("resize", resizeCanvas);
