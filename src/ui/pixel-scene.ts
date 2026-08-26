import type { OrganizationType } from "../sim/types.ts";

type PixelContext = CanvasRenderingContext2D;

type SpriteBase = {
  x: number;
  y: number;
  scale: number;
  seed: number;
};

const clothes = ["#d96b4d", "#3f8fa6", "#d0a84b", "#6d8e52", "#926a9d", "#b86f52"];
const hair = ["#3a2b24", "#5a3a2b", "#7a5639", "#d5b77b", "#25272a"];
const flags = ["#d85f4b", "#e0b84e", "#3f8fa6", "#6c9254", "#9b6a94"];

const pixelScale = (value: number): number => Math.max(1, Math.floor(value));
const at = (value: number): number => Math.round(value);

const rect = (context: PixelContext, x: number, y: number, width: number, height: number, color: string): void => {
  context.fillStyle = color;
  context.fillRect(at(x), at(y), Math.max(1, at(width)), Math.max(1, at(height)));
};

const shadow = (context: PixelContext, x: number, y: number, width: number, scale: number): void => {
  const unit = pixelScale(scale);
  rect(context, x - width / 2, y, width, unit * 2, "rgba(18, 25, 20, 0.34)");
  rect(context, x - width * 0.38, y + unit * 2, width * 0.76, unit, "rgba(18, 25, 20, 0.22)");
};

const steppedRoof = (context: PixelContext, x: number, y: number, halfWidth: number, height: number, scale: number, color: string, highlight: string): void => {
  const unit = pixelScale(scale);
  const rows = Math.max(3, Math.floor(height / unit));
  for (let row = 0; row < rows; row += 1) {
    const progress = row / Math.max(1, rows - 1);
    const width = Math.max(unit * 2, halfWidth * 2 * progress);
    rect(context, x - width / 2, y - height + row * unit, width, unit + 1, row < 2 ? highlight : color);
  }
};

const banner = (context: PixelContext, x: number, y: number, scale: number, seed: number, height = 11): void => {
  const unit = pixelScale(scale);
  rect(context, x, y - height * unit, unit, height * unit, "#594834");
  const color = flags[seed % flags.length] ?? flags[0]!;
  rect(context, x + unit, y - height * unit, unit * 5, unit * 3, color);
  rect(context, x + unit, y - (height - 3) * unit, unit * 3, unit, color);
  rect(context, x + unit, y - height * unit, unit * 5, unit, "rgba(255, 244, 186, 0.35)");
};

const cottage = (context: PixelContext, x: number, y: number, scale: number, seed: number, wide = 1): void => {
  const unit = pixelScale(scale);
  const halfWidth = unit * (7 + wide * 2);
  const wallHeight = unit * (7 + wide);
  shadow(context, x, y, halfWidth * 2.2, unit);
  rect(context, x - halfWidth, y - wallHeight, halfWidth * 2, wallHeight, "#c99b5f");
  rect(context, x - halfWidth, y - unit * 2, halfWidth * 2, unit * 2, "#8b623f");
  steppedRoof(context, x, y - wallHeight + unit, halfWidth + unit * 2, unit * 7, unit, "#8d4f3f", "#c56f4e");
  rect(context, x - unit * 2, y - unit * 5, unit * 4, unit * 5, "#69472f");
  rect(context, x - unit, y - unit * 4, unit, unit, "#e0b84e");
  rect(context, x - halfWidth + unit * 2, y - unit * 6, unit * 3, unit * 3, "#69a9b1");
  rect(context, x - halfWidth + unit * 3, y - unit * 6, unit, unit * 3, "#d5e6cf");
  if (seed % 3 === 0) rect(context, x + halfWidth - unit * 4, y - wallHeight - unit * 5, unit * 2, unit * 5, "#655343");
};

const tower = (context: PixelContext, x: number, y: number, scale: number, seed: number, height = 18): void => {
  const unit = pixelScale(scale);
  shadow(context, x, y, unit * 14, unit);
  rect(context, x - unit * 5, y - unit * height, unit * 10, unit * height, "#a99b7a");
  rect(context, x - unit * 6, y - unit * (height + 3), unit * 3, unit * 4, "#b7aa88");
  rect(context, x - unit, y - unit * (height + 3), unit * 3, unit * 4, "#b7aa88");
  rect(context, x + unit * 4, y - unit * (height + 3), unit * 3, unit * 4, "#b7aa88");
  rect(context, x - unit * 2, y - unit * 7, unit * 4, unit * 7, "#594834");
  for (let row = 0; row < 2; row += 1) {
    rect(context, x - unit * 4, y - unit * (height - 4 - row * 6), unit * 2, unit * 3, "#5b8994");
    rect(context, x + unit * 2, y - unit * (height - 4 - row * 6), unit * 2, unit * 3, "#5b8994");
  }
  banner(context, x, y - unit * (height + 1), unit, seed, 10);
};

