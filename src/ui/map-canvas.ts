import * as THREE from "three";
import type { RegionId } from "../sim/types.ts";
import type { SceneEntity, SceneLink, WorldSnapshot } from "../worker/protocol.ts";
import { colorForCell, type MapLayer } from "./layers.ts";
import { createAgentModel, createFantasyTreeGeometry, createOrganizationModel, createPopulationCamp, enableFantasyShadows, fantasyMaterials } from "./fantasy-assets.ts";

export type CellSelection = { x: number; y: number; index: number; regionId: RegionId };
export type RenderQuality = 480 | 720 | 1080;

const renderDimensions: Record<RenderQuality, { width: number; height: number }> = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clampZoom = (value: number): number => clamp(value, 0.6, 8);
const radians = (degrees: number): number => degrees * Math.PI / 180;
const degrees = (value: number): number => value * 180 / Math.PI;
const normalizeYaw = (value: number): number => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

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
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const item of materials) if (!item.userData.shared) item.dispose();
    });
  }
};

export const createMapCanvas = (
  canvas: HTMLCanvasElement,
  onSelect: (selection: CellSelection) => void,
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
  scene.background = new THREE.Color(0x78a9b8);
  scene.fog = new THREE.FogExp2(0x8db5bd, 0.0055);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 180);
  const terrainRoot = new THREE.Group();
  const territoryRoot = new THREE.Group();
  const propRoot = new THREE.Group();
  const linkRoot = new THREE.Group();
  const entityRoot = new THREE.Group();
  const effectRoot = new THREE.Group();
  scene.add(terrainRoot, territoryRoot, propRoot, linkRoot, entityRoot, effectRoot);

  scene.add(new THREE.HemisphereLight(0xc8e7ef, 0x31422d, 1.05));
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
  let pointerStart: {
    x: number;
    y: number;
    panX: number;
    panZ: number;
    yaw: number;
    pitch: number;
    mode: "pan" | "rotate";
  } | undefined;
  let didPan = false;
  let terrainMesh: THREE.Mesh | undefined;
  let waterSurface: THREE.Mesh | undefined;
  let selectionMarker: THREE.Mesh | undefined;
  let sceneEntities: SceneEntity[] = [];
  let sceneLinks: SceneLink[] = [];
  let frameCount = 0;
  const animatedObjects: THREE.Object3D[] = [];
  const entityPositions = new Map<string, THREE.Vector3>();

  const dimensionsFor = (): { width: number; height: number } => {
    const base = renderDimensions[quality];
    const rasterScale = Math.min(2.25, Math.max(1, zoom));
    return {
      width: Math.min(1920, Math.round(base.width * rasterScale)),
      height: Math.min(1080, Math.round(base.height * rasterScale)),
    };
  };

  const currentWater = (index: number): number => clamp(snapshot?.fields.water.values[index] ?? 0, 0, 1);

  const elevationAt = (x: number, y: number): number => {
    const grid = snapshot?.fields.elevation;
    if (!grid || x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
    return clamp(grid.values[y * grid.width + x] ?? 0, 0, 1) * 3.2;
  };

  const worldPosition = (x: number, y: number, extraHeight = 0): THREE.Vector3 => {
    const grid = snapshot?.fields.elevation;
    if (!grid) return new THREE.Vector3();
    return new THREE.Vector3(x - (grid.width - 1) / 2, elevationAt(Math.round(x), Math.round(y)) + extraHeight, y - (grid.height - 1) / 2);
  };

  const cameraFocus = (): THREE.Vector3 => {
    if (!snapshot) return new THREE.Vector3();
    const grid = snapshot.fields.elevation;
    const baseX = selection ? selection.x : (grid.width - 1) / 2;
    const baseY = selection ? selection.y : (grid.height - 1) / 2;
    const focus = worldPosition(baseX, baseY);
    focus.x += panWorldX;
    focus.z += panWorldZ;
    return focus;
  };

  const updateCamera = (): void => {
    if (!snapshot) return;
    const dimensions = dimensionsFor();
    const aspect = dimensions.width / dimensions.height;
    const grid = snapshot.fields.elevation;
    const baseSpan = Math.max(10, Math.max(grid.width, grid.height) * 0.94);
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
  };

  const scheduleRender = (): void => {
    if (scheduledRender) return;
    scheduledRender = requestAnimationFrame(() => {
      scheduledRender = 0;
      render();
    });
  };

  const terrainGeometryFor = (current: WorldSnapshot): THREE.BufferGeometry => {
    const grid = current.fields.elevation;
    const detail = 3;
    const columns = (grid.width - 1) * detail + 1;
    const rows = (grid.height - 1) * detail + 1;
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
        const x = vertexX / detail;
        const y = vertexY / detail;
        const index = vertexY * columns + vertexX;
        const offset = index * 3;
        positions[offset] = x - (grid.width - 1) / 2;
        positions[offset + 1] = clamp(sampleValue(grid.values, x, y), 0, 1) * 3.2;
        positions[offset + 2] = y - (grid.height - 1) / 2;
        const [red, green, blue] = sampleLayerColor(x, y);
        const variation = 0.92 + sceneHash(vertexX, vertexY, current.tick + 811) * 0.12;
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

  const rebuildTerrain = (): void => {
    if (!snapshot) return;
    clearGroup(terrainRoot);
    const grid = snapshot.fields.elevation;
    terrainMesh = new THREE.Mesh(terrainGeometryFor(snapshot), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: false, side: THREE.DoubleSide }));
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    terrainRoot.add(terrainMesh);
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
    waterSurface = new THREE.Mesh(new THREE.PlaneGeometry(grid.width + 8, grid.height + 8), seaMaterial);
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
    const grid = snapshot.fields.elevation;
    const trees: Array<{ position: THREE.Vector3; scale: number; rotation: number }> = [];
    const rocks: Array<{ position: THREE.Vector3; scale: number; rotation: number }> = [];
    for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) {
      const index = y * grid.width + x;
      const elevation = elevationAt(x, y);
      if (currentWater(index) > 0.45 || elevation < 1.47) continue;
      const variant = sceneHash(x, y, grid.width * 31);
      const biomass = clamp(snapshot.fields.biomass.values[index] ?? 0, 0, 1);
      const position = worldPosition(x, y);
      position.x += (sceneHash(x, y, 93) - 0.5) * 0.44;
      position.z += (sceneHash(x, y, 177) - 0.5) * 0.44;
      if (variant < 0.12 + biomass * 0.34) trees.push({ position, scale: 0.75 + sceneHash(x, y, 221) * 0.65, rotation: variant * Math.PI * 2 });
      else if (variant > 0.84) rocks.push({ position, scale: 0.22 + sceneHash(x, y, 341) * 0.28, rotation: variant * Math.PI * 2 });
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
    const spread = entity.kind === "agent" ? 3.8 : entity.kind === "population" ? 1.6 : entity.rank < 5 ? 1.15 : 0.52;
    position.x += ((seed % 1000) / 1000 - 0.5) * spread;
    position.z += (((seed >>> 10) % 1000) / 1000 - 0.5) * spread;
    return position;
  };

  const rebuildEntities = (): void => {
    clearGroup(entityRoot);
    clearGroup(linkRoot);
    animatedObjects.length = 0;
    entityPositions.clear();
    for (const entity of sceneEntities) {
      const position = pointForEntity(entity);
      if (!position) continue;
      entityPositions.set(entity.id, position);
      const seed = stringSeed(entity.id);
      const model = entity.kind === "agent" ? createAgentModel(seed) : entity.kind === "population" ? createPopulationCamp(seed) : createOrganizationModel(entity.kind, seed);
      model.position.copy(position);
      model.rotation.y = (seed % 628) / 100;
      model.userData.baseY = position.y;
      model.userData.phase = seed % 31;
      model.userData.sceneKind = entity.kind;
      model.userData.sceneRank = entity.rank;
      enableFantasyShadows(model);
      entityRoot.add(model);
      if (entity.kind === "agent" || entity.kind === "population") animatedObjects.push(model);
      model.traverse((child) => { if (child.userData.flame) animatedObjects.push(child); });
    }
    for (const link of sceneLinks) {
      const from = entityPositions.get(link.fromId);
      const to = entityPositions.get(link.toId);
      if (!from || !to) continue;
      const midpoint = from.clone().lerp(to, 0.5);
      midpoint.y += 0.7 + from.distanceTo(to) * 0.08;
      const curve = new THREE.QuadraticBezierCurve3(from.clone().add(new THREE.Vector3(0, 0.38, 0)), midpoint, to.clone().add(new THREE.Vector3(0, 0.38, 0)));
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
      const conflict = link.kind === "rival" || link.kind === "border-conflict";
      const lineMaterial = new THREE.LineBasicMaterial({ color: conflict ? 0xd5573e : 0xf1d36a, transparent: true, opacity: conflict ? 0.78 : 0.62 });
      linkRoot.add(new THREE.Line(geometry, lineMaterial));
    }
    updateSceneLod();
  };

  const updateSceneLod = (): void => {
    const sceneLod = zoom < 1.5 ? "global" : zoom < 2.5 ? "region" : zoom < 4 ? "settlement" : "individual";
    for (const child of entityRoot.children) {
      const kind = child.userData.sceneKind as SceneEntity["kind"] | undefined;
      const rank = Number(child.userData.sceneRank ?? 0);
      child.visible = sceneLod === "individual"
        || (sceneLod === "settlement" && kind !== "agent" && rank >= 1)
        || (sceneLod === "region" && kind !== "agent" && rank >= 3)
        || (sceneLod === "global" && rank >= 5);
    }
    propRoot.visible = zoom >= 0.8;
    territoryRoot.visible = sceneLod !== "individual";
    linkRoot.visible = sceneLod === "individual";
    canvas.dataset.sceneLod = sceneLod;
  };

  const updateSelectionMarker = (): void => {
    if (selectionMarker) {
      effectRoot.remove(selectionMarker);
      selectionMarker.geometry.dispose();
      (selectionMarker.material as THREE.Material).dispose();
      selectionMarker = undefined;
    }
    if (!selection) return;
    selectionMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.68, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    selectionMarker.rotation.x = -Math.PI / 2;
    selectionMarker.position.copy(worldPosition(selection.x, selection.y, 0.12));
    effectRoot.add(selectionMarker);
  };

  const applySnapshot = (next: WorldSnapshot): void => {
    snapshot = next;
    sceneEntities = next.sceneEntities ?? [];
    sceneLinks = next.sceneLinks ?? [];
    canvas.dataset.sceneEntityCount = String(sceneEntities.length);
    canvas.dataset.sceneLinkCount = String(sceneLinks.length);
    canvas.dataset.crossRegionLinkCount = String(sceneLinks.filter((link) => link.kind === "trade" || link.kind === "border-conflict").length);
    rebuildTerrain();
    rebuildTerritories();
    rebuildProps();
    rebuildEntities();
    updateSelectionMarker();
  };

  const updateZoom = (next: number): void => {
    zoom = clampZoom(next);
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
      if (waterSurface) {
        waterSurface.position.y = 1.47 + Math.sin(phase * 0.85) * 0.025;
        (waterSurface.material as THREE.MeshPhysicalMaterial).clearcoatRoughness = 0.13 + Math.sin(phase * 0.6) * 0.04;
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
    const fallback = new THREE.Vector3();
    const point = hit?.point ?? raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.5), fallback);
    if (!point) return undefined;
    const grid = snapshot.fields.elevation;
    const x = clamp(Math.round(point.x + (grid.width - 1) / 2), 0, grid.width - 1);
    const y = clamp(Math.round(point.z + (grid.height - 1) / 2), 0, grid.height - 1);
    return { x, y, index: y * grid.width + x, regionId: `region:${x}:${y}` as RegionId };
  };

  canvas.addEventListener("click", (event) => {
    if (didPan) { didPan = false; return; }
    const next = pickRegion(event.clientX, event.clientY);
    if (!next) return;
    selection = next;
    panWorldX = 0;
    panWorldZ = 0;
    updateSelectionMarker();
    onSelect(next);
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
    const span = Math.max(snapshot.fields.elevation.width, snapshot.fields.elevation.height) / zoom;
    const unitsPerPixel = span / Math.max(1, canvas.clientHeight);
    panWorldX = pointerStart.panX + (-deltaX * Math.cos(cameraYaw) - deltaY * Math.sin(cameraYaw) * 0.72) * unitsPerPixel * 0.72;
    panWorldZ = pointerStart.panZ + (deltaX * Math.sin(cameraYaw) - deltaY * Math.cos(cameraYaw) * 0.72) * unitsPerPixel * 0.72;
    scheduleRender();
  });
  const endPointer = (event?: PointerEvent): void => {
    pointerStart = undefined;
    if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", () => endPointer());
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => { event.preventDefault(); updateZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1)); }, { passive: false });
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
      if (!renderIntermediate) return;
      if (animationEnabled) { applySnapshot(next); return; }
      const delay = Math.max(0, 250 - (performance.now() - lastDataRender));
      if (deferredDataRender !== undefined) return;
      deferredDataRender = setTimeout(() => {
        deferredDataRender = undefined;
        lastDataRender = performance.now();
        applySnapshot(snapshot!);
        render();
      }, delay);
    },
    setLayer: (next: MapLayer) => { layer = next; if (snapshot) rebuildTerrain(); scheduleRender(); },
    setQuality: (next: RenderQuality) => { quality = next; scheduleRender(); },
    setSelection: (next: CellSelection | undefined) => {
      const changed = selection?.regionId !== next?.regionId;
      selection = next;
      if (!changed) return;
      panWorldX = 0;
      panWorldZ = 0;
      updateSelectionMarker();
      scheduleRender();
    },
    setAnimating: (next: boolean) => { animationEnabled = next; if (next) scheduleRender(); },
    zoomIn: () => updateZoom(zoom + (zoom < 2 ? 0.25 : zoom < 4 ? 0.5 : 1)),
    zoomOut: () => updateZoom(zoom - (zoom <= 2 ? 0.25 : zoom <= 4 ? 0.5 : 1)),
    resetZoom: () => { panWorldX = 0; panWorldZ = 0; updateZoom(1); },
    rotateLeft: () => updateOrbit(cameraYaw - radians(15), cameraPitch),
    rotateRight: () => updateOrbit(cameraYaw + radians(15), cameraPitch),
    tiltUp: () => updateOrbit(cameraYaw, cameraPitch + radians(5)),
    tiltDown: () => updateOrbit(cameraYaw, cameraPitch - radians(5)),
    resetCamera: () => {
      panWorldX = 0;
      panWorldZ = 0;
      updateOrbit(0, radians(42));
    },
    getLayer: () => layer,
    getQuality: () => quality,
    getZoom: () => zoom,
    getCameraYaw: () => degrees(cameraYaw),
    getCameraPitch: () => degrees(cameraPitch),
  };
};
