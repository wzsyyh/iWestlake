// Offline lighting bake:  node tools/bake.mjs [--rays 96] [--bounces 4] [--sky sky_late_afternoon]
// Builds the static level exactly as the game does, solves sky + multi-bounce sun lighting per
// vertex, and writes public/assets/bake.bin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { analyseSky } from '../src/engine/sky.js';
import { buildStatic } from '../src/world/static.js';
import { stubMaterials } from '../src/world/albedo.js';
import { canopyBlockers } from '../src/world/treeplace.js';
import { bakeLighting, encodeBake } from '../src/world/bake.js';
import { SUN_AZIMUTH, SKY, SUN_BOOST, SUN_TINT } from '../src/world/layout.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; };
const rays = +arg('rays', 96), bounces = +arg('bounces', 4), skyName = arg('sky', SKY);

const hdr = fs.readFileSync(path.join(root, 'public/assets/sky', skyName + '.hdr'));
const image = new RGBELoader().setDataType(THREE.HalfFloatType).parse(hdr.buffer.slice(hdr.byteOffset, hdr.byteOffset + hdr.byteLength));
const sky = analyseSky(image, { sunAzimuth: SUN_AZIMUTH, sunBoost: SUN_BOOST, sunTint: SUN_TINT });
console.log(`sky ${skyName}: sun elevation ${(sky.sunElevation * 180 / Math.PI).toFixed(1)} deg, E_sun ${sky.sunIrradiance.toArray().map((v) => v.toFixed(2))}, E_sky ${sky.skyIrradiance.toArray().map((v) => v.toFixed(2))}`);

const t0 = Date.now();
const world = buildStatic(stubMaterials());
const nVerts = world.statics.reduce((s, m) => s + m.geometry.attributes.position.count, 0);
console.log(`level: ${world.statics.length} static meshes, ${nVerts} vertices, ${world.trees.length} trees`);

let last = 0;
const results = bakeLighting(world.statics, {
  sunDir: sky.sunDir, sunE: sky.sunIrradiance.toArray(), skyE: sky.skyIrradiance.toArray(), groundRad: sky.bounce, sample: sky.sample,
}, {
  rays, bounces, blockers: canopyBlockers(world.trees),
  onProgress: (p) => { if (p - last > 0.1) { last = p; process.stdout.write(` ${(p * 100).toFixed(0)}%`); } },
});
const buf = encodeBake(world.statics, results, { rays, bounces, sky: skyName });
const out = path.join(root, 'public/assets/bake.bin');
fs.writeFileSync(out, Buffer.from(buf));
console.log(`\nwrote ${out} (${(buf.byteLength / 1e6).toFixed(2)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
