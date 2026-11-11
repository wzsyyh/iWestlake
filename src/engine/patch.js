import * as THREE from 'three';

/**
 * Shader extension framework for the built-in PBR materials.
 *
 * Features contribute GLSL snippets to named hooks; `extend()` assembles them into the stock
 * MeshStandard/Physical shader in one pass (and chains three's cascaded-shadow hook), so features
 * compose freely on one material.
 */

const Chunk = THREE.ShaderChunk;

/** Uniforms shared by every extended material. */
export const globals = {
  uTime: { value: 0 },
  uBaked: { value: 0 },                 // 0 = image-based ambient, 1 = baked per-vertex irradiance
  uNoise: { value: null },
  uWind: { value: new THREE.Vector4(1, 0, 0.6, 0) },   // xy = direction, z = strength
  uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
};

/** Shared by the planar-mirror feature and the pass that renders the mirror image (engine/mirror.js). */
export const mirrorUniforms = {
  tMirror: { value: null },
  uMirrorMatrix: { value: new THREE.Matrix4() },
  uMirrorOn: { value: 0 },
};

let csm = null;
export function setCSM(c) { csm = c; }

export function makeNoiseTexture(size = 256) {
  // tileable multi-octave value noise in RGBA (four decorrelated channels)
  const data = new Uint8Array(size * size * 4);
  let seed = 1337;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let ch = 0; ch < 4; ch++) {
    const acc = new Float32Array(size * size);
    let amp = 0.5, norm = 0;
    for (let oct = 0; oct < 6; oct++) {
      const n = 4 << oct;
      const lattice = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) lattice[i] = rand();
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * n, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * n, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
          const a = lattice[(y0 % n) * n + (x0 % n)], b = lattice[(y0 % n) * n + ((x0 + 1) % n)];
          const c = lattice[((y0 + 1) % n) * n + (x0 % n)], d = lattice[((y0 + 1) % n) * n + ((x0 + 1) % n)];
          acc[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        }
      }
      norm += amp; amp *= 0.5;
    }
    for (let i = 0; i < size * size; i++) data[i * 4 + ch] = Math.max(0, Math.min(255, (acc[i] / norm) * 255));
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const COMMON_FRAG = /* glsl */`
float wlHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 wlHash2(vec2 p) { return vec2(wlHash(p), wlHash(p + 17.13)); }
`;

function newHooks() {
  return {
    defines: {}, uniforms: {},
    vertPars: [], vertBegin: [], vertMain: [],
    fragPars: [], fragParsLate: [], fragPre: [], fragTex: [], fragAlbedo: [], fragNormalTS: [], fragRoughness: [], fragLit: [], fragEnd: [],
    irradiance: null, specOcc: null, radiance: null, triplanar: null, noNormalFlip: false, directFn: null,
  };
}

