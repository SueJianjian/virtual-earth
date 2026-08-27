import type { WorkerClient } from "../worker/protocol.ts";

export const bindTimeControls = (root: ParentNode, client: WorkerClient): void => {
  root.querySelector<HTMLButtonElement>("#play-button")?.addEventListener("click", () => client.send({ type: "start" }));
  root.querySelector<HTMLButtonElement>("#pause-button")?.addEventListener("click", () => client.send({ type: "pause" }));
  root.querySelector<HTMLButtonElement>("#reset-button")?.addEventListener("click", () => client.send({ type: "reset" }));
  root.querySelector<HTMLButtonElement>("#step-button")?.addEventListener("click", () => client.send({ type: "step", count: 1 }));
  root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((button) => button.addEventListener("click", () => {
    const multiplier = Number(button.dataset.speed) as 1 | 4 | 16 | 64;
    client.send({ type: "setSpeed", multiplier });
    root.querySelectorAll("[data-speed]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
  }));
};

export const downloadSave = (payload: string): void => {
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "virtual-earth-save.json";
  anchor.click();
  URL.revokeObjectURL(url);
};
