import * as THREE from "three";
import type { OrganizationType, SpeciesBlueprint, WorldviewEntityKind } from "../sim/types.ts";

export type FacilityKind = "subsistence" | "construction" | "navigation" | "medicine" | "governance" | "energy";

const material = (color: number, roughness = 0.72, metalness = 0): THREE.MeshStandardMaterial => {
  const result = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  result.userData.shared = true;
  return result;
};

const palette = {
  skin: material(0xd9a477, 0.82),
  hair: [material(0x31251f), material(0x5a3828), material(0x8a603a), material(0xd6b06a)],
  cloth: [material(0x9e3f35), material(0x286f82), material(0x617c35), material(0xb1822f), material(0x704c78)],
  leather: material(0x563a29),
  steel: material(0x9ca8a8, 0.32, 0.58),
  wood: material(0x654127),
  lightWood: material(0xb77b42),
  plaster: material(0xc8b68a),
  stone: material(0x7d8176, 0.92),
  darkStone: material(0x4b514b, 0.95),
  roof: material(0x8f342b, 0.86),
  roofBlue: material(0x2d6574, 0.82),
  gold: material(0xd4a62b, 0.35, 0.45),
  flame: material(0xff7626, 0.35),
  crop: material(0x8ea83b, 0.88),
  healing: material(0xcfe4dc, 0.68),
  energy: material(0x62d4d6, 0.3, 0.35),
  eye: material(0x1b2725, 0.4, 0.05),
  copper: material(0xc47a3c, 0.38, 0.32),
};

const lifeMaterials: Record<SpeciesBlueprint["biochemistry"], THREE.MeshStandardMaterial> = {
  "carbon-nitrogen": material(0x5c9c58, 0.78),
  "phosphorus-lattice": material(0x5d9cba, 0.58, 0.12),
  "silicate-organic": material(0xb88952, 0.72),
  "metal-organic": material(0x778d7b, 0.42, 0.26),
  "crystal-colloid": material(0x8c76b8, 0.38, 0.22),
};
const lifeAccents: Record<SpeciesBlueprint["biochemistry"], THREE.MeshStandardMaterial> = {
  "carbon-nitrogen": material(0xc7d85d, 0.62),
  "phosphorus-lattice": material(0x9ee1de, 0.34, 0.16),
  "silicate-organic": material(0xe0bf6a, 0.5),
  "metal-organic": material(0xc4c8a2, 0.32, 0.3),
  "crystal-colloid": material(0xd2b8ee, 0.28, 0.32),
};

const mesh = (geometry: THREE.BufferGeometry, meshMaterial: THREE.Material): THREE.Mesh => {
  const result = new THREE.Mesh(geometry, meshMaterial);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
};

const box = (width: number, height: number, depth: number, meshMaterial: THREE.Material): THREE.Mesh => mesh(new THREE.BoxGeometry(width, height, depth), meshMaterial);
const cylinder = (top: number, bottom: number, height: number, sides: number, meshMaterial: THREE.Material): THREE.Mesh => mesh(new THREE.CylinderGeometry(top, bottom, height, sides), meshMaterial);

const place = <T extends THREE.Object3D>(object: T, x: number, y: number, z: number): T => {
  object.position.set(x, y, z);
  return object;
};

const banner = (seed: number): THREE.Group => {
  const group = new THREE.Group();
  const pole = cylinder(0.035, 0.05, 2.25, 8, palette.wood);
  pole.position.y = 1.125;
  group.add(pole);
  const flagMaterial = palette.cloth[seed % palette.cloth.length] ?? palette.cloth[0]!;
  const flag = box(0.78, 0.42, 0.035, flagMaterial);
  flag.position.set(0.41, 1.78, 0);
  flag.userData.animationRole = "banner-flag";
  flag.userData.restRotationZ = flag.rotation.z;
  group.add(flag);
  const emblem = cylinder(0.1, 0.1, 0.055, 6, palette.gold);
  emblem.rotation.x = Math.PI / 2;
  emblem.position.set(0.4, 1.78, 0.03);
  group.add(emblem);
  return group;
};

