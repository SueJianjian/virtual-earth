import { expect, test } from "@playwright/test";

test("renders a non-empty world map and interactive observation panels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "虚拟地球" })).toBeVisible();
  await expect(page.locator("#simulation-status")).toContainText("暂停");
  const canvas = page.locator("#world-map");
  await expect(canvas).toBeVisible();
  const pixelSignal = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (!context || element.width === 0 || element.height === 0) return 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let signal = 0;
    for (let index = 0; index < pixels.length; index += 160) signal += pixels[index] ?? 0;
    return signal;
  });
  expect(pixelSignal).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "温度" }).click();
  await expect(page.getByRole("button", { name: "温度" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "食物保障" }).click();
  await expect(page.getByRole("button", { name: "食物保障" })).toHaveClass(/active/);
  await canvas.click({ position: { x: 120, y: 100 } });
  await expect(page.locator("#inspector")).toContainText("region:");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toBeVisible();
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("知识承继");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toContainText("食物保障");
  await page.getByRole("button", { name: "单步推进" }).click();
  await expect(page.locator("#world-year")).toContainText("1 年");
  await page.getByRole("button", { name: "4×", exact: true }).click();
  await expect(page.getByRole("button", { name: "4×", exact: true })).toHaveClass(/active/);
});

test("keeps the map and panels usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#world-map")).toBeVisible();
  await expect(page.locator(".right-rail")).toBeVisible();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-state", "paused");
  await page.locator("#world-map").click({ position: { x: 120, y: 100 } });
  await expect(page.locator("#inspector")).toContainText("region:");
  await expect(page.getByRole("region", { name: "家庭谱系" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const metricOverflow = await page.locator(".lineage-metrics > div").evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth + 1));
  expect(metricOverflow).toBe(false);
});
