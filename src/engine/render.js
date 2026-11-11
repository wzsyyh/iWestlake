import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, EdgeDetectionMode,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, NoiseEffect, BlendFunction, Effect, EffectAttribute,
  ChromaticAberrationEffect, GodRaysEffect, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { CSM } from 'three/addons/csm/CSM.js';

export const QUALITY = {
  low:    { label: 'Low',    maxDpr: 1,    scale: 0.75, shadow: 1024, ao: null,     motionBlur: false, godRays: false, msaa: 0, grass: 0.35, aniso: 2,  treeLod: 0.7,  fineTreeShadows: false, softShadows: false, mirror: false },
  medium: { label: 'Medium', maxDpr: 1,    scale: 1,    shadow: 2048, ao: 'Low',    motionBlur: true,  godRays: false, msaa: 0, grass: 0.65, aniso: 4,  treeLod: 0.85, fineTreeShadows: true,  softShadows: true,  mirror: false },
  high:   { label: 'High',   maxDpr: 1.5,  scale: 1,    shadow: 2048, ao: 'Medium', motionBlur: true,  godRays: true,  msaa: 0, grass: 1.0,  aniso: 8,  treeLod: 1,    fineTreeShadows: true,  softShadows: true,  mirror: true },
  ultra:  { label: 'Ultra',  maxDpr: 2,    scale: 1,    shadow: 4096, ao: 'High',   motionBlur: true,  godRays: true,  msaa: 4, grass: 1.4,  aniso: 16, treeLod: 1.3,  fineTreeShadows: true,  softShadows: true,  mirror: true },
};

// ---------------------------------------------------------------- custom effects

