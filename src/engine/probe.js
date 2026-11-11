import * as THREE from 'three';

/**
 * One-off reflection probe: renders the lit level into a cube map from `position` and prefilters
 * it, so glass and polished stone reflect the actual courtyard rather than just the sky. The sun
 * disc is left out (the directional light supplies its highlight).
 */
export function captureProbe(R, sky, position, { size = 512, hide = [] } = {}) {
  const { renderer, scene } = R;
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.3, 2400, rt);
  cam.position.copy(position);
  const dome = scene.getObjectByName('skyDome');
  const prevBg = scene.background;
  const prevVis = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; });
  if (dome) dome.visible = false;
  scene.background = sky.ambient;
  // the cascades were fitted to the player camera; let the probe see unshadowed sun beyond them
  cam.update(renderer, scene);
  scene.background = prevBg;
  if (dome) dome.visible = true;
  hide.forEach((o, i) => { o.visible = prevVis[i]; });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(rt.texture).texture;
  pmrem.dispose();
  rt.dispose();
  return env;
}
