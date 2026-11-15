import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'public', 'icons');

const targets = [
  { source: 'favicon.svg', name: 'icon-180.png', size: 180 },
  { source: 'favicon.svg', name: 'icon-192.png', size: 192 },
  { source: 'favicon.svg', name: 'icon-512.png', size: 512 },
  { source: 'maskable.svg', name: 'icon-maskable-512.png', size: 512 },
];

await mkdir(iconsDir, { recursive: true });

for (const target of targets) {
  const input = path.join(iconsDir, target.source);
  const output = path.join(iconsDir, target.name);
  await sharp(input, { density: 512 })
    .resize(target.size, target.size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(`[icons] ${target.name} (${target.size}×${target.size})`);
}