export const drawPixelWater = (context: PixelContext, options: SpriteBase & { phase: number }): void => {
  const unit = pixelScale(options.scale);
  const frame = Math.floor(options.phase * 3 + options.seed) % 3;
  const width = unit * (3 + options.seed % 4);
  const offset = (frame - 1) * unit;
  rect(context, options.x - width / 2 + offset, options.y, width, unit, "rgba(196, 236, 223, 0.52)");
  rect(context, options.x - width / 4 - offset, options.y + unit * 3, width * 0.75, unit, "rgba(83, 164, 174, 0.62)");
};

export const drawPixelGroundDetail = (context: PixelContext, options: SpriteBase & { kind: "grass" | "sand" | "snow" }): void => {
  const unit = pixelScale(options.scale);
  if (options.kind === "grass") {
    const color = options.seed % 3 === 0 ? "#f0c45b" : options.seed % 2 === 0 ? "#8fc463" : "#4f8f4e";
    rect(context, options.x - unit * 2, options.y - unit * 2, unit, unit * 3, color);
    rect(context, options.x, options.y - unit * 3, unit, unit * 4, color);
    rect(context, options.x + unit * 2, options.y - unit, unit, unit * 2, color);
    if (options.seed % 5 === 0) rect(context, options.x + unit, options.y - unit * 4, unit * 2, unit * 2, "#f4e7bd");
    return;
  }
  const color = options.kind === "snow" ? "#c9ddd4" : "#d9b56c";
  rect(context, options.x - unit * 2, options.y, unit * 2, unit, color);
  rect(context, options.x + unit, options.y - unit * 2, unit, unit, color);
};

export const drawPixelTree = (context: PixelContext, options: SpriteBase & { altitude: number; phase: number }): void => {
  const unit = pixelScale(options.scale);
  const sway = Math.round(Math.sin(options.phase * 1.8 + options.seed) * unit);
  const snowy = options.altitude > 0.72;
  shadow(context, options.x, options.y, unit * 13, unit);
  rect(context, options.x - unit, options.y - unit * 9, unit * 3, unit * 9, "#68452f");
  rect(context, options.x + unit, options.y - unit * 8, unit, unit * 7, "#9a6840");
  const dark = snowy ? "#557063" : "#38663f";
  const mid = snowy ? "#718b78" : "#4f8a4b";
  const light = snowy ? "#c3d5cb" : "#78a94e";
  rect(context, options.x - unit * 5 + sway, options.y - unit * 15, unit * 11, unit * 7, dark);
  rect(context, options.x - unit * 7 + sway, options.y - unit * 12, unit * 15, unit * 4, dark);
  rect(context, options.x - unit * 4 + sway, options.y - unit * 18, unit * 9, unit * 5, mid);
  rect(context, options.x - unit * 2 + sway, options.y - unit * 20, unit * 5, unit * 3, mid);
  rect(context, options.x - unit * 4 + sway, options.y - unit * 17, unit * 4, unit * 2, light);
  rect(context, options.x + unit * 2 + sway, options.y - unit * 14, unit * 3, unit * 2, light);
};

export const drawPixelRock = (context: PixelContext, options: SpriteBase & { altitude: number }): void => {
  const unit = pixelScale(options.scale);
  const base = options.altitude > 0.72 ? "#899596" : "#746f68";
  shadow(context, options.x, options.y, unit * 10, unit);
  rect(context, options.x - unit * 5, options.y - unit * 5, unit * 10, unit * 5, "#555652");
  rect(context, options.x - unit * 3, options.y - unit * 8, unit * 7, unit * 5, base);
  rect(context, options.x - unit, options.y - unit * 8, unit * 3, unit * 2, "#b4b5a7");
  rect(context, options.x + unit * 3, options.y - unit * 4, unit * 2, unit * 3, "#454b48");
};

export const drawPixelAgent = (context: PixelContext, options: SpriteBase & { phase: number }): void => {
  const unit = pixelScale(options.scale);
  const frame = Math.floor(options.phase * 4 + options.seed) % 4;
  const bob = frame % 2 === 0 ? 0 : unit;
  const shirt = clothes[options.seed % clothes.length] ?? clothes[0]!;
  const hairColor = hair[(options.seed >>> 4) % hair.length] ?? hair[0]!;
  shadow(context, options.x, options.y, unit * 8, unit);
  rect(context, options.x - unit * 2, options.y - unit * 15 + bob, unit * 5, unit * 5, "#d8a477");
  rect(context, options.x - unit * 2, options.y - unit * 16 + bob, unit * 5, unit * 2, hairColor);
  rect(context, options.x - unit * 3, options.y - unit * 11 + bob, unit * 7, unit * 7, shirt);
  rect(context, options.x - unit * 4, options.y - unit * 10 + bob, unit, unit * 5, "#d8a477");
  rect(context, options.x + unit * 4, options.y - unit * 10 + bob, unit, unit * 5, "#d8a477");
  const leftLeg = frame === 1 ? unit * 2 : 0;
  const rightLeg = frame === 3 ? unit * 2 : 0;
  rect(context, options.x - unit * 2, options.y - unit * 4 + bob, unit * 2, unit * 4 + leftLeg, "#344956");
  rect(context, options.x + unit, options.y - unit * 4 + bob, unit * 2, unit * 4 + rightLeg, "#344956");
  rect(context, options.x - unit * 2, options.y - unit + bob + leftLeg, unit * 3, unit, "#49372e");
  rect(context, options.x + unit, options.y - unit + bob + rightLeg, unit * 3, unit, "#49372e");
};