const cottage = (seed: number, scale = 1): THREE.Group => {
  const group = new THREE.Group();
  const foundation = box(1.55, 0.18, 1.28, palette.stone);
  foundation.position.y = 0.09;
  group.add(foundation);
  const house = box(1.42, 0.95, 1.15, palette.plaster);
  house.position.y = 0.65;
  group.add(house);
  const beams = [
    place(box(0.09, 1.02, 0.08, palette.wood), -0.62, 0.68, 0.595),
    place(box(0.09, 1.02, 0.08, palette.wood), 0.62, 0.68, 0.595),
    place(box(1.35, 0.09, 0.08, palette.wood), 0, 0.95, 0.595),
  ];
  group.add(...beams);
  const roof = mesh(new THREE.ConeGeometry(1.18, 0.72, 4), seed % 2 === 0 ? palette.roof : palette.roofBlue);
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.78;
  roof.position.y = 1.47;
  group.add(roof);
  const door = box(0.34, 0.68, 0.08, palette.wood);
  door.position.set(0.28, 0.5, 0.62);
  group.add(door);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x78bed2, emissive: 0x173640, emissiveIntensity: 0.55, roughness: 0.22 });
  const window = box(0.3, 0.3, 0.06, windowMaterial);
  window.position.set(-0.35, 0.72, 0.63);
  group.add(window);
  group.scale.setScalar(scale);
  return group;
};

const tower = (seed: number, height = 2.5, scale = 1): THREE.Group => {
  const group = new THREE.Group();
  const base = cylinder(0.62, 0.76, height, 12, palette.stone);
  base.position.y = height / 2;
  group.add(base);
  const top = cylinder(0.82, 0.7, 0.3, 10, palette.darkStone);
  top.position.y = height + 0.08;
  group.add(top);
  for (let index = 0; index < 5; index += 1) {
    const merlon = box(0.2, 0.35, 0.22, palette.stone);
    const angle = index / 5 * Math.PI * 2;
    merlon.position.set(Math.cos(angle) * 0.67, height + 0.38, Math.sin(angle) * 0.67);
    group.add(merlon);
  }
  const door = box(0.3, 0.62, 0.08, palette.wood);
  door.position.set(0, 0.38, 0.7);
  const slit = box(0.07, 0.34, 0.04, palette.energy);
  slit.position.set(0.28, height * 0.62, 0.61);
  const doorHandle = mesh(new THREE.SphereGeometry(0.035, 8, 6), palette.copper);
  doorHandle.position.set(0.08, 0.4, 0.75);
  group.add(door, slit, doorHandle);
  const flag = banner(seed);
  flag.position.set(0, height + 0.25, 0);
  flag.scale.setScalar(0.7);
  group.add(flag);
  group.scale.setScalar(scale);
  return group;
};

const tent = (seed: number, scale = 1): THREE.Group => {
  const group = new THREE.Group();
  const tentMaterial = palette.cloth[seed % palette.cloth.length] ?? palette.cloth[0]!;
  const canopy = mesh(new THREE.ConeGeometry(0.72, 1.12, 4), tentMaterial);
  canopy.rotation.y = Math.PI / 4;
  canopy.scale.z = 0.8;
  canopy.position.y = 0.56;
  group.add(canopy);
  const pole = cylinder(0.025, 0.035, 1.35, 6, palette.wood);
  pole.position.y = 0.68;
  group.add(pole);
  group.scale.setScalar(scale);
  return group;
};

const campfire = (): THREE.Group => {
  const group = new THREE.Group();
  const logA = cylinder(0.08, 0.08, 0.72, 7, palette.wood);
  logA.rotation.z = Math.PI / 2;
  logA.rotation.y = Math.PI / 4;
  logA.position.y = 0.1;
  const logB = logA.clone();
  logB.rotation.y = -Math.PI / 4;
  const flame = mesh(new THREE.ConeGeometry(0.22, 0.7, 7), palette.flame);
  flame.position.y = 0.5;
  flame.userData.flame = true;
  group.add(logA, logB, flame);
  return group;
};

