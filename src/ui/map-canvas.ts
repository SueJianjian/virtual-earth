import type { RegionId } from "../sim/types.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";
import { colorForCell, type MapLayer } from "./layers.ts";

export type CellSelection = { x: number; y: number; index: number; regionId: RegionId };
export type RenderQuality = 1 | 2 | 3;

type MapGeometry = {
  originX: number;
  originY: number;
  tileWidth: number;
  tileHeight: number;
  heightScale: number;
  maxElevation: number;
};

const geometryFor = (width: number, height: number, canvasWidth: number, canvasHeight: number): MapGeometry => {
  const tileRatio = 0.5;
  const maxElevation = 1.25;
  const tileWidth = Math.max(4, Math.min(
    (canvasWidth * 0.92) / Math.max(1, (width + height) / 2),
    (canvasHeight * 0.78) / Math.max(1, (width + height) * tileRatio / 2 + maxElevation),
  ));
  const tileHeight = tileWidth * tileRatio;
  return {
    originX: canvasWidth / 2,
    originY: Math.max(tileHeight * 1.5, canvasHeight * 0.1),
    tileWidth,
    tileHeight,
    heightScale: tileHeight * 1.35,
    maxElevation,
  };
};

const pointFor = (x: number, y: number, z: number, geometry: MapGeometry): [number, number] => [
  geometry.originX + (x - y) * geometry.tileWidth / 2,
  geometry.originY + (x + y) * geometry.tileHeight / 2 - z,
];

const polygon = (context: CanvasRenderingContext2D, points: Array<[number, number]>): void => {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first[0], first[1]);
  for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
  context.closePath();
};

const shade = (color: [number, number, number], amount: number): string => {
  const channels = color.map((channel) => Math.max(0, Math.min(255, Math.round(channel * amount))));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
};

export const createMapCanvas = (
  canvas: HTMLCanvasElement,
  onSelect: (selection: CellSelection) => void,
) => {
  let snapshot: WorldSnapshot | undefined;
  let layer: MapLayer = "natural";
  let selection: CellSelection | undefined;
  let quality: RenderQuality = 2;
  let geometry: MapGeometry | undefined;

  const render = (): void => {
    if (!snapshot) return;
    const grid = snapshot.fields.elevation;
    const currentSnapshot = snapshot;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(4, Math.max(1, window.devicePixelRatio || 1) * quality);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    geometry = geometryFor(grid.width, grid.height, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#101713";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = "round";
    context.lineWidth = Math.max(1, ratio * 0.35);
    const drawCell = (x: number, y: number): void => {
      const index = y * grid.width + x;
      const color = colorForCell(currentSnapshot, index, layer);
      const elevation = Math.max(0, Math.min(1, grid.values[index] ?? 0));
      const z = elevation * geometry!.heightScale;
      const top = pointFor(x, y, z, geometry!);
      const right = pointFor(x + 1, y, z, geometry!);
      const bottom = pointFor(x + 1, y + 1, z, geometry!);
      const left = pointFor(x, y + 1, z, geometry!);
      const baseRight = pointFor(x + 1, y, 0, geometry!);
      const baseBottom = pointFor(x + 1, y + 1, 0, geometry!);
      const baseLeft = pointFor(x, y + 1, 0, geometry!);
      if (z > 1) {
        polygon(context, [right, bottom, baseBottom, baseRight]);
        context.fillStyle = shade(color, 0.62);
        context.fill();
        polygon(context, [bottom, left, baseLeft, baseBottom]);
        context.fillStyle = shade(color, 0.48);
        context.fill();
      }
      polygon(context, [top, right, bottom, left]);
      context.fillStyle = shade(color, 0.92 + elevation * 0.12);
      context.fill();
      context.strokeStyle = "rgba(225, 232, 214, 0.12)";
      context.stroke();
    };
    for (let diagonal = 0; diagonal < grid.width + grid.height - 1; diagonal += 1) {
      const minX = Math.max(0, diagonal - (grid.height - 1));
      const maxX = Math.min(grid.width - 1, diagonal);
      for (let x = minX; x <= maxX; x += 1) drawCell(x, diagonal - x);
    }
    if (selection) {
      const z = Math.max(0, Math.min(1, grid.values[selection.index] ?? 0)) * geometry.heightScale;
      const corners = [
        pointFor(selection.x, selection.y, z + ratio, geometry),
        pointFor(selection.x + 1, selection.y, z + ratio, geometry),
        pointFor(selection.x + 1, selection.y + 1, z + ratio, geometry),
        pointFor(selection.x, selection.y + 1, z + ratio, geometry),
      ];
      polygon(context, corners);
      context.strokeStyle = "#f2c94c";
      context.lineWidth = Math.max(2, ratio * 0.8);
      context.stroke();
    }
  };

  canvas.addEventListener("click", (event) => {
    if (!snapshot) return;
    const rect = canvas.getBoundingClientRect();
    const grid = snapshot.fields.elevation;
    const currentGeometry = geometry ?? geometryFor(grid.width, grid.height, canvas.width, canvas.height);
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const localX = (event.clientX - rect.left) * scaleX;
    const localY = (event.clientY - rect.top) * scaleY;
    const diagonal = (localX - currentGeometry.originX) / (currentGeometry.tileWidth / 2);
    const antiDiagonal = (localY - currentGeometry.originY) / (currentGeometry.tileHeight / 2);
    const x = Math.max(0, Math.min(grid.width - 1, Math.floor((diagonal + antiDiagonal) / 2)));
    const y = Math.max(0, Math.min(grid.height - 1, Math.floor((antiDiagonal - diagonal) / 2)));
    selection = { x, y, index: y * grid.width + x, regionId: `region:${x}:${y}` as RegionId };
    onSelect(selection);
    render();
  });
  new ResizeObserver(render).observe(canvas);

  return {
    update: (next: WorldSnapshot) => { snapshot = next; render(); },
    setLayer: (next: MapLayer) => { layer = next; render(); },
    setQuality: (next: RenderQuality) => { quality = next; render(); },
    setSelection: (next: CellSelection | undefined) => { selection = next; render(); },
    getLayer: () => layer,
    getQuality: () => quality,
  };
};
