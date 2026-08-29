import * as THREE from "three";
import type { PlanetSeason, RegionId } from "../sim/types.ts";
import type { SceneEntity, SceneLink, WorldSnapshot } from "../worker/protocol.ts";
import { colorForCell, type MapLayer } from "./layers.ts";
import { createAgentModel, createFacilityModel, createFantasyTreeGeometry, createLifeformModel, createLifeformPopulation, createOrganizationModel, createPopulationCamp, createWorldviewModel, enableFantasyShadows, fantasyMaterials } from "./fantasy-assets.ts";
import { BASE_TERRAIN_DETAIL, MAX_MAP_ZOOM, formationBodyScale, mapSceneLodForZoom, mapSurfaceModeFor, propScaleForZoom, propsPerCellForZoom, terrainPatchLodForZoom, terrainVerticalScaleForZoom } from "./map-lod.ts";

export type CellSelection = { x: number; y: number; index: number; regionId: RegionId };
export type RenderQuality = 480 | 720 | 1080;
export type SceneEntitySelection = { id: string; kind: SceneEntity["kind"] };
export type MapFocusLod = "region" | "settlement" | "individual";

const renderDimensions: Record<RenderQuality, { width: number; height: number }> = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clampZoom = (value: number): number => clamp(value, 0.6, MAX_MAP_ZOOM);
const focusZoomForLod = (lod: MapFocusLod): number => ({
  region: 4,
  settlement: 12,
  individual: 24,
})[lod];
const radians = (degrees: number): number => degrees * Math.PI / 180;
const degrees = (value: number): number => value * 180 / Math.PI;
const normalizeYaw = (value: number): number => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

const seasonVisuals: Record<PlanetSeason, {
  sky: number;
  fog: number;
  hemisphere: number;
  ground: number;
  sunlight: number;
  rim: number;
}> = {
  spring: { sky: 0x78aeb2, fog: 0x91c4c0, hemisphere: 0xd6ece4, ground: 0x4c684e, sunlight: 0xffefc5, rim: 0x76bdc4 },
  summer: { sky: 0x6ca2b4, fog: 0x86b9bd, hemisphere: 0xd7ebf0, ground: 0x4a6040, sunlight: 0xffe6ad, rim: 0x69a9c2 },
  autumn: { sky: 0x9b927e, fog: 0xb8ae94, hemisphere: 0xf0dec6, ground: 0x614d3a, sunlight: 0xffd29c, rim: 0xa87e61 },
  winter: { sky: 0x687e91, fog: 0x9aaebc, hemisphere: 0xdbe7f2, ground: 0x52606a, sunlight: 0xd9e7ff, rim: 0x8db9d7 },
};

const stringSeed = (value: string): number => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
};

const sceneHash = (x: number, y: number, salt: number): number => {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};

const clearGroup = (group: THREE.Group): void => {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const item of materials) if (!item.userData.shared) item.dispose();
    });
  }
};

