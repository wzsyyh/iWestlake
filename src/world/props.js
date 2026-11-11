import * as THREE from 'three';
import { Geo, DEG, polar, rng } from './geom.js';
import { RING, HALL, PATHS, ZONE, PERIMETER_PATH, pavingDistance, insideRingArc } from './layout.js';

/**
 * Site furniture (pure geometry, part of the baked static level): lamp posts, path bollards,
 * granite block benches and tree pits.
 */
export function buildProps(M, trees) {
  const rand = rng(777);
  const TAU = Math.PI * 2;
  const lamps = new Geo(), bollards = new Geo(), benches = new Geo(), pits = new Geo();
  const colliders = [];      // { x, z, r, h } cylinders for the thin things
  const boxes = [];          // { x, z, hx, hz, yaw, top } footprints of the benches

  const lamp = (x, z) => {
    lamps.arcSweep([[0.002, 4.82], [0.2, 4.8], [0.062, 4.34], [0.055, 0.22], [0.11, 0.2], [0.11, 0]], { cx: x, cz: z, th0: 0, th1: TAU, segs: 10, maxEdge: 9 });
    colliders.push({ x, z, r: 0.09, h: 4.8 });
  };
  // along the promenade kerb
  for (let th = 3 * DEG; th < 360 * DEG; th += 8.6 * DEG) {
    const p = polar(RING.rPromenade + 1.1, th);
    lamp(p.x, p.z);
  }
  // around the Hall plaza
  for (let i = 0; i < 16; i++) {
    const p = polar(HALL.rPlaza - 1.0, (i + 0.5) / 16 * TAU, 0, HALL.x, HALL.z);
    lamp(p.x, p.z);
  }

  // low bollard lights alternate along the vein paths; a bench every so often
  const c = new THREE.Vector3();
  PATHS.forEach((path, pi) => {
    let next = 9, side = pi % 2 ? 1 : -1, nextBench = 24 + rand() * 14;
    for (const q of path.pts) {
      if (q.s >= next) {
        next += 9;
        side = -side;
        const off = (path.w / 2 + 0.45) * side;
        const x = q.x - q.tz * off, z = q.z + q.tx * off;
        if (pavingDistance(x, z) > 0.25) bollards.arcSweep([[0.002, 0.46], [0.05, 0.46], [0.05, 0.4], [0.042, 0.4], [0.042, 0.33], [0.05, 0.33], [0.05, 0]], { cx: x, cz: z, th0: 0, th1: TAU, segs: 8, maxEdge: 9 });
      }
      if (q.s >= nextBench) {
        nextBench += 38 + rand() * 20;
        const off = (path.w / 2 + 1.1) * (rand() < 0.5 ? 1 : -1);
        const x = q.x - q.tz * off, z = q.z + q.tx * off;
        if (pavingDistance(x, z) > 0.9 && Math.hypot(x, z) < RING.rPromenade - 6) {
          const yaw = Math.atan2(-q.tz, q.tx);
          benches.box(c.set(x, 0.2, z), 1.15, 0.24, 0.26, { yaw, maxSeg: 0.9, skip: '-y', cellSize: [50, 50] });
          boxes.push({ x, z, hx: 1.15, hz: 0.26, yaw, top: 0.44 });
        }
      }
    }
  });

  // mulched pits at the foot of every tree
  for (const t of trees) {
    const r = 0.62 * t.scale / 2.3;
    pits.arcSweep([[0.02, -0.032], [r + 0.06, -0.032]], { cx: t.x, cz: t.z, th0: 0, th1: TAU, segs: 12, maxEdge: 9 });
    colliders.push({ x: t.x, z: t.z, r: 0.13 * t.scale, h: 3.2 * t.scale });
  }

  const group = new THREE.Group();
  group.name = 'props';
  const add = (geo, mat, name, opts = {}) => {
    const m = new THREE.Mesh(geo.build(), mat);
    m.name = name; m.castShadow = opts.cast ?? true; m.receiveShadow = true;
    m.userData.static = true; m.userData.collide = opts.collide ?? false; m.userData.surface = opts.surface ?? 'metal';
    group.add(m);
  };
  add(lamps, M.darkMetal, 'props.lamps');
  add(bollards, M.darkMetal, 'props.bollards');
  add(benches, M.bench, 'props.benches', { collide: true, surface: 'stone' });
  add(pits, M.soil, 'props.pits', { cast: false, surface: 'grass' });
  return { group, colliders, boxes };
}