export const createAgentModel = (seed: number): THREE.Group => {
  const group = new THREE.Group();
  const arms: THREE.Object3D[] = [];
  const legs: THREE.Object3D[] = [];
  const cloth = palette.cloth[seed % palette.cloth.length] ?? palette.cloth[0]!;
  const hair = palette.hair[(seed >>> 4) % palette.hair.length] ?? palette.hair[0]!;
  const body = cylinder(0.22, 0.3, 0.72, 10, cloth);
  body.position.y = 0.95;
  body.userData.animationRole = "agent-body";
  group.add(body);
  const belt = cylinder(0.305, 0.305, 0.12, 8, palette.leather);
  belt.position.y = 0.71;
  group.add(belt);
  const head = mesh(new THREE.SphereGeometry(0.23, 16, 12), palette.skin);
  head.position.y = 1.55;
  group.add(head);
  const hairCap = mesh(new THREE.SphereGeometry(0.245, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), hair);
  hairCap.position.y = 1.59;
  group.add(hairCap);
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.038, 8, 6), palette.eye);
    eye.position.set(side * 0.085, 1.56, 0.218);
    group.add(eye);
  }
  for (const side of [-1, 1]) {
    const shoulder = mesh(new THREE.SphereGeometry(0.16, 8, 6), side > 0 && seed % 3 === 0 ? palette.steel : cloth);
    shoulder.position.set(side * 0.34, 1.17, 0);
    group.add(shoulder);
    const arm = cylinder(0.075, 0.09, 0.58, 7, palette.skin);
    arm.position.set(side * 0.4, 0.87, 0);
    arm.rotation.z = side * 0.12;
    arm.userData.animationRestRotationZ = arm.rotation.z;
    arms.push(arm);
    const hand = mesh(new THREE.SphereGeometry(0.09, 8, 6), palette.skin);
    hand.position.set(side * 0.43, 0.58, 0);
    group.add(arm, hand);
    const leg = cylinder(0.09, 0.11, 0.62, 7, palette.leather);
    leg.position.set(side * 0.13, 0.32, 0);
    leg.userData.animationRestRotationZ = leg.rotation.z;
    legs.push(leg);
    group.add(leg);
  }
  if (seed % 2 === 0) {
    const sword = box(0.055, 0.82, 0.035, palette.steel);
    sword.position.set(0.48, 0.72, 0.06);
    sword.rotation.z = -0.25;
    group.add(sword);
  } else {
    const shield = cylinder(0.25, 0.25, 0.08, 10, palette.wood);
    shield.rotation.x = Math.PI / 2;
    shield.position.set(-0.42, 0.92, 0.17);
    group.add(shield);
  }
  group.userData.animation = { type: "agent", arms, legs, body };
  group.scale.setScalar(0.55);
  return group;
};

export const createPopulationCamp = (seed: number): THREE.Group => {
  const group = new THREE.Group();
  const positions: Array<[number, number]> = [[-0.75, 0], [0.7, 0.15], [0, -0.72]];
  positions.forEach(([x, z], index) => group.add(place(tent(seed + index, 0.72), x, 0, z)));
  const fire = campfire();
  fire.position.set(0, 0, 0.18);
  group.add(fire);
  return group;
};

const lifeBodyScaleFor = (blueprint: SpeciesBlueprint): number => 0.24 + Math.min(0.48, Math.sqrt(blueprint.adultScale) * 0.14);