function assemble(shader, h) {
  Object.assign(shader.uniforms, h.uniforms);
  let vs = shader.vertexShader, fs = shader.fragmentShader;
  const rep = (src, tag, by) => {
    if (!src.includes(tag)) console.warn('[patch] missing', tag);
    return src.replace(tag, by);
  };

  // ---- vertex
  vs = rep(vs, '#include <common>', '#include <common>\n' + h.vertPars.join('\n'));
  if (h.vertBegin.length) vs = rep(vs, '#include <begin_vertex>', '#include <begin_vertex>\n' + h.vertBegin.join('\n'));
  if (h.vertMain.length) vs = rep(vs, '#include <project_vertex>', '#include <project_vertex>\n' + h.vertMain.join('\n'));

  // ---- fragment
  fs = rep(fs, '#include <common>', '#include <common>\n' + COMMON_FRAG + h.fragPars.join('\n'));
  // declarations that need the material's own samplers (map, normalMap, ...) to exist already
  if (h.fragParsLate.length) fs = rep(fs, '#include <normalmap_pars_fragment>', '#include <normalmap_pars_fragment>\n' + h.fragParsLate.join('\n'));

  const tex = (sampler, uv) => h.triplanar
    ? `wlTriplanar(${sampler})`
    : `textureGrad(${sampler}, ${uv} + wlUvOff, dFdx(${uv}), dFdy(${uv}))`;

  fs = rep(fs, '#include <map_fragment>', `
    vec2 wlUvOff = vec2(0.0);
    ${h.fragPre.join('\n')}
    #ifdef USE_MAP
      vec4 wlTex = ${tex('map', 'vMapUv')};
      ${h.fragTex.join('\n')}
      diffuseColor *= wlTex;
    #endif
    ${h.fragAlbedo.join('\n')}
  `);
  fs = rep(fs, '#include <roughnessmap_fragment>', `
    float roughnessFactor = roughness;
    #ifdef USE_ROUGHNESSMAP
      vec4 wlOrm = ${tex('roughnessMap', 'vRoughnessMapUv')};
      roughnessFactor *= wlOrm.g;
    #endif
    ${h.fragRoughness.join('\n')}
  `);
  fs = rep(fs, '#include <metalnessmap_fragment>', `
    float metalnessFactor = metalness;
    #ifdef USE_METALNESSMAP
      #ifdef USE_ROUGHNESSMAP
        metalnessFactor *= wlOrm.b;
      #else
        metalnessFactor *= ${tex('metalnessMap', 'vMetalnessMapUv')}.b;
      #endif
    #endif
  `);
  if (h.noNormalFlip) {
    fs = rep(fs, '#include <normal_fragment_begin>', `
      float faceDirection = 1.0;
      vec3 normal = normalize( vNormal );
      #if defined( USE_NORMALMAP_TANGENTSPACE )
        mat3 tbn = getTangentFrame( - vViewPosition, normal, vNormalMapUv );
      #endif
      vec3 nonPerturbedNormal = normal;
    `);
  }
  fs = rep(fs, '#include <normal_fragment_maps>', h.triplanar ? `
    #ifdef USE_NORMALMAP_TANGENTSPACE
      normal = wlTriplanarNormal(normal);
    #endif
  ` : `
    #ifdef USE_NORMALMAP_TANGENTSPACE
      vec3 mapN = ${tex('normalMap', 'vNormalMapUv')}.xyz * 2.0 - 1.0;
      mapN.xy *= normalScale;
      ${h.fragNormalTS.join('\n')}
      normal = normalize( tbn * mapN );
    #endif
  `);
  fs = rep(fs, '#include <aomap_fragment>', `
    #ifdef USE_AOMAP
      #ifdef USE_ROUGHNESSMAP
        float ambientOcclusion = ( wlOrm.r - 1.0 ) * aoMapIntensity + 1.0;
      #else
        float ambientOcclusion = ( ${tex('aoMap', 'vAoMapUv')}.r - 1.0 ) * aoMapIntensity + 1.0;
      #endif
      reflectedLight.indirectDiffuse *= ambientOcclusion;
      #if defined( USE_ENVMAP ) && defined( STANDARD )
        reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), ambientOcclusion, material.roughness );
      #endif
    #endif
    ${h.fragLit.join('\n')}
  `);
  if (h.irradiance || h.specOcc || h.radiance) {
    let lm = Chunk.lights_fragment_maps;
    if (h.irradiance) lm = lm.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', h.irradiance);
    if (h.specOcc || h.radiance) {
      // wlEnv = probe reflection (optionally occluded); a feature may swap in something better
      lm = lm.replace('radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
        `vec3 wlEnv = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * ( ${h.specOcc || '1.0'} );
        ${h.radiance || 'radiance += wlEnv;'}`);
    }
    fs = rep(fs, '#include <lights_fragment_maps>', lm);
  }
  if (h.directFn) {
    fs = rep(fs, '#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + h.directFn + '\n#undef RE_Direct\n#define RE_Direct RE_Direct_WL\n');
  }
  if (h.fragEnd.length) fs = rep(fs, '#include <opaque_fragment>', h.fragEnd.join('\n') + '\n#include <opaque_fragment>');

  shader.vertexShader = vs;
  shader.fragmentShader = fs;
}

/**
 * Extend a MeshStandardMaterial / MeshPhysicalMaterial with features (and cascaded shadows).
 * Returns the same material.
 */
export function extend(material, features = []) {
  const h = newHooks();
  h.uniforms.uTime = globals.uTime;
  for (const f of features) f(h, material);
  material.defines = { ...(material.defines || {}), ...h.defines };
  let csmHook = null;
  if (csm) {
    csm.setupMaterial(material);
    csmHook = material.onBeforeCompile;
  }
  material.onBeforeCompile = (shader, renderer) => {
    if (csmHook) csmHook.call(material, shader, renderer);
    assemble(shader, h);
    material.userData.shader = shader;
  };
  const key = 'wl|' + features.map((f) => f.key || f.name).join('|') + (csm ? '|csm' : '');
  material.customProgramCacheKey = () => key;
  material.userData.features = features;
  return material;
}

// ------------------------------------------------------------------ features

/** Per-vertex baked sky + one-bounce irradiance (rgb) and sky visibility (a) replace the ambient probe. */
export function Baked({ specOcc = true } = {}) {
  const f = (h) => {
    h.uniforms.uBaked = globals.uBaked;
    h.vertPars.push('attribute vec4 bakedIrr; varying vec4 vBaked;');
    h.vertMain.push('vBaked = bakedIrr;');
    h.fragPars.push('varying vec4 vBaked; uniform float uBaked;');
    h.irradiance = 'iblIrradiance += mix( getIBLIrradiance( geometryNormal ), vBaked.rgb, uBaked );';
    // rough reflections follow the baked visibility; mirror-like ones keep the probe
    if (specOcc) h.specOcc = 'mix( 1.0, mix( 1.0, clamp( vBaked.a * 1.15, 0.0, 1.0 ), 0.35 + 0.65 * material.roughness ), uBaked )';
  };
  f.key = 'baked:' + specOcc;
  return f;
}

/**
 * Re-balance a photo texture before it is tinted by material.color:
 *  sat      0 = greyscale, 1 = as scanned
 *  contrast 0 = flat `mid` grey, 1 = as scanned (keeps the grain, drops the stains)
 */
export function Albedo({ sat = 1, contrast = 1, mid = 0.5 } = {}) {
  const f = (h) => {
    h.fragTex.push(`
      {
        float wlL = dot( wlTex.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        wlTex.rgb = mix( vec3( wlL ), wlTex.rgb, ${sat.toFixed(3)} );
        wlTex.rgb = mix( vec3( ${mid.toFixed(3)} ), wlTex.rgb, ${contrast.toFixed(3)} );
      }`);
  };
  f.key = `albedo:${sat}:${contrast}:${mid}`;
  return f;
}

/**
 * Polished floor: reflect the real scene (rendered from the mirrored camera by PlanarMirror)
 * instead of the static probe. Fresnel still comes from the PBR model, so the mirror is faint
 * looking straight down and strong at grazing angles; roughness blurs it through the mip chain.
 */
export function Mirror() {
  const f = (h) => {
    needWorldPos(h);
    Object.assign(h.uniforms, mirrorUniforms);
    h.vertPars.push('uniform mat4 uMirrorMatrix; varying vec4 vMirror;');
    h.vertMain.push('vMirror = uMirrorMatrix * vec4( vWlWorld, 1.0 );');
    h.fragPars.push('uniform sampler2D tMirror; uniform float uMirrorOn; varying vec4 vMirror;');
    h.radiance = `
      if ( uMirrorOn > 0.0 ) {
        vec2 muv = vMirror.xy / vMirror.w + ( normal.xz - nonPerturbedNormal.xz ) * 0.05;
        vec3 mcol = textureLod( tMirror, clamp( muv, 0.002, 0.998 ), material.roughness * 7.0 ).rgb;
        radiance += mix( wlEnv, mcol, uMirrorOn );
      } else radiance += wlEnv;`;
  };
  f.key = 'mirror';
  return f;
}

/** World-space position varying `vWlWorld` (needed by several features). */
export function needWorldPos(h) {
  if (h._wp) return;
  h._wp = true;
  h.vertPars.push('varying vec3 vWlWorld;');
  h.vertMain.push(`
    vec4 wlWp = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      wlWp = instanceMatrix * wlWp;
    #endif
    vWlWorld = ( modelMatrix * wlWp ).xyz;`);
  h.fragPars.push('varying vec3 vWlWorld;');
}

/** Large-scale albedo / roughness variation so tiled textures do not read as tiles. */
export function Macro({ scale = 0.035, amount = 0.16, roughAmount = 0.1, streaks = 0 } = {}) {
  const f = (h) => {
    needWorldPos(h);
    h.uniforms.uNoise = globals.uNoise;
    h.fragPars.push('uniform sampler2D uNoise; float wlMacro = 0.5;');
    h.fragAlbedo.push(`
      {
        vec3 an = abs( normalize( cross( dFdx( vWlWorld ), dFdy( vWlWorld ) ) ) );
        vec2 mp = an.y > 0.5 ? vWlWorld.xz : ( an.x > an.z ? vWlWorld.zy : vWlWorld.xy );
        vec4 n1 = texture2D( uNoise, mp * ${scale.toFixed(4)} );
        vec4 n2 = texture2D( uNoise, mp * ${(scale * 7.3).toFixed(4)} + 0.37 );
        wlMacro = n1.r * 0.65 + n2.g * 0.35;
        diffuseColor.rgb *= 1.0 + ( wlMacro - 0.5 ) * ${(amount * 2).toFixed(3)};
        ${streaks > 0 ? `
        // rain streaks on vertical faces: stretched noise running down the wall
        float st = texture2D( uNoise, vec2( ( an.x > an.z ? vWlWorld.z : vWlWorld.x ) * 0.9, vWlWorld.y * 0.035 ) ).b;
        diffuseColor.rgb *= 1.0 - ( 1.0 - an.y ) * smoothstep( 0.52, 0.8, st ) * ${streaks.toFixed(3)};` : ''}
      }`);
    if (roughAmount > 0) h.fragRoughness.push(`roughnessFactor = clamp( roughnessFactor + ( wlMacro - 0.5 ) * ${(roughAmount * 2).toFixed(3)}, 0.03, 1.0 );`);
  };
  f.key = `macro:${scale}:${amount}:${roughAmount}:${streaks}`;
  return f;
}

/**
 * Procedural joints between stone slabs / cladding panels, driven by the geometry's `cell` attribute.
 *  size      [x, y] cell size in metres (only used to keep the joint width physical)
 *  width     joint width in metres
 *  jitter    0..0.9 random slab length variation along x
 *  stagger   0..1 random course offset (running bond)
 *  tint      per-slab albedo variation
 *  shuffle   give every slab its own random patch of the texture (hides tiling completely)
 *  bevel     normal-map strength of the arris
 */
export function Joints({ size = [1, 1], width = 0.006, dark = 0.55, jitter = 0, stagger = 0, tint = 0.05, shuffle = false, bevel = 0.6, rough = 0.0 } = {}) {
  const f = (h) => {
    h.vertPars.push('attribute vec2 cell; varying vec2 vCell;');
    h.vertMain.push('vCell = cell;');
    h.fragPars.push('varying vec2 vCell; float wlJoint = 0.0; vec2 wlJointDir = vec2(0.0); float wlCellRnd = 0.5;');
    h.fragPre.push(`
      {
        vec2 cc = vCell;
        float row = floor( cc.y );
        cc.x += ${stagger.toFixed(3)} * wlHash( vec2( row, 7.0 ) ) * 37.0;
        float ix = floor( cc.x );
        float b0 = ix + ${jitter.toFixed(3)} * wlHash( vec2( ix, row ) );
        if ( cc.x < b0 ) { ix -= 1.0; b0 = ix + ${jitter.toFixed(3)} * wlHash( vec2( ix, row ) ); }
        float b1 = ix + 1.0 + ${jitter.toFixed(3)} * wlHash( vec2( ix + 1.0, row ) );
        vec2 cs = vec2( ${size[0].toFixed(4)}, ${size[1].toFixed(4)} );
        float dl = ( cc.x - b0 ) * cs.x, dr = ( b1 - cc.x ) * cs.x;
        float db = fract( cc.y ) * cs.y, dt = ( 1.0 - fract( cc.y ) ) * cs.y;
        float dx = min( dl, dr ), dy = min( db, dt );
        float d = min( dx, dy );
        vec2 fw = fwidth( vCell ) * cs;
        float aa = max( max( fw.x, fw.y ), 1e-5 );
        float w = ${(width * 0.5).toFixed(5)};
        wlJoint = smoothstep( w + aa, w - aa, d ) * clamp( 2.5 * w / aa, 0.0, 1.0 );
        // arris: tilt the normal towards the joint over a couple of centimetres
        float bw = 0.018;
        float bx = ( 1.0 - smoothstep( 0.0, bw, dx ) ) * ( dl < dr ? -1.0 : 1.0 );
        float by = ( 1.0 - smoothstep( 0.0, bw, dy ) ) * ( db < dt ? -1.0 : 1.0 );
        wlJointDir = vec2( bx, by ) * clamp( bw / aa, 0.0, 1.0 );
        vec2 id = vec2( ix, row );
        wlCellRnd = wlHash( id + 3.7 );
        ${shuffle ? 'wlUvOff = wlHash2( id ) * 7.0;' : ''}
      }`);
    h.fragAlbedo.push(`
      diffuseColor.rgb *= 1.0 + ( wlCellRnd - 0.5 ) * ${(tint * 2).toFixed(3)};
      diffuseColor.rgb *= mix( 1.0, ${(1 - dark).toFixed(3)}, wlJoint );`);
    h.fragRoughness.push(`roughnessFactor = clamp( mix( roughnessFactor + ( wlCellRnd - 0.5 ) * ${(rough * 2).toFixed(3)}, 0.95, wlJoint ), 0.03, 1.0 );`);
    h.fragNormalTS.push(`mapN.xy += wlJointDir * ${bevel.toFixed(3)};`);
  };
  f.key = `joints:${size}:${width}:${dark}:${jitter}:${stagger}:${tint}:${shuffle}:${bevel}:${rough}`;
  return f;
}

/** Object-space triplanar texturing (bark): geometry needs no UVs. */
export function Triplanar({ scale = 1.0 } = {}) {
  const f = (h) => {
    h.triplanar = true;
    h.vertPars.push('varying vec3 vObjPos; varying vec3 vObjNor; varying mat3 vObjToView;');
    h.vertBegin.push(`
      vObjPos = position; vObjNor = normal;
      mat3 wlM = mat3( modelViewMatrix );
      #ifdef USE_INSTANCING
        wlM = wlM * mat3( instanceMatrix );
      #endif
      vObjToView = wlM;`);
    h.fragPars.push('varying vec3 vObjPos; varying vec3 vObjNor; varying mat3 vObjToView;');
    h.fragParsLate.push(`
      vec3 wlTriW() { vec3 w = pow( abs( normalize( vObjNor ) ), vec3( 4.0 ) ) + 1e-4; return w / ( w.x + w.y + w.z ); }
      vec4 wlTriplanar( sampler2D t ) {
        vec3 w = wlTriW(); vec3 p = vObjPos * ${scale.toFixed(4)};
        return texture2D( t, p.zy ) * w.x + texture2D( t, p.xz ) * w.y + texture2D( t, p.xy ) * w.z;
      }
      #ifdef USE_NORMALMAP_TANGENTSPACE
      vec3 wlTriplanarNormal( vec3 viewN ) {
        vec3 w = wlTriW(); vec3 p = vObjPos * ${scale.toFixed(4)}; vec3 n = normalize( vObjNor );
        vec3 tx = texture2D( normalMap, p.zy ).xyz * 2.0 - 1.0;
        vec3 ty = texture2D( normalMap, p.xz ).xyz * 2.0 - 1.0;
        vec3 tz = texture2D( normalMap, p.xy ).xyz * 2.0 - 1.0;
        tx.xy *= normalScale; ty.xy *= normalScale; tz.xy *= normalScale;
        // whiteout blend, swizzled back to object space
        vec3 nx = vec3( 0.0, tx.y, tx.x ) ; nx = vec3( n.x, nx.y + n.y, nx.z + n.z );
        vec3 ny = vec3( ty.x + n.x, n.y, ty.y + n.z );
        vec3 nz = vec3( tz.x + n.x, tz.y + n.y, n.z );
        vec3 on = normalize( nx * w.x + ny * w.y + nz * w.z );
        return normalize( vObjToView * on );
      }
      #endif`);
  };
  f.key = `triplanar:${scale}`;
  return f;
}

/** Tree / shrub wind: slow trunk bend, branch sway and (for leaves) per-leaf flutter. */
export function Wind({ leaves = false, scale = 1 } = {}) {
  const f = (h) => {
    h.uniforms.uWind = globals.uWind;
    h.vertPars.push(`uniform float uTime; uniform vec4 uWind; ${leaves ? 'attribute vec3 _leafdata; varying vec3 vLeaf;' : ''}`);
    h.vertBegin.push(`
      {
        #ifdef USE_INSTANCING
          vec3 wlO = vec3( instanceMatrix[3] );
        #else
          vec3 wlO = vec3( modelMatrix[3] );
        #endif
        float ph = dot( wlO.xz, vec2( 0.37, 0.71 ) );
        float hgt = max( transformed.y, 0.0 ) * ${scale.toFixed(3)};
        float gust = 0.55 + 0.3 * sin( uTime * 0.63 + ph ) + 0.15 * sin( uTime * 1.71 + ph * 1.9 );
        float s = uWind.z * gust;
        // trunk
        transformed.xz += vec2( 0.8, 0.6 ) * ( hgt * hgt ) * 0.0022 * s / ${scale.toFixed(3)};
        // branches
        float bp = ph + dot( transformed, vec3( 1.3, 0.9, 1.7 ) );
        float away = length( transformed.xz ) * ${scale.toFixed(3)};
        transformed += vec3( sin( uTime * 1.9 + bp ), 0.5 * sin( uTime * 2.6 + bp * 1.3 ), cos( uTime * 1.5 + bp ) ) * ( 0.006 * away + 0.002 * hgt ) * s / ${scale.toFixed(3)};
        ${leaves ? `
        vLeaf = _leafdata;
        float fl = sin( uTime * ( 6.0 + 5.0 * _leafdata.x ) + _leafdata.x * 61.0 + bp );
        transformed += normal * fl * 0.006 * s;` : ''}
      }`);
    if (leaves) h.fragPars.push('varying vec3 vLeaf;');
  };
  f.key = `wind:${leaves}:${scale}`;
  return f;
}

/** Leaf shading: no back-face normal flip, canopy occlusion, and light bleeding through the blade. */
export function Foliage({ transmission = [0.55, 0.72, 0.18], amount = 1.0, occ = 'vLeaf.y' } = {}) {
  const f = (h) => {
    h.noNormalFlip = true;
    h.directFn = `
      void RE_Direct_WL( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
        float occ = mix( 1.0, ${occ}, 0.55 );
        IncidentLight l = directLight;
        l.color *= occ;
        RE_Direct_Physical( l, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
        // transmitted light: strongest when looking towards the sun through the leaf
        float back = saturate( dot( -geometryNormal, l.direction ) * 0.6 + 0.4 );
        float vdl = saturate( dot( geometryViewDir, -l.direction ) );
        float through = back * ( 0.35 + 0.65 * vdl * vdl );
        reflectedLight.directDiffuse += l.color * material.diffuseColor * vec3( ${transmission.map((v) => v.toFixed(3)).join(', ')} ) * through * ${amount.toFixed(3)} * RECIPROCAL_PI * 2.2;
      }`;
    h.fragLit.push(`reflectedLight.indirectDiffuse *= ${occ}; reflectedLight.indirectSpecular *= ${occ} * 0.6;`);
  };
  f.key = `foliage:${transmission}:${amount}:${occ}`;
  return f;
}

// ------------------------------------------------------------------ global chunks

/**
 * Replaces three's fog with analytic exponential height fog whose colour warms up towards the sun
 * (cheap aerial perspective). Uses scene.fog = FogExp2 for colour + density.
 */
export function installAtmosphere({ sunDir, sunColor, heightFalloff = 0.012, baseHeight = 0 }) {
  const v3 = (v) => `vec3(${(v.x ?? v.r).toFixed(5)}, ${(v.y ?? v.g).toFixed(5)}, ${(v.z ?? v.b).toFixed(5)})`;
  Chunk.fog_pars_vertex = /* glsl */`
    #ifdef USE_FOG
      varying vec3 vFogRay;
    #endif`;
  Chunk.fog_vertex = /* glsl */`
    #ifdef USE_FOG
      vFogRay = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
    #endif`;
  Chunk.fog_pars_fragment = /* glsl */`
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vFogRay;
      uniform float fogDensity;
      vec3 wlFog( vec3 color, vec3 ray ) {
        float dist = length( ray );
        vec3 dir = ray / max( dist, 1e-4 );
        float k = ${heightFalloff.toFixed(5)};
        float t = k * dir.y * dist;
        float column = abs( t ) > 1e-3 ? ( 1.0 - exp( -t ) ) / t : 1.0;
        float od = fogDensity * exp( -k * ( cameraPosition.y - ${baseHeight.toFixed(2)} ) ) * dist * column;
        float f = 1.0 - exp( -od );
        float sunAmt = pow( max( dot( dir, ${v3(sunDir)} ), 0.0 ), 6.0 );
        vec3 fc = mix( fogColor, ${v3(sunColor)}, sunAmt * 0.75 );
        return mix( color, fc, f );
      }
    #endif`;
  Chunk.fog_fragment = /* glsl */`
    #ifdef USE_FOG
      gl_FragColor.rgb = wlFog( gl_FragColor.rgb, vFogRay );
    #endif`;
}

/**
 * Percentage-closer soft shadows for the sun: the penumbra widens with the distance between the
 * occluder and the receiver (crisp where a column meets the floor, soft under a tree canopy).
 * Every cascade passes its world-space width through `light.shadow.radius`, so the softness is
 * the same physical size in all of them. A receiver-plane depth bias keeps the wide kernel from
 * self-shadowing surfaces that are oblique to the light.
 */
export function installSoftShadows({ depthRange = 899, softness = 0.02, maxPenumbra = 1.3, blockerTaps = 10, filterTaps = 16 } = {}) {
  const pcss = /* glsl */`
    float wlIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
    vec2 wlVogel( int i, float n, float phi ) {
      float r = sqrt( ( float( i ) + 0.5 ) / n );
      float a = float( i ) * 2.39996323 + phi;
      return vec2( cos( a ), sin( a ) ) * r;
    }
    float wlPCSS( sampler2D shadowMap, vec2 mapSize, float widthMetres, vec3 coord ) {
      float uvPerMetre = 1.0 / max( widthMetres, 1.0 );
      float texel = 1.0 / mapSize.x;
      vec3 dx = dFdx( coord ), dy = dFdy( coord );
      float det = dx.x * dy.y - dx.y * dy.x;
      vec2 grad = abs( det ) > 1e-14 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
      grad = clamp( grad, vec2( -6.0 ), vec2( 6.0 ) );
      float phi = wlIGN( gl_FragCoord.xy ) * 6.2831853;
      float search = max( ${(maxPenumbra * 0.5).toFixed(3)} * uvPerMetre, texel * 1.5 );
      float sum = 0.0, cnt = 0.0;
      for ( int i = 0; i < ${blockerTaps}; i ++ ) {
        vec2 o = wlVogel( i, ${blockerTaps.toFixed(1)}, phi ) * search;
        float d = unpackRGBAToDepth( texture2D( shadowMap, coord.xy + o ) );
        if ( d < coord.z + dot( o, grad ) ) { sum += d; cnt += 1.0; }
      }
      if ( cnt < 0.5 ) return 1.0;
      float pen = max( coord.z - sum / cnt, 0.0 ) * ${depthRange.toFixed(1)} * ${softness.toFixed(4)};
      float radius = clamp( pen * 0.5 * uvPerMetre, texel * 0.75, search );
      float lit = 0.0;
      for ( int i = 0; i < ${filterTaps}; i ++ ) {
        vec2 o = wlVogel( i, ${filterTaps.toFixed(1)}, phi + 1.7 ) * radius;
        lit += step( coord.z + dot( o, grad ), unpackRGBAToDepth( texture2D( shadowMap, coord.xy + o ) ) );
      }
      return lit / ${filterTaps.toFixed(1)};
    }
  `;
  let c = Chunk.shadowmap_pars_fragment;
  if (c.includes('wlPCSS')) return;
  c = c.replace('float getShadow(', pcss + '\n\tfloat getShadow(');
  c = c.replace('#if defined( SHADOWMAP_TYPE_PCF )', '#if defined( SHADOWMAP_TYPE_PCF_SOFT )\n\t\t\tshadow = wlPCSS( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz );\n\t\t#elif defined( SHADOWMAP_TYPE_PCF )');
  // the stock PCF_SOFT branch further down is now unreachable; neutralise its guard
  c = c.replace('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )', '#elif defined( WL_UNUSED_PCF_SOFT )');
  Chunk.shadowmap_pars_fragment = c;
}
