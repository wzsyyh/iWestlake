import * as THREE from 'three';
import { extend, Triplanar, Wind, Foliage, globals } from '../engine/patch.js';

const LOD_DIST = [27, 66];           // metres: lod0 | lod1 | lod2
const TILE = 44, SHADOW_NEAR = 50;  // shadow proxies are grouped into tiles this size; nearer tiles cast from LOD1
const FINE_CASCADE = 100;           // shadow cameras narrower than this (half-width, m) are the two near cascades
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

/**
 * Instanced trees with three levels of detail. Geometry comes from tools/build_tree.py
 * (a photoscanned Poly Haven tree re-authored as bark + leaf cards).
 */
export async function createTrees(assets, trees, { lodScale = 1, fineShadows = true } = {}) {
  const [gltf, barkCol, barkNor, leafCol, leafNor] = await Promise.all([
    assets.gltf('tree.glb'),
    assets.texture('bark_col.jpg', { srgb: true }), assets.texture('bark_nor.jpg'),
    assets.texture('leaf_atlas.png', { srgb: true }), assets.texture('leaf_nor.jpg'),
  ]);
  // the atlas was authored with glTF's top-left UV origin
  for (const t of [leafCol, leafNor]) { t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
  leafCol.anisotropy = 4;

  const bark = extend(new THREE.MeshStandardMaterial({ map: barkCol, normalMap: barkNor, roughness: 0.92, color: new THREE.Color(0.82, 0.78, 0.74), normalScale: new THREE.Vector2(1.4, 1.4) }),
    [Triplanar({ scale: 0.9 }), Wind({ leaves: false })]);
  const leaves = extend(new THREE.MeshStandardMaterial({
    map: leafCol, normalMap: leafNor, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.52, color: new THREE.Color(0.92, 1.0, 0.82),
    normalScale: new THREE.Vector2(0.6, 0.6),
  }), [Wind({ leaves: true }), Foliage({ transmission: [0.62, 0.78, 0.2], amount: 1.0 })]);
  // depth material so the cut-out, wind-blown leaves cast matching shadows
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafCol, alphaTest: 0.42, side: THREE.DoubleSide });
  leafDepth.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globals.uTime; shader.uniforms.uWind = globals.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec4 uWind; attribute vec3 _leafdata;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wlO = vec3( instanceMatrix[3] );
          float ph = dot( wlO.xz, vec2( 0.37, 0.71 ) );
          float hgt = max( transformed.y, 0.0 );
          float gust = 0.55 + 0.3 * sin( uTime * 0.63 + ph ) + 0.15 * sin( uTime * 1.71 + ph * 1.9 );
          float s = uWind.z * gust;
          transformed.xz += vec2( 0.8, 0.6 ) * ( hgt * hgt ) * 0.0022 * s;
          float bp = ph + dot( transformed, vec3( 1.3, 0.9, 1.7 ) );
          transformed += vec3( sin( uTime * 1.9 + bp ), 0.5 * sin( uTime * 2.6 + bp * 1.3 ), cos( uTime * 1.5 + bp ) ) * ( 0.006 * length( transformed.xz ) + 0.002 * hgt ) * s;
        }`);
  };

  const group = new THREE.Group();
  group.name = 'trees';
  const lods = [];
  for (let l = 0; l < 3; l++) {
    const wood = gltf.scene.getObjectByName(`wood_lod${l}`).geometry;
    const leaf = gltf.scene.getObjectByName(`leaves_lod${l}`).geometry;
    const wm = new THREE.InstancedMesh(wood, bark, trees.length);
    const lm = new THREE.InstancedMesh(leaf, leaves, trees.length);
    lm.customDepthMaterial = leafDepth;
    for (const m of [wm, lm]) {
      m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(m);
    }
    lm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(trees.length * 3), 3);
    lm.instanceColor.setUsage(THREE.DynamicDrawUsage);
    lods.push({ wood: wm, leaves: lm });
  }

  const mats = trees.map((t) => {
    _e.set(0, t.rot, 0);
    _m.compose(_p.set(t.x, -0.06, t.z), _q.setFromEuler(_e), _s.set(t.scale, t.scale * t.sy, t.scale));
    return _m.clone();
  });
  const tints = trees.map((t) => new THREE.Color().setHSL(0.24 + (t.tint - 0.5) * 0.05, 0.25, 0.5).multiplyScalar(2).lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.9 + t.tint * 0.2));
  // ---- shadow casters: static per-tile proxies at reduced detail. They are skipped in the colour
  // pass (count = 0 while it renders) and frustum-culled per cascade, so a cascade only pays for
  // the trees that can actually shadow it.
  const tiles = new Map();
  trees.forEach((t, i) => {
    const key = `${Math.floor(t.x / TILE)},${Math.floor(t.z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(i);
  });
  const shadowTiles = [];
  // near tiles cast detailed (LOD1) shadows into the two fine cascades; every tile casts cheap
  // (LOD2) shadows into the two coarse ones, where leaf-level detail could not be resolved anyway
  const proxy = (geo, mat, ids, depthMat, tile, fine) => {
    const m = new THREE.InstancedMesh(geo, mat, ids.length);
    ids.forEach((id, k) => m.setMatrixAt(k, mats[id]));
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = true; m.receiveShadow = false;
    if (depthMat) m.customDepthMaterial = depthMat;
    m.computeBoundingSphere();
    const n = ids.length;
    m.onBeforeRender = () => { m.count = 0; };
    m.onAfterRender = () => { m.count = n; };
    m.onBeforeShadow = (_r, _o, _c, shadowCamera) => {
      const fineCascade = fineShadows && shadowCamera.right < FINE_CASCADE;
      if (fine ? !(tile.isNear && fineCascade) : (tile.isNear && fineCascade)) m.count = 0;
    };
    m.onAfterShadow = () => { m.count = n; };
    group.add(m);
    return m;
  };
  for (const ids of tiles.values()) {
    let cx = 0, cz = 0;
    for (const id of ids) { cx += trees[id].x; cz += trees[id].z; }
    const tile = { x: cx / ids.length, z: cz / ids.length, isNear: false };
    if (fineShadows) { proxy(lods[1].wood.geometry, bark, ids, null, tile, true); proxy(lods[1].leaves.geometry, leaves, ids, leafDepth, tile, true); }
    proxy(lods[2].wood.geometry, bark, ids, null, tile, false); proxy(lods[2].leaves.geometry, leaves, ids, leafDepth, tile, false);
    shadowTiles.push(tile);
  }

  const assigned = new Int8Array(trees.length).fill(-1);
  const d0 = LOD_DIST[0] * lodScale, d1 = LOD_DIST[1] * lodScale;

  /** Re-bins trees into LODs around the camera (with hysteresis so they do not flicker at a boundary). */
  const update = (camPos) => {
    for (const t of shadowTiles) {
      const d = Math.hypot(t.x - camPos.x, t.z - camPos.z);
      t.isNear = t.isNear ? d < SHADOW_NEAR * 1.1 : d < SHADOW_NEAR * 0.9;
    }
    let changed = false;
    for (let i = 0; i < trees.length; i++) {
      const d = Math.hypot(trees[i].x - camPos.x, trees[i].z - camPos.z);
      const cur = assigned[i];
      let lod = d < d0 ? 0 : d < d1 ? 1 : 2;
      if (cur >= 0 && lod !== cur) {
        const edge = lod > cur ? (cur === 0 ? d0 : d1) * 1.08 : (lod === 0 ? d0 : d1) * 0.92;
        if ((lod > cur && d < edge) || (lod < cur && d > edge)) lod = cur;
      }
      if (lod !== cur) { assigned[i] = lod; changed = true; }
    }
    if (!changed) return;
    const n = [0, 0, 0];
    for (let i = 0; i < trees.length; i++) {
      const L = lods[assigned[i]], k = n[assigned[i]]++;
      L.wood.setMatrixAt(k, mats[i]); L.leaves.setMatrixAt(k, mats[i]); L.leaves.setColorAt(k, tints[i]);
    }
    lods.forEach((L, l) => {
      L.wood.count = L.leaves.count = n[l];
      L.wood.instanceMatrix.needsUpdate = L.leaves.instanceMatrix.needsUpdate = true;
      L.leaves.instanceColor.needsUpdate = true;
    });
  };
  update(new THREE.Vector3(1e5, 0, 1e5));
  return { group, update, materials: { bark, leaves } };
}