// The models are assembled from reusable low-poly primitives so every evolved
// lineage is visually distinct without depending on copied game assets.
export const createLifeformModel = (blueprint: SpeciesBlueprint, seed: number): THREE.Group => {
  const group = new THREE.Group();
  const cores: THREE.Object3D[] = [];
  const limbs: THREE.Object3D[] = [];
  const bodyMaterial = lifeMaterials[blueprint.biochemistry];
  const accentMaterial = lifeAccents[blueprint.biochemistry];
  const bodyScale = lifeBodyScaleFor(blueprint);
  const appendagePairs = Math.min(4, Math.max(0, blueprint.bodyPlan.appendagePairs));
  const bodyParts = blueprint.bodyPlan.colonial ? 3 : blueprint.bodyPlan.structure === "segmented" ? 3 : 1;
  const addCore = (offset: number, scale = 1): void => {
    let core: THREE.Mesh;
    if (blueprint.bodyPlan.structure === "shell") {
      core = mesh(new THREE.DodecahedronGeometry(bodyScale * 0.66 * scale, 1), bodyMaterial);
    } else if (blueprint.bodyPlan.structure === "network") {
      core = mesh(new THREE.TorusGeometry(bodyScale * 0.5 * scale, bodyScale * 0.14 * scale, 6, 10), bodyMaterial);
      core.rotation.x = Math.PI / 2;
    } else if (blueprint.bodyPlan.structure === "filament") {
      core = cylinder(bodyScale * 0.16 * scale, bodyScale * 0.28 * scale, bodyScale * 1.18 * scale, 7, bodyMaterial);
    } else {
      core = mesh(new THREE.SphereGeometry(bodyScale * (blueprint.bodyPlan.structure === "membrane" ? 0.72 : 0.58) * scale, 9, 7), bodyMaterial);
      core.scale.z = blueprint.bodyPlan.symmetry === "spiral" ? 1.45 : 1;
    }
    core.position.set(offset, bodyScale * 0.5 * scale, 0);
    cores.push(core);
    group.add(core);
  };
  for (let index = 0; index < bodyParts; index += 1) addCore((index - (bodyParts - 1) / 2) * bodyScale * 0.9, 1 - index * 0.09);

  if (blueprint.bodyPlan.symmetry === "radial" || blueprint.bodyPlan.symmetry === "fractal") {
    const rays = blueprint.bodyPlan.symmetry === "fractal" ? 5 : 4;
    for (let index = 0; index < rays; index += 1) {
      const angle = index / rays * Math.PI * 2;
      const ray = cylinder(bodyScale * 0.06, bodyScale * 0.11, bodyScale * 0.52, 6, accentMaterial);
      ray.position.set(Math.cos(angle) * bodyScale * 0.27, bodyScale * 0.48, Math.sin(angle) * bodyScale * 0.27);
      ray.rotation.z = Math.cos(angle) * Math.PI / 2;
      ray.rotation.x = Math.sin(angle) * Math.PI / 2;
      group.add(ray);
    }
  }

  if (blueprint.bodyPlan.locomotion === "rooted") {
    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * Math.PI * 2 + (seed % 11) * 0.08;
      const root = cylinder(bodyScale * 0.04, bodyScale * 0.1, bodyScale * 0.8, 6, accentMaterial);
      root.position.set(Math.cos(angle) * bodyScale * 0.3, bodyScale * 0.16, Math.sin(angle) * bodyScale * 0.3);
      root.rotation.z = Math.cos(angle) * 0.65;
      root.rotation.x = Math.sin(angle) * 0.65;
      root.userData.animationRestRotationZ = root.rotation.z;
      limbs.push(root);
      group.add(root);
    }
  } else {
    for (let pair = 0; pair < appendagePairs; pair += 1) {
      for (const side of [-1, 1]) {
        const limb = cylinder(bodyScale * 0.045, bodyScale * 0.085, bodyScale * 0.82, 6, accentMaterial);
        limb.position.set(side * bodyScale * (0.45 + pair * 0.09), bodyScale * 0.36, (pair - appendagePairs / 2) * bodyScale * 0.18);
        limb.rotation.z = side * (blueprint.bodyPlan.locomotion === "gliding" ? Math.PI / 2.7 : Math.PI / 5);
        limb.userData.animationRestRotationZ = limb.rotation.z;
        limbs.push(limb);
        group.add(limb);
      }
    }
  }

  if (blueprint.senses.includes("polarized-light") || blueprint.senses.includes("electric-field")) {
    const sensor = mesh(new THREE.SphereGeometry(bodyScale * 0.13, 8, 6), accentMaterial);
    sensor.position.set(0, bodyScale * 1.18, bodyScale * 0.5);
    group.add(sensor);
  }
  if (blueprint.senses.includes("vibration") || blueprint.senses.includes("pressure-wave")) {
    const crest = mesh(new THREE.ConeGeometry(bodyScale * 0.18, bodyScale * 0.58, 5), accentMaterial);
    crest.position.y = bodyScale * 1.36;
    group.add(crest);
  }
  if (blueprint.reproduction === "brood-pod" || blueprint.reproduction === "budding") {
    const pod = mesh(new THREE.SphereGeometry(bodyScale * 0.22, 7, 6), accentMaterial);
    pod.position.set(bodyScale * 0.56, bodyScale * 0.5, 0);
    group.add(pod);
  }
  group.userData.animation = { type: "lifeform", cores, limbs };
  group.userData.lifeform = true;
  group.userData.lifeBlueprint = blueprint.noveltySignature;
  return group;
};

