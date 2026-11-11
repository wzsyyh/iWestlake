import * as THREE from 'three';
import { Geo, DEG } from './geom.js';
import { RING, HALL, NODE, PATHS, PERIMETER_PATH } from './layout.js';

/** Extent of the lawn grid / coverage mask (metres from the ring centre). */
export const LAWN_HALF = 232;

/** Up-facing ribbon along a sampled path between two lateral offsets (positive = right of travel). */
function ribbon(geo, pts, a, b, { cellAcross = 1, cellAlong = 1, y = 0, maxSeg = 1.5 } = {}) {
  const nj = Math.max(1, Math.ceil(Math.abs(b - a) / maxSeg));
  const base = geo.count;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], rx = -p.tz, rz = p.tx;
    for (let j = 0; j <= nj; j++) {
      const lat = a + (b - a) * (j / nj);
      geo.vert(p.x + rx * lat, y, p.z + rz * lat, 0, 1, 0, lat, p.s, lat / cellAcross, p.s / cellAlong);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < nj; j++) {
      const v0 = base + i * (nj + 1) + j, v1 = v0 + 1, v2 = v0 + nj + 2, v3 = v0 + nj + 1;
      geo.idx.push(v0, v1, v2, v0, v2, v3);
    }
  }
}

/** Ground geometry only (pure: also runs in the offline lighting baker). */
export function buildGround(M) {
  const group = new THREE.Group();
  group.name = 'ground';
  const add = (geo, mat, name, surface, opts = {}) => {
    const m = new THREE.Mesh(geo.build(), mat);
    m.name = name; m.receiveShadow = true; m.castShadow = false;
    m.userData.static = true; m.userData.collide = opts.collide ?? false; m.userData.surface = surface;
    group.add(m);
    return m;
  };
  const TAU = Math.PI * 2;

  // ---- promenade under the ring, and its continuation as a perimeter path across the open arc
  const prom = new Geo();
  prom.arcSweep([[RING.rPromenade, 0], [RING.rGlass + 0.3, 0]], { th0: RING.th0 - 0.4 * DEG, th1: RING.th1 + 0.4 * DEG, segs: RING.panes, rRef: 147, cells: { arc: 1.2, prof: 0.6 }, maxEdge: 1.6 });
  const openSegs = Math.round((TAU - (RING.th1 - RING.th0)) * 142 / 1.8);
  prom.arcSweep([[RING.rPromenade, 0], [RING.rPromenade + PERIMETER_PATH, 0]], { th0: RING.th1, th1: RING.th0 + TAU, segs: openSegs, rRef: 147, cells: { arc: 1.2, prof: 0.6 }, maxEdge: 1.6 });
  add(prom, M.paving, 'ground.promenade', 'stone');

  // ---- kerbs
  const kerb = new Geo();
  kerb.arcSweep([[RING.rPromenade - 0.14, 0], [RING.rPromenade, 0]], { th0: 0, th1: TAU, segs: 480, rRef: 139, cells: { arc: 1, prof: 1 }, maxEdge: 2 });
  kerb.arcSweep([[RING.rPromenade + PERIMETER_PATH, 0], [RING.rPromenade + PERIMETER_PATH + 0.14, 0]], { th0: RING.th1, th1: RING.th0 + TAU, segs: openSegs, rRef: 146, cells: { arc: 1, prof: 1 }, maxEdge: 2 });
  kerb.arcSweep([[HALL.rPlaza, 0], [HALL.rPlaza + 0.14, 0]], { cx: HALL.x, cz: HALL.z, th0: 0, th1: TAU, segs: 256, rRef: 60, cells: { arc: 1, prof: 1 }, maxEdge: 2 });
  kerb.arcSweep([[NODE.r, 0], [NODE.r + 0.14, 0]], { cx: NODE.x, cz: NODE.z, th0: 0, th1: TAU, segs: 48, rRef: NODE.r, cells: { arc: 1, prof: 1 }, maxEdge: 2 });

  // ---- vein paths + node
  const paths = new Geo();
  for (const p of PATHS) {
    ribbon(paths, p.pts, -p.w / 2, p.w / 2, { cellAcross: 0.9, cellAlong: 0.45 });
    ribbon(kerb, p.pts, -p.w / 2 - 0.14, -p.w / 2, { cellAcross: 1, cellAlong: 1 });
    ribbon(kerb, p.pts, p.w / 2, p.w / 2 + 0.14, { cellAcross: 1, cellAlong: 1 });
  }
  add(paths, M.pavingPath, 'ground.paths', 'stone');
  const node = new Geo();
  node.arcSweep([[0.01, 0], [NODE.r, 0]], { cx: NODE.x, cz: NODE.z, th0: 0, th1: TAU, segs: 48, rRef: NODE.r * 0.6, cells: { arc: 0.9, prof: 0.6 }, maxEdge: 1.5 });
  add(node, M.plaza, 'ground.node', 'stone');
  add(kerb, M.kerb, 'ground.kerbs', 'stone');

  // ---- lawn
  const lawn = new Geo();
  const step = 3, n = Math.floor(LAWN_HALF / step), yLawn = -0.04;
  const index = new Map();
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const x = i * step, z = j * step;
      if (Math.hypot(x, z) > LAWN_HALF + step) continue;
      index.set(j * 4096 + i, lawn.vert(x, yLawn, z, 0, 1, 0, x, z));
    }
  }
  for (let j = -n; j < n; j++) {
    for (let i = -n; i < n; i++) {
      const a = index.get(j * 4096 + i), b = index.get(j * 4096 + i + 1), c = index.get((j + 1) * 4096 + i + 1), d = index.get((j + 1) * 4096 + i);
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      // skip quads that are entirely under the ring building
      const r = Math.hypot((i + 0.5) * step, (j + 0.5) * step);
      if (r > RING.rGlass + 4 && r < RING.rOuter + 60) {
        let th = Math.atan2((i + 0.5) * step, -(j + 0.5) * step); if (th < 0) th += TAU;
        if (th > RING.th0 && th < RING.th1) continue;
      }
      lawn.idx.push(a, d, c, a, c, b);
    }
  }
  const lawnMesh = add(lawn, M.lawn, 'ground.lawn', 'grass');

  // ---- the land beyond the site (out to the haze) and the service yard beneath the ring; not baked
  const far = new THREE.Mesh(new THREE.RingGeometry(LAWN_HALF - 6, 2600, 96, 6).rotateX(-Math.PI / 2), M.farGround);
  far.position.y = -0.3;
  far.name = 'ground.far';
  group.add(far);
  const under = new THREE.Mesh(new THREE.RingGeometry(RING.rGlass, LAWN_HALF + 20, 128, 2).rotateX(-Math.PI / 2), M.underGround);
  under.position.y = -0.12;
  under.name = 'ground.under';
  group.add(under);

  return { group, lawnMesh };
}
