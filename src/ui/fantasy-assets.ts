import * as THREE from "three";
import type { OrganizationType } from "../sim/types.ts";

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
  const base = cylinder(0.62, 0.76, height, 10, palette.stone);
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
  group.add(door);
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
  const cloth = palette.cloth[seed % palette.cloth.length] ?? palette.cloth[0]!;
  const hair = palette.hair[(seed >>> 4) % palette.hair.length] ?? palette.hair[0]!;
  const body = cylinder(0.22, 0.3, 0.72, 8, cloth);
  body.position.y = 0.95;
  group.add(body);
  const belt = cylinder(0.305, 0.305, 0.12, 8, palette.leather);
  belt.position.y = 0.71;
  group.add(belt);
  const head = mesh(new THREE.SphereGeometry(0.23, 10, 8), palette.skin);
  head.position.y = 1.55;
  group.add(head);
  const hairCap = mesh(new THREE.SphereGeometry(0.245, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.58), hair);
  hairCap.position.y = 1.59;
  group.add(hairCap);
  for (const side of [-1, 1]) {
    const shoulder = mesh(new THREE.SphereGeometry(0.16, 8, 6), side > 0 && seed % 3 === 0 ? palette.steel : cloth);
    shoulder.position.set(side * 0.34, 1.17, 0);
    group.add(shoulder);
    const arm = cylinder(0.075, 0.09, 0.58, 7, palette.skin);
    arm.position.set(side * 0.4, 0.87, 0);
    arm.rotation.z = side * 0.12;
    group.add(arm);
    const leg = cylinder(0.09, 0.11, 0.62, 7, palette.leather);
    leg.position.set(side * 0.13, 0.32, 0);
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
