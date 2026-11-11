import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * Baked global illumination for the static level.
 *
 * For every vertex we gather cosine-weighted rays against a BVH of the whole level:
 *   - rays that escape pick up sky radiance (sun removed; the sun itself stays a real-time light)
 *   - rays that hit geometry pick up sunlight bounced off that surface, and are linked to the
 *     hit triangle so further bounces can be solved as a sparse radiosity iteration
 * The result (irradiance rgb + sky visibility a) is stored per vertex and replaces the ambient
 * probe in the material shader. Pure JS: runs offline in Node (tools/bake.mjs) or in the browser
 * as a lower-quality fallback.
 */
export const BAKE_MAGIC = 0x4b424c57; // 'WLBK'
export const BAKE_VERSION = 3;

const FOLIAGE_PASS = 0.58;            // chance a ray slips through one canopy surface

function checksum(pos) {
  let s = 0;
  for (let i = 0; i < pos.length; i += 7) s = (s + Math.round(pos[i] * 100)) | 0;
  return s;
}

export function describe(meshes) {
  return meshes.map((m) => ({ name: m.name, count: m.geometry.attributes.position.count, sum: checksum(m.geometry.attributes.position.array) }));
}

/**
 * meshes:   static THREE.Mesh list (identity transforms), each material has userData.bake = [r,g,b]
 * env:      { sunDir: Vector3, sunE: [r,g,b], skyE: [r,g,b], groundRad: [r,g,b], sample(dx,dy,dz,out) }
 * blockers: canopy ellipsoids [{x,y,z,rx,ry}]
 * returns   Float32Array[] (rgba per vertex) in the order of `meshes`
 */
