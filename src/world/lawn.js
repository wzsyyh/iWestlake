import * as THREE from 'three';
import { DEG } from './geom.js';
import { RING, HALL, NODE, PATHS, PERIMETER_PATH } from './layout.js';
import { LAWN_HALF } from './ground.js';
import { extend, Baked, Albedo, needWorldPos, globals } from '../engine/patch.js';
import { ALBEDO } from './albedo.js';

export const MASK = { half: LAWN_HALF, size: 2048 };

/**
 * Lawn coverage mask (white = grass). The paving meshes own the visible edges; the mask only has
 * to cut the lawn away somewhere underneath them, and tells the grass system where blades may grow.
 */
export function buildLawnMask(pits = []) {
  const S = MASK.size, k = S / (MASK.half * 2);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const X = (x) => (x + MASK.half) * k, Z = (z) => (z + MASK.half) * k;
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  // courtyard
  g.beginPath(); g.arc(X(0), Z(0), (RING.rPromenade + 0.12) * k, 0, Math.PI * 2); g.fill();
  // lawn beyond the perimeter path across the open (northern) arc; canvas angle = bearing - 90deg
  const a0 = RING.th1 - Math.PI / 2 + 0.5 * DEG, a1 = RING.th0 + Math.PI * 2 - Math.PI / 2 - 0.5 * DEG;
  g.beginPath();
  g.arc(X(0), Z(0), (MASK.half - 1) * k, a0, a1);
  g.arc(X(0), Z(0), (RING.rPromenade + PERIMETER_PATH - 0.12) * k, a1, a0, true);
  g.closePath(); g.fill();
  g.fillStyle = '#000'; g.strokeStyle = '#000';
  g.beginPath(); g.arc(X(HALL.x), Z(HALL.z), (HALL.rPlaza - 0.12) * k, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(X(NODE.x), Z(NODE.z), (NODE.r - 0.12) * k, 0, Math.PI * 2); g.fill();
  g.lineCap = 'butt'; g.lineJoin = 'round';
  for (const p of PATHS) {
    g.lineWidth = (p.w - 0.24) * k;
    g.beginPath();
    p.pts.forEach((q, i) => (i ? g.lineTo(X(q.x), Z(q.z)) : g.moveTo(X(q.x), Z(q.z))));
    g.stroke();
  }
  for (const pit of pits) { g.beginPath(); g.arc(X(pit.x), Z(pit.z), pit.r * k, 0, Math.PI * 2); g.fill(); }
  const data = g.getImageData(0, 0, S, S).data;
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  /** Lawn coverage 0..1 at a world position (bilinear). */
  const sample = (x, z) => {
    const fx = X(x) - 0.5, fz = Z(z) - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    if (x0 < 0 || z0 < 0 || x0 >= S - 1 || z0 >= S - 1) return 0;
    const tx = fx - x0, tz = fz - z0, i = (z0 * S + x0) * 4;
    return ((data[i] * (1 - tx) + data[i + 4] * tx) * (1 - tz) + (data[i + S * 4] * (1 - tx) + data[i + S * 4 + 4] * tx) * tz) / 255;
  };
  return { texture: tex, sample };
}

/** Large-scale colour variation of the turf, shared by the lawn surface and the grass blades growing on it. */
export const LAWN_TINT_GLSL = /* glsl */`
  vec3 wlLawnTint( vec3 c, vec2 p, sampler2D noise ) {
    float n1 = texture2D( noise, p * 0.011 ).r;
    float n2 = texture2D( noise, p * 0.047 + 0.3 ).g;
    float n3 = texture2D( noise, p * 0.31 ).b;
    float dry = smoothstep( 0.52, 0.78, n1 * 0.6 + n2 * 0.4 );
    c *= mix( vec3( 0.9, 1.0, 0.82 ), vec3( 1.28, 1.14, 0.62 ), dry * 0.55 );
    return c * ( 0.86 + 0.28 * n3 );
  }`;

function Lawn(mask, grass2) {
  const f = (h) => {
    needWorldPos(h);
    h.uniforms.uLawnMask = { value: mask };
    h.uniforms.uGrass2 = { value: grass2 };
    h.uniforms.uNoise = globals.uNoise;
    h.fragPars.push('uniform sampler2D uLawnMask; uniform sampler2D uGrass2; uniform sampler2D uNoise;');
    h.fragPre.push(`
      if ( texture2D( uLawnMask, vWlWorld.xz / ${(MASK.half * 2).toFixed(1)} + 0.5 ).r < 0.5 ) discard;`);
    h.fragPars.push(LAWN_TINT_GLSL);
    h.fragAlbedo.push(`
      {
        vec3 g2 = texture2D( uGrass2, vWlWorld.xz / 6.3 ).rgb;
        float n2 = texture2D( uNoise, vWlWorld.xz * 0.047 + 0.3 ).g;
        // break the tiling with the second texture, then add dry / lush patches
        diffuseColor.rgb = mix( diffuseColor.rgb, g2 * vec3( 1.25, 1.2, 1.0 ), smoothstep( 0.35, 0.7, n2 ) * 0.55 );
        diffuseColor.rgb = wlLawnTint( diffuseColor.rgb, vWlWorld.xz, uNoise );
      }`);
    h.fragRoughness.push('roughnessFactor = clamp( roughnessFactor * 1.1, 0.6, 1.0 );');
  };
  f.key = 'lawn';
  return f;
}


export async function createLawnMaterial(assets, lawnMask) {
  const [grass, grass2] = await Promise.all([assets.pbr('grass', 2.3), assets.texture('grass2_col.jpg', { srgb: true })]);
  const mat = new THREE.MeshPhysicalMaterial({
    specularIntensity: 0.35,
    map: grass.map, normalMap: grass.normalMap, roughnessMap: grass.orm, aoMap: grass.orm,
    color: new THREE.Color(0.98, 0.94, 0.74), roughness: 1, normalScale: new THREE.Vector2(1.3, 1.3),
  });
  mat.userData.bake = ALBEDO.lawn;
  return extend(mat, [Baked(), Albedo({ sat: 0.8, contrast: 1 }), Lawn(lawnMask.texture, grass2)]);
}