export const drawPixelCamp = (context: PixelContext, options: SpriteBase & { phase: number }): void => {
  const unit = pixelScale(options.scale);
  shadow(context, options.x, options.y, unit * 22, unit);
  const tentColor = options.seed % 2 === 0 ? "#c98a55" : "#b79562";
  for (let row = 0; row < 8; row += 1) {
    const width = unit * (2 + row * 2);
    rect(context, options.x - unit * 5 - width / 2, options.y - unit * 9 + row * unit, width, unit + 1, tentColor);
  }
  rect(context, options.x - unit * 5, options.y - unit * 5, unit, unit * 5, "#6c4933");
  rect(context, options.x + unit * 5, options.y - unit * 2, unit * 5, unit * 2, "#674b34");
  const flame = Math.floor(options.phase * 6 + options.seed) % 2;
  rect(context, options.x + unit * 7, options.y - unit * (5 + flame), unit * 3, unit * (4 + flame), "#e45d3f");
  rect(context, options.x + unit * 8, options.y - unit * (4 + flame), unit, unit * 3, "#ffd65c");
};

export const drawPixelOrganization = (context: PixelContext, options: SpriteBase & { kind: OrganizationType; count: number }): void => {
  const unit = pixelScale(options.scale);
  switch (options.kind) {
    case "family":
      cottage(context, options.x, options.y, unit, options.seed);
      return;
    case "clan":
      cottage(context, options.x, options.y, unit, options.seed, 2);
      banner(context, options.x + unit * 8, options.y - unit * 4, unit, options.seed, 10);
      return;
    case "tribe":
      drawPixelCamp(context, { ...options, x: options.x - unit * 5, scale: unit, phase: 0 });
      drawPixelCamp(context, { ...options, x: options.x + unit * 8, y: options.y + unit * 2, scale: unit, phase: 1 });
      banner(context, options.x, options.y - unit * 4, unit, options.seed, 15);
      return;
    case "settlement":
      cottage(context, options.x - unit * 8, options.y, unit, options.seed);
      cottage(context, options.x + unit * 9, options.y + unit * 3, unit, options.seed + 1);
      banner(context, options.x, options.y - unit * 5, unit, options.seed, 12);
      return;
    case "city":
      cottage(context, options.x - unit * 12, options.y + unit * 3, unit, options.seed, 1);
      tower(context, options.x + unit * 6, options.y, unit, options.seed, 17);
      return;
    case "state":
      tower(context, options.x, options.y, unit, options.seed, 21);
      cottage(context, options.x - unit * 14, options.y + unit * 4, unit, options.seed + 2);
      cottage(context, options.x + unit * 15, options.y + unit * 4, unit, options.seed + 3);
      return;
    case "federation":
      tower(context, options.x - unit * 8, options.y + unit * 2, unit, options.seed, 21);
      tower(context, options.x + unit * 9, options.y + unit * 2, unit, options.seed + 1, 21);
      banner(context, options.x, options.y - unit * 20, unit, options.seed, 18);
      return;
    case "empire":
      tower(context, options.x, options.y, unit * 1.2, options.seed, 26);
      tower(context, options.x - unit * 15, options.y + unit * 5, unit, options.seed + 1, 19);
      tower(context, options.x + unit * 15, options.y + unit * 5, unit, options.seed + 2, 19);
  }
};

export const organizationLabel: Record<OrganizationType, string> = {
  family: "\u5bb6\u5ead",
  clan: "\u6c0f\u65cf",
  tribe: "\u90e8\u843d",
  settlement: "\u805a\u843d",
  city: "\u57ce\u5e02",
  state: "\u56fd\u5bb6",
  federation: "\u8054\u76df",
  empire: "\u5e1d\u56fd",
};

export const drawPixelLabel = (context: PixelContext, options: { x: number; y: number; scale: number; label: string; count: number; seed: number }): void => {
  const unit = pixelScale(options.scale);
  const fontSize = Math.max(10, unit * 5);
  const text = `${options.label}  ${options.count.toLocaleString("zh-CN")}`;
  context.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
  context.textBaseline = "middle";
  const width = Math.ceil(context.measureText(text).width) + unit * 6;
  const height = fontSize + unit * 4;
  rect(context, options.x - width / 2 + unit, options.y - height / 2 + unit, width, height, "rgba(25, 34, 25, 0.42)");
  rect(context, options.x - width / 2, options.y - height / 2, width, height, "rgba(251, 239, 193, 0.94)");
  rect(context, options.x - width / 2, options.y - height / 2, unit * 2, height, flags[options.seed % flags.length] ?? flags[0]!);
  context.fillStyle = "#29362a";
  context.fillText(text, at(options.x - width / 2 + unit * 4), at(options.y));
};
