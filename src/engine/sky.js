import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const fromHalf = THREE.DataUtils.fromHalfFloat;
const toHalf = THREE.DataUtils.toHalfFloat;

/**
 * Loads an equirectangular HDR sky and turns it into a physically consistent lighting rig:
 *
 *  - finds the sun, measures its irradiance, and rotates the panorama so the sun sits at the
 *    requested compass azimuth (rotation is done on the pixels, so no runtime rotation is needed)
 *  - `background`: full-resolution sky (sun included) for the sky dome
 *  - `ambient`:    small copy with the sun disc removed and the ground hemisphere replaced by the
 *                  bounce colour of the site; used for image-based ambient + the lighting bake
 *  - everything is normalised so a white horizontal card in full sun has radiance ~1
 */
export async function loadSky(url, opts = {}) {
  const tex = await new RGBELoader().setDataType(THREE.HalfFloatType).loadAsync(url, opts.onProgress);
  const sky = analyseSky(tex.image, opts);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sky.background = tex;
  return sky;
}

/**
 * Pure analysis step (no GPU): `image` = { data: Uint16Array half-float RGBA, width, height }.
 * Rotates `image.data` in place. Also used by the offline lighting baker.
 */
export function analyseSky(image, { sunAzimuth, groundAlbedo = [0.3, 0.3, 0.27], sunBoost = 1, sunTint = [1, 1, 1] } = {}) {
  const { data, width: W, height: H } = image;            // row 0 = zenith

  // ---- coarse luminance scan to find the sun
  const lum = (i) => 0.2126 * fromHalf(data[i]) + 0.7152 * fromHalf(data[i + 1]) + 0.0722 * fromHalf(data[i + 2]);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < H / 2; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const l = lum((y * W + x) * 4);
      if (l > best) { best = l; bx = x; by = y; }
    }
  }
  // refine: luminance-weighted centroid in a small window
  let sx = 0, sy = 0, sw = 0;
  const win = Math.round(W / 360 * 2.5);
  for (let y = Math.max(0, by - win); y <= Math.min(H - 1, by + win); y++) {
    for (let dx = -win; dx <= win; dx++) {
      const x = (bx + dx + W) % W;
      const l = lum((y * W + x) * 4);
      if (l > best * 0.25) { sx += (bx + dx) * l; sy += y * l; sw += l; }
    }
  }
  const sunX = sx / sw, sunY = sy / sw;
  const sunElevation = (0.5 - (sunY + 0.5) / H) * Math.PI;

  // ---- rotate the panorama so the sun lands on the requested azimuth
  // equirect convention (three.js): u = atan2(dir.z, dir.x) / 2pi + 0.5
  const targetPhi = Math.atan2(-Math.cos(sunAzimuth), Math.sin(sunAzimuth));
  const targetX = (targetPhi / (2 * Math.PI) + 0.5) * W - 0.5;
  const shift = ((Math.round(targetX - sunX) % W) + W) % W;
  if (shift !== 0) {
    const row = new Uint16Array(W * 4);
    for (let y = 0; y < H; y++) {
      const o = y * W * 4;
      row.set(data.subarray(o, o + W * 4));
      data.set(row.subarray(0, (W - shift) * 4), o + shift * 4);
      data.set(row.subarray((W - shift) * 4), o);
    }
  }
  const sunCol = (sunX + shift) % W;
  const phi = ((sunCol + 0.5) / W - 0.5) * 2 * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(sunElevation) * Math.cos(phi), Math.sin(sunElevation), Math.cos(sunElevation) * Math.sin(phi)).normalize();

  // ---- small float copy (ambient), measuring sun and sky energy on the way
  const AW = 512, AH = 256, fx = W / AW, fy = H / AH;
  const amb = new Float32Array(AW * AH * 3);
  const dOmegaPix = (y) => (2 * Math.PI / W) * (Math.PI / H) * Math.cos((0.5 - (y + 0.5) / H) * Math.PI);
  // sky luminance reference = median-ish value of the upper hemisphere away from the sun
  let ref = 0, refN = 0;
  for (let y = 8; y < H / 2; y += 16) for (let x = 0; x < W; x += 16) { ref += Math.min(lum((y * W + x) * 4), 50); refN++; }
  ref /= refN;
  const sunThreshold = Math.max(ref * 12, 4);
  const sunRadiusPx = W / 360 * 6;                        // the disc + its brightest aureole
  const sunE = [0, 0, 0];
  const cosSunElev = Math.cos(sunElevation);
  for (let y = 0; y < H; y++) {
    const ay = Math.min(AH - 1, Math.floor(y / fy));
    const dO = dOmegaPix(y);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r = fromHalf(data[i]), g = fromHalf(data[i + 1]), b = fromHalf(data[i + 2]);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > sunThreshold) {
        let ddx = Math.abs(x - sunCol); ddx = Math.min(ddx, W - ddx) * cosSunElev;
        if (Math.hypot(ddx, y - sunY) < sunRadiusPx) {
          const k = sunThreshold / l;
          sunE[0] += (r - r * k) * dO; sunE[1] += (g - g * k) * dO; sunE[2] += (b - b * k) * dO;
          r *= k; g *= k; b *= k;
        }
      }
      const ax = Math.min(AW - 1, Math.floor(x / fx));
      const o = (ay * AW + ax) * 3;
      amb[o] += r; amb[o + 1] += g; amb[o + 2] += b;
    }
  }
  // optional artistic lever: a clearer atmosphere than the one the panorama was shot in
  for (let c = 0; c < 3; c++) sunE[c] *= sunBoost * sunTint[c];
  const inv = 1 / (fx * fy);
  for (let i = 0; i < amb.length; i++) amb[i] *= inv;

  // sky irradiance on a horizontal plane (upper hemisphere only)
  const skyE = [0, 0, 0];
  for (let y = 0; y < AH / 2; y++) {
    const el = (0.5 - (y + 0.5) / AH) * Math.PI;
    const w = (2 * Math.PI / AW) * (Math.PI / AH) * Math.cos(el) * Math.sin(el);
    for (let x = 0; x < AW; x++) {
      const o = (y * AW + x) * 3;
      skyE[0] += amb[o] * w; skyE[1] += amb[o + 1] * w; skyE[2] += amb[o + 2] * w;
    }
  }

  // ---- normalise: white horizontal card in full sun -> radiance 1
  const sinEl = Math.sin(sunElevation);
  const totalH = 0.2126 * (sunE[0] * sinEl + skyE[0]) + 0.7152 * (sunE[1] * sinEl + skyE[1]) + 0.0722 * (sunE[2] * sinEl + skyE[2]);
  const scale = Math.PI / totalH;
  const sunIrradiance = new THREE.Color(sunE[0] * scale, sunE[1] * scale, sunE[2] * scale);
  const skyIrradiance = new THREE.Color(skyE[0] * scale, skyE[1] * scale, skyE[2] * scale);

  // ground hemisphere of the ambient map = light bounced off the sunlit site
  const bounce = [0, 1, 2].map((c) => groundAlbedo[c] * (sunE[c] * sinEl + skyE[c]) / Math.PI);
  for (let y = AH / 2; y < AH; y++) {
    // blend over the first few degrees below the horizon
    const t = Math.min(1, (y - AH / 2 + 0.5) / (AH * 0.03));
    for (let x = 0; x < AW; x++) {
      const o = (y * AW + x) * 3;
      const hz = ((AH / 2 - 1) * AW + x) * 3;
      for (let c = 0; c < 3; c++) amb[o + c] = amb[hz + c] * (1 - t) + bounce[c] * t;
    }
  }
  for (let i = 0; i < amb.length; i++) amb[i] *= scale;

  const ambData = new Uint16Array(AW * AH * 4);
  for (let i = 0, j = 0; i < AW * AH; i++, j += 4) {
    ambData[j] = toHalf(Math.min(amb[i * 3], 65000)); ambData[j + 1] = toHalf(Math.min(amb[i * 3 + 1], 65000));
    ambData[j + 2] = toHalf(Math.min(amb[i * 3 + 2], 65000)); ambData[j + 3] = toHalf(1);
  }
  const ambient = new THREE.DataTexture(ambData, AW, AH, THREE.RGBAFormat, THREE.HalfFloatType);
  ambient.mapping = THREE.EquirectangularReflectionMapping;
  ambient.colorSpace = THREE.LinearSRGBColorSpace;
  ambient.minFilter = ambient.magFilter = THREE.LinearFilter;
  ambient.flipY = true;
  ambient.needsUpdate = true;

  /** Ambient-sky radiance (sun removed) for a world direction; used by the lighting bake. */
  const sample = (dx, dy, dz, out) => {
    const u = Math.atan2(dz, dx) / (2 * Math.PI) + 0.5;
    const v = Math.asin(Math.max(-1, Math.min(1, dy))) / Math.PI + 0.5;
    const x = Math.min(AW - 1, Math.max(0, Math.floor(u * AW)));
    const y = Math.min(AH - 1, Math.max(0, Math.floor((1 - v) * AH)));
    const o = (y * AW + x) * 3;
    out[0] = amb[o]; out[1] = amb[o + 1]; out[2] = amb[o + 2];
    return out;
  };

  // horizon colour towards / away from the sun (drives the fog)
  const hz = [0, 0, 0], hzSun = [0, 0, 0], tmp = [0, 0, 0];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    sample(Math.cos(a), 0.03, Math.sin(a), tmp);
    for (let c = 0; c < 3; c++) hz[c] += tmp[c] / 64;
  }
  for (let i = -3; i <= 3; i++) {
    const a = phi + i * 0.05;
    sample(Math.cos(a), 0.05, Math.sin(a), tmp);
    for (let c = 0; c < 3; c++) hzSun[c] += tmp[c] / 7;
  }

  return {
    background: null, backgroundScale: scale, ambient,
    sunDir, sunElevation, sunIrradiance, skyIrradiance,
    horizon: new THREE.Color(hz[0], hz[1], hz[2]), horizonSun: new THREE.Color(hzSun[0], hzSun[1], hzSun[2]),
    bounce: bounce.map((v) => v * scale), sample,
  };
}

