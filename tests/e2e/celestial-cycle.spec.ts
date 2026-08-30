import { expect, test } from "@playwright/test";
import { createWorld } from "../../src/sim/world.ts";
import { serializeWorld } from "../../src/persistence/serialize.ts";

test("keeps the global planet observation view and orbital telemetry", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#world-map");
  await expect(canvas).toHaveAttribute("data-formation-phase", "dust-cloud");
  await expect(canvas).not.toHaveAttribute("data-celestial-mode", /.+/);

  const formed = createWorld(420_301, { width: 32, height: 16, formation: "formed" });
  await page.locator("#load-input").setInputFiles({
    name: "celestial-formed-world.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeWorld(formed)),
  });
  await expect(canvas).toHaveAttribute("data-formation-phase", "stable-crust");
  await expect(canvas).toHaveAttribute("data-celestial-mode", "planetary-orbit");
  await expect(canvas).toHaveAttribute("data-celestial-objects", "hidden");
  await expect(canvas).toHaveAttribute("data-space-background", "black");
  await expect(canvas).toHaveAttribute("data-star-occlusion", "depth-tested");
  await expect(canvas).toHaveAttribute("data-orbital-frame", "star-centered");
  await expect(canvas).toHaveAttribute("data-star-orbits-planet", "false");
  await expect(canvas).toHaveAttribute("data-planet-orbits-star", "true");
  await expect(canvas).toHaveAttribute("data-moon-orbits-planet", "true");
  await expect(canvas).not.toHaveAttribute("data-solar-track", /.+/);
  await expect(canvas).not.toHaveAttribute("data-lunar-track", /.+/);
  await expect(canvas).toHaveAttribute("data-day-phase", /0\.0000/);
  await expect(canvas).toHaveAttribute("data-moon-illumination", /0\.\d+|1\.0000/);
  await expect(page.locator("#status-panel")).toContainText("天体与昼夜循环");
  await expect(page.locator("#status-panel")).toContainText("月球轨道周期");

  await page.locator('[data-speed="64"]').click();
  const before = await canvas.getAttribute("data-day-phase");
  const spinBefore = await canvas.getAttribute("data-planet-spin-phase");
  const surfaceYawBefore = await canvas.getAttribute("data-route-yaw");
  const planetFrameBefore = await canvas.screenshot();
  await page.locator("#play-button").click();
  await expect.poll(() => canvas.getAttribute("data-day-phase"), { timeout: 5_000 }).not.toBe(before);
  await expect.poll(() => canvas.getAttribute("data-planet-spin-phase"), { timeout: 5_000 }).not.toBe(spinBefore);
  await expect.poll(() => canvas.getAttribute("data-route-yaw"), { timeout: 5_000 }).not.toBe(surfaceYawBefore);
  const planetFrameAfter = await canvas.screenshot();
  expect(planetFrameAfter.equals(planetFrameBefore)).toBe(false);
  await page.locator("#pause-button").click();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-state", "paused");
  const frozenPhase = await canvas.getAttribute("data-day-phase");
  await page.waitForTimeout(180);
  await expect(canvas).toHaveAttribute("data-day-phase", frozenPhase ?? "");
  await canvas.screenshot({ path: "test-results/celestial-planet.png" });

  await expect(page.locator("#system-view")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-celestial-mode", "planetary-orbit");
  await expect(canvas).toHaveAttribute("data-celestial-objects", "hidden");
  await expect(canvas).toHaveAttribute("data-space-background", "black");
  await expect(canvas).toHaveAttribute("data-orbital-frame", "star-centered");
  await expect(canvas).toHaveAttribute("data-solar-light-frame", "inertial");
  await expect(canvas).toHaveAttribute("data-system-orbit-lines", "hidden");
  await expect(canvas).toHaveAttribute("data-star-radius-ratio", "109.1");
  await expect(canvas).toHaveAttribute("data-moon-radius-ratio", "0.2727");
  await expect(canvas).toHaveAttribute("data-star-position", "0.0000,0.0000,0.0000");
  await expect(canvas).toHaveAttribute("data-spatial-scale", "surface");
  await expect(canvas).toHaveAttribute("data-distance-unit", "map-region");
  await page.screenshot({ path: "test-results/celestial-cycle.png", fullPage: true });
});
