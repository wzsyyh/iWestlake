import { DEG, samplePath } from './geom.js';

/**
 * Site layout of the Academic Ring courtyard, Westlake University Yungu Campus, measured off
 * HENN's published master plan (scale bar 100 m). Origin = centre of the ring, +X east, -Z north.
 * Bearings are compass angles (0 = north, clockwise).
 */
export const RING = {
  rGlass: 155,          // ground-floor curtain wall
  rOuter: 181,
  rPromenade: 139,      // inner edge of the granite promenade (lawn kerb)
  rCanopy: 146,         // tip of the canopy
  th0: 85 * DEG,        // east end
  th1: 310 * DEG,       // north-west end (the ring is deliberately left open to the north)
  pane: 1.8,            // curtain-wall module (m along the arc)
  hGround: 6.2,
  hTop: 23.6,
};
RING.panes = Math.round((RING.th1 - RING.th0) * RING.rGlass / RING.pane);
RING.dTheta = (RING.th1 - RING.th0) / RING.panes;

export const HALL = {
  x: 65, z: -47,        // Academic Hall centre
  rGlass: 38,
  rCol: 47, colR: 1.15, nCol: 64,
  rSoffit: 49.6, rRoof: 50.6,
  plinth: 0.45, rPlinth: 51.0,
  hSoffitIn: 13.2, hSoffitOut: 14.2, hRoof: 16.1,
  rDrum: 24, hDrum: 24.6,
  rPlaza: 60,
};

export const PERIMETER_PATH = 7;

/** The fenced-off combat zone: the south-east sector between the Hall and the Ring. */
export const ZONE = { x: 78, z: 52, r: 76 };

/** Late-afternoon sun, slightly south of west. */
export const SUN_AZIMUTH = 258 * DEG;
export const SKY = 'sky_late_afternoon';
/** Sun strength relative to the panorama's measured sun (clearer air than the day it was shot). */
export const SUN_BOOST = 1.25;
/** Golden-hour bias applied to the measured sun colour. */
export const SUN_TINT = [1.05, 0.975, 0.86];

/** Focal node of the "leaf-vein" paths, just south-west of the Hall. */
export const NODE = { x: 6, z: 4, r: 7.5 };

// Each path runs from the node out to the promenade; `w` is the paved width.
const PATH_DEFS = [
  // positive bend bows a vein to the right of its direction of travel, i.e. away from the Hall
  { th: 99, w: 3.4, bend: 0.24 },
  { th: 124, w: 4.6, bend: 0.16 },
  { th: 149, w: 3.4, bend: 0.10 },
  { th: 176, w: 4.6, bend: 0.04 },
  { th: 204, w: 3.4, bend: -0.04 },
  { th: 233, w: 3.4, bend: -0.10 },
  { th: 262, w: 4.6, bend: -0.16 },
  { th: 292, w: 3.4, bend: -0.22 },
  { th: 330, w: 3.4, bend: -0.20 },
];

export const PATHS = PATH_DEFS.map((d) => {
  const th = d.th * DEG;
  const ex = (RING.rPromenade + 0.6) * Math.sin(th), ez = -(RING.rPromenade + 0.6) * Math.cos(th);
  const dx = ex - NODE.x, dz = ez - NODE.z, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const sx = NODE.x + ux * (NODE.r - 0.6), sz = NODE.z + uz * (NODE.r - 0.6);
  // perpendicular bow gives every vein the same gentle curl
  const px = -uz, pz = ux;
  const ctrl = [];
  for (const t of [0.3, 0.62]) {
    const bow = Math.sin(t * Math.PI) * d.bend * len * 0.5;
    ctrl.push([NODE.x + ux * len * t + px * bow, NODE.z + uz * len * t + pz * bow]);
  }
  const pts = samplePath([[sx, sz], ...ctrl, [ex, ez]], 1.5);
  return { ...d, pts };
});

function distToPath(path, x, z) {
  let best = Infinity;
  const pts = path.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, az = pts[i].z, bx = pts[i + 1].x, bz = pts[i + 1].z;
    const vx = bx - ax, vz = bz - az;
    let t = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}

/** Signed distance (m) to the nearest paved surface: negative = on paving. */
export function pavingDistance(x, z) {
  const r = Math.hypot(x, z);
  // under the ring the paving runs to the building; across the open arc it is a 7 m perimeter path
  let d = insideRingArc(x, z) ? RING.rPromenade - r : Math.max(RING.rPromenade - r, r - RING.rPromenade - PERIMETER_PATH);
  const rh = Math.hypot(x - HALL.x, z - HALL.z);
  d = Math.min(d, rh - HALL.rPlaza);                         // Hall plaza
  d = Math.min(d, Math.hypot(x - NODE.x, z - NODE.z) - NODE.r);
  if (d > 0) {
    for (const p of PATHS) {
      const dp = distToPath(p, x, z) - p.w / 2;
      if (dp < d) d = dp;
      if (d < 0) break;
    }
  }
  return d;
}

export function bearingOf(x, z) {
  let th = Math.atan2(x, -z);
  if (th < 0) th += Math.PI * 2;
  return th;
}

export function insideRingArc(x, z) {
  const th = bearingOf(x, z);
  return th >= RING.th0 && th <= RING.th1;
}
