import type { WorldSnapshot } from "../worker/protocol.ts";

const format = (value: number | undefined): string => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value ?? 0);

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
    <div class="metric-primary"><span>当前纪元</span><strong>${phaseForSnapshot(snapshot)}</strong></div>
    <dl class="metric-grid">
      <div><dt>全球年</dt><dd>${format(snapshot.years)}</dd></div>
      <div><dt>种群数量</dt><dd>${format(metrics.populationCount)}</dd></div>
      <div><dt>生物量</dt><dd>${format((metrics.biomass ?? 0) * 100)}%</dd></div>
      <div><dt>氧气</dt><dd>${format((metrics.oxygen ?? 0) * 100)}%</dd></div>
      <div><dt>平均温度</dt><dd>${format((metrics.meanTemperature ?? 0) * 100)}%</dd></div>
      <div><dt>海洋覆盖</dt><dd>${format((metrics.oceanCoverage ?? 0) * 100)}%</dd></div>
      <div><dt>大气碳</dt><dd>${format((metrics.carbon ?? 0) * 100)}%</dd></div>
      <div><dt>有机物</dt><dd>${format((metrics.organics ?? 0) * 100)}%</dd></div>
      <div><dt>地形起伏</dt><dd>${format((metrics.terrainRelief ?? 0) * 100)}%</dd></div>
      <div><dt>环境养分</dt><dd>${format((metrics.nutrientLevel ?? 0) * 100)}%</dd></div>
      <div><dt>家庭</dt><dd>${format(metrics.householdCount)}</dd></div>
      <div><dt>组织容量</dt><dd>${format(metrics.organizationCapacity)}</dd></div>
      <div><dt>食物库存</dt><dd>${format(metrics.foodSurplus)}</dd></div>
      <div><dt>食物保障</dt><dd>${format((metrics.foodSecurity ?? 0) * 100)}%</dd></div>
    </dl>
  `;
};
