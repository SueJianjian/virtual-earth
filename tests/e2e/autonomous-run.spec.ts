import { expect, test } from "@playwright/test";

test("advances the world autonomously without scripted entities", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#world-map")).toBeVisible();
  const initialYear = await page.locator("#world-year").textContent();
  await page.getByRole("button", { name: /鍗曟|单步/ }).click();
  await expect(page.locator("#world-year")).not.toHaveText(initialYear ?? "");
  await expect(page.locator("#digest-label")).not.toContainText("绛夊緟|等待");
  await page.getByRole("button", { name: /娓╁害|温度/ }).click();
  await expect(page.getByRole("button", { name: /娓╁害|温度/ })).toHaveClass(/active/);
});
