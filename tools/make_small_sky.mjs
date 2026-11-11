// Writes a half-resolution copy of the sky panorama for the single-file build
// (assets_single/sky/<name>.hdr): box-filtered in linear light, re-encoded as RLE Radiance RGBE.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SKY } from '../src/world/layout.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'public/assets/sky', SKY + '.hdr'));
const img = new RGBELoader().setDataType(THREE.FloatType).parse(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
const W = img.width / 2, H = img.height / 2, d = img.data;       // RGBA float32
const rgbe = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = ((y * 2 + dy) * img.width + x * 2 + dx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r /= 4; g /= 4; b /= 4;
    const m = Math.max(r, g, b), o = (y * W + x) * 4;
    if (m < 1e-32) continue;
    const e = Math.ceil(Math.log2(m) + 1e-9), s = 256 / 2 ** e;       // m < 2^e
    rgbe[o] = Math.min(255, r * s); rgbe[o + 1] = Math.min(255, g * s); rgbe[o + 2] = Math.min(255, b * s); rgbe[o + 3] = e + 128;
  }
}
// "new" RLE: every scanline stores its four channels separately
const out = [];
const line = new Uint8Array(W);
for (let y = 0; y < H; y++) {
  out.push(2, 2, W >> 8, W & 255);
  for (let c = 0; c < 4; c++) {
    for (let x = 0; x < W; x++) line[x] = rgbe[(y * W + x) * 4 + c];
    let i = 0;
    while (i < W) {
      let run = 1;
      while (i + run < W && run < 127 && line[i + run] === line[i]) run++;
      if (run >= 4) { out.push(128 + run, line[i]); i += run; continue; }
      // literal span until the next long run
      let j = i, n = 0;
      while (j < W && n < 128) {
        let r2 = 1;
        while (j + r2 < W && r2 < 4 && line[j + r2] === line[j]) r2++;
        if (r2 >= 4) break;
        j++; n++;
      }
      out.push(n);
      for (let k = 0; k < n; k++) out.push(line[i + k]);
      i += n;
    }
  }
}
const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii');
const dst = path.join(root, 'assets_single/sky', SKY + '.hdr');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, Buffer.concat([header, Buffer.from(out)]));
// round-trip check
const back = new RGBELoader().setDataType(THREE.FloatType).parse(new Uint8Array(fs.readFileSync(dst)).buffer);
let maxIn = 0, maxOut = 0;
for (let i = 0; i < d.length; i += 4) maxIn = Math.max(maxIn, d[i]);
for (let i = 0; i < back.data.length; i += 4) maxOut = Math.max(maxOut, back.data[i]);
console.log(`${dst}: ${back.width}x${back.height}, ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB (peak ${maxIn.toFixed(0)} -> ${maxOut.toFixed(0)})`);
