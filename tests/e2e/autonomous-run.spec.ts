import { expect, test } from "@playwright/test";

test("advances the world autonomously without scripted entities", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#world-map")).toBeVisible();
  const initialTime = await page.locator("#world-year").textContent();
  await page.locator('[data-speed="64"]').click();
  await page.locator("#play-button").click();
  await expect(page.locator("#world-year")).not.toHaveText(initialTime ?? "");
  await page.locator("#pause-button").click();
  await expect(page.locator("#digest-label")).not.toContainText("等待首个快照");
  await page.locator('[data-layer="temperature"]').click();
  await expect(page.locator('[data-layer="temperature"]')).toHaveClass(/active/);
});