export const createMapCanvas = (
  canvas: HTMLCanvasElement,
  onSelect: (selection: CellSelection, entity?: SceneEntitySelection) => void,
  onZoomChange?: (zoom: number) => void,
) => {
  for (const value of Object.values(fantasyMaterials)) value.userData.shared = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141a16);
  scene.fog = new THREE.FogExp2(0x8db5bd, 0.0055);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 180);
  const terrainRoot = new THREE.Group();
  const territoryRoot = new THREE.Group();
  const propRoot = new THREE.Group();
  const linkRoot = new THREE.Group();
  const entityRoot = new THREE.Group();
  const effectRoot = new THREE.Group();
  const weatherRoot = new THREE.Group();
  scene.add(terrainRoot, territoryRoot, propRoot, linkRoot, entityRoot, effectRoot, weatherRoot);

  const hemisphereLight = new THREE.HemisphereLight(0xc8e7ef, 0x31422d, 1.05);
  scene.add(hemisphereLight);
  const sunlight = new THREE.DirectionalLight(0xffe8bc, 2.15);
  sunlight.position.set(-18, 28, 14);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -38;
  sunlight.shadow.camera.right = 38;
  sunlight.shadow.camera.top = 38;
  sunlight.shadow.camera.bottom = -38;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = 90;
  sunlight.shadow.bias = -0.00035;
  scene.add(sunlight, sunlight.target);
  const rimLight = new THREE.DirectionalLight(0x6da7c2, 0.65);
  rimLight.position.set(18, 10, -20);
  scene.add(rimLight);

  let snapshot: WorldSnapshot | undefined;
  let layer: MapLayer = "natural";
  let selection: CellSelection | undefined;
  let quality: RenderQuality = 480;
  let zoom = 1;
  let animationEnabled = false;
  let lastAnimationFrame = 0;
  let scheduledRender = 0;
  let deferredCameraRender: ReturnType<typeof setTimeout> | undefined;
  let deferredDataRender: ReturnType<typeof setTimeout> | undefined;
  let lastDataRender = 0;
  let panWorldX = 0;
  let panWorldZ = 0;
  let cameraYaw = radians(45);
  let cameraPitch = radians(42);
  let globeYaw = radians(-18);
  let globePitch = radians(-12);
  let pointerStart: {
    x: number;
    y: number;
    panX: number;
    panZ: number;
    yaw: number;
    pitch: number;
    globeYaw: number;
    globePitch: number;
    mode: "pan" | "rotate";
  } | undefined;
  let didPan = false;
  let terrainMesh: THREE.Mesh | undefined;
  let formationBodyMesh: THREE.Mesh | undefined;
  let waterSurface: THREE.Mesh | undefined;
  let selectionMarker: THREE.Mesh | undefined;
  let sceneEntities: SceneEntity[] = [];
  let sceneLinks: SceneLink[] = [];
  let frameCount = 0;
  const animatedObjects: THREE.Object3D[] = [];
  const animatedRouteObjects: Array<THREE.Line | THREE.Mesh> = [];
  const entityPositions = new Map<string, THREE.Vector3>();
  let weatherMotion: {
    kind: "rain" | "snow";
    geometry: THREE.BufferGeometry;
    positions: Float32Array;
    floors: Float32Array;
    resetX: Float32Array;
    resetZ: Float32Array;
    resetY: Float32Array;
    lengths: Float32Array;
    maxY: number;
    speed: number;
    drift: number;
    xMin: number;
    xMax: number;
    zMin: number;
    zMax: number;
  } | undefined;

  const syncEnvironmentalPresentation = (): void => {
    if (!snapshot?.orbital) return;
    const orbital = snapshot.orbital;
    const visuals = seasonVisuals[orbital.season];
    const humidity = clamp(snapshot.metrics.meanHumidity ?? 0, 0, 1);
    const solarScale = clamp(orbital.solarFlux / 1.05, 0.45, 1.35);
    (scene.background as THREE.Color).set(visuals.sky);
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.set(visuals.fog);
      scene.fog.density = 0.0042 + humidity * 0.0024;
    }
    hemisphereLight.color.set(visuals.hemisphere);
    hemisphereLight.groundColor.set(visuals.ground);
    hemisphereLight.intensity = 0.82 + solarScale * 0.2;
    sunlight.color.set(visuals.sunlight);
    sunlight.intensity = 1.62 + solarScale * 0.55;
    const solarAngle = orbital.seasonalPhase * Math.PI * 2 + orbital.periapsisPhase * Math.PI * 2;
    sunlight.position.set(Math.cos(solarAngle) * 26, 19 + solarScale * 10, Math.sin(solarAngle) * 26);
    rimLight.color.set(visuals.rim);
    rimLight.intensity = 0.46 + (1 - humidity) * 0.22;
    canvas.dataset.season = orbital.season;
    canvas.dataset.solarFlux = orbital.solarFlux.toFixed(3);
    canvas.dataset.atmosphereHumidity = humidity.toFixed(2);
  };

  const dimensionsFor = (): { width: number; height: number } => {
    const base = renderDimensions[quality];
    const rasterScale = Math.min(2.25, Math.max(1, zoom));
    const displayAspect = canvas.clientWidth > 0 && canvas.clientHeight > 0
      ? clamp(canvas.clientWidth / canvas.clientHeight, 0.5, 3)
      : base.width / base.height;
    const requestedHeight = Math.round(base.height * rasterScale);
    const requestedWidth = Math.round(requestedHeight * displayAspect);
    const capScale = Math.min(1, 1920 / requestedWidth, 1080 / requestedHeight);
    return {
      width: Math.max(1, Math.round(requestedWidth * capScale)),
      height: Math.max(1, Math.round(requestedHeight * capScale)),
    };
  };

  const currentWater = (index: number): number => clamp(snapshot?.fields.water.values[index] ?? 0, 0, 1);

  const surfaceMode = () => snapshot ? mapSurfaceModeFor(snapshot.formation, zoom) : "forming-body";

  const syncGlobeRotation = (): void => {
    const globeView = surfaceMode() === "planet-globe";
    const pitch = globeView ? globePitch : 0;
    const yaw = globeView ? globeYaw : 0;
    terrainRoot.rotation.order = "YXZ";
    linkRoot.rotation.order = "YXZ";
    terrainRoot.rotation.set(pitch, yaw, 0);
    linkRoot.rotation.set(pitch, yaw, 0);
  };

  const globeRadius = (): number => {
    const grid = snapshot?.fields.elevation;
    return grid ? Math.max(4, Math.min(grid.width, grid.height) * 0.43) : 4;
  };

  const globePointForRegion = (x: number, y: number, radiusOffset = 0): THREE.Vector3 => {
    const grid = snapshot?.fields.elevation;
    if (!grid) return new THREE.Vector3();
    const phi = ((x + 0.5) / grid.width) * Math.PI * 2;
    const theta = ((y + 0.5) / grid.height) * Math.PI;
    const radius = globeRadius() + radiusOffset;
    return new THREE.Vector3(
      -Math.cos(phi) * Math.sin(theta) * radius,
      Math.cos(theta) * radius,
      Math.sin(phi) * Math.sin(theta) * radius,
    );
  };

  const renderedElevation = (value: number): number => {
    const seaLevel = 1.47;
    return seaLevel + (clamp(value, 0, 1) * 3.2 - seaLevel) * terrainVerticalScaleForZoom(zoom);
  };

  const elevationAt = (x: number, y: number): number => {
    const grid = snapshot?.fields.elevation;
    if (!grid || x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
    return renderedElevation(grid.values[y * grid.width + x] ?? 0);
  };

  const worldPosition = (x: number, y: number, extraHeight = 0): THREE.Vector3 => {
    const grid = snapshot?.fields.elevation;
    if (!grid) return new THREE.Vector3();
    return new THREE.Vector3(x - (grid.width - 1) / 2, elevationAt(Math.round(x), Math.round(y)) + extraHeight, y - (grid.height - 1) / 2);
  };

  const cameraFocus = (): THREE.Vector3 => {
    if (!snapshot) return new THREE.Vector3();
    if (surfaceMode() === "planet-globe") return new THREE.Vector3();
    const grid = snapshot.fields.elevation;
    const baseX = selection ? selection.x : (grid.width - 1) / 2;
    const baseY = selection ? selection.y : (grid.height - 1) / 2;
    const focus = worldPosition(baseX, baseY);
    focus.x += panWorldX;
    focus.z += panWorldZ;
    return focus;
  };

  const clampSurfacePan = (): void => {
    if (!snapshot || surfaceMode() !== "local-surface") {
      panWorldX = 0;
      panWorldZ = 0;
      return;
    }
    const dimensions = dimensionsFor();
    const aspect = dimensions.width / dimensions.height;
    const grid = snapshot.fields.elevation;
    const baseSpan = Math.max(10, Math.max(grid.width, grid.height) * 0.94);
    const visibleHeight = baseSpan / zoom;
    const visibleWidth = visibleHeight * aspect;
    // Keep the camera inside the finite local surface. The slightly smaller
    // usable bounds leave a stable terrain margin at steep camera pitches.
    const horizontalMargin = Math.max(0, (grid.width - 1 - visibleWidth) / 2) * 0.9;
    const depthMargin = Math.max(0, (grid.height - 1 - visibleHeight) / 2) * 0.9;
    panWorldX = clamp(panWorldX, -horizontalMargin, horizontalMargin);
    panWorldZ = clamp(panWorldZ, -depthMargin, depthMargin);
  };

  const updateCamera = (): void => {
    if (!snapshot) return;
    clampSurfacePan();
    const dimensions = dimensionsFor();
    const aspect = dimensions.width / dimensions.height;
    const grid = snapshot.fields.elevation;
    const bodyView = surfaceMode() === "planet-globe" || snapshot.formation.phase !== "stable-crust";
    const baseSpan = Math.max(10, (bodyView ? Math.min(grid.width, grid.height) : Math.max(grid.width, grid.height)) * 0.94);
    const visibleHeight = baseSpan / zoom;
    camera.left = -visibleHeight * aspect / 2;
    camera.right = visibleHeight * aspect / 2;
    camera.top = visibleHeight / 2;
    camera.bottom = -visibleHeight / 2;
    camera.updateProjectionMatrix();
    const focus = cameraFocus();
    const distance = Math.max(22, baseSpan * 0.82);
    const horizontalDistance = Math.cos(cameraPitch) * distance;
    camera.position.set(
      focus.x + Math.sin(cameraYaw) * horizontalDistance,
      focus.y + Math.sin(cameraPitch) * distance,
      focus.z + Math.cos(cameraYaw) * horizontalDistance,
    );
    camera.lookAt(focus);
    sunlight.target.position.copy(focus);
  };

  const updateRendererSize = (): void => {
    const dimensions = dimensionsFor();
    if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) renderer.setSize(dimensions.width, dimensions.height, false);
  };

  const render = (): void => {
    if (!snapshot) return;
    updateRendererSize();
    updateCamera();
    renderer.render(scene, camera);
    frameCount += 1;
    canvas.dataset.webglFrame = String(frameCount);
    canvas.dataset.renderStyle = "fantasy-3d";
    canvas.dataset.cameraYaw = String(Math.round(degrees(cameraYaw)));
    canvas.dataset.cameraPitch = String(Math.round(degrees(cameraPitch)));
    canvas.dataset.globeYaw = String(Math.round(degrees(globeYaw)));
    canvas.dataset.globePitch = String(Math.round(degrees(globePitch)));
    canvas.dataset.routeYaw = String(Math.round(degrees(linkRoot.rotation.y)));
    canvas.dataset.routePitch = String(Math.round(degrees(linkRoot.rotation.x)));
    canvas.dataset.cameraPanX = panWorldX.toFixed(2);
    canvas.dataset.cameraPanZ = panWorldZ.toFixed(2);
  };

  const scheduleRender = (): void => {
    if (scheduledRender) return;
    scheduledRender = requestAnimationFrame(() => {
      scheduledRender = 0;
      render();
    });
  };

  const terrainGeometryFor = (
    current: WorldSnapshot,
    options: { detail: number; xMin?: number; xMax?: number; yMin?: number; yMax?: number; relief?: number },
  ): THREE.BufferGeometry => {
    const grid = current.fields.elevation;
    const detail = options.detail;
    const xMin = clamp(options.xMin ?? 0, 0, grid.width - 1);
    const xMax = clamp(options.xMax ?? grid.width - 1, xMin, grid.width - 1);
    const yMin = clamp(options.yMin ?? 0, 0, grid.height - 1);
    const yMax = clamp(options.yMax ?? grid.height - 1, yMin, grid.height - 1);
    const columns = Math.round((xMax - xMin) * detail) + 1;
    const rows = Math.round((yMax - yMin) * detail) + 1;
    const positions = new Float32Array(columns * rows * 3);
    const colors = new Float32Array(columns * rows * 3);
    const indices: number[] = [];
    const sampleValue = (values: Float32Array, x: number, y: number): number => {
      const x0 = clamp(Math.floor(x), 0, grid.width - 1);
      const y0 = clamp(Math.floor(y), 0, grid.height - 1);
      const x1 = Math.min(grid.width - 1, x0 + 1);
      const y1 = Math.min(grid.height - 1, y0 + 1);
      const horizontal = x - x0;
      const vertical = y - y0;
      const top = (values[y0 * grid.width + x0] ?? 0) * (1 - horizontal) + (values[y0 * grid.width + x1] ?? 0) * horizontal;
      const bottom = (values[y1 * grid.width + x0] ?? 0) * (1 - horizontal) + (values[y1 * grid.width + x1] ?? 0) * horizontal;
      return top * (1 - vertical) + bottom * vertical;
    };
    const sampleLayerColor = (x: number, y: number): [number, number, number] => {
      const x0 = clamp(Math.floor(x), 0, grid.width - 1);
      const y0 = clamp(Math.floor(y), 0, grid.height - 1);
      const x1 = Math.min(grid.width - 1, x0 + 1);
      const y1 = Math.min(grid.height - 1, y0 + 1);
      const horizontal = x - x0;
      const vertical = y - y0;
      const topLeft = colorForCell(current, y0 * grid.width + x0, layer);
      const topRight = colorForCell(current, y0 * grid.width + x1, layer);
      const bottomLeft = colorForCell(current, y1 * grid.width + x0, layer);
      const bottomRight = colorForCell(current, y1 * grid.width + x1, layer);
      return topLeft.map((channel, channelIndex) => {
        const top = channel * (1 - horizontal) + topRight[channelIndex]! * horizontal;
        const bottom = bottomLeft[channelIndex]! * (1 - horizontal) + bottomRight[channelIndex]! * horizontal;
        return Math.round(top * (1 - vertical) + bottom * vertical);
      }) as [number, number, number];
    };
    for (let vertexY = 0; vertexY < rows; vertexY += 1) {
      for (let vertexX = 0; vertexX < columns; vertexX += 1) {
        const x = xMin + vertexX / detail;
        const y = yMin + vertexY / detail;
        const index = vertexY * columns + vertexX;
        const offset = index * 3;
        const baseElevation = clamp(sampleValue(grid.values, x, y), 0, 1);
        const water = clamp(sampleValue(current.fields.water.values, x, y), 0, 1);
        const landRelief = clamp((baseElevation - 0.38) / 0.2, 0, 1) * (1 - water);
        const relief = (sceneHash(Math.round(x * detail), Math.round(y * detail), current.seed ^ detail * 811) - 0.5)
          * (options.relief ?? 0) * landRelief;
        positions[offset] = x - (grid.width - 1) / 2;
        positions[offset + 1] = renderedElevation(baseElevation) + relief;
        positions[offset + 2] = y - (grid.height - 1) / 2;
        const [red, green, blue] = sampleLayerColor(x, y);
        const variation = 0.92 + sceneHash(Math.round(x * detail), Math.round(y * detail), current.seed + 811) * 0.12;
        colors[offset] = red / 255 * variation;
        colors[offset + 1] = green / 255 * variation;
        colors[offset + 2] = blue / 255 * variation;
        if (vertexX >= columns - 1 || vertexY >= rows - 1) continue;
        const right = index + 1;
        const below = index + columns;
        indices.push(index, below, right, right, below, below + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };

  const updateGlobeGeometry = (current: WorldSnapshot, geometry: THREE.SphereGeometry): void => {
    const grid = current.fields.elevation;
    const radius = globeRadius();
    const positions = geometry.getAttribute("position");
    const uvs = geometry.getAttribute("uv");
    let colors = geometry.getAttribute("color");
    if (!colors || colors.count !== positions.count) {
      colors = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
      geometry.setAttribute("color", colors);
    }
    const direction = new THREE.Vector3();
    const sampleField = (values: Float32Array, u: number, v: number): number => {
      const sourceX = u * grid.width - 0.5;
      const sourceY = (1 - v) * (grid.height - 1);
      const x0 = Math.floor(sourceX);
      const x1 = x0 + 1;
      const y0 = clamp(Math.floor(sourceY), 0, grid.height - 1);
      const y1 = Math.min(grid.height - 1, y0 + 1);
      const horizontal = sourceX - x0;
      const vertical = sourceY - y0;
      const wrappedX0 = (x0 + grid.width) % grid.width;
      const wrappedX1 = (x1 + grid.width) % grid.width;
      const top = (values[y0 * grid.width + wrappedX0] ?? 0) * (1 - horizontal) + (values[y0 * grid.width + wrappedX1] ?? 0) * horizontal;
      const bottom = (values[y1 * grid.width + wrappedX0] ?? 0) * (1 - horizontal) + (values[y1 * grid.width + wrappedX1] ?? 0) * horizontal;
      return top * (1 - vertical) + bottom * vertical;
    };
    const sampleColor = (u: number, v: number): [number, number, number] => {
      const sourceX = u * grid.width - 0.5;
      const sourceY = (1 - v) * (grid.height - 1);
      const x0 = Math.floor(sourceX);
      const x1 = x0 + 1;
      const y0 = clamp(Math.floor(sourceY), 0, grid.height - 1);
      const y1 = Math.min(grid.height - 1, y0 + 1);
      const horizontal = sourceX - x0;
      const vertical = sourceY - y0;
      const wrappedX0 = (x0 + grid.width) % grid.width;
      const wrappedX1 = (x1 + grid.width) % grid.width;
      const topLeft = colorForCell(current, y0 * grid.width + wrappedX0, layer);
      const topRight = colorForCell(current, y0 * grid.width + wrappedX1, layer);
      const bottomLeft = colorForCell(current, y1 * grid.width + wrappedX0, layer);
      const bottomRight = colorForCell(current, y1 * grid.width + wrappedX1, layer);
      return topLeft.map((channel, channelIndex) => {
        const top = channel * (1 - horizontal) + topRight[channelIndex]! * horizontal;
        const bottom = bottomLeft[channelIndex]! * (1 - horizontal) + bottomRight[channelIndex]! * horizontal;
        return top * (1 - vertical) + bottom * vertical;
      }) as [number, number, number];
    };
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const u = clamp(uvs.getX(vertex), 0, 0.999999);
      const v = clamp(uvs.getY(vertex), 0, 1);
      const x = Math.min(grid.width - 1, Math.floor(u * grid.width));
      const y = Math.min(grid.height - 1, Math.floor((1 - v) * grid.height));
      const elevation = clamp(sampleField(grid.values, u, v), 0, 1);
      const water = clamp(sampleField(current.fields.water.values, u, v), 0, 1);
      const relief = (elevation - 0.48) * radius * 0.035 * (water > 0.45 ? 0.28 : 1);
      direction.fromBufferAttribute(positions, vertex).normalize().multiplyScalar(radius + relief);
      positions.setXYZ(vertex, direction.x, direction.y, direction.z);
      const [red, green, blue] = sampleColor(u, v);
      const variation = 0.94 + sceneHash(x, y, current.seed + 1663) * 0.1;
      colors.setXYZ(vertex, red / 255 * variation, green / 255 * variation, blue / 255 * variation);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  const globeGeometryFor = (current: WorldSnapshot): THREE.SphereGeometry => {
    const grid = current.fields.elevation;
    const widthSegments = Math.max(64, Math.min(192, grid.width * 2));
    const heightSegments = Math.max(32, Math.min(96, grid.height * 2));
    const geometry = new THREE.SphereGeometry(globeRadius(), widthSegments, heightSegments);
    updateGlobeGeometry(current, geometry);
    return geometry;
  };

  const terrainPatchBounds = (radius: number): { xMin: number; xMax: number; yMin: number; yMax: number } => {
    const grid = snapshot!.fields.elevation;
    const centerX = clamp((selection?.x ?? (grid.width - 1) / 2) + panWorldX, 0, grid.width - 1);
    const centerY = clamp((selection?.y ?? (grid.height - 1) / 2) + panWorldZ, 0, grid.height - 1);
    return {
      xMin: Math.max(0, Math.floor(centerX - radius)),
      xMax: Math.min(grid.width - 1, Math.ceil(centerX + radius)),
      yMin: Math.max(0, Math.floor(centerY - radius)),
      yMax: Math.min(grid.height - 1, Math.ceil(centerY + radius)),
    };
  };

  const rebuildTerrain = (): void => {
    if (!snapshot) return;
    const grid = snapshot.fields.elevation;
    const globeGridKey = `${grid.width}x${grid.height}`;
    if (snapshot.formation.phase === "stable-crust"
      && surfaceMode() === "planet-globe"
      && terrainMesh === formationBodyMesh
      && terrainMesh?.userData.surfaceMode === "planet-globe"
      && terrainMesh.userData.gridKey === globeGridKey
      && terrainMesh.geometry instanceof THREE.SphereGeometry) {
      updateGlobeGeometry(snapshot, terrainMesh.geometry);
      syncGlobeRotation();
      canvas.dataset.terrainReuse = "true";
      return;
    }
    if (selectionMarker?.parent === terrainRoot) selectionMarker = undefined;
    clearGroup(terrainRoot);
    terrainRoot.rotation.set(0, 0, 0);
    terrainRoot.scale.setScalar(1);
    terrainMesh = undefined;
    formationBodyMesh = undefined;
    waterSurface = undefined;
    canvas.dataset.terrainReuse = "false";
    const bodyScale = formationBodyScale(snapshot.formation);
    canvas.dataset.formationBodyScale = bodyScale.toFixed(3);
    if (snapshot.formation.phase !== "stable-crust") {
      const bodyRadius = Math.min(grid.width, grid.height) * 0.44 * bodyScale;
      const surfaceColor = new THREE.Color(0x775b3e).lerp(new THREE.Color(0xc15a32), snapshot.formation.surfaceHeat * 0.65);
      formationBodyMesh = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.8, bodyRadius), 64, 32),
        new THREE.MeshStandardMaterial({
          color: surfaceColor,
          roughness: 0.8,
          metalness: snapshot.formation.coreFraction * 0.28,
          emissive: new THREE.Color(0x8f260d),
          emissiveIntensity: snapshot.formation.surfaceHeat * 0.72,
          flatShading: snapshot.formation.phase === "planetesimals" || snapshot.formation.phase === "accretion",
        }),
      );
      formationBodyMesh.position.y = 1.2;
      formationBodyMesh.castShadow = formationBodyMesh.receiveShadow = true;
      terrainRoot.add(formationBodyMesh);
      if (snapshot.formation.atmosphere > 0.01) {
        const atmosphere = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(1, bodyRadius * 1.035), 48, 24),
          new THREE.MeshPhysicalMaterial({ color: 0x6ea6b3, transparent: true, opacity: snapshot.formation.atmosphere * 0.2, roughness: 0.1, depthWrite: false, side: THREE.BackSide }),
        );
        atmosphere.position.copy(formationBodyMesh.position);
        terrainRoot.add(atmosphere);
      }
      terrainMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(grid.width - 1, grid.height - 1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }),
      );
      terrainMesh.rotation.x = -Math.PI / 2;
      terrainRoot.add(terrainMesh);
      canvas.dataset.terrainDetail = "0";
      canvas.dataset.terrainPatch = "formation-body";
      canvas.dataset.surfaceMode = "forming-body";
      canvas.dataset.worldCoverage = `${Math.round(snapshot.formation.planetaryMass * 100)}%`;
      return;
    }
    if (surfaceMode() === "planet-globe") {
      const radius = globeRadius();
      formationBodyMesh = new THREE.Mesh(
        globeGeometryFor(snapshot),
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.78,
          metalness: 0.02,
          flatShading: false,
        }),
      );
      formationBodyMesh.castShadow = formationBodyMesh.receiveShadow = true;
      formationBodyMesh.userData.surfaceMode = "planet-globe";
      formationBodyMesh.userData.gridKey = globeGridKey;
      terrainMesh = formationBodyMesh;
      terrainRoot.add(formationBodyMesh);
      const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.035, 96, 48),
        new THREE.MeshPhysicalMaterial({
          color: 0x74b9d0,
          transparent: true,
          opacity: 0.14,
          roughness: 0.12,
          clearcoat: 0.8,
          depthWrite: false,
          side: THREE.BackSide,
        }),
      );
      terrainRoot.add(atmosphere);
      syncGlobeRotation();
      canvas.dataset.terrainDetail = String(BASE_TERRAIN_DETAIL);
      canvas.dataset.terrainPatch = "global";
      canvas.dataset.surfaceMode = "planet-globe";
      canvas.dataset.worldCoverage = "100%";
      return;
    }
    canvas.dataset.surfaceMode = "local-surface";
    canvas.dataset.worldCoverage = "local-detail";
    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    terrainMesh = new THREE.Mesh(terrainGeometryFor(snapshot, { detail: BASE_TERRAIN_DETAIL }), terrainMaterial);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    terrainRoot.add(terrainMesh);
    const patchLod = terrainPatchLodForZoom(zoom);
    if (patchLod) {
      const bounds = terrainPatchBounds(patchLod.radius);
      const patchMaterial = terrainMaterial.clone();
      patchMaterial.polygonOffset = true;
      patchMaterial.polygonOffsetFactor = -1;
      patchMaterial.polygonOffsetUnits = -1;
      const patch = new THREE.Mesh(terrainGeometryFor(snapshot, { ...bounds, detail: patchLod.detail, relief: patchLod.relief }), patchMaterial);
      patch.receiveShadow = true;
      patch.castShadow = true;
      terrainRoot.add(patch);
      canvas.dataset.terrainDetail = String(patchLod.detail);
      canvas.dataset.terrainPatch = `${bounds.xMin}:${bounds.yMin}:${bounds.xMax}:${bounds.yMax}`;
    } else {
      canvas.dataset.terrainDetail = String(BASE_TERRAIN_DETAIL);
      canvas.dataset.terrainPatch = "global";
    }
    const seaMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x287f9b,
      transparent: true,
      opacity: 0.7,
      roughness: 0.2,
      metalness: 0.08,
      transmission: 0.08,
      clearcoat: 0.55,
      clearcoatRoughness: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    waterSurface = new THREE.Mesh(new THREE.PlaneGeometry(grid.width - 1, grid.height - 1), seaMaterial);
    waterSurface.rotation.x = -Math.PI / 2;
    waterSurface.position.y = 1.47;
    waterSurface.receiveShadow = true;
    terrainRoot.add(waterSurface);
    const wateryCells: THREE.Vector3[] = [];
    for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) {
      const index = y * grid.width + x;
      if (currentWater(index) > 0.45 && elevationAt(x, y) > 1.48) wateryCells.push(worldPosition(x, y, 0.045));
    }
    if (wateryCells.length > 0) {
      const patch = new THREE.InstancedMesh(new THREE.CircleGeometry(0.72, 16), seaMaterial, wateryCells.length);
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      wateryCells.forEach((position, index) => {
        matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
        patch.setMatrixAt(index, matrix);
      });
      patch.instanceMatrix.needsUpdate = true;
      terrainRoot.add(patch);
    }
  };

  const rebuildProps = (): void => {
    if (!snapshot) return;
    clearGroup(propRoot);
    propRoot.rotation.set(0, 0, 0);
    const grid = snapshot.fields.elevation;
    if (snapshot.formation.phase !== "stable-crust") {
      const formation = snapshot.formation;
      const particleCount = Math.max(48, Math.min(900, Math.round(formation.dustDensity * 720 + formation.bodyCount / 800)));
      const geometry = new THREE.DodecahedronGeometry(0.16, 0);
      const material = new THREE.MeshStandardMaterial({
        color: formation.phase === "accretion" || formation.phase === "differentiation" ? 0xd8753f : 0xc3a06d,
        roughness: 0.92,
        emissive: formation.collisionEnergy > 0.15 ? 0x70250e : 0x39250f,
        emissiveIntensity: 0.28 + formation.collisionEnergy * 0.8,
      });
      const particles = new THREE.InstancedMesh(geometry, material, particleCount);
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const bodyRadius = Math.min(grid.width, grid.height) * 0.44 * formationBodyScale(formation);
      const diskRadius = Math.max(bodyRadius * 1.35, Math.max(grid.width, grid.height) * (0.14 + formation.dustDensity * 0.34));
      for (let index = 0; index < particleCount; index += 1) {
        const angle = sceneHash(index, snapshot.seed, 1709) * Math.PI * 2;
        const distance = bodyRadius * 1.05 + Math.pow(sceneHash(index, grid.width, 2371), 0.62) * diskRadius;
        const vertical = (sceneHash(index, grid.height, 91) - 0.5) * (1.4 + formation.dustDensity * 5.2);
        const position = new THREE.Vector3(Math.cos(angle) * distance, 1.2 + vertical, Math.sin(angle) * distance);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sceneHash(index, snapshot.seed, 337) * Math.PI * 2);
        const scale = 0.35 + sceneHash(index, snapshot.seed, 419) * (0.7 + formation.planetaryMass * 2.2);
        matrix.compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
        particles.setMatrixAt(index, matrix);
      }
      particles.castShadow = particles.receiveShadow = true;
      particles.instanceMatrix.needsUpdate = true;
      propRoot.add(particles);
      return;
    }
    const trees: Array<{ position: THREE.Vector3; scale: number; rotation: number }> = [];
    const rocks: Array<{ position: THREE.Vector3; scale: number; rotation: number }> = [];
    const samplesPerCell = propsPerCellForZoom(zoom);
    const localPropScale = propScaleForZoom(zoom);
    if (samplesPerCell === 0) return;
    const patchLod = terrainPatchLodForZoom(zoom);
    const bounds = patchLod
      ? terrainPatchBounds(patchLod.radius + 2)
      : { xMin: 0, xMax: grid.width - 1, yMin: 0, yMax: grid.height - 1 };
    for (let y = bounds.yMin; y <= bounds.yMax; y += 1) for (let x = bounds.xMin; x <= bounds.xMax; x += 1) {
      const index = y * grid.width + x;
      const elevation = elevationAt(x, y);
      if (currentWater(index) > 0.45 || elevation < 1.47) continue;
      const biomass = clamp(snapshot.fields.biomass.values[index] ?? 0, 0, 1);
      for (let sample = 0; sample < samplesPerCell; sample += 1) {
        const salt = grid.width * 31 + sample * 977;
        const variant = sceneHash(x, y, salt);
        const position = worldPosition(x, y);
        position.x += (sceneHash(x, y, 93 + sample * 43) - 0.5) * 0.82;
        position.z += (sceneHash(x, y, 177 + sample * 59) - 0.5) * 0.82;
        if (variant < 0.12 + biomass * 0.34) trees.push({ position, scale: (0.58 + sceneHash(x, y, 221 + sample * 71) * 0.72) * localPropScale, rotation: variant * Math.PI * 2 });
        else if (variant > 0.84) rocks.push({ position, scale: (0.18 + sceneHash(x, y, 341 + sample * 83) * 0.3) * localPropScale, rotation: variant * Math.PI * 2 });
      }
    }
    const treeGeometry = createFantasyTreeGeometry();
    const trunk = new THREE.InstancedMesh(treeGeometry.trunk, fantasyMaterials.trunk, trees.length);
    const crown = new THREE.InstancedMesh(treeGeometry.crown, fantasyMaterials.crown, trees.length);
    trunk.castShadow = trunk.receiveShadow = crown.castShadow = crown.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    trees.forEach((item, index) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.rotation);
      matrix.compose(new THREE.Vector3(item.position.x, item.position.y + 0.38 * item.scale, item.position.z), quaternion, new THREE.Vector3(item.scale, item.scale, item.scale));
      trunk.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(item.position.x, item.position.y + 1.2 * item.scale, item.position.z), quaternion, new THREE.Vector3(item.scale, item.scale, item.scale));
      crown.setMatrixAt(index, matrix);
    });
    trunk.instanceMatrix.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
    propRoot.add(trunk, crown);
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), fantasyMaterials.rock, rocks.length);
    rockMesh.castShadow = rockMesh.receiveShadow = true;
    rocks.forEach((item, index) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.rotation);
      matrix.compose(new THREE.Vector3(item.position.x, item.position.y + item.scale * 0.55, item.position.z), quaternion, new THREE.Vector3(item.scale * 1.25, item.scale, item.scale));
      rockMesh.setMatrixAt(index, matrix);
    });
    rockMesh.instanceMatrix.needsUpdate = true;
    propRoot.add(rockMesh);
  };

  const rebuildWeather = (): void => {
    clearGroup(weatherRoot);
    weatherMotion = undefined;
    canvas.dataset.weatherMode = "clear";
    canvas.dataset.weatherParticleCount = "0";
    canvas.dataset.weatherIntensity = "0.00";
    canvas.dataset.weatherFrame = "0";
    if (!snapshot || snapshot.formation.phase !== "stable-crust" || surfaceMode() === "planet-globe") return;

    const grid = snapshot.fields.elevation;
    const patchLod = terrainPatchLodForZoom(zoom);
    const bounds = patchLod
      ? terrainPatchBounds(patchLod.radius + 3)
      : { xMin: 0, xMax: grid.width - 1, yMin: 0, yMax: grid.height - 1 };
    let humidityTotal = 0;
    let waterTotal = 0;
    let temperatureTotal = 0;
    let sampleCount = 0;
    for (let y = bounds.yMin; y <= bounds.yMax; y += 1) for (let x = bounds.xMin; x <= bounds.xMax; x += 1) {
      const index = y * grid.width + x;
      humidityTotal += clamp(snapshot.fields.humidity.values[index] ?? 0, 0, 1);
      waterTotal += currentWater(index);
      temperatureTotal += clamp(snapshot.fields.temperature.values[index] ?? 0, 0, 1);
      sampleCount += 1;
    }
    const humidity = humidityTotal / Math.max(1, sampleCount);
    const water = waterTotal / Math.max(1, sampleCount);
    const temperature = temperatureTotal / Math.max(1, sampleCount);
    const intensity = clamp((humidity - 0.3) * 1.8 + water * 0.42, 0, 1);
    const count = intensity < 0.06 ? 0 : Math.min(180, 24 + Math.round(intensity * 156));
    const kind: "rain" | "snow" = temperature < 0.32 ? "snow" : "rain";
    canvas.dataset.weatherMode = count > 0 ? kind : "clear";
    canvas.dataset.weatherParticleCount = String(count);
    canvas.dataset.weatherIntensity = intensity.toFixed(2);
    canvas.dataset.weatherTemperature = temperature.toFixed(2);
    if (count === 0) return;

    const xMin = bounds.xMin - (grid.width - 1) / 2;
    const xMax = bounds.xMax - (grid.width - 1) / 2;
    const zMin = bounds.yMin - (grid.height - 1) / 2;
    const zMax = bounds.yMax - (grid.height - 1) / 2;
    const maxY = 4.6 + intensity * 1.8;
    const positions = new Float32Array(kind === "rain" ? count * 6 : count * 3);
    const floors = new Float32Array(count);
    const resetX = new Float32Array(count);
    const resetZ = new Float32Array(count);
    const resetY = new Float32Array(count);
    const lengths = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const horizontal = sceneHash(index, snapshot.seed, 1901);
      const depth = sceneHash(index, snapshot.seed, 1907);
      const height = sceneHash(index, snapshot.seed, 1913);
      const x = xMin + horizontal * Math.max(0.1, xMax - xMin);
      const z = zMin + depth * Math.max(0.1, zMax - zMin);
      const ground = elevationAt(Math.round(x + (grid.width - 1) / 2), Math.round(z + (grid.height - 1) / 2)) + 0.08;
      const length = kind === "rain" ? 0.2 + sceneHash(index, snapshot.seed, 1919) * 0.24 : 0;
      const startY = ground + 1.4 + height * maxY;
      const offset = kind === "rain" ? index * 6 : index * 3;
      positions[offset] = x;
      positions[offset + 1] = startY;
      positions[offset + 2] = z;
      if (kind === "rain") {
        positions[offset + 3] = x;
        positions[offset + 4] = startY - length;
        positions[offset + 5] = z;
      }
      floors[index] = ground;
      resetX[index] = x;
      resetZ[index] = z;
      resetY[index] = startY;
      lengths[index] = length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const weather = kind === "rain"
      ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: 0x9dd7e3,
        transparent: true,
        opacity: 0.18 + intensity * 0.34,
        depthWrite: false,
      }))
      : new THREE.Points(geometry, new THREE.PointsMaterial({
        color: 0xf2f8ff,
        size: 0.18,
        transparent: true,
        opacity: 0.42 + intensity * 0.34,
        depthWrite: false,
        sizeAttenuation: true,
      }));
    weather.userData.weatherKind = kind;
    weatherRoot.add(weather);
    weatherMotion = {
      kind,
      geometry,
      positions,
      floors,
      resetX,
      resetZ,
      resetY,
      lengths,
      maxY,
      speed: 0.07 + intensity * 0.11,
      drift: 0.012 + intensity * 0.018,
      xMin,
      xMax,
      zMin,
      zMax,
    };
  };

  const rebuildTerritories = (): void => {
    clearGroup(territoryRoot);
    const owners = new Map<string, SceneEntity>();
    for (const entity of sceneEntities.filter((candidate) => candidate.rank >= 5)) {
      for (const regionId of entity.territoryRegionIds ?? []) {
        const existing = owners.get(regionId);
        if (!existing || entity.rank > existing.rank || (entity.rank === existing.rank && entity.id < existing.id)) owners.set(regionId, entity);
      }
    }
    const cells = [...owners.entries()]
      .map(([regionId, entity]) => {
        const match = /^region:(\d+):(\d+)$/.exec(regionId);
        return match ? { x: Number(match[1]), y: Number(match[2]), entity } : undefined;
      })
      .filter((cell): cell is { x: number; y: number; entity: SceneEntity } => Boolean(cell));
    canvas.dataset.territoryRegionCount = String(cells.length);
    if (cells.length === 0) return;
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 20), material, cells.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    cells.forEach((cell, index) => {
      matrix.compose(worldPosition(cell.x, cell.y, 0.16), quaternion, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(index, matrix);
      const seed = stringSeed(cell.entity.id);
      mesh.setColorAt(index, new THREE.Color().setHSL((seed % 360) / 360, 0.56, 0.5));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    territoryRoot.add(mesh);
  };

  const pointForEntity = (entity: SceneEntity): THREE.Vector3 | undefined => {
    const match = /^region:(\d+):(\d+)$/.exec(entity.regionId);
    if (!match || !snapshot) return undefined;
    const seed = stringSeed(entity.id);
    const position = worldPosition(Number(match[1]), Number(match[2]), 0.04);
    const sceneLod = mapSceneLodForZoom(zoom);
    const spread = sceneLod === "individual"
      ? entity.kind === "agent" ? 1.35 : entity.kind === "population" ? 0.48 : entity.rank <= 2 ? 0.58 : entity.rank <= 5 ? 0.4 : 0.26
      : entity.kind === "agent" ? 3.8 : entity.kind === "population" ? 1.6 : entity.rank < 5 ? 1.15 : 0.52;
    position.x += ((seed % 1000) / 1000 - 0.5) * spread;
    position.z += (((seed >>> 10) % 1000) / 1000 - 0.5) * spread;
    return position;
  };

  const pointForRegion = (regionId: RegionId, globeView: boolean, extraHeight: number): THREE.Vector3 | undefined => {
    const match = /^region:(\d+):(\d+)$/.exec(regionId);
    if (!match || !snapshot) return undefined;
    const x = Number(match[1]);
    const y = Number(match[2]);
    return globeView ? globePointForRegion(x, y, extraHeight) : worldPosition(x, y, extraHeight);
  };

  const strategicRoutePoints = (link: SceneLink, globeView: boolean): THREE.Vector3[] | undefined => {
    const from = pointForRegion(link.fromRegion, globeView, globeView ? globeRadius() * 0.012 : 0.3);
    const to = pointForRegion(link.toRegion, globeView, globeView ? globeRadius() * 0.012 : 0.3);
    if (!from || !to || from.distanceToSquared(to) < 0.0001) return undefined;
    const kindOffset = link.kind === "border-conflict" ? 0.85 : link.kind === "migration" ? 0.35 : link.kind === "alliance" ? 0.15 : 0;
    const lateralOffset = link.kind === "border-conflict" ? 0.45 : link.kind === "migration" ? -0.45 : link.kind === "alliance" ? 0.16 : 0;
    if (!globeView) {
      const midpoint = from.clone().lerp(to, 0.5);
      midpoint.y = Math.max(from.y, to.y) + 0.55 + kindOffset + Math.min(3.5, from.distanceTo(to) * 0.07);
      const direction = to.clone().sub(from);
      const horizontalLength = Math.hypot(direction.x, direction.z);
      if (horizontalLength > 0.0001) {
        midpoint.x += -direction.z / horizontalLength * lateralOffset;
        midpoint.z += direction.x / horizontalLength * lateralOffset;
      }
      return new THREE.QuadraticBezierCurve3(from, midpoint, to).getPoints(24);
    }
    const radius = globeRadius();
    const angularDistance = Math.acos(clamp(from.clone().normalize().dot(to.clone().normalize()), -1, 1));
    const midpoint = from.clone().add(to);
    if (midpoint.lengthSq() < 0.0001) midpoint.copy(from).cross(new THREE.Vector3(0, 1, 0));
    if (midpoint.lengthSq() < 0.0001) midpoint.copy(from).cross(new THREE.Vector3(1, 0, 0));
    midpoint.normalize().multiplyScalar(radius + 0.22 + kindOffset + angularDistance * 0.72);
    const lateralDirection = from.clone().cross(to).normalize();
    if (lateralDirection.lengthSq() > 0.0001) midpoint.addScaledVector(lateralDirection, lateralOffset);
    return new THREE.QuadraticBezierCurve3(from, midpoint, to).getPoints(32);
  };

  const personalRoutePoints = (link: SceneLink): THREE.Vector3[] | undefined => {
    const from = entityPositions.get(link.fromId);
    const to = entityPositions.get(link.toId);
    if (!from || !to) return undefined;
    const midpoint = from.clone().lerp(to, 0.5);
    midpoint.y += 0.7 + from.distanceTo(to) * 0.08;
    return new THREE.QuadraticBezierCurve3(
      from.clone().add(new THREE.Vector3(0, 0.38, 0)),
      midpoint,
      to.clone().add(new THREE.Vector3(0, 0.38, 0)),
    ).getPoints(16);
  };

  const routeAppearance = (link: SceneLink): { color: number; opacity: number; pulseRate: number } => {
    if (link.kind === "border-conflict" || link.kind === "rival") return { color: 0xe05b43, opacity: 0.82, pulseRate: 3.8 };
    if (link.kind === "alliance") return { color: 0x61c3c7, opacity: 0.72, pulseRate: 1.15 };
    if (link.kind === "migration") return { color: 0xa8d59d, opacity: 0.68, pulseRate: 2.2 };
    if (link.kind === "predation") return { color: 0xf08b62, opacity: 0.7, pulseRate: 3.2 };
    if (link.kind === "competition") return { color: 0xc982b6, opacity: 0.68, pulseRate: 2.6 };
    if (link.kind === "mutualism") return { color: 0x72d6b0, opacity: 0.7, pulseRate: 1.1 };
    if (link.kind === "parasitism") return { color: 0x9e86d8, opacity: 0.72, pulseRate: 3.6 };
    return { color: 0xe6be58, opacity: link.scope === "strategic" ? 0.74 : 0.6, pulseRate: 1.55 };
  };

  const rebuildLinks = (): void => {
    clearGroup(linkRoot);
    animatedRouteObjects.length = 0;
    const globeView = surfaceMode() === "planet-globe";
    syncGlobeRotation();
    for (const link of sceneLinks) {
      if (globeView && link.scope !== "strategic") continue;
      const points = link.scope === "strategic" ? strategicRoutePoints(link, globeView) : personalRoutePoints(link);
      if (!points) continue;
      const appearance = routeAppearance(link);
      const route = link.scope === "strategic"
        ? new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), globeView ? 40 : 24, globeView ? Math.max(0.045, globeRadius() * 0.0045) : 0.045, 5, false),
          new THREE.MeshBasicMaterial({ color: appearance.color, transparent: true, opacity: appearance.opacity, depthTest: !globeView, depthWrite: false, toneMapped: false }),
        )
        : new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: appearance.color, transparent: true, opacity: appearance.opacity, depthWrite: false }),
        );
      route.renderOrder = link.scope === "strategic" ? 8 : 2;
      route.userData.fromId = link.fromId;
      route.userData.toId = link.toId;
      route.userData.fromRegion = link.fromRegion;
      route.userData.toRegion = link.toRegion;
      route.userData.linkScope = link.scope;
      route.userData.linkKind = link.kind;
      route.userData.baseOpacity = appearance.opacity;
      route.userData.pulseRate = appearance.pulseRate;
      route.userData.routePhase = stringSeed(`${link.kind}:${link.fromId}:${link.toId}`) % 37;
      linkRoot.add(route);
      if (link.scope === "strategic") animatedRouteObjects.push(route);
    }
  };

  const rebuildEntities = (): void => {
    clearGroup(entityRoot);
    animatedObjects.length = 0;
    entityPositions.clear();
    for (const entity of sceneEntities) {
      const position = pointForEntity(entity);
      if (!position) continue;
      entityPositions.set(entity.id, position);
      const seed = stringSeed(entity.id);
      const model = entity.kind === "agent"
        ? entity.lifeBlueprint ? createLifeformModel(entity.lifeBlueprint, seed) : createAgentModel(seed)
        : entity.kind === "population"
          ? entity.lifeBlueprint ? createLifeformPopulation(entity.lifeBlueprint, seed) : createPopulationCamp(seed)
          : entity.kind === "facility"
            ? createFacilityModel(entity.facilityType ?? "governance", seed)
            : entity.kind === "deity" || entity.kind === "sect" || entity.kind === "cultivation-path"
              ? createWorldviewModel(entity.kind, seed)
              : createOrganizationModel(entity.kind, seed);
      model.position.copy(position);
      model.rotation.y = (seed % 628) / 100;
      model.userData.baseY = position.y;
      model.userData.phase = seed % 31;
      model.userData.sceneKind = entity.kind;
      model.userData.sceneRank = entity.rank;
      model.userData.sceneRegionId = entity.regionId;
      model.userData.sceneEntityId = entity.id;
      model.userData.lifeform = Boolean(entity.lifeBlueprint);
      model.userData.facilityLevel = entity.facilityLevel ?? 1;
      model.userData.facilityCondition = entity.facilityCondition ?? 1;
      model.userData.facilityStatus = entity.facilityStatus;
      model.userData.worldviewInfluence = entity.worldviewInfluence ?? 0;
      model.userData.worldviewStatus = entity.worldviewStatus;
      if (entity.kind === "facility" && entity.facilityStatus === "damaged") {
        model.rotation.z = (1 - (entity.facilityCondition ?? 1)) * 0.12;
        model.position.y -= 0.08;
      }
      enableFantasyShadows(model);
      entityRoot.add(model);
      if (entity.kind === "agent" || entity.kind === "population") animatedObjects.push(model);
      model.traverse((child) => { if (child.userData.flame) animatedObjects.push(child); });
    }
    updateSceneLod();
  };

  const updateSceneLod = (): void => {
    const sceneLod = mapSceneLodForZoom(zoom);
    const globeView = surfaceMode() === "planet-globe";
    let visibleAgentCount = 0;
    let visiblePopulationCount = 0;
    let visibleOrganizationCount = 0;
    let visibleEntityCount = 0;
    const visibleEntityIds = new Set<string>();
    for (const child of entityRoot.children) {
      const kind = child.userData.sceneKind as SceneEntity["kind"] | undefined;
      const rank = Number(child.userData.sceneRank ?? 0);
      const isLocal = !selection || child.userData.sceneRegionId === selection.regionId;
      if (globeView) child.visible = false;
      else if (sceneLod === "individual") {
        if (!isLocal) child.visible = false;
        else if (kind === "agent") child.visible = visibleAgentCount++ < 12;
        else if (kind === "population") child.visible = visiblePopulationCount++ < 2;
        else if (kind === "facility") child.visible = visibleOrganizationCount++ < 10;
        else child.visible = rank <= 6 && visibleOrganizationCount++ < 8;
      } else {
        child.visible = (sceneLod === "settlement" && kind !== "agent" && rank >= 1)
          || (sceneLod === "region" && kind !== "agent" && rank >= 3)
          || (sceneLod === "continent" && rank >= 5)
          || (sceneLod === "global" && rank >= 7);
      }
      const modelScale = sceneLod === "global" ? 1
        : sceneLod === "continent" ? 0.82
          : sceneLod === "region" ? 0.62
            : sceneLod === "settlement" ? 0.38
              : kind === "agent" ? 0.16
                : kind === "population" ? 0.14
                  : rank <= 2 ? 0.12
                    : rank <= 5 ? 0.09
                      : 0.07;
      const facilityScale = kind === "facility" ? 0.84 + Number(child.userData.facilityLevel ?? 1) * 0.16 : 1;
      const worldviewScale = kind === "deity" || kind === "sect" || kind === "cultivation-path"
        ? (child.userData.worldviewStatus === "dormant" ? 0.68 : 0.82) + Number(child.userData.worldviewInfluence ?? 0) * 0.35
        : 1;
      child.scale.setScalar(modelScale * facilityScale * worldviewScale);
      if (child.visible) {
        visibleEntityCount += 1;
        visibleEntityIds.add(String(child.userData.sceneEntityId));
      }
    }
    propRoot.visible = snapshot?.formation.phase !== "stable-crust" || (!globeView && propsPerCellForZoom(zoom) > 0);
    territoryRoot.visible = !globeView && sceneLod !== "individual";
    linkRoot.visible = snapshot?.formation.phase === "stable-crust";
    weatherRoot.visible = snapshot?.formation.phase === "stable-crust" && !globeView && sceneLod !== "global";
    let visibleStrategicLinkCount = 0;
    let visiblePersonalLinkCount = 0;
    effectRoot.visible = !globeView;
    for (const link of linkRoot.children) {
      const strategic = link.userData.linkScope === "strategic";
      const touchesSelection = !selection
        || link.userData.fromRegion === selection.regionId
        || link.userData.toRegion === selection.regionId;
      link.visible = strategic
        ? globeView || sceneLod === "continent" || sceneLod === "region" || (sceneLod === "settlement" && touchesSelection)
        : !globeView && sceneLod === "individual"
          && visibleEntityIds.has(String(link.userData.fromId))
          && visibleEntityIds.has(String(link.userData.toId));
      if (link.visible && strategic) visibleStrategicLinkCount += 1;
      else if (link.visible) visiblePersonalLinkCount += 1;
    }
    canvas.dataset.sceneLod = sceneLod;
    canvas.dataset.visibleSceneEntityCount = String(visibleEntityCount);
    canvas.dataset.visibleStrategicLinkCount = String(visibleStrategicLinkCount);
    canvas.dataset.visiblePersonalLinkCount = String(visiblePersonalLinkCount);
    canvas.dataset.maxZoom = String(MAX_MAP_ZOOM);
    canvas.dataset.worldScope = snapshot?.formation.phase === "stable-crust" ? "planetary" : "forming-body";
    if (snapshot) {
      const grid = snapshot.fields.elevation;
      canvas.dataset.visibleRegionSpan = globeView
        ? `${grid.width.toFixed(2)}x${grid.height.toFixed(2)}`
        : `${Math.max(1 / MAX_MAP_ZOOM, grid.width / zoom).toFixed(2)}x${Math.max(1 / MAX_MAP_ZOOM, grid.height / zoom).toFixed(2)}`;
    }
  };

  const updateSelectionMarker = (): void => {
    if (selectionMarker) {
      selectionMarker.parent?.remove(selectionMarker);
      selectionMarker.geometry.dispose();
      (selectionMarker.material as THREE.Material).dispose();
      selectionMarker = undefined;
    }
    if (!selection) return;
    if (surfaceMode() === "planet-globe") {
      const radius = globeRadius();
      const position = globePointForRegion(selection.x, selection.y, radius * 0.018);
      const normal = position.clone().normalize();
      selectionMarker = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.018, radius * 0.027, 32),
        new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
      );
      selectionMarker.position.copy(position);
      selectionMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      terrainRoot.add(selectionMarker);
      return;
    }
    const sceneLod = mapSceneLodForZoom(zoom);
    const markerRadius = sceneLod === "individual" ? 0.08
      : sceneLod === "settlement" ? 0.2
        : sceneLod === "region" ? 0.36
          : 0.52;
    selectionMarker = new THREE.Mesh(
      new THREE.RingGeometry(markerRadius, markerRadius * 1.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    selectionMarker.rotation.x = -Math.PI / 2;
    selectionMarker.position.copy(worldPosition(selection.x, selection.y, 0.12));
    effectRoot.add(selectionMarker);
  };

  const applySnapshot = (next: WorldSnapshot): void => {
    snapshot = next;
    syncEnvironmentalPresentation();
    sceneEntities = next.sceneEntities ?? [];
    sceneLinks = next.sceneLinks ?? [];
    canvas.dataset.sceneEntityCount = String(sceneEntities.length);
    canvas.dataset.sceneLinkCount = String(sceneLinks.length);
    canvas.dataset.strategicLinkCount = String(sceneLinks.filter((link) => link.scope === "strategic").length);
    canvas.dataset.personalLinkCount = String(sceneLinks.filter((link) => link.scope === "personal").length);
    canvas.dataset.sceneFacilityCount = String(sceneEntities.filter((entity) => entity.kind === "facility").length);
    canvas.dataset.sceneWorldviewCount = String(sceneEntities.filter((entity) => entity.kind === "deity" || entity.kind === "sect" || entity.kind === "cultivation-path").length);
    canvas.dataset.sceneLifeformCount = String(sceneEntities.filter((entity) => (entity.kind === "agent" || entity.kind === "population") && entity.lifeBlueprint).length);
    canvas.dataset.formationPhase = next.formation.phase;
    canvas.dataset.formationProgress = (next.formation.progress * 100).toFixed(2);
    canvas.dataset.worldGrid = `${next.fields.elevation.width}x${next.fields.elevation.height}`;
    canvas.dataset.crossRegionLinkCount = String(sceneLinks.filter((link) => link.scope === "strategic").length);
    rebuildTerrain();
    if (surfaceMode() === "planet-globe") {
      clearGroup(territoryRoot);
      clearGroup(propRoot);
      clearGroup(entityRoot);
      clearGroup(linkRoot);
      clearGroup(weatherRoot);
      weatherMotion = undefined;
      animatedObjects.length = 0;
      entityPositions.clear();
      rebuildLinks();
      updateSceneLod();
    } else {
      rebuildTerritories();
      rebuildProps();
      rebuildWeather();
      rebuildEntities();
      rebuildLinks();
      updateSceneLod();
    }
    updateSelectionMarker();
  };

  const updateZoom = (next: number): void => {
    const previousLod = mapSceneLodForZoom(zoom);
    zoom = clampZoom(next);
    const nextLod = mapSceneLodForZoom(zoom);
    if (snapshot && previousLod !== nextLod) {
      rebuildTerrain();
      rebuildProps();
      rebuildWeather();
      rebuildEntities();
      rebuildLinks();
      updateSelectionMarker();
    }
    updateSceneLod();
    onZoomChange?.(zoom);
    if (deferredCameraRender !== undefined) clearTimeout(deferredCameraRender);
    deferredCameraRender = setTimeout(() => {
      deferredCameraRender = undefined;
      render();
    }, 80);
  };

  const updateOrbit = (nextYaw: number, nextPitch: number): void => {
    cameraYaw = normalizeYaw(nextYaw);
    cameraPitch = clamp(nextPitch, radians(28), radians(68));
    scheduleRender();
  };

  const animate = (time: number): void => {
    if (animationEnabled && time - lastAnimationFrame >= 33) {
      const phase = time / 1000;
      lastAnimationFrame = time;
      if (snapshot?.formation.phase !== "stable-crust") {
        propRoot.rotation.y = phase * 0.035;
        if (formationBodyMesh) formationBodyMesh.rotation.y = phase * 0.08;
      }
      if (waterSurface) {
        waterSurface.position.y = 1.47 + Math.sin(phase * 0.85) * 0.025;
        (waterSurface.material as THREE.MeshPhysicalMaterial).clearcoatRoughness = 0.13 + Math.sin(phase * 0.6) * 0.04;
      }
      if (weatherMotion && weatherRoot.visible) {
        const motion = weatherMotion;
        const positions = motion.positions;
        for (let index = 0; index < motion.floors.length; index += 1) {
          if (motion.kind === "rain") {
            const offset = index * 6;
            positions[offset] = positions[offset]! + motion.drift;
            positions[offset + 3] = positions[offset + 3]! + motion.drift;
            positions[offset + 1] = positions[offset + 1]! - motion.speed;
            positions[offset + 4] = positions[offset + 4]! - motion.speed;
            if (positions[offset + 1]! < motion.floors[index]!) {
              const wrappedX = motion.resetX[index]! + (phase * motion.drift) % Math.max(0.1, motion.xMax - motion.xMin);
              const x = wrappedX > motion.xMax ? wrappedX - (motion.xMax - motion.xMin) : wrappedX;
              const y = motion.resetY[index]!;
              positions[offset] = x;
              positions[offset + 1] = y;
              positions[offset + 2] = motion.resetZ[index]!;
              positions[offset + 3] = x;
              positions[offset + 4] = y - motion.lengths[index]!;
              positions[offset + 5] = motion.resetZ[index]!;
            }
            if (positions[offset + 2]! < motion.zMin || positions[offset + 2]! > motion.zMax) {
              positions[offset + 2] = motion.resetZ[index]!;
              positions[offset + 5] = motion.resetZ[index]!;
            }
            continue;
          }
          const offset = index * 3;
          const xSpan = Math.max(0.1, motion.xMax - motion.xMin);
          const driftedX = motion.resetX[index]! + (phase * motion.drift * 0.45) % xSpan;
          positions[offset] = driftedX > motion.xMax ? driftedX - xSpan : driftedX;
          positions[offset + 1] = positions[offset + 1]! - motion.speed * 0.45;
          positions[offset + 2] = clamp(
            motion.resetZ[index]! + Math.sin(phase * 0.8 + index) * 0.22,
            motion.zMin,
            motion.zMax,
          );
          const x = positions[offset]!;
          const z = positions[offset + 2]!;
          if (positions[offset + 1]! < motion.floors[index]!
            || x < motion.xMin
            || x > motion.xMax
            || z < motion.zMin
            || z > motion.zMax) {
            positions[offset] = motion.resetX[index]!;
            positions[offset + 1] = motion.resetY[index]!;
            positions[offset + 2] = motion.resetZ[index]!;
          }
        }
        motion.geometry.getAttribute("position").needsUpdate = true;
        canvas.dataset.weatherFrame = String(Number(canvas.dataset.weatherFrame ?? 0) + 1);
      }
      for (const object of animatedObjects) {
        if (object.userData.flame) {
          object.scale.y = 0.82 + Math.sin(phase * 7 + object.id) * 0.18;
          object.rotation.y = phase * 0.7;
        } else {
          object.position.y = Number(object.userData.baseY ?? object.position.y) + Math.sin(phase * 2.8 + Number(object.userData.phase ?? 0)) * 0.035;
          object.rotation.y += 0.0015;
        }
      }
      for (const route of animatedRouteObjects) {
        const material = route.material as THREE.Material;
        const baseOpacity = Number(route.userData.baseOpacity ?? 0.7);
        material.opacity = clamp(baseOpacity + Math.sin(phase * Number(route.userData.pulseRate ?? 1.5) + Number(route.userData.routePhase ?? 0)) * 0.16, 0.25, 0.98);
      }
      render();
    }
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);

  const pickRegion = (clientX: number, clientY: number): CellSelection | undefined => {
    if (!snapshot || !terrainMesh) return undefined;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrainMesh, false)[0];
    const grid = snapshot.fields.elevation;
    if (surfaceMode() === "planet-globe") {
      if (!hit?.uv) return undefined;
      const x = Math.min(grid.width - 1, Math.floor(clamp(hit.uv.x, 0, 0.999999) * grid.width));
      const y = Math.min(grid.height - 1, Math.floor((1 - clamp(hit.uv.y, 0, 1)) * grid.height));
      return { x, y, index: y * grid.width + x, regionId: `region:${x}:${y}` as RegionId };
    }
    const fallback = new THREE.Vector3();
    const point = hit?.point ?? raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.5), fallback);
    if (!point) return undefined;
    const x = clamp(Math.round(point.x + (grid.width - 1) / 2), 0, grid.width - 1);
    const y = clamp(Math.round(point.z + (grid.height - 1) / 2), 0, grid.height - 1);
    return { x, y, index: y * grid.width + x, regionId: `region:${x}:${y}` as RegionId };
  };

  const pickSceneEntity = (clientX: number, clientY: number): SceneEntitySelection | undefined => {
    if (!snapshot || surfaceMode() === "planet-globe") return undefined;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(entityRoot, true)
      .sort((left, right) => left.distance - right.distance)
      .find((candidate) => {
        let object: THREE.Object3D | null = candidate.object;
        while (object && object !== entityRoot) {
          if (typeof object.userData.sceneEntityId === "string" && typeof object.userData.sceneKind === "string") return true;
          object = object.parent;
        }
        return false;
      });
    if (!hit) return undefined;
    let object: THREE.Object3D | null = hit.object;
    while (object && object !== entityRoot) {
      const id = object.userData.sceneEntityId;
      const kind = object.userData.sceneKind;
      if (typeof id === "string" && typeof kind === "string") return { id, kind: kind as SceneEntity["kind"] };
      object = object.parent;
    }
    return undefined;
  };

  canvas.addEventListener("click", (event) => {
    if (didPan) { didPan = false; return; }
    const entity = pickSceneEntity(event.clientX, event.clientY);
    const next = entity
      ? (() => {
        const sceneEntity = sceneEntities.find((candidate) => candidate.id === entity.id);
        if (!sceneEntity || !snapshot) return undefined;
        const match = /^region:(\d+):(\d+)$/.exec(sceneEntity.regionId);
        if (!match) return undefined;
        const x = Number(match[1]);
        const y = Number(match[2]);
        return { x, y, index: y * snapshot.fields.elevation.width + x, regionId: sceneEntity.regionId };
      })()
      : pickRegion(event.clientX, event.clientY);
    if (!next) return;
    selection = next;
    panWorldX = 0;
    panWorldZ = 0;
    if (snapshot?.formation.phase === "stable-crust" && terrainPatchLodForZoom(zoom)) rebuildTerrain();
    updateSelectionMarker();
    canvas.dataset.selectedSceneEntity = entity?.id ?? "";
    onSelect(next, entity);
    scheduleRender();
  });
  canvas.addEventListener("pointerdown", (event) => {
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      panX: panWorldX,
      panZ: panWorldZ,
      yaw: cameraYaw,
      pitch: cameraPitch,
      globeYaw,
      globePitch,
      mode: event.button === 2 || event.shiftKey ? "rotate" : "pan",
    };
    didPan = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerStart || !snapshot) return;
    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    if (Math.hypot(deltaX, deltaY) < 3) return;
    didPan = true;
    if (pointerStart.mode === "rotate") {
      cameraYaw = normalizeYaw(pointerStart.yaw - deltaX * 0.008);
      cameraPitch = clamp(pointerStart.pitch - deltaY * 0.005, radians(28), radians(68));
      scheduleRender();
      return;
    }
    if (surfaceMode() === "planet-globe") {
      globeYaw = normalizeYaw(pointerStart.globeYaw + deltaX * 0.008);
      globePitch = clamp(pointerStart.globePitch + deltaY * 0.005, radians(-55), radians(55));
      syncGlobeRotation();
      scheduleRender();
      return;
    }
    const span = Math.max(snapshot.fields.elevation.width, snapshot.fields.elevation.height) / zoom;
    const unitsPerPixel = span / Math.max(1, canvas.clientHeight);
    panWorldX = pointerStart.panX + (-deltaX * Math.cos(cameraYaw) - deltaY * Math.sin(cameraYaw) * 0.72) * unitsPerPixel * 0.72;
    panWorldZ = pointerStart.panZ + (deltaX * Math.sin(cameraYaw) - deltaY * Math.cos(cameraYaw) * 0.72) * unitsPerPixel * 0.72;
    clampSurfacePan();
    scheduleRender();
  });
  const endPointer = (event?: PointerEvent): void => {
    clampSurfacePan();
    if (didPan && snapshot?.formation.phase === "stable-crust" && terrainPatchLodForZoom(zoom)) rebuildTerrain();
    if (didPan && snapshot?.formation.phase === "stable-crust" && terrainPatchLodForZoom(zoom)) rebuildWeather();
    pointerStart = undefined;
    if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", () => endPointer());
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    updateZoom(event.deltaY < 0 ? zoom * 1.12 : zoom / 1.12);
  }, { passive: false });
  new ResizeObserver(scheduleRender).observe(canvas);

  return {
    update: (next: WorldSnapshot, immediate = false, renderIntermediate = true) => {
      if (immediate) {
        if (deferredDataRender !== undefined) clearTimeout(deferredDataRender);
        deferredDataRender = undefined;
        lastDataRender = performance.now();
        applySnapshot(next);
        render();
        return;
      }
      snapshot = next;
      if (animationEnabled) { applySnapshot(next); return; }
      const throttle = renderIntermediate ? 250 : 1_000;
      const delay = Math.max(0, throttle - (performance.now() - lastDataRender));
      if (deferredDataRender !== undefined) return;
      deferredDataRender = setTimeout(() => {
        deferredDataRender = undefined;
        lastDataRender = performance.now();
        applySnapshot(snapshot!);
        render();
      }, delay);
    },
    setLayer: (next: MapLayer) => {
      layer = next;
      if (snapshot) {
        rebuildTerrain();
        updateSelectionMarker();
      }
      scheduleRender();
    },
    setQuality: (next: RenderQuality) => { quality = next; scheduleRender(); },
    setSelection: (next: CellSelection | undefined) => {
      const changed = selection?.regionId !== next?.regionId;
      selection = next;
      if (!changed) return;
      panWorldX = 0;
      panWorldZ = 0;
      if (snapshot?.formation.phase === "stable-crust" && terrainPatchLodForZoom(zoom)) rebuildTerrain();
      updateSelectionMarker();
      scheduleRender();
    },
    focusSelection: (next: CellSelection, lod: MapFocusLod) => {
      const changed = selection?.regionId !== next.regionId;
      const previousLod = mapSceneLodForZoom(zoom);
      selection = next;
      panWorldX = 0;
      panWorldZ = 0;
      updateZoom(focusZoomForLod(lod));
      if (changed && previousLod === mapSceneLodForZoom(zoom) && snapshot?.formation.phase === "stable-crust" && terrainPatchLodForZoom(zoom)) {
        rebuildTerrain();
      }
      updateSelectionMarker();
      scheduleRender();
    },
    setAnimating: (next: boolean) => { animationEnabled = next; if (next) scheduleRender(); },
    zoomIn: () => updateZoom(zoom < 2 ? zoom + 0.25 : zoom < 10 ? zoom + 1 : zoom < 24 ? zoom + 2 : zoom * 1.5),
    zoomOut: () => updateZoom(zoom <= 2 ? zoom - 0.25 : zoom <= 10 ? zoom - 1 : zoom <= 24 ? zoom - 2 : zoom / 1.5),
    resetZoom: () => { panWorldX = 0; panWorldZ = 0; updateZoom(1); },
    rotateLeft: () => updateOrbit(cameraYaw - radians(15), cameraPitch),
    rotateRight: () => updateOrbit(cameraYaw + radians(15), cameraPitch),
    tiltUp: () => updateOrbit(cameraYaw, cameraPitch + radians(5)),
    tiltDown: () => updateOrbit(cameraYaw, cameraPitch - radians(5)),
    resetCamera: () => {
      panWorldX = 0;
      panWorldZ = 0;
      globeYaw = radians(-18);
      globePitch = radians(-12);
      syncGlobeRotation();
      updateOrbit(0, radians(42));
    },
    getLayer: () => layer,
    getQuality: () => quality,
    getZoom: () => zoom,
    getCameraYaw: () => degrees(cameraYaw),
    getCameraPitch: () => degrees(cameraPitch),
  };
};
