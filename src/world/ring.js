import * as THREE from 'three';
import { Geo, polar, rng } from './geom.js';
import { RING } from './layout.js';

/**
 * Curtain-wall strip made of individual flat panes. Every pane gets a slightly different tilt and a
 * faint pillow bulge in its normals, which is what makes real glazing break reflections up per pane.
 * (rA,yA) -> (rB,yB) follows the same "surface faces left" rule as Geo.arcSweep.
 */
export function paneStrip(geo, { cx = 0, cz = 0, th0, dTheta, count, rA, yA, rB, yB, rand, inset = 0.03, tilt = 0.011 }) {
  const t = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), tmp = new THREE.Vector3();
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const rMid = (rA + rB) / 2;
  const dIn = inset / rMid;                         // leave room for the mullion
  const prof = Math.hypot(rB - rA, yB - yA);
  for (let i = 0; i < count; i++) {
    const a0 = th0 + dTheta * i + dIn, a1 = th0 + dTheta * (i + 1) - dIn;
    polar(rA, a0, yA, cx, cz, P[0]); polar(rA, a1, yA, cx, cz, P[1]);
    polar(rB, a1, yB, cx, cz, P[2]); polar(rB, a0, yB, cx, cz, P[3]);
    t.subVectors(P[1], P[0]).normalize();
    d.subVectors(P[3], P[0]).normalize();
    n.crossVectors(t, d).normalize();
    n.addScaledVector(t, (rand() - 0.5) * 2 * tilt).addScaledVector(d, (rand() - 0.5) * 2 * tilt).normalize();
    const bulge = (rand() - 0.35) * 0.012;
    const base = geo.count;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      tmp.copy(n).addScaledVector(t, corners[k][0] * bulge).addScaledVector(d, corners[k][1] * bulge).normalize();
      geo.vert(P[k].x, P[k].y, P[k].z, tmp.x, tmp.y, tmp.z, i + (corners[k][0] > 0 ? 1 : 0), corners[k][1] > 0 ? prof : 0, rand(), rand());
    }
    geo.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// Cross-section of the ring's courtyard face, bottom to top, as [material, points(r, y)].
// Three glazed tiers step back above the canopy; a white eave caps each tier.
const R = RING.rGlass;
export const RING_SECTION = [
  ['soffit', [[R, 6.2], [146.0, 7.2]]],
  ['cladding', [[146.0, 7.2], [145.94, 7.36], [146.0, 7.5], [150.4, 8.5]]],
  ['glassTier', [[150.4, 8.5], [151.6, 12.1]]],
  ['cladding', [[151.6, 12.1], [150.9, 12.3], [150.9, 13.1], [153.3, 13.7]]],
  ['glassTier', [[153.3, 13.7], [154.5, 17.3]]],
  ['cladding', [[154.5, 17.3], [153.8, 17.5], [153.8, 18.3], [156.2, 18.9]]],
  ['glassTier', [[156.2, 18.9], [157.4, 22.5]]],
  ['cladding', [[157.4, 22.5], [156.7, 22.7], [156.7, RING.hTop], [157.6, RING.hTop]]],
  ['roof', [[157.6, RING.hTop], [RING.rOuter, RING.hTop]]],
  ['backdrop', [[RING.rOuter, RING.hTop], [RING.rOuter, 0]]],
];

