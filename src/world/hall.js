import * as THREE from 'three';
import { Geo, polar, rng } from './geom.js';
import { HALL } from './layout.js';
import { paneStrip } from './ring.js';

/**
 * The Academic Hall: a glazed drum ringed by 64 monumental white columns that carry a flat roof
 * disc, with a bamboo-lined soffit over a polished-stone gallery. A ribbed upper drum (the
 * auditorium's fly space) rises through the roof.
 */
export function buildHall(M) {
  const rand = rng(2002);
  const H = HALL, cx = H.x, cz = H.z;
  const TAU = Math.PI * 2;
  const g = { floor: new Geo(), steps: new Geo(), wood: new Geo(), cladding: new Geo(), column: new Geo(), glass: new Geo(), mullion: new Geo(), plaza: new Geo() };
  const circle = { cx, cz, th0: 0, th1: TAU, segs: 256 };

  // roof disc: top, fascia, underside chamfer (profile runs top -> bottom so faces point outward)
  g.cladding.arcSweep([[H.rDrum, H.hRoof + 0.35], [H.rRoof, H.hRoof], [H.rRoof, H.hSoffitOut + 0.55], [H.rSoffit, H.hSoffitOut]],
    { ...circle, rRef: H.rRoof, cells: { arc: 1.8, prof: 2.6, snap: true }, maxEdge: 2.2 });
  // bamboo soffit over the gallery
  g.wood.arcSweep([[H.rSoffit, H.hSoffitOut], [H.rGlass, H.hSoffitIn]], { ...circle, rRef: 44, cells: { arc: 0.6, prof: 0.15 }, maxEdge: 1.3 });
  // polished gallery floor on the plinth, then three steps down to the plaza
  g.floor.arcSweep([[H.rGlass, H.plinth], [H.rPlinth, H.plinth]], { ...circle, rRef: 45, cells: { arc: 1.2, prof: 1.2 }, maxEdge: 1.3 });
  g.steps.arcSweep([[H.rPlinth, H.plinth], [H.rPlinth, 0.30], [H.rPlinth + 0.4, 0.30], [H.rPlinth + 0.4, 0.15], [H.rPlinth + 0.8, 0.15], [H.rPlinth + 0.8, -0.02]],
    { ...circle, rRef: H.rPlinth, cells: { arc: 1.5, prof: 0.45 }, maxEdge: 1.3 });
  // granite plaza ring around the Hall
  g.plaza.arcSweep([[H.rPlinth + 0.75, 0], [H.rPlaza, 0]], { ...circle, rRef: 56, cells: { arc: 0.9, prof: 0.6 }, maxEdge: 1.5 });

  // glazed drum in four tiers
  const nPanes = 180, dTheta = TAU / nPanes;
  const tiers = [H.plinth + 0.1, 3.7, 6.9, 10.1, H.hSoffitIn];
  for (let i = 0; i < tiers.length - 1; i++) {
    paneStrip(g.glass, { cx, cz, th0: 0, dTheta, count: nPanes, rA: H.rGlass, yA: tiers[i + 1] - 0.04, rB: H.rGlass, yB: tiers[i] + 0.04, rand, tilt: 0.009 });
    if (i > 0) {
      const y = tiers[i];
      g.mullion.arcSweep([[H.rGlass, y + 0.04], [H.rGlass + 0.12, y + 0.04], [H.rGlass + 0.12, y - 0.04], [H.rGlass, y - 0.04]], { ...circle, maxEdge: 9 });
    }
  }
  g.mullion.arcSweep([[H.rGlass, H.plinth + 0.1], [H.rGlass + 0.08, H.plinth + 0.1], [H.rGlass + 0.08, H.plinth]], { ...circle, maxEdge: 9 });
  const c = new THREE.Vector3();
  for (let i = 0; i < nPanes; i++) {
    const th = i * dTheta;
    polar(H.rGlass + 0.1, th, (H.hSoffitIn + H.plinth) / 2, cx, cz, c);
    g.mullion.box(c, 0.03, (H.hSoffitIn - H.plinth) / 2, 0.1, { yaw: Math.PI - th, skip: '-y+y-z', maxSeg: 3.3 });
  }

  // colonnade
  const colTop = H.hSoffitIn + (H.rCol - H.rGlass) / (H.rSoffit - H.rGlass) * (H.hSoffitOut - H.hSoffitIn) + 0.25;
  for (let i = 0; i < H.nCol; i++) {
    const th = (i + 0.5) / H.nCol * TAU;
    const p = polar(H.rCol, th, 0, cx, cz);
    g.column.cylinder(p.x, p.z, H.colR, H.plinth, colTop, { segs: 28, maxEdge: 1.25, cells: { arc: 1.806, prof: 3.4 } });
  }

  // upper drum with vertical fins
  g.cladding.arcSweep([[0.5, H.hDrum], [H.rDrum, H.hDrum], [H.rDrum, H.hRoof + 0.3]], { ...circle, segs: 128, rRef: H.rDrum, cells: { arc: 1.8, prof: 2.6, snap: true }, maxEdge: 3 });
  const nFins = 220;
  for (let i = 0; i < nFins; i++) {
    const th = i / nFins * TAU;
    polar(H.rDrum + 0.2, th, (H.hDrum + H.hRoof) / 2 + 0.1, cx, cz, c);
    g.cladding.box(c, 0.07, (H.hDrum - H.hRoof) / 2 - 0.25, 0.2, { yaw: Math.PI - th, skip: '-y-z', maxSeg: 4.5, cellSize: [50, 50] });
  }

  const group = new THREE.Group();
  group.name = 'hall';
  const add = (geo, mat, name, opts = {}) => {
    const m = new THREE.Mesh(geo.build(), mat);
    m.name = name; m.castShadow = opts.cast ?? true; m.receiveShadow = true;
    m.userData.static = true;
    m.userData.collide = opts.collide ?? true;
    m.userData.surface = opts.surface ?? 'stone';
    group.add(m);
  };
  add(g.cladding, M.cladding, 'hall.cladding');
  add(g.wood, M.wood, 'hall.soffit', { surface: 'wood' });
  add(g.floor, M.hallFloor, 'hall.floor', { cast: false });
  add(g.steps, M.hallSteps, 'hall.steps', { cast: false });
  add(g.plaza, M.plaza, 'hall.plaza', { cast: false, collide: false });
  add(g.glass, M.glass, 'hall.glass', { surface: 'glass' });
  add(g.mullion, M.mullion, 'hall.mullions', { collide: false, surface: 'metal' });
  add(g.column, M.column, 'hall.columns');
  return group;
}
