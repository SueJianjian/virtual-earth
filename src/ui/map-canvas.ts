import type { RegionId } from "../sim/types.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";
import { colorForCell, type MapLayer } from "./layers.ts";

export type CellSelection = { x: number; y: number; index: number; regionId: RegionId };
export type RenderQuality = 480 | 720 | 1080;

const renderDimensions: Record<RenderQuality, { width: number; height: number }> = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
};

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

const clampZoom = (value: number): number => Math.max(0.6, Math.min(2.5, value));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const blendColor = (
  from: [number, number, number],
  to: [number, number, number],
  amount: number,
): [number, number, number] => [
  Math.round(from[0] + (to[0] - from[0]) * amount),
  Math.round(from[1] + (to[1] - from[1]) * amount),
  Math.round(from[2] + (to[2] - from[2]) * amount),
];

const sampleGrid = (values: Float32Array, width: number, height: number, x: number, y: number): number => {
  const sampleX = clamp(x, 0, width - 1);
  const sampleY = clamp(y, 0, height - 1);
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const horizontal = sampleX - x0;
  const vertical = sampleY - y0;
  const top = (values[y0 * width + x0] ?? 0) * (1 - horizontal) + (values[y0 * width + x1] ?? 0) * horizontal;
  const bottom = (values[y1 * width + x0] ?? 0) * (1 - horizontal) + (values[y1 * width + x1] ?? 0) * horizontal;
  return top * (1 - vertical) + bottom * vertical;
};

const sampleColor = (
  snapshot: WorldSnapshot,
  width: number,
  height: number,
  x: number,
  y: number,
  layer: MapLayer,
): [number, number, number] => {
  const sampleX = clamp(x, 0, width - 1);
  const sampleY = clamp(y, 0, height - 1);
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const horizontal = sampleX - x0;
  const vertical = sampleY - y0;
  const top = blendColor(colorForCell(snapshot, y0 * width + x0, layer), colorForCell(snapshot, y0 * width + x1, layer), horizontal);
  const bottom = blendColor(colorForCell(snapshot, y1 * width + x0, layer), colorForCell(snapshot, y1 * width + x1, layer), horizontal);
  return blendColor(top, bottom, vertical);
};

const surfaceDetailFor = (quality: RenderQuality, width: number, height: number): number => {
  const requested = quality === 480 ? 2 : quality === 720 ? 3 : 4;
  const maximum = Math.max(1, Math.floor(Math.sqrt(60_000 / Math.max(1, width * height))));
  return Math.min(requested, maximum);
};

export const createMapCanvas = (
  canvas: HTMLCanvasElement,
  onSelect: (selection: CellSelection) => void,
  onZoomChange?: (zoom: number) => void,
) => {
  let snapshot: WorldSnapshot | undefined;
  let layer: MapLayer = "natural";
  let selection: CellSelection | undefined;
  let quality: RenderQuality = 480;
  let zoom = 1;
  let geometry: MapGeometry | undefined;
  const updateZoom = (next: number): void => {
    zoom = clampZoom(next);
    onZoomChange?.(zoom);
    render();
  };

  const render = (): void => {
    if (!snapshot) return;
    const grid = snapshot.fields.elevation;
    const currentSnapshot = snapshot;
    const dimensions = renderDimensions[quality];
    const ratio = quality / 480;
    if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    const baseGeometry = geometryFor(grid.width, grid.height, canvas.width, canvas.height);
    geometry = {
      ...baseGeometry,
      tileWidth: baseGeometry.tileWidth * zoom,
      tileHeight: baseGeometry.tileHeight * zoom,
      heightScale: baseGeometry.heightScale * zoom,
    };
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#101713";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = "round";
    context.imageSmoothingEnabled = true;
    const detail = surfaceDetailFor(quality, grid.width, grid.height);
    const fineWidth = grid.width * detail;
    const fineHeight = grid.height * detail;
    const terrainPoint = (x: number, y: number): [number, number] => pointFor(
      x,
      y,
      sampleGrid(grid.values, grid.width, grid.height, x, y) * geometry!.heightScale,
      geometry!,
    );
    const drawOuterEdge = (from: [number, number], to: [number, number], color: [number, number, number], amount: number): void => {
      polygon(context, [terrainPoint(...from), terrainPoint(...to), pointFor(to[0], to[1], 0, geometry!), pointFor(from[0], from[1], 0, geometry!)]);
      context.fillStyle = shade(color, amount);
      context.fill();
    };
    for (let fineY = 0; fineY < fineHeight; fineY += 1) {
      const y = fineY / detail;
      const nextY = (fineY + 1) / detail;
      drawOuterEdge([grid.width, y], [grid.width, nextY], sampleColor(currentSnapshot, grid.width, grid.height, grid.width - 0.5, y + 0.5 / detail, layer), 0.58);
    }
    for (let fineX = 0; fineX < fineWidth; fineX += 1) {
      const x = fineX / detail;
      const nextX = (fineX + 1) / detail;
      drawOuterEdge([x, grid.height], [nextX, grid.height], sampleColor(currentSnapshot, grid.width, grid.height, x + 0.5 / detail, grid.height - 0.5, layer), 0.44);
    }
    const drawSurface = (fineX: number, fineY: number): void => {
      const x = fineX / detail;
      const y = fineY / detail;
      const nextX = (fineX + 1) / detail;
      const nextY = (fineY + 1) / detail;
      polygon(context, [terrainPoint(x, y), terrainPoint(nextX, y), terrainPoint(nextX, nextY), terrainPoint(x, nextY)]);
      const elevation = sampleGrid(grid.values, grid.width, grid.height, x + 0.5 / detail, y + 0.5 / detail);
      context.fillStyle = shade(sampleColor(currentSnapshot, grid.width, grid.height, x + 0.5 / detail, y + 0.5 / detail, layer), 0.92 + elevation * 0.12);
      context.fill();
    };
    for (let diagonal = 0; diagonal < fineWidth + fineHeight - 1; diagonal += 1) {
      const minX = Math.max(0, diagonal - (fineHeight - 1));
      const maxX = Math.min(fineWidth - 1, diagonal);
      for (let fineX = minX; fineX <= maxX; fineX += 1) drawSurface(fineX, diagonal - fineX);
    }
    if (selection) {
      const corners = [
        terrainPoint(selection.x, selection.y),
        terrainPoint(selection.x + 1, selection.y),
        terrainPoint(selection.x + 1, selection.y + 1),
        terrainPoint(selection.x, selection.y + 1),
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
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  new ResizeObserver(render).observe(canvas);

  return {
    update: (next: WorldSnapshot) => { snapshot = next; render(); },
    setLayer: (next: MapLayer) => { layer = next; render(); },
    setQuality: (next: RenderQuality) => { quality = next; render(); },
    setSelection: (next: CellSelection | undefined) => { selection = next; render(); },
    zoomIn: () => updateZoom(zoom + 0.25),
    zoomOut: () => updateZoom(zoom - 0.25),
    resetZoom: () => updateZoom(1),
    getLayer: () => layer,
    getQuality: () => quality,
    getZoom: () => zoom,
  };
};