export const createLifeformPopulation = (blueprint: SpeciesBlueprint, seed: number): THREE.Group => {
  const group = new THREE.Group();
  const count = blueprint.bodyPlan.colonial ? 4 : 3;
  for (let index = 0; index < count; index += 1) {
    const organism = createLifeformModel(blueprint, seed + index * 37);
    const angle = index / count * Math.PI * 2;
    organism.position.set(Math.cos(angle) * 0.36, 0, Math.sin(angle) * 0.32);
    organism.rotation.y = angle + 0.5;
    organism.scale.setScalar(0.5);
    group.add(organism);
  }
  group.userData.lifeform = true;
  group.userData.lifeBlueprint = blueprint.noveltySignature;
  return group;
};

export const createOrganizationModel = (kind: OrganizationType, seed: number): THREE.Group => {
  const group = new THREE.Group();
  switch (kind) {
    case "family":
      group.add(cottage(seed, 0.78));
      break;
    case "clan":
      group.add(cottage(seed, 1.05), place(banner(seed), 0.92, 0, 0.25));
      break;
    case "tribe":
      group.add(place(tent(seed, 0.9), -0.65, 0, 0), place(tent(seed + 1, 0.9), 0.65, 0, 0.15), campfire(), place(banner(seed), 0, 0, -0.55));
      break;
    case "settlement":
      group.add(place(cottage(seed, 0.72), -0.75, 0, 0.25), place(cottage(seed + 1, 0.72), 0.78, 0, -0.2), place(banner(seed), 0, 0, 0.4));
      break;
    case "city":
      group.add(place(tower(seed, 2.2, 0.75), 0.35, 0, -0.25), place(cottage(seed + 1, 0.7), -0.85, 0, 0.35), place(cottage(seed + 2, 0.62), 0.9, 0, 0.6));
      break;
    case "state":
      group.add(tower(seed, 2.9, 0.9), place(tower(seed + 1, 1.9, 0.62), -1.05, 0, 0.45), place(tower(seed + 2, 1.9, 0.62), 1.05, 0, 0.45));
      break;
    case "federation":
      group.add(place(tower(seed, 2.8, 0.82), -0.72, 0, 0), place(tower(seed + 1, 2.8, 0.82), 0.72, 0, 0), place(banner(seed), 0, 0, -0.8));
      break;
    case "empire":
      group.add(tower(seed, 3.5, 1.05), place(tower(seed + 1, 2.4, 0.72), -1.25, 0, 0.55), place(tower(seed + 2, 2.4, 0.72), 1.25, 0, 0.55));
      break;
  }
  return group;
};

