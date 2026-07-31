/**
 * Render the rich menu image from scripts/richmenu-layout.mjs.
 *
 * Uses the sharp that Next.js already pulls in, so there is no extra
 * dependency. The output is committed, which means the menu artwork is
 * reviewable in a diff and reproducible without any design tool.
 *
 * Usage: npm run richmenu:image
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { buildSvg, WIDTH, HEIGHT } from './richmenu-layout.mjs';

// LINE rejects rich menu images over 1 MB.
const MAX_BYTES = 1024 * 1024;

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'richmenu.png',
);

const png = await sharp(Buffer.from(buildSvg()))
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

const meta = await sharp(png).metadata();
if (meta.width !== WIDTH || meta.height !== HEIGHT) {
  throw new Error(`rendered ${meta.width}x${meta.height}, expected ${WIDTH}x${HEIGHT}`);
}
if (png.byteLength > MAX_BYTES) {
  throw new Error(`image is ${(png.byteLength / 1024).toFixed(0)} KB, over LINE's 1 MB limit`);
}

await writeFile(OUT, png);
console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${meta.width}x${meta.height}, ${(png.byteLength / 1024).toFixed(0)} KB`);
