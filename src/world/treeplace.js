import { rng, DEG } from './geom.js';
import { RING, HALL, PERIMETER_PATH, pavingDistance, insideRingArc } from './layout.js';

/** Proportions of the tree model (tools/build_tree.py), in model units. */
export const TREE_MODEL = { height: 4.54, canopyCenter: [0.267, 3.08, 0.743], canopyRadius: [1.2, 1.37, 2.0] };

/**
 * Deterministic tree positions: loosely scattered over the lawns, clear of paving and buildings.
 * Returned in a fixed order so the lighting bake and the renderer agree.
 */
export function placeTrees() {
  const rand = rng(4242);
  const trees = [];
  const ok = (x, z, minGap) => {
    if (pavingDistance(x, z) < 3.2) return false;
    if (Math.hypot(x - HALL.x, z - HALL.z) < HALL.rPlaza + 5) return false;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < minGap) return false;
    return true;
  };
  const add = (x, z) => {
    const scale = 2.0 + rand() * 0.75;
    trees.push({ x, z, scale, sy: 0.92 + rand() * 0.2, rot: rand() * Math.PI * 2, tint: rand() });
  };
  // a loose row following the promenade, like the planted camphors on site
  for (let th = 2 * DEG; th < 360 * DEG; th += (7.5 + rand() * 3) * DEG) {
    const r = RING.rPromenade - 6 - rand() * 5;
    const x = r * Math.sin(th), z = -r * Math.cos(th);
    if (ok(x, z, 9)) add(x, z);
  }
  // scattered specimens on the lawns
  for (let i = 0; i < 2600 && trees.length < 96; i++) {
    const r = Math.sqrt(rand()) * (RING.rPromenade - 5), th = rand() * Math.PI * 2;
    const x = r * Math.sin(th), z = -r * Math.cos(th);
    if (ok(x, z, 13.5)) add(x, z);
  }
  // beyond the perimeter path on the open northern side
  for (let i = 0; i < 900 && trees.length < 128; i++) {
    const r = RING.rPromenade + PERIMETER_PATH + 5 + rand() * 62, th = rand() * Math.PI * 2;
    const x = r * Math.sin(th), z = -r * Math.cos(th);
    if (insideRingArc(x, z)) continue;
    if (ok(x, z, 12)) add(x, z);
  }
  return trees;
}

/** Canopy ellipsoids (world space) used as soft sky occluders by the lighting bake. */
export function canopyBlockers(trees) {
  return trees.map((t) => {
    const c = Math.cos(t.rot), s = Math.sin(t.rot);
    const [cx, cy, cz] = TREE_MODEL.canopyCenter, [rx, ry, rz] = TREE_MODEL.canopyRadius;
    // rotate the model-space canopy centre about Y (three.js rotation.y convention)
    const wx = (cx * c + cz * s) * t.scale, wz = (-cx * s + cz * c) * t.scale;
    return { x: t.x + wx, y: cy * t.scale * t.sy, z: t.z + wz, rx: Math.max(rx, rz) * t.scale * 0.92, ry: ry * t.scale * t.sy };
  });
}
