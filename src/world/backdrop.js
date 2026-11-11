import * as THREE from 'three';
import { Geo, DEG, polar, rng } from './geom.js';

/**
 * Everything beyond the courtyard, seen only at a distance: the campus buildings north of the
 * open arc (after the master plan), the landmark tower, the city and the hills on the horizon.
 * Not baked and not collidable.
 */
export function buildBackdrop(M) {
  const rand = rng(31337);
  const white = new Geo(), glass = new Geo(), tower = new Geo(), city = new Geo();
  const c = new THREE.Vector3();

  // [x, z, width, height, depth, yawDeg]  (north = -z)
  const campus = [
    [-98, -214, 72, 25, 26, 4], [36, -246, 24, 31, 84, 0], [108, -216, 92, 22, 28, -3], [166, -152, 68, 20, 40, 12],
    [-156, -154, 56, 18, 30, -14], [-62, -334, 42, 27, 40, 0], [62, -338, 42, 27, 40, 0], [-204, -262, 62, 30, 30, 8],
    [236, -258, 84, 33, 40, -6], [-10, -410, 150, 24, 30, 0], [150, -400, 60, 38, 36, 5], [-170, -390, 70, 30, 34, -4],
    // the school wings radiating outward behind the ring are hidden by it; these sit beyond its open ends
    [228, -60, 70, 22, 44, 30], [-214, -86, 66, 24, 40, -24],
  ];
  for (const [x, z, w, h, d, yawDeg] of campus) {
    const yaw = yawDeg * DEG;
    white.box(c.set(x, h / 2, z), w / 2, h / 2, d / 2, { yaw, maxSeg: 60, skip: '-y' });
    // ribbon windows, a floor every 4.4 m
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let y = 3.0; y < h - 2.2; y += 4.4) {
      glass.box(c.set(x, y, z), w / 2 + 0.12, 1.15, d / 2 - 0.9, { yaw, maxSeg: 60, skip: '-y+y+z-z' });
      glass.box(c.set(x, y, z), w / 2 - 0.9, 1.15, d / 2 + 0.12, { yaw, maxSeg: 60, skip: '-y+y+x-x' });
    }
    void cs; void sn;
  }

  // the campus tower: a slender tapering spire north of the Hall
  const TX = -44, TZ = -302;
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, y = 124 * t;
    prof.push([Math.max(0.05, 6.4 * Math.pow(1 - t, 0.62) * (1 - 0.18 * t)), y]);
  }
  tower.arcSweep(prof.reverse(), { cx: TX, cz: TZ, th0: 0, th1: Math.PI * 2, segs: 24, maxEdge: 30, smooth: true });

  // the city beyond: anonymous blocks, denser to the east (towards Hangzhou)
  for (let i = 0; i < 260; i++) {
    const th = rand() * Math.PI * 2;
    const r = 520 + Math.pow(rand(), 0.7) * 1500;
    const east = 0.5 + 0.5 * Math.sin(th);                    // sin(bearing) > 0 = east
    if (rand() > 0.35 + 0.65 * east) continue;
    const p = polar(r, th);
    const tall = rand() < 0.3 + 0.3 * east;
    const w = 26 + rand() * 50, d = 18 + rand() * 30, h = tall ? 60 + rand() * 80 : 14 + rand() * 30;
    city.box(c.set(p.x, h / 2 - 2, p.z), w / 2, h / 2, d / 2, { yaw: rand() * Math.PI, maxSeg: 200, skip: '-y' });
  }

  // hills on the south-western horizon (the Hangzhou hills are visible from the campus)
  const hills = new Geo();
  const N = 140, R = 2250;
  for (let layer = 0; layer < 2; layer++) {
    const base = hills.count, rr = R - layer * 420, amp = layer ? 150 : 250;
    for (let i = 0; i <= N; i++) {
      const t = i / N, th = (150 + 210 * t) * DEG;
      const env = Math.sin(Math.PI * t) ** 0.6;
      const hgt = env * amp * (0.42 + 0.3 * Math.sin(t * 19 + layer * 2.1) + 0.2 * Math.sin(t * 47 + 1.3) + 0.12 * Math.sin(t * 113 + layer));
      const p = polar(rr, th);
      hills.vert(p.x, -4, p.z, -Math.sin(th), 0.3, Math.cos(th));
      hills.vert(p.x, Math.max(2, hgt), p.z, -Math.sin(th), 0.6, Math.cos(th));
    }
    for (let i = 0; i < N; i++) { const a = base + i * 2; hills.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }

  const group = new THREE.Group();
  group.name = 'backdrop';
  const add = (geo, mat, name, cast = false) => {
    const m = new THREE.Mesh(geo.build(), mat);
    m.name = name; m.castShadow = cast; m.receiveShadow = false;
    group.add(m);
    return m;
  };
  add(white, M.farWhite, 'backdrop.campus', true);
  add(glass, M.farGlass, 'backdrop.windows');
  add(tower, M.farMetal, 'backdrop.tower', true);
  add(city, M.farCity, 'backdrop.city');
  add(hills, M.farHills, 'backdrop.hills');
  return group;
}
