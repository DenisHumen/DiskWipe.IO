// Rasterizes assets/logo.svg into a 1024×1024 PNG used as the source for
// `tauri icon`. Run with: node scripts/gen-logo.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const svg = readFileSync(resolve(root, "assets/logo.svg"));

await sharp(svg, { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile(resolve(root, "assets/logo-1024.png"));

console.log("Wrote assets/logo-1024.png");
