import { expect, test } from "@playwright/test";

test("keeps controls, causal events, and save/load state consistent", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#simulation-status")).toContainText("暂停");

  const initialDigest = await page.locator("#digest-label").textContent();
  await page.locator("#step-button").click();
  await expect(page.locator("#world-year")).toContainText("1");
  await page.locator("[data-speed=\"16\"]").click();
  await expect(page.locator("[data-speed=\"16\"]")).toHaveClass(/active/);

  await page.locator("#god-tool").selectOption("heat");
  await page.locator("#god-apply").click();
  await expect(page.locator("#timeline")).not.toContainText("暂无事件");
  await expect(page.locator("#world-year")).toContainText("2");
  await page.locator("#world-map").click({ position: { x: 120, y: 100 } });
  await expect(page.locator("#inspector")).toContainText("region:");

  const savedYear = await page.locator("#world-year").textContent();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save-button").click();
  const download = await downloadPromise;
  const savePath = await download.path();
  expect(savePath).toBeTruthy();

  await page.locator("#step-button").click();
  await expect(page.locator("#world-year")).not.toHaveText(savedYear ?? "");
  await page.locator("#load-input").setInputFiles(savePath!);
  await expect(page.locator("#world-year")).toHaveText(savedYear ?? "");
  await expect(page.locator("#inspector")).toContainText("region:");

  const beforeFocus = await page.locator("#digest-label").textContent();
  await page.locator("#world-map").click({ position: { x: 120, y: 100 } });
  await expect(page.locator("#inspector")).toContainText("region:");
  await expect(page.locator("#digest-label")).toHaveText(beforeFocus ?? initialDigest ?? "");
});