/** Scene-referred exposure + white balance, applied before tone mapping. */
class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', /* glsl */`
      uniform float exposure; uniform vec3 balance;
      void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
        outputColor = vec4( inputColor.rgb * exposure * balance, inputColor.a );
      }`, {
      uniforms: new Map([['exposure', new THREE.Uniform(1)], ['balance', new THREE.Uniform(new THREE.Vector3(1, 1, 1))]]),
    });
  }
}

/** Display-referred grade after tone mapping: contrast, saturation, split toning, damage / low-health tint. */
class FilmGradeEffect extends Effect {
  constructor() {
    super('FilmGradeEffect', /* glsl */`
      uniform float contrast; uniform float saturation; uniform vec3 shadowTint; uniform vec3 highlightTint;
      uniform float damage; uniform float desat;
      void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
        vec3 c = pow( max( inputColor.rgb, 0.0 ), vec3( 1.0 / 2.2 ) );
        float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
        c = mix( vec3( l ), c, saturation * ( 1.0 - desat ) );
        c = ( c - 0.5 ) * contrast + 0.5;
        c *= mix( shadowTint, highlightTint, smoothstep( 0.0, 1.0, l ) );
        // red pulse at the screen edge when hurt
        float edge = smoothstep( 0.25, 0.95, length( uv - 0.5 ) * 1.35 );
        c = mix( c, c * vec3( 1.0, 0.25, 0.2 ) + vec3( 0.12, 0.0, 0.0 ), edge * damage );
        outputColor = vec4( pow( clamp( c, 0.0, 1.0 ), vec3( 2.2 ) ), inputColor.a );
      }`, {
      uniforms: new Map([
        ['contrast', new THREE.Uniform(1.1)], ['saturation', new THREE.Uniform(1.04)],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(0.965, 1.0, 1.045))],
        ['highlightTint', new THREE.Uniform(new THREE.Vector3(1.04, 1.0, 0.95))],
        ['damage', new THREE.Uniform(0)], ['desat', new THREE.Uniform(0)],
      ]),
    });
  }
}

/** Camera motion blur by depth re-projection. Anything closer than `nearMask` (the weapon) stays sharp. */
class MotionBlurEffect extends Effect {
  constructor() {
    super('MotionBlurEffect', /* glsl */`
      uniform mat4 invViewProj; uniform mat4 prevViewProj; uniform float strength; uniform float nearMask;
      float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
      void mainImage( const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor ) {
        vec4 ndc = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
        vec4 wp = invViewProj * ndc; wp /= wp.w;
        vec4 prev = prevViewProj * wp;
        vec2 vel = ( ndc.xy - prev.xy / max( prev.w, 1e-5 ) ) * 0.5 * strength;
        float vz = -getViewZ( depth );
        float len = length( vel );
        if ( vz < nearMask || len < 0.0007 ) { outputColor = inputColor; return; }
        vel *= min( 1.0, 0.045 / len );
        float j = ign( uv * resolution );
        vec3 acc = inputColor.rgb; float tot = 1.0;
        for ( int i = 0; i < 8; i ++ ) {
          vec2 o = vel * ( ( float( i ) + j ) / 8.0 - 0.5 );
          vec2 suv = uv + o;
          float sz = -getViewZ( readDepth( suv ) );
          float wgt = step( nearMask, sz );
          acc += texture2D( inputBuffer, suv ).rgb * wgt; tot += wgt;
        }
        outputColor = vec4( acc / tot, inputColor.a );
      }`, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['invViewProj', new THREE.Uniform(new THREE.Matrix4())], ['prevViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['strength', new THREE.Uniform(0.6)], ['nearMask', new THREE.Uniform(1.6)],
      ]),
    });
    this._vp = new THREE.Matrix4();
    this._first = true;
  }

  /** Call once per frame before rendering, with the camera that is about to be used. */
  track(camera, dt) {
    const u = this.uniforms;
    if (this._first) { this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this._first = false; }
    u.get('prevViewProj').value.copy(this._vp);
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.get('invViewProj').value.copy(this._vp).invert();
    // a constant ~1/150 s shutter regardless of the actual frame rate
    u.get('strength').value = Math.min(1.0, 0.4 * (1 / 60) / Math.max(dt, 1 / 240));
  }
}

// ---------------------------------------------------------------- renderer

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.quality = QUALITY[quality] ? quality : 'high';
    this.q = QUALITY[this.quality];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: false, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 2400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.exposure = 1;
    this.frame = 0;
    this.maxAniso = r.capabilities.getMaxAnisotropy();
  }

  get anisotropy() { return Math.min(this.q.aniso, this.maxAniso); }

  /** Sun + cascaded shadow maps. Must exist before materials are created (they are patched for CSM). */
  setupSun(sunDir, sunIrradiance) {
    const lightDir = sunDir.clone().negate();
    const csm = this.csm = new CSM({
      camera: this.camera, parent: this.scene, cascades: 4, maxFar: 330, mode: 'custom',
      customSplitsCallback: (n, near, far, out) => { out.push(0.045, 0.15, 0.42, 1); },
      shadowMapSize: this.q.shadow, lightDirection: lightDir, lightIntensity: 1,
      lightNear: 1, lightFar: 900, lightMargin: 260, shadowBias: -0.00012,
    });
    csm.fade = true;
    const peak = Math.max(sunIrradiance.r, sunIrradiance.g, sunIrradiance.b);
    csm.lights.forEach((l, i) => {
      l.color.copy(sunIrradiance).multiplyScalar(1 / peak);
      l.intensity = peak;
      l.shadow.normalBias = [0.02, 0.045, 0.1, 0.22][i];
      l.shadow.bias = [-0.00008, -0.00012, -0.0002, -0.0004][i];
    });
    this.sunDir = sunDir.clone();
    this.sunColor = sunIrradiance.clone();
    return csm;
  }

  setupPost(sunDir) {
    const { renderer, scene, camera, q } = this;
    const composer = this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: q.msaa });
    composer.addPass(new RenderPass(scene, camera));

    if (q.ao) {
      const ao = this.ao = new N8AOPostPass(scene, camera, 1, 1);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.6;
      ao.configuration.halfRes = q.ao !== 'High';
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.screenSpaceRadius = false;
      ao.configuration.color = new THREE.Color(0.0, 0.0, 0.0);
      ao.setQualityMode(q.ao);
      composer.addPass(ao);
    }

    if (q.motionBlur) {
      this.motionBlur = new MotionBlurEffect();
      composer.addPass(new EffectPass(camera, this.motionBlur));
    }

    const effects = [];
    if (q.godRays) {
      // a disc pinned far away in the sun direction drives the screen-space light shafts
      const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff6ec, transparent: true, fog: false, depthWrite: false, toneMapped: false });
      const sunMesh = this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 8), sunMat);
      sunMesh.frustumCulled = false;
      this.godRays = new GodRaysEffect(camera, sunMesh, {
        resolutionScale: 0.5, density: 0.94, decay: 0.9, weight: 0.16, exposure: 0.26, samples: 48, clampMax: 1.0,
        blur: true, kernelSize: KernelSize.MEDIUM, blendFunction: BlendFunction.ADD,
      });
      this.godRays.blendMode.opacity.value = 0.22;
      effects.push(this.godRays);
    }
    // a high, soft threshold: only the sun, glints and emissives bloom (a low one turns the whole solar aureole into a hard-edged disc)
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 2.4, luminanceSmoothing: 1.6, intensity: 0.5, radius: 0.72, levels: 7 });
    effects.push(this.bloom);
    this.exposureFx = new ExposureEffect();
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.grade = new FilmGradeEffect();
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.5 });
    effects.push(this.exposureFx, this.tone, this.grade, this.vignette);
    composer.addPass(new EffectPass(camera, ...effects));

    // lens artefacts are applied to the display-referred image so HDR highlights cannot explode into rainbows
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0007, 0.0007), radialModulation: true, modulationOffset: 0.3 });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.grain.blendMode.opacity.value = 0.07;
    composer.addPass(new EffectPass(camera, this.chroma, this.grain));
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
    composer.addPass(new EffectPass(camera, this.smaa));
    this.resize();
  }

  resize(w = window.innerWidth, h = window.innerHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.maxDpr) * this.q.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
    if (this.csm) {
      this.csm.updateFrustums();
      // the soft-shadow filter needs each cascade's world-space width (see installSoftShadows)
      for (const l of this.csm.lights) l.shadow.radius = l.shadow.camera.right - l.shadow.camera.left;
    }
    this.width = w; this.height = h;
  }

  render(dt) {
    const { renderer, camera } = this;
    this.frame++;
    camera.updateMatrixWorld();
    if (this.csm) {
      this.csm.update();
      // the two far cascades are static enough to refresh on alternate frames
      this.csm.lights.forEach((l, i) => {
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = i < 2 || this.frame < 8 || (this.frame + i) % 2 === 0;
      });
    }
    if (this.motionBlur) this.motionBlur.track(camera, dt);
    if (this.godRays) {
      this.sunMesh.position.copy(camera.position).addScaledVector(this.sunDir, 1500);
      this.sunMesh.updateMatrixWorld();
      // light shafts only make sense while the sun is on (or just off) screen
      const p = _v.copy(this.sunDir).applyMatrix4(_m.extractRotation(camera.matrixWorldInverse)).applyMatrix4(camera.projectionMatrix);
      const off = _v.z > 1 || camera.getWorldDirection(_d).dot(this.sunDir) < 0 ? 9 : Math.max(Math.abs(p.x), Math.abs(p.y));
      this.godRays.blendMode.opacity.value = 0.22 * THREE.MathUtils.clamp((1.05 - off) / 0.3, 0, 1);
    }
    this.exposureFx.uniforms.get('exposure').value = this.exposure;
    renderer.info.reset();
    this.composer.render(dt);
  }
}
