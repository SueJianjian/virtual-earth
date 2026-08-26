import type { WorldSnapshot } from "../worker/protocol.ts";
import { formatCount, formatIndex, formatModelTemperature, formatPercent, formatResource, type FormattedMetric } from "./formatters.ts";

const metric = (label: string, formatted: FormattedMetric, note?: string): string => `
  <div class="metric-row">
    <dt>${label}${note ? `<small>${note}</small>` : ""}</dt>
    <dd><strong>${formatted.value}</strong><small>${formatted.unit}</small></dd>
  </div>
`;

export const phaseForSnapshot = (snapshot: WorldSnapshot): string => {
  const metrics = snapshot.metrics;
  if ((metrics.organizationCapacity ?? 0) > 0) return "社会演化";
  if ((metrics.populationCount ?? 0) > 0 && (metrics.cognitivePotential ?? 0) > 0) return "生命演化";
  if ((metrics.biomass ?? 0) > 0.01) return "生态扩张";
  if ((metrics.organics ?? 0) > 0.001) return "化学演化";
  if ((metrics.waterCoverage ?? 0) > 0.1) return "海洋形成";
  return "原始地质";
};

export const renderStatusPanel = (element: HTMLElement, snapshot: WorldSnapshot): void => {
  const metrics = snapshot.metrics;
  element.innerHTML = `
    <div class="metric-primary">
      <div><span>当前纪元</span><strong>${phaseForSnapshot(snapshot)}</strong></div>
      <div class="world-age"><span>世界年龄</span><strong>${formatCount(snapshot.years, "年").value}</strong><small>${formatCount(snapshot.years, "年").unit}</small></div>
    </div>
    <section class="metric-group" aria-label="行星环境">
      <h3><span>环境</span><small>行星物理与大气</small></h3>
      <dl class="metric-list">
        ${metric("模型均温", formatModelTemperature(metrics.meanTemperature), "换算温标")}
        ${metric("海洋覆盖", formatPercent(metrics.oceanCoverage))}
        ${metric("地形起伏", formatIndex(metrics.terrainRelief), "相对指数")}
        ${metric("氧相对浓度", formatPercent(metrics.oxygen))}
        ${metric("碳相对浓度", formatPercent(metrics.carbon))}
      </dl>
    </section>
    <section class="metric-group" aria-label="生命生态">
      <h3><span>生态</span><small>生命规模与承载</small></h3>
      <dl class="metric-list">
        ${metric("生命个体", formatCount(metrics.populationCount, "个"))}
        ${metric("生态生物量", formatIndex(metrics.biomass), "相对指数")}
        ${metric("环境养分", formatIndex(metrics.nutrientLevel), "相对指数")}
        ${metric("有机物浓度", formatPercent(metrics.organics), "相对浓度")}
      </dl>
    </section>
    <section class="metric-group" aria-label="文明社会">
      <h3><span>社会</span><small>家庭、组织与供给</small></h3>
      <dl class="metric-list">
        ${metric("稳定家庭", formatCount(metrics.householdCount, "户"))}
        ${metric("组织成员席位", formatCount(metrics.organizationCapacity, "人次"))}
        ${metric("食物库存", formatResource(metrics.foodSurplus))}
        ${metric("食物保障", formatPercent(metrics.foodSecurity))}
      </dl>
    </section>
  `;
};