export const createWorldviewModel = (kind: WorldviewEntityKind, seed: number): THREE.Group => {
  const group = new THREE.Group();
  const base = cylinder(0.72, 0.88, 0.28, 10, palette.darkStone);
  base.position.y = 0.14;
  group.add(base);
  if (kind === "sect") {
    const hall = tower(seed, 1.9, 0.62);
    hall.position.y = 0.18;
    const core = mesh(new THREE.SphereGeometry(0.2, 12, 8), palette.energy);
    core.position.y = 2.15;
    core.userData.flame = true;
    const ring = mesh(new THREE.TorusGeometry(0.46, 0.055, 8, 24), palette.gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.15;
    group.add(hall, core, ring, place(banner(seed), 0.72, 0, 0.25));
  } else if (kind === "cultivation-path") {
    for (let index = 0; index < 3; index += 1) {
      const step = cylinder(0.5 - index * 0.1, 0.58 - index * 0.1, 0.18, 8, index === 2 ? palette.gold : palette.stone);
      step.position.y = 0.34 + index * 0.2;
      group.add(step);
    }
    const core = mesh(new THREE.OctahedronGeometry(0.3, 0), palette.energy);
    core.position.y = 1.35;
    core.userData.flame = true;
    group.add(core);
  } else {
    const core = mesh(new THREE.SphereGeometry(0.38, 16, 10), palette.energy);
    core.position.y = 1.25;
    core.userData.flame = true;
    const firstRing = mesh(new THREE.TorusGeometry(0.66, 0.055, 8, 28), palette.gold);
    firstRing.position.y = 1.25;
    firstRing.rotation.x = Math.PI / 2.8;
    const secondRing = mesh(new THREE.TorusGeometry(0.56, 0.04, 8, 24), palette.steel);
    secondRing.position.y = 1.25;
    secondRing.rotation.y = Math.PI / 2;
    group.add(core, firstRing, secondRing);
  }
  return group;
};

export const createFacilityModel = (kind: FacilityKind, seed: number): THREE.Group => {
  const group = new THREE.Group();
  switch (kind) {
    case "subsistence": {
      const field = box(1.6, 0.08, 1.2, palette.lightWood);
      field.position.y = 0.04;
      group.add(field);
      for (let row = -2; row <= 2; row += 1) for (let column = -2; column <= 2; column += 1) {
        const crop = cylinder(0.035, 0.055, 0.28 + (seed + row + column) % 3 * 0.04, 5, palette.crop);
        crop.position.set(column * 0.25, 0.22, row * 0.2);
        crop.userData.animationRole = "crop";
        crop.userData.restRotationZ = crop.rotation.z;
        group.add(crop);
      }
      break;
    }
    case "construction":
      group.add(place(box(1.35, 0.22, 1.15, palette.stone), 0, 0.11, 0), place(tower(seed, 1.45, 0.42), 0, 0.2, 0));
      break;
    case "navigation": {
      const dock = box(1.55, 0.12, 0.6, palette.wood);
      dock.position.y = 0.08;
      const mast = cylinder(0.035, 0.055, 1.5, 7, palette.wood);
      mast.position.set(0, 0.82, 0);
      const sail = box(0.62, 0.82, 0.035, palette.cloth[seed % palette.cloth.length] ?? palette.cloth[0]!);
      sail.position.set(0.28, 0.87, 0);
      sail.userData.animationRole = "sail";
      sail.userData.restRotationY = sail.rotation.y;
      group.add(dock, mast, sail);
      break;
    }
    case "medicine": {
      const clinic = cottage(seed, 0.72);
      const crossVertical = box(0.1, 0.44, 0.04, palette.roof);
      const crossHorizontal = box(0.3, 0.1, 0.04, palette.roof);
      crossVertical.position.set(0, 1.1, 0.48);
      crossHorizontal.position.set(0, 1.1, 0.48);
      group.add(clinic, crossVertical, crossHorizontal);
      break;
    }
    case "governance":
      group.add(tower(seed, 2.05, 0.62), place(banner(seed), 0, 0, 0.2));
      break;
    case "energy": {
      const base = cylinder(0.56, 0.7, 0.28, 8, palette.darkStone);
      base.position.y = 0.14;
      const core = mesh(new THREE.SphereGeometry(0.35, 12, 8), palette.energy);
      core.position.y = 0.8;
      core.userData.flame = true;
      const ring = mesh(new THREE.TorusGeometry(0.52, 0.06, 8, 20), palette.gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.8;
      group.add(base, core, ring);
      break;
    }
  }
  return group;
};

export const createFantasyTreeGeometry = (): { trunk: THREE.CylinderGeometry; crown: THREE.ConeGeometry } => ({
  trunk: new THREE.CylinderGeometry(0.07, 0.12, 0.75, 7),
  crown: new THREE.ConeGeometry(0.5, 1.35, 8),
});

export const fantasyMaterials = {
  trunk: palette.wood,
  crown: material(0x3f7237, 0.92),
  rock: palette.stone,
};

export const enableFantasyShadows = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};
