import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { RING, HALL, ZONE } from '../world/layout.js';

const _ray = new THREE.Ray();

/**
 * Collision world.
 *  - movement: analytic 2D colliders (circles / oriented boxes with a top height) + curved walls,
 *    which is cheap and never snags on triangle seams
 *  - shots and line-of-sight: a BVH over the visible static geometry, so impacts land on what you see
 */
export class Collision {
  constructor(world) {
    this.circles = [];     // { x, z, r, top }
    this.boxes = [];       // { x, z, hx, hz, cos, sin, top }
    this.dynamic = [];     // extra boxes added by gameplay props

    for (let i = 0; i < HALL.nCol; i++) {
      const th = (i + 0.5) / HALL.nCol * Math.PI * 2;
      this.circles.push({ x: HALL.x + HALL.rCol * Math.sin(th), z: HALL.z - HALL.rCol * Math.cos(th), r: HALL.colR + 0.02, top: 99 });
    }
    for (const c of world.colliders) this.circles.push({ x: c.x, z: c.z, r: c.r, top: c.h });
    for (const b of world.boxes) this.boxes.push({ x: b.x, z: b.z, hx: b.hx, hz: b.hz, cos: Math.cos(b.yaw), sin: -Math.sin(b.yaw), top: b.top });

    // ray-cast BVH
    const geos = [];
    const surfaces = [];
    for (const m of world.statics) {
      if (m.name === 'ground.lawn' || m.name === 'props.pits' || m.name === 'ground.kerbs') continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', m.geometry.attributes.position);
      g.setIndex(m.geometry.index);
      geos.push(g);
      surfaces.push({ surface: m.userData.surface || 'stone', tris: m.geometry.index.count / 3 });
    }
    // a flat lawn quad stands in for the (masked) lawn mesh
    const lawn = new THREE.PlaneGeometry(520, 520).rotateX(-Math.PI / 2).translate(0, -0.04, 0);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', lawn.attributes.position); lg.setIndex(lawn.index);
    geos.push(lg); surfaces.push({ surface: 'grass', tris: 2 });
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    // per-triangle surface id, kept in step with the BVH's index reordering via a group-free lookup
    this.surfaceNames = [...new Set(surfaces.map((s) => s.surface))];
    const triSurface = new Uint8Array(merged.index.count / 3);
    let t = 0;
    for (const s of surfaces) { triSurface.fill(this.surfaceNames.indexOf(s.surface), t, t + s.tris); t += s.tris; }
    this.bvh = new MeshBVH(merged, { indirect: true });
    this.triSurface = triSurface;
    this.geometry = merged;
  }

  /** yaw follows three.js rotation.y. */
  addBox(x, z, hx, hz, yaw, top) {
    const b = { x, z, hx, hz, cos: Math.cos(yaw), sin: -Math.sin(yaw), top };
    this.dynamic.push(b);
    return b;
  }

  /** Height of the walkable surface under (x, z), given the current feet height (for stepping onto things). */
  groundHeight(x, z, feetY = 0) {
    let h = 0;
    const rho = Math.hypot(x - HALL.x, z - HALL.z);
    if (rho < HALL.rPlinth + 0.8) h = rho < HALL.rPlinth ? HALL.plinth : rho < HALL.rPlinth + 0.4 ? 0.30 : 0.15;
    const check = (b) => {
      if (feetY < b.top - 0.12 || b.top > 3) return;
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * b.cos + dz * b.sin, lz = -dx * b.sin + dz * b.cos;
      if (Math.abs(lx) < b.hx && Math.abs(lz) < b.hz) h = Math.max(h, b.top);
    };
    for (const b of this.boxes) check(b);
    for (const b of this.dynamic) check(b);
    return h;
  }

  /** Push a vertical capsule (radius r, feet at y) out of everything solid. Mutates pos. Returns true if it touched a wall. */
  resolve(pos, r, feetY, height = 1.8) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      // ring curtain wall (piers stand a little proud of the glass)
      const rr = Math.hypot(pos.x, pos.z);
      const lim = RING.rGlass - 0.9 - r;
      if (rr > lim) {
        let th = Math.atan2(pos.x, -pos.z); if (th < 0) th += Math.PI * 2;
        if (th > RING.th0 - 0.02 && th < RING.th1 + 0.02 && rr < RING.rOuter + 5) { pos.x *= lim / rr; pos.z *= lim / rr; hit = true; }
      }
      // Hall drum
      const hx = pos.x - HALL.x, hz = pos.z - HALL.z, rho = Math.hypot(hx, hz), hl = HALL.rGlass + 0.25 + r;
      if (rho < hl) { const k = hl / (rho || 1); pos.x = HALL.x + hx * k; pos.z = HALL.z + hz * k; hit = true; }
      // combat-zone fence
      const zx = pos.x - ZONE.x, zz = pos.z - ZONE.z, zr = Math.hypot(zx, zz);
      if (zr > ZONE.r - r) { const k = (ZONE.r - r) / zr; pos.x = ZONE.x + zx * k; pos.z = ZONE.z + zz * k; hit = true; }
      for (const c of this.circles) {
        if (feetY > c.top - 0.1) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z, d2 = dx * dx + dz * dz, lim2 = c.r + r;
        if (d2 < lim2 * lim2) { const d = Math.sqrt(d2) || 1e-4, k = lim2 / d; pos.x = c.x + dx * k; pos.z = c.z + dz * k; hit = true; }
      }
      const boxes = this.dynamic.length ? this.boxes.concat(this.dynamic) : this.boxes;
      for (const b of boxes) {
        if (feetY > b.top - 0.12) continue;                // standing on top of it
        if (feetY + height < 0) continue;
        const dx = pos.x - b.x, dz = pos.z - b.z;
        const lx = dx * b.cos + dz * b.sin, lz = -dx * b.sin + dz * b.cos;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx)), qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ex = lx - qx, ez = lz - qz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        let px, pz;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; px = ex * k; pz = ez * k; }
        else {
          // centre is inside: leave through the nearest face
          const ox = b.hx - Math.abs(lx), oz = b.hz - Math.abs(lz);
          if (ox < oz) { px = (ox + r) * Math.sign(lx || 1); pz = 0; } else { px = 0; pz = (oz + r) * Math.sign(lz || 1); }
        }
        pos.x += px * b.cos - pz * b.sin; pos.z += px * b.sin + pz * b.cos; hit = true;
      }
    }
    return hit;
  }

  /** Nearest hit along a ray: { point, normal, distance, surface } or null. */
  raycast(origin, dir, maxDist = 500) {
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const h = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
    if (!h) return null;
    const n = h.face.normal;
    if (n.dot(dir) > 0) n.negate();
    return { point: h.point, normal: n, distance: h.distance, surface: this.surfaceNames[this.triSurface[h.faceIndex]] };
  }

  /** True if nothing solid lies between a and b. */
  clear(a, b) {
    _ray.origin.copy(a); _ray.direction.subVectors(b, a);
    const d = _ray.direction.length();
    _ray.direction.multiplyScalar(1 / d);
    return this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, d - 0.05) === null;
  }
}
