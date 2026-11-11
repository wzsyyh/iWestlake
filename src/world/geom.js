import * as THREE from 'three';

export const DEG = Math.PI / 180;

/** Compass-polar to world: bearing 0 = north (-Z), 90deg = east (+X). */
export function polar(r, th, y = 0, cx = 0, cz = 0, out = new THREE.Vector3()) {
  return out.set(cx + r * Math.sin(th), y, cz - r * Math.cos(th));
}

/** Deterministic RNG (mulberry32) so the level and its baked lighting are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Growable indexed geometry with UVs in metres (`uv`) and "cell" coordinates (`cell`) that drive
 * procedural panel / paving joints: joints sit on integer cell values.
 */
export class Geo {
  constructor() {
    this.p = []; this.n = []; this.uv = []; this.cell = []; this.idx = [];
  }

  get count() { return this.p.length / 3; }

  vert(x, y, z, nx, ny, nz, u = 0, v = 0, cu = 0, cv = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.cell.push(cu, cv);
    return this.p.length / 3 - 1;
  }

  /**
   * Flat rectangle patch spanned by origin + s*U + t*V (U x V gives the normal), subdivided so no
   * edge is longer than maxSeg (the baked lighting is stored per vertex).
   */
  rect(o, U, V, { maxSeg = 1.5, uv0 = [0, 0], cellSize = [1, 1], cell0 = [0, 0], flip = false } = {}) {
    const lu = U.length(), lv = V.length();
    const nu = Math.max(1, Math.ceil(lu / maxSeg)), nv = Math.max(1, Math.ceil(lv / maxSeg));
    const n = new THREE.Vector3().crossVectors(U, V).normalize();
    if (flip) n.negate();
    const base = this.count;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const s = i / nu, t = j / nv;
        this.vert(o.x + U.x * s + V.x * t, o.y + U.y * s + V.y * t, o.z + U.z * s + V.z * t, n.x, n.y, n.z,
          uv0[0] + lu * s, uv0[1] + lv * t, cell0[0] + lu * s / cellSize[0], cell0[1] + lv * t / cellSize[1]);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
        if (flip) this.idx.push(a, c, b, a, d, c); else this.idx.push(a, b, c, a, c, d);
      }
    }
    return this;
  }

  /** Axis-aligned-in-local-frame box: centre c, half extents, rotated by `yaw` about Y. Skips faces listed in `skip`. */
  box(c, hx, hy, hz, { yaw = 0, maxSeg = 1.5, skip = '', cellSize = [1, 1] } = {}) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const X = new THREE.Vector3(cs, 0, -sn), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(sn, 0, cs);
    const P = (x, y, z) => new THREE.Vector3().copy(c).addScaledVector(X, x).addScaledVector(Y, y).addScaledVector(Z, z);
    const opt = { maxSeg, cellSize };
    if (!skip.includes('+z')) this.rect(P(-hx, -hy, hz), X.clone().multiplyScalar(2 * hx), Y.clone().multiplyScalar(2 * hy), opt);
    if (!skip.includes('-z')) this.rect(P(hx, -hy, -hz), X.clone().multiplyScalar(-2 * hx), Y.clone().multiplyScalar(2 * hy), opt);
    if (!skip.includes('+x')) this.rect(P(hx, -hy, hz), Z.clone().multiplyScalar(-2 * hz), Y.clone().multiplyScalar(2 * hy), opt);
    if (!skip.includes('-x')) this.rect(P(-hx, -hy, -hz), Z.clone().multiplyScalar(2 * hz), Y.clone().multiplyScalar(2 * hy), opt);
    if (!skip.includes('+y')) this.rect(P(-hx, hy, hz), X.clone().multiplyScalar(2 * hx), Z.clone().multiplyScalar(-2 * hz), opt);
    if (!skip.includes('-y')) this.rect(P(-hx, -hy, -hz), X.clone().multiplyScalar(2 * hx), Z.clone().multiplyScalar(2 * hz), opt);
    return this;
  }

  /**
   * Sweep a profile of (radius, height) points around a vertical axis.
   * Walking the profile from first to last point, the surface faces LEFT (so a wall traced upward
   * faces the axis). Each profile edge is flat-shaded across and smooth along the arc.
   *
   * cells: { arc: metres per cell along the arc (measured at rRef), prof: metres per cell along the profile }
   */
  arcSweep(profile, { cx = 0, cz = 0, th0, th1, segs, maxEdge = 1.5, rRef = null, cells = null, smooth = false, vStart = 0 } = {}) {
    let vAcc = vStart;
    const dth = (th1 - th0) / segs;
    const ref = rRef ?? profile[0][0];
    for (let e = 0; e < profile.length - 1; e++) {
      const [r0, y0] = profile[e], [r1, y1] = profile[e + 1];
      const dr = r1 - r0, dy = y1 - y0, len = Math.hypot(dr, dy);
      if (len < 1e-6) continue;
      let nr = -dy / len, ny = dr / len;
      const sub = Math.max(1, Math.ceil(len / maxEdge));
      const base = this.count;
      // optional smooth shading across profile edges (used for rounded lips)
      let nA = [nr, ny], nB = [nr, ny];
      if (smooth) {
        const prev = e > 0 ? profile[e - 1] : null, next = e < profile.length - 2 ? profile[e + 2] : null;
        const avg = (ax, ay, bx, by) => { const x = ax + bx, y = ay + by, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
        if (prev) { const l = Math.hypot(r0 - prev[0], y0 - prev[1]) || 1; nA = avg(nr, ny, -(y0 - prev[1]) / l, (r0 - prev[0]) / l); }
        if (next) { const l = Math.hypot(next[0] - r1, next[1] - y1) || 1; nB = avg(nr, ny, -(next[1] - y1) / l, (next[0] - r1) / l); }
      }
      for (let j = 0; j <= sub; j++) {
        const t = j / sub, r = r0 + dr * t, y = y0 + dy * t;
        const nrr = nA[0] + (nB[0] - nA[0]) * t, nyy = nA[1] + (nB[1] - nA[1]) * t, nl = Math.hypot(nrr, nyy) || 1;
        for (let i = 0; i <= segs; i++) {
          const th = th0 + dth * i, s = Math.sin(th), c = Math.cos(th);
          const arc = (th - th0);
          this.vert(cx + r * s, y, cz - r * c, (nrr / nl) * s, nyy / nl, -(nrr / nl) * c,
            r * arc, vAcc + len * t,
            cells ? ref * arc / cells.arc : 0, cells ? (vAcc + len * t) / cells.prof : 0);
        }
      }
      for (let j = 0; j < sub; j++) {
        for (let i = 0; i < segs; i++) {
          const a = base + j * (segs + 1) + i, b = a + 1, c2 = a + segs + 2, d = a + segs + 1;
          this.idx.push(a, b, c2, a, c2, d);
        }
      }
      // snap the running length to whole cells so joints land on profile corners
      vAcc += len;
      if (cells && cells.snap) vAcc = Math.ceil(vAcc / cells.prof - 1e-4) * cells.prof;
    }
    return this;
  }

  /** Vertical cylinder wall (outward facing), UVs in metres. */
  cylinder(cx, cz, r, y0, y1, { segs = 32, maxEdge = 1.5, cells = null, inward = false } = {}) {
    const prof = inward ? [[r, y0], [r, y1]] : [[r, y1], [r, y0]];
    return this.arcSweep(prof, { cx, cz, th0: 0, th1: Math.PI * 2, segs, maxEdge, cells });
  }

  merge(other) {
    const base = this.count;
    for (const k of ['p', 'n', 'uv', 'cell']) for (let i = 0; i < other[k].length; i++) this[k].push(other[k][i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('cell', new THREE.Float32BufferAttribute(this.cell, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Centripetal Catmull-Rom polyline sampled every `step` metres; returns points + tangents (XZ plane). */
export function samplePath(points, step = 1.5) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.max(2, Math.ceil(curve.getLength() / step));
  const pts = curve.getSpacedPoints(n);
  const out = [];
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    if (i > 0) acc += pts[i].distanceTo(pts[i - 1]);
    out.push({ x: pts[i].x, z: pts[i].z, tx: t.x, tz: t.z, s: acc });
  }
  return out;
}