export function bakeLighting(meshes, env, { rays = 32, bounces = 3, blockers = [], onProgress = null } = {}) {
  // ---------------- merge everything into one BVH
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const icoPos = ico.attributes.position.array, icoN = icoPos.length / 3;
  let nV = 0, nI = 0;
  for (const m of meshes) { nV += m.geometry.attributes.position.count; nI += m.geometry.index.count; }
  const nSolid = nV;
  nV += blockers.length * icoN; nI += blockers.length * icoN;
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nSolid * 3), alb = new Float32Array(nV * 3), index = new Uint32Array(nI);
  const offsets = [];
  let vo = 0, io = 0;
  for (const m of meshes) {
    const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
    pos.set(p, vo * 3); nor.set(n, vo * 3);
    const a = m.material.userData.bake || [0.5, 0.5, 0.5];
    for (let i = 0; i < p.length / 3; i++) { alb[(vo + i) * 3] = a[0]; alb[(vo + i) * 3 + 1] = a[1]; alb[(vo + i) * 3 + 2] = a[2]; }
    for (let i = 0; i < ix.length; i++) index[io + i] = ix[i] + vo;
    offsets.push(vo);
    vo += p.length / 3; io += ix.length;
  }
  for (const b of blockers) {
    for (let i = 0; i < icoN; i++) {
      pos[(vo + i) * 3] = b.x + icoPos[i * 3] * b.rx; pos[(vo + i) * 3 + 1] = b.y + icoPos[i * 3 + 1] * b.ry; pos[(vo + i) * 3 + 2] = b.z + icoPos[i * 3 + 2] * b.rx;
      alb[(vo + i) * 3] = 0.07; alb[(vo + i) * 3 + 1] = 0.12; alb[(vo + i) * 3 + 2] = 0.03;
      index[io + i] = vo + i;
    }
    vo += icoN; io += icoN;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const bvh = new MeshBVH(geo, { targetLeafSize: 6 });

  // ---------------- helpers
  const sun = env.sunDir, sunE = env.sunE, skyE = env.skyE;
  const groundE = [env.groundRad[0] * Math.PI, env.groundRad[1] * Math.PI, env.groundRad[2] * Math.PI];
  const ray = new THREE.Ray();
  let seed = 12345;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const DS = THREE.DoubleSide;

  /** First solid hit, letting rays leak stochastically through tree canopies. Returns hit or null; foliage hits return with .foliage = true. */
  const cast = (ox, oy, oz, dx, dy, dz) => {
    ray.origin.set(ox, oy, oz); ray.direction.set(dx, dy, dz);
    for (let k = 0; k < 4; k++) {
      const h = bvh.raycastFirst(ray, DS);
      if (!h) return null;
      if (h.face.a < nSolid) return h;
      if (rand() > FOLIAGE_PASS) { h.foliage = true; return h; }
      ray.origin.copy(h.point).addScaledVector(ray.direction, 0.08);
    }
    return null;
  };
  const sunVisible = (x, y, z) => cast(x, y, z, sun.x, sun.y, sun.z) === null;

  const E = new Float32Array(nSolid * 3);        // source term: sky + first bounce of sunlight
  const vis = new Float32Array(nSolid);
  const invalid = new Uint8Array(nSolid);
  const useLinks = bounces > 1;
  const linkIdx = useLinks ? new Uint32Array(nSolid * rays * 3) : null;
  const linkW = useLinks ? new Float32Array(nSolid * rays * 3) : null;
  const sky = [0, 0, 0];
  const GOLDEN = 2.399963229728653;

  // ---------------- gather
  for (let v = 0; v < nSolid; v++) {
    const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
    const nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
    // tangent frame
    let tx, ty, tz;
    if (Math.abs(ny) < 0.9) { const l = Math.hypot(nz, nx); tx = nz / l; ty = 0; tz = -nx / l; } else { const l = Math.hypot(ny, nz); tx = 0; ty = -nz / l; tz = ny / l; }
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const ox = px + nx * 0.03, oy = py + ny * 0.03, oz = pz + nz * 0.03;
    const rot = rand() * Math.PI * 2;
    let sr = 0, sg = 0, sb = 0, escaped = 0, inside = 0;
    for (let s = 0; s < rays; s++) {
      const u = (s + rand()) / rays, r = Math.sqrt(u), phi = s * GOLDEN + rot;
      const lx = r * Math.cos(phi), ly = r * Math.sin(phi), lz = Math.sqrt(Math.max(0, 1 - u));
      const dx = tx * lx + bx * ly + nx * lz, dy = ty * lx + by * ly + ny * lz, dz = tz * lx + bz * ly + nz * lz;
      const h = cast(ox, oy, oz, dx, dy, dz);
      if (!h) {
        env.sample(dx, dy, dz, sky);
        sr += sky[0]; sg += sky[1]; sb += sky[2];
        escaped++;
        continue;
      }
      if (h.distance > 5) escaped++;
      const f = h.face, fn = f.normal;
      let facing = fn.x * dx + fn.y * dy + fn.z * dz;
      if (h.foliage) {
        // leaves: half lit by the sun, plus skylight
        const k = 0.45 / Math.PI;
        sr += alb[f.a * 3] * (sunE[0] * 0.45 + skyE[0]) * k; sg += alb[f.a * 3 + 1] * (sunE[1] * 0.45 + skyE[1]) * k; sb += alb[f.a * 3 + 2] * (sunE[2] * 0.45 + skyE[2]) * k;
        continue;
      }
      if (facing > 0 && h.distance < 4) { inside++; continue; }           // we are looking at the back of a nearby wall: the vertex is buried
      const sgn = facing > 0 ? -1 : 1;
      const qnx = fn.x * sgn, qny = fn.y * sgn, qnz = fn.z * sgn;
      const ar = alb[f.a * 3], ag = alb[f.a * 3 + 1], ab = alb[f.a * 3 + 2];
      const ndl = qnx * sun.x + qny * sun.y + qnz * sun.z;
      if (ndl > 0.01 && sunVisible(h.point.x + qnx * 0.04, h.point.y + qny * 0.04, h.point.z + qnz * 0.04)) {
        const k = ndl / Math.PI;
        sr += ar * sunE[0] * k; sg += ag * sunE[1] * k; sb += ab * sunE[2] * k;
      }
      if (useLinks) {
        // barycentric weights of the hit inside its triangle
        const ax = pos[f.a * 3], ay = pos[f.a * 3 + 1], az = pos[f.a * 3 + 2];
        const e1x = pos[f.b * 3] - ax, e1y = pos[f.b * 3 + 1] - ay, e1z = pos[f.b * 3 + 2] - az;
        const e2x = pos[f.c * 3] - ax, e2y = pos[f.c * 3 + 1] - ay, e2z = pos[f.c * 3 + 2] - az;
        const qx = h.point.x - ax, qy = h.point.y - ay, qz = h.point.z - az;
        const d11 = e1x * e1x + e1y * e1y + e1z * e1z, d12 = e1x * e2x + e1y * e2y + e1z * e2z, d22 = e2x * e2x + e2y * e2y + e2z * e2z;
        const dq1 = qx * e1x + qy * e1y + qz * e1z, dq2 = qx * e2x + qy * e2y + qz * e2z;
        const den = d11 * d22 - d12 * d12 || 1;
        let wb = (d22 * dq1 - d12 * dq2) / den, wc = (d11 * dq2 - d12 * dq1) / den;
        wb = Math.min(1, Math.max(0, wb)); wc = Math.min(1 - wb, Math.max(0, wc));
        const o = (v * rays + s) * 3;
        linkIdx[o] = f.a; linkIdx[o + 1] = f.b; linkIdx[o + 2] = f.c;
        linkW[o] = (1 - wb - wc) / rays; linkW[o + 1] = wb / rays; linkW[o + 2] = wc / rays;
      } else {
        // single-bounce fallback: assume the hit surface sees a typical amount of sky
        const up = 0.5 + 0.5 * qny, k = 1 / Math.PI;
        sr += ar * (skyE[0] * up * 0.7 + groundE[0] * (1 - up)) * k; sg += ag * (skyE[1] * up * 0.7 + groundE[1] * (1 - up)) * k; sb += ab * (skyE[2] * up * 0.7 + groundE[2] * (1 - up)) * k;
      }
    }
    const k = Math.PI / rays;
    E[v * 3] = sr * k; E[v * 3 + 1] = sg * k; E[v * 3 + 2] = sb * k;
    vis[v] = escaped / rays;                     // openness: share of directions with nothing within 5 m
    if (inside > rays * 0.4) invalid[v] = 1;
    if (onProgress && (v & 4095) === 0) onProgress(v / nSolid * 0.9);
  }

  // ---------------- further bounces: E = S + F E
  let cur = E;
  if (useLinks) {
    cur = new Float32Array(E);
    let next = new Float32Array(E.length);
    for (let b = 1; b < bounces; b++) {
      for (let v = 0; v < nSolid; v++) {
        let r = E[v * 3], g = E[v * 3 + 1], bl = E[v * 3 + 2];
        const base = v * rays * 3;
        for (let k = 0; k < rays * 3; k++) {
          const w = linkW[base + k];
          if (w === 0) continue;
          const j = linkIdx[base + k] * 3;
          r += w * alb[j] * cur[j]; g += w * alb[j + 1] * cur[j + 1]; bl += w * alb[j + 2] * cur[j + 2];
        }
        next[v * 3] = r; next[v * 3 + 1] = g; next[v * 3 + 2] = bl;
      }
      const t = cur; cur = next; next = t;
      if (onProgress) onProgress(0.9 + 0.1 * b / (bounces - 1));
    }
  }

  // ---------------- output per mesh (+ repair buried vertices from their neighbours)
  const out = [];
  meshes.forEach((m, mi) => {
    const n = m.geometry.attributes.position.count, o = offsets[mi], ix = m.geometry.index.array;
    const res = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      res[i * 4] = cur[(o + i) * 3]; res[i * 4 + 1] = cur[(o + i) * 3 + 1]; res[i * 4 + 2] = cur[(o + i) * 3 + 2]; res[i * 4 + 3] = Math.min(1, vis[o + i]);
    }
    const bad = new Uint8Array(n);
    let nBad = 0;
    for (let i = 0; i < n; i++) if (invalid[o + i]) { bad[i] = 1; nBad++; }
    for (let pass = 0; pass < 8 && nBad > 0; pass++) {
      const acc = new Float32Array(n * 4), cnt = new Uint16Array(n);
      for (let t = 0; t < ix.length; t += 3) {
        for (let a = 0; a < 3; a++) {
          const va = ix[t + a];
          if (!bad[va]) continue;
          for (let b = 1; b < 3; b++) {
            const vb = ix[t + (a + b) % 3];
            if (bad[vb]) continue;
            for (let c = 0; c < 4; c++) acc[va * 4 + c] += res[vb * 4 + c];
            cnt[va]++;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        if (bad[i] && cnt[i]) { for (let c = 0; c < 4; c++) res[i * 4 + c] = acc[i * 4 + c] / cnt[i]; bad[i] = 0; nBad--; }
      }
    }
    out.push(res);
  });
  return out;
}

export function applyBake(meshes, results) {
  meshes.forEach((m, i) => m.geometry.setAttribute('bakedIrr', new THREE.BufferAttribute(results[i], 4)));
}

/** Serialise to the .bin shipped in public/assets (half-float RGBA per vertex). */
export function encodeBake(meshes, results, meta = {}) {
  const header = JSON.stringify({ ...meta, meshes: describe(meshes) });
  const enc = new TextEncoder().encode(header);
  const pad = (4 - (enc.length % 4)) % 4;
  let total = 0;
  for (const r of results) total += r.length;
  const buf = new ArrayBuffer(16 + enc.length + pad + total * 2);
  const dv = new DataView(buf);
  dv.setUint32(0, BAKE_MAGIC, true); dv.setUint32(4, BAKE_VERSION, true); dv.setUint32(8, enc.length + pad, true); dv.setUint32(12, total, true);
  new Uint8Array(buf, 16, enc.length + pad).fill(0x20).set(enc);
  const half = new Uint16Array(buf, 16 + enc.length + pad, total);
  let o = 0;
  for (const r of results) for (let i = 0; i < r.length; i++) half[o++] = THREE.DataUtils.toHalfFloat(Math.min(r[i], 60000));
  return buf;
}

/** Returns Float32Array[] matching `meshes`, or null if the file does not belong to this geometry. */
export function decodeBake(buf, meshes) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== BAKE_MAGIC || dv.getUint32(4, true) !== BAKE_VERSION) return null;
  const jsonLen = dv.getUint32(8, true), total = dv.getUint32(12, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 16, jsonLen)).replace(/\0/g, ' ').trim());
  const want = describe(meshes);
  if (header.meshes.length !== want.length) return null;
  for (let i = 0; i < want.length; i++) {
    const a = header.meshes[i], b = want[i];
    if (a.name !== b.name || a.count !== b.count || a.sum !== b.sum) return null;
  }
  const half = new Uint16Array(buf, 16 + jsonLen, total);
  const out = [];
  let o = 0;
  for (const m of meshes) {
    const n = m.geometry.attributes.position.count * 4, r = new Float32Array(n);
    for (let i = 0; i < n; i++) r[i] = THREE.DataUtils.fromHalfFloat(half[o++]);
    out.push(r);
  }
  return out;
}