/** Sky dome that samples the full-resolution panorama; follows whichever camera renders it. */
export function createSkyDome(sky, { horizonFade = null } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tSky: { value: sky.background },
      uScale: { value: sky.backgroundScale },
      uHorizon: { value: (horizonFade || sky.horizon).clone() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tSky; uniform float uScale; uniform vec3 uHorizon;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        vec2 uv = vec2( atan( d.z, d.x ) * 0.15915494 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5 );
        // keep the lookup above the horizon; below it the dome fades into the haze colour
        vec2 uvSky = vec2( uv.x, max( uv.y, 0.5015 ) );
        vec3 c = texture2D( tSky, uvSky ).rgb * uScale;
        // soft shoulder: the sun and its aureole still bloom, but cannot blow the bloom chain apart
        float pk = max( c.r, max( c.g, c.b ) );
        if ( pk > 12.0 ) c *= ( 12.0 + ( pk - 12.0 ) / ( 1.0 + ( pk - 12.0 ) / 60.0 ) ) / pk;
        float below = smoothstep( 0.012, -0.03, d.y );
        c = mix( c, uHorizon, below );
        gl_FragColor = vec4( c, 1.0 );
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;      // depth is pinned to the far plane, so drawing it last costs no overdraw
  mesh.name = 'skyDome';
  return mesh;
}