export function buildRing(M) {
  const rand = rng(1001);
  const { th0, th1, panes, dTheta } = RING;
  const geos = { soffit: new Geo(), cladding: new Geo(), roof: new Geo(), backdrop: new Geo(), glass: new Geo(), mullion: new Geo(), column: new Geo() };
  const sweep = { th0, th1, segs: panes, maxEdge: 1.5 };

  for (const [mat, pts] of RING_SECTION) {
    if (mat === 'glassTier') {
      const [[rA, yA], [rB, yB]] = pts;
      paneStrip(geos.glass, { th0, dTheta, count: panes, rA, yA, rB, yB, rand, inset: 0.04, tilt: 0.008 });
      // slim cap rails so the tiers read as framed glazing
      geos.mullion.arcSweep([[rA - 0.05, yA], [rA - 0.05, yA + 0.12]], { ...sweep, maxEdge: 9 });
      continue;
    }
    const cells = mat === 'soffit' ? { arc: 1.8, prof: 2.265, snap: true } : mat === 'cladding' ? { arc: 1.8, prof: 2.6, snap: true } : null;
    geos[mat].arcSweep(pts, { ...sweep, rRef: R, cells, maxEdge: mat === 'roof' || mat === 'backdrop' ? 6 : 1.5 });
  }

  // ---- ground floor: curtain wall, transom, mullions, piers
  const yBase = 0.14, yTransom = 2.9, yHead = RING.hGround;
  paneStrip(geos.glass, { th0, dTheta, count: panes, rA: R, yA: yBase, rB: R, yB: yTransom - 0.04, rand, tilt: 0.007 });
  paneStrip(geos.glass, { th0, dTheta, count: panes, rA: R, yA: yTransom + 0.04, rB: R, yB: yHead, rand, tilt: 0.011 });
  geos.mullion.arcSweep([[R, yTransom - 0.04], [R - 0.11, yTransom - 0.04], [R - 0.11, yTransom + 0.04], [R, yTransom + 0.04]], { ...sweep, maxEdge: 9 });
  geos.mullion.arcSweep([[R - 0.08, 0], [R - 0.08, yBase], [R, yBase]], { ...sweep, maxEdge: 9 });
  const c = new THREE.Vector3();
  for (let i = 0; i <= panes; i++) {
    const th = th0 + dTheta * i;
    const pier = i % 6 === 0;
    if (pier) {
      polar(R - 0.42, th, yHead / 2 + 0.06, 0, 0, c);
      geos.column.box(c, 0.46, yHead / 2 + 0.06, 0.4, { yaw: Math.PI - th, skip: '-y+y', maxSeg: 1.6, cellSize: [1.806, 3.4] });
    } else {
      polar(R - 0.085, th, (yHead + yBase) / 2, 0, 0, c);
      geos.mullion.box(c, 0.03, (yHead - yBase) / 2, 0.085, { yaw: Math.PI - th, skip: '-y+y+z', maxSeg: 3.2 });
    }
  }

  // ---- end walls close the two cut ends of the ring
  const outline = [[R, 0], ...RING_SECTION.flatMap(([, pts]) => pts)];
  const dedup = outline.filter((p, i) => i === 0 || p[0] !== outline[i - 1][0] || p[1] !== outline[i - 1][1]);
  const shape = dedup.map(([r, y]) => new THREE.Vector2(r, y));
  const tris = THREE.ShapeUtils.triangulateShape(shape, []);
  for (const [th, sign] of [[th0, -1], [th1, 1]]) {
    const g = geos.cladding, base = g.count;
    const nx = Math.cos(th) * sign, nz = Math.sin(th) * sign;
    for (const [r, y] of dedup) {
      const p = polar(r, th, y);
      g.vert(p.x, p.y, p.z, nx, 0, nz, r, y, r / 1.8, y / 2.6);
    }
    for (const [a, b, cc] of tris) {
      if (sign > 0) g.idx.push(base + a, base + cc, base + b); else g.idx.push(base + a, base + b, base + cc);
    }
  }

  const group = new THREE.Group();
  group.name = 'ring';
  const add = (geo, mat, name, opts = {}) => {
    if (!geo.count) return;
    const m = new THREE.Mesh(geo.build(), mat);
    m.name = name; m.castShadow = opts.cast ?? true; m.receiveShadow = true;
    m.userData.static = true;
    m.userData.collide = opts.collide ?? true;
    m.userData.surface = opts.surface ?? 'stone';
    group.add(m);
  };
  add(geos.soffit, M.soffit, 'ring.soffit');
  add(geos.cladding, M.cladding, 'ring.cladding');
  add(geos.roof, M.roof, 'ring.roof', { collide: false });
  add(geos.backdrop, M.backdrop, 'ring.outer', { collide: false });
  add(geos.glass, M.glass, 'ring.glass', { surface: 'glass' });
  add(geos.mullion, M.mullion, 'ring.mullions', { collide: false, surface: 'metal' });
  add(geos.column, M.column, 'ring.piers');
  return group;
}
