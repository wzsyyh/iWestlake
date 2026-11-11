import * as THREE from 'three';
import { mirrorUniforms } from './patch.js';

const _n = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3(), _cam = new THREE.Vector3(), _view = new THREE.Vector3(), _look = new THREE.Vector3(), _target = new THREE.Vector3();
const _rot = new THREE.Matrix4(), _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();

/**
 * Real-time planar reflection for a horizontal floor (the Academic Hall's polished gallery).
 * While the player is near, the scene is rendered once more from the camera mirrored in the floor
 * plane (half resolution, oblique near plane so nothing below the floor leaks in, no shadow
 * re-render) and the floor material samples that image; see the `Mirror` feature in patch.js.
 */
export class PlanarMirror {
  constructor(R, floor, { height, centre, range = 80, scale = 0.5, hide = [] }) {
    this.R = R; this.floor = floor; this.height = height; this.centre = centre; this.range = range; this.hide = hide;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.camera = new THREE.PerspectiveCamera();
    mirrorUniforms.tMirror.value = this.rt.texture;
    this.busy = false; this.enabled = true;
    floor.onBeforeRender = (renderer, scene, camera) => this._render(renderer, scene, camera);
  }

  _render(renderer, scene, camera) {
    const U = mirrorUniforms;
    if (this.busy || camera !== this.R.camera) { if (camera !== this.R.camera && !this.busy) U.uMirrorOn.value = 0; return; }
    _cam.setFromMatrixPosition(camera.matrixWorld);
    const dist = Math.hypot(_cam.x - this.centre.x, _cam.z - this.centre.z);
    // fade the mirror in as the player approaches; beyond that the static probe is plenty
    const on = this.enabled && _cam.y > this.height + 0.05 ? THREE.MathUtils.clamp((this.range - dist) / 12, 0, 1) : 0;
    U.uMirrorOn.value = on;
    if (on <= 0) return;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(64, Math.round(size.x * this.scale)), h = Math.max(64, Math.round(size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);

    // mirror the camera in the plane y = height
    _p.set(0, this.height, 0);
    _view.subVectors(_p, _cam).reflect(_n).negate().add(_p);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cam);
    _target.subVectors(_p, _look).reflect(_n).negate().add(_p);
    const v = this.camera;
    v.position.copy(_view);
    v.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
    v.lookAt(_target);
    v.near = camera.near; v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    U.uMirrorMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);

    // oblique near plane (Lengyel): clip everything below the floor
    _plane.setFromNormalAndCoplanarPoint(_n, _p).applyMatrix4(v.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = v.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + pm[8]) / pm[0], (Math.sign(_clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    pm[2] = _clip.x; pm[6] = _clip.y; pm[10] = _clip.z + 1 - 0.003; pm[14] = _clip.w;
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();

    this.busy = true;
    const hidden = this.hide.filter((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    this.floor.visible = false;
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;                 // reuse this frame's cascades
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, v);
    renderer.shadowMap.autoUpdate = prevAuto;
    renderer.setRenderTarget(prevTarget);
    this.floor.visible = true;
    hidden.forEach((o) => { o.visible = true; });
    this.busy = false;
  }
}
