import type { RegionId } from "../sim/types.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";
import type { SceneEntity, SceneLink } from "../worker/protocol.ts";
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

const clampZoom = (value: number): number => Math.max(0.6, Math.min(8, value));
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

const surfaceDetailFor = (quality: RenderQuality, width: number, height: number, zoom: number): number => {
  const requested = zoom >= 4 ? 6 : zoom >= 2 ? 4 : quality === 480 ? 3 : quality === 720 ? 4 : 5;
  const maximum = Math.max(1, Math.floor(Math.sqrt(180_000 / Math.max(1, width * height))));
  return Math.min(requested, maximum);
};

const microRelief = (x: number, y: number, phase: number): number => (
  Math.sin(x * 7.13 + y * 3.71 + phase * 0.35) * 0.45
  + Math.sin(x * 13.7 - y * 5.19 + phase * 0.18) * 0.3
  + Math.sin((x + y) * 21.4 - phase * 0.12) * 0.25
);

const sceneHash = (x: number, y: number, salt: number): number => {
  let value = Math.imul(Math.floor(x * 1000) + 1, 374761393) ^ Math.imul(Math.floor(y * 1000) + 1, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};

const stringSeed = (value: string): number => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
};

export const createMapCanvas = (
  canvas: HTMLCanvasElement,
  onSelect: (selection: CellSelection) => void,
  onZoomChange?: (zoom: number) => void,
) => {
  let snapshot: WorldSnapshot | undefined;
  let layer: MapLayer = "natural";
  let selection: CellSelection | undefined;
  let sceneEntities: SceneEntity[] = [];
  let sceneLinks: SceneLink[] = [];
  let quality: RenderQuality = 480;
  let zoom = 1;
  let cameraTarget: { x: number; y: number } | undefined;
  let geometry: MapGeometry | undefined;
  let animationPhase = 0;
  let lastAnimationFrame = 0;
  let animationEnabled = false;
  let scheduledRender = 0;
  let deferredDataRender: ReturnType<typeof setTimeout> | undefined;
  let lastDataRender = 0;
  let panX = 0;
  let panY = 0;
  let pointerStart: { x: number; y: number; panX: number; panY: number } | undefined;
  let didPan = false;
  const updateZoom = (next: number): void => {
    zoom = clampZoom(next);
    if (zoom > 1 && selection) cameraTarget = { x: selection.x + 0.5, y: selection.y + 0.5 };
    if (zoom <= 1) cameraTarget = undefined;
    onZoomChange?.(zoom);
    render();
  };

  const render = (): void => {
    if (!snapshot) return;
    const grid = snapshot.fields.elevation;
    const currentSnapshot = snapshot;
    sceneEntities = currentSnapshot.sceneEntities ?? [];
    sceneLinks = currentSnapshot.sceneLinks ?? [];
    canvas.dataset.sceneEntityCount = String(sceneEntities.length);
    canvas.dataset.sceneLinkCount = String(sceneLinks.length);
    const baseDimensions = renderDimensions[quality];
    const rasterScale = Math.min(2.25, Math.max(1, zoom));
    const dimensions = {
      width: Math.min(1920, Math.round(baseDimensions.width * rasterScale)),
      height: Math.min(1080, Math.round(baseDimensions.height * rasterScale)),
    };
    const ratio = dimensions.height / renderDimensions[480].height;
    if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    const baseGeometry = geometryFor(grid.width, grid.height, canvas.width, canvas.height);
    const scaledGeometry = {
      ...baseGeometry,
      tileWidth: baseGeometry.tileWidth * zoom,
      tileHeight: baseGeometry.tileHeight * zoom,
      heightScale: baseGeometry.heightScale * zoom,
    };
    const target = cameraTarget ?? { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
    const targetElevation = sampleGrid(grid.values, grid.width, grid.height, target.x, target.y) * scaledGeometry.heightScale;
    const targetPoint = pointFor(target.x, target.y, targetElevation, scaledGeometry);
    geometry = {
      ...scaledGeometry,
      originX: scaledGeometry.originX + canvas.width / 2 - targetPoint[0] + panX,
      originY: scaledGeometry.originY + canvas.height / 2 - targetPoint[1] + panY,
    };
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#101713";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = "round";
    context.imageSmoothingEnabled = true;
    const detail = surfaceDetailFor(quality, grid.width, grid.height, zoom);
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
      const bleed = 0.018;
      const nextX = (fineX + 1) / detail;
      const nextY = (fineY + 1) / detail;
      const corners = [
        terrainPoint(Math.max(0, x - bleed), Math.max(0, y - bleed)),
        terrainPoint(Math.min(grid.width, nextX + bleed), Math.max(0, y - bleed)),
        terrainPoint(Math.min(grid.width, nextX + bleed), Math.min(grid.height, nextY + bleed)),
        terrainPoint(Math.max(0, x - bleed), Math.min(grid.height, nextY + bleed)),
      ];
      const minX = Math.min(...corners.map(([pointX]) => pointX));
      const maxX = Math.max(...corners.map(([pointX]) => pointX));
      const minY = Math.min(...corners.map(([, pointY]) => pointY));
      const maxY = Math.max(...corners.map(([, pointY]) => pointY));
      if (maxX < -32 || minX > canvas.width + 32 || maxY < -32 || minY > canvas.height + 32) return;
      polygon(context, corners);
      const elevation = sampleGrid(grid.values, grid.width, grid.height, x + 0.5 / detail, y + 0.5 / detail);
      const sampleX = x + 0.5 / detail;
      const sampleY = y + 0.5 / detail;
      const water = sampleGrid(currentSnapshot.fields.water.values, grid.width, grid.height, sampleX, sampleY);
      const shimmer = water > 0.45 ? 1 + Math.sin(animationPhase * 2.2 + sampleX * 0.28 + sampleY * 0.19) * 0.045 : 1;
      context.fillStyle = shade(sampleColor(currentSnapshot, grid.width, grid.height, sampleX, sampleY, layer), (0.92 + elevation * 0.12) * shimmer);
      context.fill();
    };
    for (let diagonal = 0; diagonal < fineWidth + fineHeight - 1; diagonal += 1) {
      const minX = Math.max(0, diagonal - (fineHeight - 1));
      const maxX = Math.min(fineWidth - 1, diagonal);
      for (let fineX = minX; fineX <= maxX; fineX += 1) drawSurface(fineX, diagonal - fineX);
    }
    if (zoom >= 4) {
      const detail = zoom >= 6 ? 12 : 8;
      const cellRadiusX = Math.ceil(canvas.width / Math.max(1, geometry.tileWidth) / 2) + 2;
      const cellRadiusY = Math.ceil(canvas.height / Math.max(1, geometry.tileHeight) / 2) + 2;
      const center = cameraTarget ?? { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
      const minCellX = Math.max(0, Math.floor(center.x - cellRadiusX));
      const maxCellX = Math.min(grid.width - 1, Math.ceil(center.x + cellRadiusX));
      const minCellY = Math.max(0, Math.floor(center.y - cellRadiusY));
      const maxCellY = Math.min(grid.height - 1, Math.ceil(center.y + cellRadiusY));
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          for (let detailY = 0; detailY < detail; detailY += 1) {
            for (let detailX = 0; detailX < detail; detailX += 1) {
              const x = cellX + detailX / detail;
              const y = cellY + detailY / detail;
              const nextX = Math.min(grid.width, x + 1 / detail);
              const nextY = Math.min(grid.height, y + 1 / detail);
              const relief = microRelief(x, y, animationPhase) * 0.018;
              const elevation = sampleGrid(grid.values, grid.width, grid.height, x + 0.5 / detail, y + 0.5 / detail);
              const microElevation = clamp(elevation + relief, 0, 1);
              const points: Array<[number, number]> = [
                pointFor(x, y, microElevation * geometry.heightScale, geometry),
                pointFor(nextX, y, microElevation * geometry.heightScale, geometry),
                pointFor(nextX, nextY, microElevation * geometry.heightScale, geometry),
                pointFor(x, nextY, microElevation * geometry.heightScale, geometry),
              ];
              const minX = Math.min(...points.map(([pointX]) => pointX));
              const maxX = Math.max(...points.map(([pointX]) => pointX));
              const minY = Math.min(...points.map(([, pointY]) => pointY));
              const maxY = Math.max(...points.map(([, pointY]) => pointY));
              if (maxX < -8 || minX > canvas.width + 8 || maxY < -8 || minY > canvas.height + 8) continue;
              polygon(context, points);
              const water = sampleGrid(currentSnapshot.fields.water.values, grid.width, grid.height, x + 0.5 / detail, y + 0.5 / detail);
              const light = 0.97 + relief * 3 + (water > 0.45 ? Math.sin(animationPhase * 2 + x + y) * 0.025 : 0);
              context.fillStyle = shade(sampleColor(currentSnapshot, grid.width, grid.height, x + 0.5 / detail, y + 0.5 / detail, layer), light);
              context.fill();
            }
          }
        }
      }
    }
    const propStride = zoom >= 4 ? 1 : zoom >= 2 ? 2 : 5;
    const propRadiusX = Math.ceil(canvas.width / Math.max(1, geometry.tileWidth) / 2) + 2;
    const propRadiusY = Math.ceil(canvas.height / Math.max(1, geometry.tileHeight) / 2) + 2;
    const propCenter = cameraTarget ?? { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
    const propMinX = Math.max(0, Math.floor(propCenter.x - propRadiusX));
    const propMaxX = Math.min(grid.width - 1, Math.ceil(propCenter.x + propRadiusX));
    const propMinY = Math.max(0, Math.floor(propCenter.y - propRadiusY));
    const propMaxY = Math.min(grid.height - 1, Math.ceil(propCenter.y + propRadiusY));
    const drawProp = (cellX: number, cellY: number): void => {
      const index = cellY * grid.width + cellX;
      const elevation = clamp(grid.values[index] ?? 0, 0, 1);
      const water = clamp(currentSnapshot.fields.water.values[index] ?? 0, 0, 1);
      const base = pointFor(cellX + 0.5, cellY + 0.5, elevation * geometry!.heightScale, geometry!);
      const size = Math.max(2, geometry!.tileWidth * 0.18);
      const variant = sceneHash(cellX, cellY, currentSnapshot.tick + currentSnapshot.fields.elevation.width * 31);
      if (water > 0.45) {
        context.strokeStyle = `rgba(166, 226, 231, ${0.22 + Math.sin(animationPhase * 2 + cellX * 0.4 + cellY) * 0.08})`;
        context.lineWidth = Math.max(1, ratio * 0.8);
        for (let wave = 0; wave < 2; wave += 1) {
          const waveY = base[1] - size * 0.25 + wave * size * 0.35;
          context.beginPath();
          context.moveTo(base[0] - size, waveY + Math.sin(animationPhase * 2 + cellX + wave) * 2);
          context.quadraticCurveTo(base[0], waveY - size * 0.18, base[0] + size, waveY + Math.sin(animationPhase * 2.4 + cellY + wave) * 2);
          context.stroke();
        }
        return;
      }
      if (variant < 0.48 && zoom >= 2) {
        const trunkHeight = size * (0.9 + variant);
        context.fillStyle = "#554634";
        context.fillRect(base[0] - size * 0.08, base[1] - trunkHeight, size * 0.16, trunkHeight);
        const canopy = [
          [base[0], base[1] - trunkHeight - size * 1.1],
          [base[0] - size * 0.75, base[1] - trunkHeight * 0.35],
          [base[0] + size * 0.75, base[1] - trunkHeight * 0.35],
        ] as Array<[number, number]>;
        polygon(context, canopy);
        context.fillStyle = elevation > 0.7 ? "#6c7560" : "#48704b";
        context.fill();
        return;
      }
      if (variant > 0.78 && zoom >= 2) {
        polygon(context, [
          [base[0] - size, base[1]],
          [base[0] - size * 0.2, base[1] - size * (0.8 + variant * 0.4)],
          [base[0] + size, base[1]],
        ]);
        context.fillStyle = "#777468";
        context.fill();
      }
    };
    for (let cellY = propMinY; cellY <= propMaxY; cellY += propStride) {
      for (let cellX = propMinX; cellX <= propMaxX; cellX += propStride) drawProp(cellX, cellY);
    }
    const entityPoint = (entity: SceneEntity): [number, number] | undefined => {
      const match = /^region:(\d+):(\d+)$/.exec(entity.regionId);
      if (!match) return undefined;
      const regionX = Number(match[1] ?? 0);
      const regionY = Number(match[2] ?? 0);
      const seed = stringSeed(entity.id);
      const localX = ((seed % 1000) / 1000 - 0.5) * 0.62;
      const localY = (((seed >>> 10) % 1000) / 1000 - 0.5) * 0.62;
      const elevation = sampleGrid(grid.values, grid.width, grid.height, regionX + 0.5, regionY + 0.5);
      return pointFor(regionX + 0.5 + localX, regionY + 0.5 + localY, elevation * geometry!.heightScale, geometry!);
    };
    const entityPositions = new Map<string, [number, number]>();
    for (const entity of sceneEntities) {
      const position = entityPoint(entity);
      if (position) entityPositions.set(entity.id, position);
    }
    if (zoom >= 2 && sceneLinks.length > 0) {
      context.lineWidth = Math.max(1, ratio * 0.45);
      for (const link of sceneLinks) {
        const from = entityPositions.get(link.fromId);
        const to = entityPositions.get(link.toId);
        if (!from || !to) continue;
        context.strokeStyle = link.kind === "rival" ? "rgba(214, 104, 77, 0.55)" : "rgba(238, 211, 113, 0.42)";
        context.beginPath();
        context.moveTo(from[0], from[1] - ratio * 2);
        context.quadraticCurveTo((from[0] + to[0]) / 2, Math.min(from[1], to[1]) - ratio * 8, to[0], to[1] - ratio * 2);
        context.stroke();
      }
    }
    const visibleEntities = [...sceneEntities]
      .filter((entity) => zoom >= 2 || entity.kind !== "agent")
      .sort((left, right) => {
        const leftPosition = entityPositions.get(left.id) ?? [0, 0];
        const rightPosition = entityPositions.get(right.id) ?? [0, 0];
        return leftPosition[1] - rightPosition[1];
      });
    const drawSceneEntity = (entity: SceneEntity): void => {
      const point = entityPositions.get(entity.id);
      if (!point) return;
      const size = Math.max(2, geometry!.tileWidth * (entity.kind === "agent" ? 0.08 : entity.kind === "population" ? 0.2 : 0.16 + entity.rank * 0.018));
      if (point[0] < -size * 4 || point[0] > canvas.width + size * 4 || point[1] < -size * 8 || point[1] > canvas.height + size * 4) return;
      context.fillStyle = "rgba(8, 12, 9, 0.28)";
      context.beginPath();
      context.ellipse(point[0], point[1] + size * 0.14, size * 1.25, size * 0.35, 0, 0, Math.PI * 2);
      context.fill();
      const bob = animationEnabled ? Math.sin(animationPhase * 2.4 + stringSeed(entity.id) % 31) * size * 0.08 : 0;
      if (entity.kind === "agent") {
        context.fillStyle = "#d6b84b";
        context.beginPath();
        context.arc(point[0], point[1] - size * 1.25 + bob, size * 0.33, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#d6b84b";
        context.lineWidth = Math.max(1, size * 0.14);
        context.beginPath();
        context.moveTo(point[0], point[1] - size * 0.9 + bob);
        context.lineTo(point[0], point[1] - size * 0.05 + bob);
        context.moveTo(point[0], point[1] - size * 0.65 + bob);
        context.lineTo(point[0] - size * 0.45, point[1] - size * 0.28 + bob);
        context.moveTo(point[0], point[1] - size * 0.65 + bob);
        context.lineTo(point[0] + size * 0.45, point[1] - size * 0.28 + bob);
        context.stroke();
        return;
      }
      if (entity.kind === "population") {
        context.fillStyle = "#8d6d4e";
        polygon(context, [[point[0] - size, point[1]], [point[0], point[1] - size * 1.15], [point[0] + size, point[1]]]);
        context.fill();
        context.fillStyle = "#c5a86e";
        context.fillRect(point[0] - size * 0.1, point[1] - size * 0.58, size * 0.2, size * 0.58);
        return;
      }
      const buildingHeight = size * (0.7 + entity.rank * 0.2);
      const width = size * (1.2 + entity.rank * 0.12);
      context.fillStyle = entity.rank >= 7 ? "#7d6a45" : entity.rank >= 5 ? "#776049" : "#695943";
      context.fillRect(point[0] - width, point[1] - buildingHeight, width * 2, buildingHeight);
      context.fillStyle = entity.rank >= 6 ? "#d6b84b" : "#b99e70";
      polygon(context, [[point[0] - width * 1.15, point[1] - buildingHeight], [point[0], point[1] - buildingHeight - size * 0.72], [point[0] + width * 1.15, point[1] - buildingHeight]]);
      context.fill();
      if (entity.rank >= 5) {
        context.strokeStyle = "#d6b84b";
        context.lineWidth = Math.max(1, size * 0.12);
        context.beginPath();
        context.moveTo(point[0], point[1] - buildingHeight - size * 0.65);
        context.lineTo(point[0], point[1] - buildingHeight - size * 1.35);
        context.stroke();
        context.fillStyle = entity.rank >= 7 ? "#d96b4d" : "#3f8fa6";
        polygon(context, [[point[0], point[1] - buildingHeight - size * 1.35], [point[0] + size * 0.8, point[1] - buildingHeight - size * 1.12], [point[0], point[1] - buildingHeight - size * 0.95]]);
        context.fill();
      }
    };
    for (const entity of visibleEntities) drawSceneEntity(entity);
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

  const animate = (time: number): void => {
    const animationInterval = zoom > 4 ? 250 : zoom > 2 ? 100 : 50;
    if (animationEnabled && time - lastAnimationFrame >= animationInterval) {
      animationPhase = time / 1000;
      lastAnimationFrame = time;
      render();
    }
    requestAnimationFrame(animate);
  };
  const scheduleRender = (): void => {
    if (scheduledRender) return;
    scheduledRender = requestAnimationFrame(() => {
      scheduledRender = 0;
      render();
    });
  };
  requestAnimationFrame(animate);

  canvas.addEventListener("click", (event) => {
    if (!snapshot) return;
    if (didPan) {
      didPan = false;
      return;
    }
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
    if (zoom > 1) cameraTarget = { x: x + 0.5, y: y + 0.5 };
    onSelect(selection);
    render();
  });
  canvas.addEventListener("pointerdown", (event) => {
    pointerStart = { x: event.clientX, y: event.clientY, panX, panY };
    didPan = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerStart) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    if (distance < 3) return;
    didPan = true;
    panX = pointerStart.panX + (event.clientX - pointerStart.x) * (canvas.width / Math.max(1, canvas.clientWidth));
    panY = pointerStart.panY + (event.clientY - pointerStart.y) * (canvas.height / Math.max(1, canvas.clientHeight));
    render();
  });
  canvas.addEventListener("pointerup", (event) => {
    pointerStart = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("pointercancel", () => {
    pointerStart = undefined;
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  new ResizeObserver(render).observe(canvas);

  return {
    update: (next: WorldSnapshot, immediate = false, renderIntermediate = true) => {
      snapshot = next;
      if (immediate) {
        if (deferredDataRender !== undefined) clearTimeout(deferredDataRender);
        deferredDataRender = undefined;
        lastDataRender = performance.now();
        render();
        return;
      }
      if (!renderIntermediate) return;
      if (animationEnabled) return;
      const delay = Math.max(0, 250 - (performance.now() - lastDataRender));
      if (deferredDataRender !== undefined) return;
      deferredDataRender = setTimeout(() => {
        deferredDataRender = undefined;
        lastDataRender = performance.now();
        render();
      }, delay);
    },
    setLayer: (next: MapLayer) => { layer = next; render(); },
    setQuality: (next: RenderQuality) => { quality = next; render(); },
    setSelection: (next: CellSelection | undefined) => {
      const changed = selection?.regionId !== next?.regionId;
      selection = next;
      if (changed) scheduleRender();
    },
    setAnimating: (next: boolean) => { if (animationEnabled === next) return; animationEnabled = next; if (next) render(); },
    zoomIn: () => { zoom = clampZoom(zoom + (zoom < 2 ? 0.25 : zoom < 4 ? 0.5 : 1)); if (zoom > 1 && selection) cameraTarget = { x: selection.x + 0.5, y: selection.y + 0.5 }; onZoomChange?.(zoom); scheduleRender(); },
    zoomOut: () => { zoom = clampZoom(zoom - (zoom <= 2 ? 0.25 : zoom <= 4 ? 0.5 : 1)); if (zoom <= 1) cameraTarget = undefined; onZoomChange?.(zoom); scheduleRender(); },
    resetZoom: () => { zoom = 1; cameraTarget = undefined; panX = 0; panY = 0; onZoomChange?.(zoom); scheduleRender(); },
    getLayer: () => layer,
    getQuality: () => quality,
    getZoom: () => zoom,
  };
};
