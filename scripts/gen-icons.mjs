import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'favicon.svg'));

// Maskable: full-bleed background, logo kept inside the safe zone.
const maskable = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="80%">
      <stop offset="0%" stop-color="#1a0a3a"/>
      <stop offset="100%" stop-color="#05010f"/>
    </radialGradient>
    <linearGradient id="z" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#12f7ff"/>
      <stop offset="100%" stop-color="#ff2bd6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(0.72) translate(-256 -256)">
    <rect x="150" y="300" width="70" height="70" rx="9" fill="#8a5bff"/>
    <rect x="224" y="300" width="70" height="70" rx="9" fill="#12f7ff"/>
    <rect x="298" y="300" width="70" height="70" rx="9" fill="#ff2bd6"/>
    <text x="256" y="250" font-family="Arial Black, Arial, sans-serif" font-weight="900"
          font-size="300" text-anchor="middle" fill="url(#z)">Z</text>
  </g>
</svg>`);

async function gen(input, size, out) {
  await sharp(input, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(root, 'public', out));
  console.log('wrote', out);
}

await gen(svg, 192, 'icon-192.png');
await gen(svg, 512, 'icon-512.png');
await gen(maskable, 512, 'icon-512-maskable.png');
