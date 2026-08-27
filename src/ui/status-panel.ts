import type { WorldSnapshot } from "../worker/protocol.ts";
import { PREBIOTIC_ORGANICS_THRESHOLD } from "../sim/environment/thresholds.ts";
import { formatCount, formatIndex, formatModelTemperature, formatNumber, formatPercent, formatResource, formatSimulationAgeMetric, type FormattedMetric } from "./formatters.ts";

const metric = (label: string, formatted: FormattedMetric, note?: string): string => `
  <div class="metric-row">
    <dt>${label}${note ? `<small>${note}</small>` : ""}</dt>
    <dd><strong>${formatted.value}</strong><small>${formatted.unit}</small></dd>
  </div>
`;

const formationLabels = {
  "dust-cloud": "原行星尘埃盘",
  planetesimals: "微行星聚合",
  accretion: "行星主体吸积",
  differentiation: "内核与地幔分异",
  cooling: "熔融地表冷却",
  "stable-crust": "稳定地壳",
} as const;

export const phaseForSnapshot = (snapshot: WorldSnapshot): string => {
  if (snapshot.formation.phase !== "stable-crust") return formationLabels[snapshot.formation.phase];
  const metrics = snapshot.metrics;
  if ((metrics.organizationCapacity ?? 0) > 0) return "社会演化";
  if ((metrics.populationCount ?? 0) > 0 && (metrics.cognitivePotential ?? 0) > 0) return "生命演化";
  if ((metrics.biomass ?? 0) > 0.01) return "生态扩张";
  if ((metrics.organics ?? 0) >= PREBIOTIC_ORGANICS_THRESHOLD) return "化学演化";
  if ((metrics.waterCoverage ?? 0) > 0.1) return "海洋形成";
  return "原始地质";
};

export const renderStatusPanel = (element: HTMLElement, snapshot: WorldSnapshot): void => {
  const metrics = snapshot.metrics;
  const formation = snapshot.formation;
  const livingSpeciesIds = new Set((snapshot.populations ?? []).filter((population) => population.count > 0).map((population) => population.speciesId));
  const formationStatus = formation.phase === "stable-crust" ? "" : `
    <section class="metric-group" aria-label="行星形成">
      <h3><span>行星形成</span><small>从尘埃到稳定地壳</small></h3>
      <dl class="metric-list">
        ${metric("形成进度", formatPercent(formation.progress))}
        ${metric("聚合质量", formatPercent(formation.planetaryMass), "目标行星质量")}
        ${metric("引力天体", formatCount(formation.bodyCount, "个"), "尘埃团与微行星")}
        ${metric("碰撞能量", formatIndex(formation.collisionEnergy), "相对指数")}
        ${metric("核心比例", formatPercent(formation.coreFraction))}
        ${metric("地表热量", formatIndex(formation.surfaceHeat), "相对指数")}
        ${metric("大气积累", formatPercent(formation.atmosphere))}
        ${metric("挥发物保留", formatPercent(formation.volatileFraction))}
      </dl>
    </section>
  `;
  const runtime = snapshot.runtime;
  const runtimeStatus = runtime ? `
    <section class="metric-group" aria-label="运行监测">
      <h3><span>运行监测</span><small>连续推进与历史压缩</small></h3>
      <dl class="metric-list">
        ${metric("已测步数", formatCount(runtime.measuredSteps, "步"))}
        ${metric("最近一步", { value: formatNumber(runtime.lastStepMs, 2), unit: "毫秒" })}
        ${metric("平均耗时", { value: formatNumber(runtime.averageStepMs, 2), unit: "毫秒" })}
        ${metric("峰值耗时", { value: formatNumber(runtime.peakStepMs, 2), unit: "毫秒" })}
        ${metric("当前热事件", formatCount(runtime.hotEventCount, "条"), "保留窗口")}
        ${metric("历史归档", formatCount(runtime.archivedEventCount, "条"), "累计事件")}
        ${metric("关键里程碑", formatCount(runtime.milestoneCount, "条"), "有界档案")}
      </dl>
    </section>
  ` : "";
  element.innerHTML = `
    <div class="metric-primary">
      <div><span>当前纪元</span><strong>${phaseForSnapshot(snapshot)}</strong></div>
      <div class="world-age"><span>世界年龄</span><strong>${formatSimulationAgeMetric(snapshot.years).value}</strong><small>${formatSimulationAgeMetric(snapshot.years).unit}</small></div>
    </div>
    ${formationStatus}
    ${runtimeStatus}
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
        ${metric("原创物种", formatCount(livingSpeciesIds.size, "种"), "拥有可遗传生命蓝图")}
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
        ${metric("知识记录", formatCount(snapshot.knowledge?.length ?? 0, "条"))}
        ${metric("原创文化", formatCount(snapshot.cultures?.length ?? 0, "支"), "具备可追溯身份")}
        ${metric("原创技术", formatCount(snapshot.knowledge?.filter((knowledge) => knowledge.domain).length ?? 0, "项"))}
        ${metric("原创物质", formatCount(snapshot.substances?.length ?? 0, "种"), `${formatCount(snapshot.substances?.filter((substance) => substance.status === "known").length ?? 0, "种").value} 种已发现`)}
        ${metric("食物库存", formatResource(metrics.foodSurplus))}
        ${metric("食物保障", formatPercent(metrics.foodSecurity))}
      </dl>
    </section>
  `;
};
