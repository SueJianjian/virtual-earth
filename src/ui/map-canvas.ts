import type { RegionId } from "../sim/types.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";
import { colorForCell, type MapLayer } from "./layers.ts";

export type CellSelection = { x: number; y: number; index: number; regionId: RegionId };

export const createMapCanvas = (
  canvas: HTMLCanvasElement,
  onSelect: (selection: CellSelection) => void,
) => {
  let snapshot: WorldSnapshot | undefined;
  let layer: MapLayer = "natural";
  let selection: CellSelection | undefined;

  const render = (): void => {
    if (!snapshot) return;
    const grid = snapshot.fields.elevation;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const buffer = document.createElement("canvas");
    buffer.width = grid.width;
    buffer.height = grid.height;
    const bufferContext = buffer.getContext("2d");
    const context = canvas.getContext("2d");
    if (!bufferContext || !context) return;
    const pixels = bufferContext.createImageData(grid.width, grid.height);
    for (let index = 0; index < grid.values.length; index += 1) {
      const [red, green, blue] = colorForCell(snapshot, index, layer);
      const offset = index * 4;
      pixels.data[offset] = red;
      pixels.data[offset + 1] = green;
      pixels.data[offset + 2] = blue;
      pixels.data[offset + 3] = 255;
    }
    bufferContext.putImageData(pixels, 0, 0);
    context.imageSmoothingEnabled = true;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(236, 231, 212, 0.08)";
    for (let y = 0; y < canvas.height; y += Math.max(16, Math.floor(canvas.height / 12))) context.fillRect(0, y, canvas.width, 1);
    if (selection) {
      const cellWidth = canvas.width / grid.width;
      const cellHeight = canvas.height / grid.height;
      context.strokeStyle = "#f2c94c";
      context.lineWidth = Math.max(2, ratio);
      context.strokeRect(selection.x * cellWidth, selection.y * cellHeight, cellWidth, cellHeight);
    }
  };

  canvas.addEventListener("click", (event) => {
    if (!snapshot) return;
    const rect = canvas.getBoundingClientRect();
    const grid = snapshot.fields.elevation;
    const x = Math.max(0, Math.min(grid.width - 1, Math.floor((event.clientX - rect.left) / rect.width * grid.width)));
    const y = Math.max(0, Math.min(grid.height - 1, Math.floor((event.clientY - rect.top) / rect.height * grid.height)));
    selection = { x, y, index: y * grid.width + x, regionId: `region:${x}:${y}` as RegionId };
    onSelect(selection);
    render();
  });
  new ResizeObserver(render).observe(canvas);

  return {
    update: (next: WorldSnapshot) => { snapshot = next; render(); },
    setLayer: (next: MapLayer) => { layer = next; render(); },
    getLayer: () => layer,
  };
};
