import { expect, test } from "@playwright/test";

test("keeps the current recovery point when an imported save is invalid", async ({ page }) => {
  await page.goto("/");
  await page.locator("#pause-button").click();
  await page.locator("#step-button").click();
  await expect(page.locator("#world-year")).toContainText("1");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save-button").click();
  await downloadPromise;
  const before = await page.evaluate(() => localStorage.getItem("virtual-earth:auto-save:v1"));
  expect(before).toContain('"schemaVersion":1');

  await page.locator("#load-input").setInputFiles({
    name: "broken-world.json",
    mimeType: "application/json",
    buffer: Buffer.from("{")
  });
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#persistence-status")).toContainText("原恢复点已保留");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("virtual-earth:auto-save:v1"))).toBe(before);
  await expect(page.locator("#world-year")).toContainText("1");
});

test("restores from IndexedDB when browser checkpoint storage is full", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (key === "virtual-earth:auto-save:v1") throw new DOMException("quota exceeded", "QuotaExceededError");
      originalSetItem.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.locator("#pause-button").click();
  await page.locator("#step-button").click();
  await expect(page.locator("#world-year")).toContainText("1");
  await page.locator("#save-button").click();
  await expect(page.locator("#persistence-status")).toContainText("IndexedDB");
  await expect(page.locator("#persistence-status")).toHaveAttribute("data-state", "saved");
  await expect.poll(() => page.evaluate(async () => new Promise<string | undefined>((resolve) => {
    const request = indexedDB.open("virtual-earth", 1);
    request.onerror = () => resolve(undefined);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction("checkpoints", "readonly").objectStore("checkpoints").get("virtual-earth:auto-save:v1");
      read.onsuccess = () => { database.close(); resolve(read.result); };
      read.onerror = () => { database.close(); resolve(undefined); };
    };
  }))).toContain('"schemaVersion":1');

  await page.reload();
  await expect(page.locator("#world-year")).toContainText("1");
  await expect(page.locator("#persistence-status")).toContainText("IndexedDB 镜像恢复");
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-state", "running");
});

test("uses the IndexedDB mirror when the fast browser checkpoint is corrupted", async ({ page }) => {
  await page.goto("/");
  await page.locator("#pause-button").click();
  await page.locator("#step-button").click();
  await expect(page.locator("#world-year")).toContainText("1");
  await page.locator("#save-button").click();
  await expect(page.locator("#persistence-status")).toContainText("双重存储");

  await page.evaluate(() => localStorage.setItem("virtual-earth:auto-save:v1", "corrupted-fast-cache"));
  await page.reload();

  await expect(page.locator("#world-year")).toContainText("1");
  await expect(page.locator("#persistence-status")).toContainText("IndexedDB 镜像");
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-state", "running");
});

test("keeps controls, causal events, and save/load state consistent", async ({ page }) => {
  await page.goto("/");
  await page.locator("#pause-button").click();
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

  await page.reload();
  await expect(page.locator("#world-year")).toHaveText(savedYear ?? "");
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-state", "running");

  const beforeFocus = await page.locator("#digest-label").textContent();
  await page.locator("#world-map").click({ position: { x: 120, y: 100 } });
  await expect(page.locator("#inspector")).toContainText("region:");
  await expect(page.locator("#digest-label")).toHaveText(beforeFocus ?? initialDigest ?? "");
  await page.locator("#reset-button").click();
  await expect(page.locator("#simulation-status")).toContainText("暂停");
  await expect(page.locator("#world-year")).toHaveText("0 年 0 天");
});
