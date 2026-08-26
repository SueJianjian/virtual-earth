import type { RegionId } from "../sim/types.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";
import type { SceneEntity, SceneLink } from "../worker/protocol.ts";
import { colorForCell, type MapLayer } from "./layers.ts";
import {
  drawPixelAgent,
  drawPixelCamp,
  drawPixelGroundDetail,
  drawPixelLabel,
  drawPixelOrganization,
  drawPixelRock,
  drawPixelTree,
  drawPixelWater,
  organizationLabel,
} from "./pixel-scene.ts";

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
    context.fillStyle = "#14252a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const backdropUnit = Math.max(4, Math.round(ratio * 6));
    context.fillStyle = "rgba(43, 91, 96, 0.12)";
    for (let backdropY = 0; backdropY < canvas.height; backdropY += backdropUnit * 4) {
      const offset = (Math.floor(backdropY / (backdropUnit * 4)) % 2) * backdropUnit * 2;
      for (let backdropX = -offset; backdropX < canvas.width; backdropX += backdropUnit * 8) {
        context.fillRect(backdropX, backdropY, backdropUnit * 3, backdropUnit);
      }
    }
    context.lineJoin = "round";
    context.imageSmoothingEnabled = false;
    canvas.dataset.renderStyle = "pixel-world";
    const waterAt = (cellX: number, cellY: number): boolean => {
      if (cellX < 0 || cellY < 0 || cellX >= grid.width || cellY >= grid.height) return true;
      const index = cellY * grid.width + cellX;
      return (currentSnapshot.fields.water.values[index] ?? 0) > 0.45 || (grid.values[index] ?? 0) < 0.46;
    };
    const elevationAt = (cellX: number, cellY: number): number => {
      if (cellX < 0 || cellY < 0 || cellX >= grid.width || cellY >= grid.height) return 0;
      const value = clamp(grid.values[cellY * grid.width + cellX] ?? 0, 0, 1);
      return Math.round(value * 12) / 12;
    };
    const tilePoint = (cellX: number, cellY: number, elevation: number): [number, number] => pointFor(
      cellX,
      cellY,
      elevation * geometry!.heightScale,
      geometry!,
    );
    const tileColor = (cellX: number, cellY: number): [number, number, number] => {
      const index = cellY * grid.width + cellX;
      if (layer !== "natural") return colorForCell(currentSnapshot, index, layer);
      const elevation = elevationAt(cellX, cellY);
      const biomass = clamp(currentSnapshot.fields.biomass.values[index] ?? 0, 0, 1);
      const humidity = clamp(currentSnapshot.fields.humidity.values[index] ?? 0, 0, 1);
      if (waterAt(cellX, cellY)) {
        const water = clamp(currentSnapshot.fields.water.values[index] ?? 0, 0, 1);
        return water > 0.68 ? [36, 104, 137] : [52, 132, 151];
      }
      if (elevation > 0.78) return [203, 214, 199];
      if (elevation > 0.66) return [126, 133, 111];
      if (humidity < 0.25) return [190, 159, 91];
      if (biomass > 0.45) return [87, 143, 72];
      return [111, 151, 78];
    };
    const drawTile = (cellX: number, cellY: number): void => {
      const elevation = elevationAt(cellX, cellY);
      const corners = [
        tilePoint(cellX, cellY, elevation),
        tilePoint(cellX + 1, cellY, elevation),
        tilePoint(cellX + 1, cellY + 1, elevation),
        tilePoint(cellX, cellY + 1, elevation),
      ] as Array<[number, number]>;
      const minX = Math.min(...corners.map(([pointX]) => pointX));
      const maxX = Math.max(...corners.map(([pointX]) => pointX));
      const minY = Math.min(...corners.map(([, pointY]) => pointY));
      const maxY = Math.max(...corners.map(([, pointY]) => pointY));
      if (maxX < -48 || minX > canvas.width + 48 || maxY < -48 || minY > canvas.height + 48) return;
      const color = tileColor(cellX, cellY);
      const eastElevation = elevationAt(cellX + 1, cellY);
      if (elevation - eastElevation > 0.04) {
        polygon(context, [corners[1]!, corners[2]!, tilePoint(cellX + 1, cellY + 1, eastElevation), tilePoint(cellX + 1, cellY, eastElevation)]);
        context.fillStyle = shade(color, 0.62);
        context.fill();
      }
      const southElevation = elevationAt(cellX, cellY + 1);
      if (elevation - southElevation > 0.04) {
        polygon(context, [corners[2]!, corners[3]!, tilePoint(cellX, cellY + 1, southElevation), tilePoint(cellX + 1, cellY + 1, southElevation)]);
        context.fillStyle = shade(color, 0.48);
        context.fill();
      }
      polygon(context, corners);
      const variant = sceneHash(cellX, cellY, 17);
      context.fillStyle = shade(color, 0.94 + variant * 0.12);
      context.fill();
      const center = pointFor(cellX + 0.5, cellY + 0.5, elevation * geometry!.heightScale, geometry!);
      const detailScale = Math.max(1, geometry!.tileWidth / 52);
      if (waterAt(cellX, cellY)) {
        if (layer === "natural" && (cellX + cellY) % 2 === 0) {
          drawPixelWater(context, { x: center[0], y: center[1] - detailScale, scale: detailScale, seed: Math.floor(variant * 1000), phase: animationPhase });
        }
        return;
      }
      if (zoom >= 1.5 && variant > 0.72 && layer === "natural") {
        const kind = elevation > 0.76 ? "snow" : (currentSnapshot.fields.humidity.values[cellY * grid.width + cellX] ?? 0) < 0.25 ? "sand" : "grass";
        drawPixelGroundDetail(context, { x: center[0], y: center[1], scale: detailScale, seed: Math.floor(variant * 1000), kind });
      }
    };
    for (let diagonal = 0; diagonal < grid.width + grid.height - 1; diagonal += 1) {
      const minCellX = Math.max(0, diagonal - (grid.height - 1));
      const maxCellX = Math.min(grid.width - 1, diagonal);
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) drawTile(cellX, diagonal - cellX);
    }
    const terrainPoint = (x: number, y: number): [number, number] => {
      const cellX = Math.min(grid.width - 1, Math.max(0, Math.floor(x)));
      const cellY = Math.min(grid.height - 1, Math.max(0, Math.floor(y)));
      return pointFor(x, y, elevationAt(cellX, cellY) * geometry!.heightScale, geometry!);
    };
    const propStride = zoom >= 4 ? 1 : zoom >= 2 ? 2 : 3;
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
      const base = pointFor(cellX + 0.5, cellY + 0.5, elevationAt(cellX, cellY) * geometry!.heightScale, geometry!);
      const spriteScale = Math.max(1, geometry!.tileWidth / 48);
      const variant = sceneHash(cellX, cellY, currentSnapshot.tick + currentSnapshot.fields.elevation.width * 31);
      if (water > 0.45 || elevation < 0.46) return;
      const biomass = clamp(currentSnapshot.fields.biomass.values[index] ?? 0, 0, 1);
      const treeChance = 0.2 + biomass * 0.42;
      if (variant < treeChance) {
        drawPixelTree(context, { x: base[0], y: base[1], scale: spriteScale, seed: Math.floor(variant * 10_000), altitude: elevation, phase: animationPhase });
        return;
      }
      if (variant > 0.82) {
        drawPixelRock(context, { x: base[0], y: base[1], scale: spriteScale, seed: Math.floor(variant * 10_000), altitude: elevation });
        return;
      }
      if (zoom >= 2 && variant > 0.66) {
        const kind = elevation > 0.76 ? "snow" : (currentSnapshot.fields.humidity.values[index] ?? 0) < 0.25 ? "sand" : "grass";
        drawPixelGroundDetail(context, { x: base[0], y: base[1], scale: spriteScale, seed: Math.floor(variant * 10_000), kind });
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
      const elevation = elevationAt(regionX, regionY);
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
      const seed = stringSeed(entity.id);
      const spriteScale = Math.max(1, geometry!.tileWidth / (entity.kind === "agent" ? 54 : 46));
      const extent = spriteScale * (entity.kind === "agent" ? 20 : 65);
      if (point[0] < -extent || point[0] > canvas.width + extent || point[1] < -extent * 2 || point[1] > canvas.height + extent) return;
      if (entity.kind === "agent") {
        drawPixelAgent(context, { x: point[0], y: point[1], scale: spriteScale, seed, phase: animationPhase });
        if (zoom >= 6 && sceneEntities.length < 80) {
          drawPixelLabel(context, { x: point[0], y: point[1] - spriteScale * 24, scale: spriteScale * 0.65, label: `#${entity.id.slice(-5)}`, count: 1, seed });
        }
        return;
      }
      if (entity.kind === "population") {
        drawPixelCamp(context, { x: point[0], y: point[1], scale: spriteScale, seed, phase: animationPhase });
        if (zoom >= 4) drawPixelLabel(context, { x: point[0], y: point[1] - spriteScale * 18, scale: spriteScale * 0.55, label: "\u4eba\u53e3", count: entity.count, seed });
        return;
      }
      drawPixelOrganization(context, { x: point[0], y: point[1], scale: spriteScale, seed, kind: entity.kind, count: entity.count });
      const showLabel = zoom >= 6 ? entity.rank >= 5 : zoom >= 4 ? entity.rank >= 7 : false;
      if (showLabel) drawPixelLabel(context, { x: point[0], y: point[1] - spriteScale * (entity.rank >= 6 ? 38 : 26), scale: spriteScale * 0.55, label: organizationLabel[entity.kind], count: entity.count, seed });
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
