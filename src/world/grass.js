import * as THREE from 'three';
import { extend, Foliage, needWorldPos, globals } from '../engine/patch.js';
import { MASK, LAWN_TINT_GLSL } from './lawn.js';

const RADIUS = 13;      // blades exist within this distance of the camera

/**
 * Short mown-turf blades around the camera. A fixed pool of instanced triangles is wrapped
 * toroidally around the viewer in the vertex shader, so the field follows the player with no
 * per-frame CPU work; the lawn mask keeps blades off the paving.
 */
function Blades(maskTex) {
  const f = (h) => {
    needWorldPos(h);
    h.uniforms.uLawnMask = { value: maskTex };
    h.uniforms.uNoise = globals.uNoise;
    h.uniforms.uWind = globals.uWind;
    h.vertPars.push(`
      attribute vec4 aBlade; uniform sampler2D uLawnMask; uniform sampler2D uNoise; uniform float uTime; uniform vec4 uWind;
      varying float vBladeT; varying vec3 vBladeN;`);
    h.vertBegin.push(`
      {
        const float R = ${RADIUS.toFixed(1)};
        vec2 cam = cameraPosition.xz;
        vec2 w = mod( aBlade.xy - cam + R, 2.0 * R ) - R + cam;
        float dist = length( w - cam );
        float keep = step( dist / R, 0.16 + aBlade.z * 1.15 ) * ( 1.0 - smoothstep( R * 0.72, R * 0.98, dist ) );
        float mask = step( 0.72, texture2D( uLawnMask, w / ${(MASK.half * 2).toFixed(1)} + 0.5 ).r );
        float tuft = texture2D( uNoise, w * 0.9 ).a;
        float hgt = ( 0.03 + 0.045 * aBlade.w + 0.03 * tuft ) * keep * mask;
        float ang = aBlade.z * 97.0;
        vec2 dir = vec2( cos( ang ), sin( ang ) );
        float wid = ( 0.0045 + 0.004 * aBlade.w ) * ( 1.0 + dist * 0.22 );
        vec2 lean = ( vec2( fract( aBlade.z * 13.7 ), fract( aBlade.w * 7.3 ) ) - 0.5 ) * 1.1;
        float gust = sin( uTime * 2.1 + w.x * 0.35 + w.y * 0.27 ) * 0.5 + sin( uTime * 3.7 + w.x * 1.1 ) * 0.25;
        lean += uWind.xy * ( 0.25 + 0.35 * gust ) * uWind.z;
        vec3 p = vec3( w.x, -0.04, w.y );
        p.xz += dir * position.x * wid;
        p.y += position.y * hgt;
        p.xz += lean * position.y * position.y * hgt;
        transformed = p;
        vBladeT = position.y;
        // shade like the turf underneath (mostly up) with a little of the blade's own facing
        vBladeN = normalize( vec3( 0.0, 1.0, 0.0 ) + vec3( -dir.y, 0.0, dir.x ) * 0.35 + vec3( lean.x, 0.0, lean.y ) * 0.3 );
      }`);
    h.vertMain.push('vNormal = normalize( normalMatrix * vBladeN );');
    h.fragPars.push('varying float vBladeT; uniform sampler2D uNoise;' + LAWN_TINT_GLSL);
    h.fragAlbedo.push(`
      diffuseColor.rgb = wlLawnTint( diffuseColor.rgb, vWlWorld.xz, uNoise );
      diffuseColor.rgb *= mix( 0.74, 1.1, vBladeT );`);
  };
  f.key = 'blades';
  return f;
}

export function createGrass(lawnMask, { density = 1 } = {}) {
  const n = Math.floor(190000 * density);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  const blade = new Float32Array(n * 4);
  let seed = 99;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    blade[i * 4] = rand() * RADIUS * 2; blade[i * 4 + 1] = rand() * RADIUS * 2;
    blade[i * 4 + 2] = rand(); blade[i * 4 + 3] = rand();
  }
  geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(blade, 4));
  geo.instanceCount = n;
  const mat = extend(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.155, 0.205, 0.078), roughness: 0.8, specularIntensity: 0.3, side: THREE.DoubleSide }),
    [Blades(lawnMask.texture), Foliage({ transmission: [0.7, 0.85, 0.25], amount: 0.8, occ: '( 0.7 + 0.3 * vBladeT )' })]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'grassBlades';
  return mesh;
}
