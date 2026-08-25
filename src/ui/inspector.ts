import type { CellSelection } from "./map-canvas.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";

const percent = (value: number | undefined): string => `${((value ?? 0) * 100).toFixed(1)}%`;

export const renderInspector = (element: HTMLElement, snapshot: WorldSnapshot, selection?: CellSelection): void => {
  if (!selection) {
    element.innerHTML = `<div class="empty-state"><strong>未选择区域</strong><span>环境与社会状态</span></div>`;
    return;
  }
  const fields = snapshot.fields;
  const projection = snapshot.projection;
  element.innerHTML = `
    <div class="inspector-head"><strong>${selection.regionId}</strong><span>${projection ? "微观投影" : "网格摘要"}</span></div>
    <dl class="inspector-grid">
      <div><dt>海拔</dt><dd>${percent(fields.elevation.values[selection.index])}</dd></div>
      <div><dt>水量</dt><dd>${percent(fields.water.values[selection.index])}</dd></div>
      <div><dt>温度</dt><dd>${percent(fields.temperature.values[selection.index])}</dd></div>
      <div><dt>湿度</dt><dd>${percent(fields.humidity.values[selection.index])}</dd></div>
      <div><dt>养分</dt><dd>${percent(fields.nutrients.values[selection.index])}</dd></div>
      <div><dt>生物量</dt><dd>${percent(fields.biomass.values[selection.index])}</dd></div>
    </dl>
    ${projection ? `<div class="projection-summary"><span>个体 ${projection.agents.length}</span><span>关系 ${projection.relationships.length}</span><span>组织 ${projection.organizations.length}</span></div>` : ""}
  `;
};
