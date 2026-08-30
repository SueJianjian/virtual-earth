import { describe, expect, it } from "vitest";
import { completedPlanetFormationState, createPlanetFormationState } from "../../src/sim/environment/formation.ts";
import { BASE_TERRAIN_DETAIL, MAX_MAP_ZOOM, formationBodyScale, mapSceneLodForZoom, mapSceneLodLabel, mapSurfaceModeFor, propScaleForZoom, propsPerCellForZoom, terrainPatchLodForZoom, terrainReliefFor, terrainVerticalScaleForZoom } from "../../src/ui/map-lod.ts";

describe("map level of detail", () => {
  it("progresses from a global view to individual detail", () => {
    expect([1, 2, 6, 16, MAX_MAP_ZOOM].map(mapSceneLodForZoom)).toEqual([
      "global",
      "continent",
      "region",
      "settlement",
      "individual",
    ]);
  });

  it("increases local terrain and prop detail without refining the whole globe", () => {
    expect(terrainPatchLodForZoom(1)).toBeUndefined();
    expect(terrainPatchLodForZoom(2)).toMatchObject({ detail: 3, radius: 24 });
    expect(terrainPatchLodForZoom(16)).toMatchObject({ detail: 8, radius: 5 });
    expect(terrainPatchLodForZoom(MAX_MAP_ZOOM)).toMatchObject({ detail: 16, radius: 2 });
    expect(propsPerCellForZoom(MAX_MAP_ZOOM)).toBeGreaterThan(propsPerCellForZoom(2));
    expect(BASE_TERRAIN_DETAIL).toBeLessThan(terrainPatchLodForZoom(MAX_MAP_ZOOM)!.detail);
  });

  it("labels every semantic observation scale", () => {
    expect([1, 2, 6, 16, MAX_MAP_ZOOM].map(mapSceneLodLabel)).toEqual([
      "全球观察",
      "洲域观察",
      "区域观察",
      "聚落观察",
      "个人观察",
    ]);
  });

  it("shows a complete globe before entering the expandable local surface", () => {
    const forming = createPlanetFormationState(42);
    const formed = completedPlanetFormationState(42);

    expect(mapSurfaceModeFor(forming, 1)).toBe("forming-body");
    expect(mapSurfaceModeFor(formed, 1)).toBe("planet-globe");
    expect(mapSurfaceModeFor(formed, 1.49)).toBe("planet-globe");
    expect(mapSurfaceModeFor(formed, 1.5)).toBe("local-surface");
    expect(mapSurfaceModeFor(formed, MAX_MAP_ZOOM)).toBe("local-surface");
  });

  it("reduces global exaggeration for close local observation", () => {
    expect(terrainVerticalScaleForZoom(1)).toBe(1);
    expect(terrainVerticalScaleForZoom(MAX_MAP_ZOOM)).toBeLessThan(0.2);
    expect(propScaleForZoom(1)).toBe(0);
    expect(propScaleForZoom(MAX_MAP_ZOOM)).toBeLessThan(propScaleForZoom(6));
  });

  it("grows the visible planet with accreted mass", () => {
    const dust = createPlanetFormationState(42);
    const formed = completedPlanetFormationState(42);
    const halfFormed = { ...formed, phase: "accretion" as const, planetaryMass: 0.125 };

    expect(formationBodyScale(dust)).toBeCloseTo(0.07);
    expect(formationBodyScale(halfFormed)).toBeCloseTo(0.535);
    expect(formationBodyScale(formed)).toBe(1);
  });

  it("uses continuous seeded relief for close-up terrain", () => {
    const first = terrainReliefFor(4.25, 2.5, 42);
    const nearby = terrainReliefFor(4.26, 2.5, 42);
    const otherSeed = terrainReliefFor(4.25, 2.5, 43);

    expect(Math.abs(nearby - first)).toBeLessThan(0.02);
    expect(otherSeed).not.toBe(first);
    expect(terrainReliefFor(4.25, 2.5, 42)).toBe(first);
  });
});
