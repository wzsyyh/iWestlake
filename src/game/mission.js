import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeByMaterial } from './weapon.js';
import { extend } from '../engine/patch.js';
import { HALL, PATHS } from '../world/layout.js';

const HOLD_TIME = 3.2, REACH = 2.6;

/**
 * Where the three hijacked uplink masts stand. Taken in order they lead the player on a loop of
 * the court: out along a lawn path, up into the Hall's colonnade, and back along the ring promenade.
 */
function sites() {
  const path = PATHS[2].pts, p = path[Math.floor(path.length * 0.55)];
  const off = PATHS[2].w / 2 - 0.7;
  const deg = Math.PI / 180;
  return [
    { id: 'A', x: p.x - p.tz * off, z: p.z + p.tx * off },
    { id: 'B', x: HALL.x + 44.3 * Math.sin(185 * deg), z: HALL.z - 44.3 * Math.cos(185 * deg) },
    { id: 'C', x: 141.5 * Math.sin(101 * deg), z: -141.5 * Math.cos(101 * deg) },
  ];
}

function labelTexture(id) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#101214'; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#ff5a3c'; g.fillRect(0, 0, 256, 10);
  g.fillStyle = '#f2f3f1';
  g.font = '700 96px "Helvetica Neue", Arial, sans-serif'; g.fillText(id, 18, 118);
  g.font = '600 26px "PingFang SC", "Microsoft YaHei", sans-serif'; g.fillText('上行链路', 112, 70);
  g.font = '500 20px "Helvetica Neue", Arial, sans-serif'; g.fillText('UPLINK', 112, 100);
  g.fillStyle = 'rgba(242,243,241,0.55)'; g.font = '400 14px monospace'; g.fillText('WU-ROBOTICS 7C', 112, 126);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/**
 * The mission objective: three portable uplink masts that are steering the swarm. Standing next to
 * one and holding the interact key cuts it.
 */
export class Mission {
  constructor(scene, M, col, groundHeight) {
    this.scene = scene; this.col = col;
    this.relays = [];
    this.onCut = null;
    this.near = null; this.progress = 0;
    const beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 60, 10, 1, true).translate(0, 30, 0);
    const dishGeo = new THREE.SphereGeometry(0.62, 28, 8, 0, Math.PI * 2, 0, 0.6).translate(0, -0.62, 0);     // cap with its pole at the origin
    const dishMat = extend(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.81, 0.82), roughness: 0.4, side: THREE.DoubleSide }), []);
    for (const s of sites()) {
      const y = groundHeight(s.x, s.z);
      const g = new THREE.Group();
      g.position.set(s.x, y, s.z);
      g.rotation.y = Math.atan2(s.x - HALL.x, s.z - HALL.z) + 0.6;
      const add = (geo, mat, x, py, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, py, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
      // equipment case, tripod, mast, dish and a panel antenna
      add(new RoundedBoxGeometry(0.74, 0.46, 0.52, 3, 0.04), M.caseShell, 0, 0.23, 0);
      add(new THREE.BoxGeometry(0.752, 0.06, 0.532), M.accent, 0, 0.1, 0);
      add(new RoundedBoxGeometry(0.3, 0.05, 0.2, 2, 0.012), M.gunmetal, 0.12, 0.485, 0.05);
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2 + 0.4;
        add(new THREE.CylinderGeometry(0.014, 0.014, 1.5, 6), M.steel, Math.cos(a) * 0.36 - 0.14, 0.72, Math.sin(a) * 0.36 - 0.02, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
      add(new THREE.CylinderGeometry(0.03, 0.036, 2.5, 10), M.steel, -0.14, 1.7, -0.02);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), M.gunmetal, -0.14, 1.42, -0.02);
      // parabolic dish (a spherical cap seen from both sides), aimed up and outward, with its feed arm
      add(dishGeo, dishMat, -0.14, 2.52, 0.12, Math.PI - 0.95, 0, 0);
      add(new THREE.TorusGeometry(0.352, 0.012, 6, 28), M.steel, -0.14, 2.52 + 0.108 * Math.cos(0.95), 0.12 + 0.108 * Math.sin(0.95), Math.PI / 2 - 0.95, 0, 0);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 6), M.steel, -0.14, 2.52 + 0.25 * Math.cos(0.95), 0.12 + 0.25 * Math.sin(0.95), 0.95, 0, 0);
      add(new THREE.SphereGeometry(0.03, 10, 8), M.gunmetal, -0.14, 2.52 + 0.42 * Math.cos(0.95), 0.12 + 0.42 * Math.sin(0.95));
      add(new RoundedBoxGeometry(0.16, 0.5, 0.05, 2, 0.01), M.shell, -0.14, 2.1, -0.09);
      add(new THREE.TorusGeometry(0.09, 0.012, 6, 14), M.rubber, 0.2, 0.52, -0.1, Math.PI / 2, 0, 0);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshBasicMaterial({ map: labelTexture(s.id), toneMapped: false, color: new THREE.Color(0.75, 0.75, 0.75) }));
      label.position.set(-0.12, 0.25, 0.262);
      mergeByMaterial(g);
      g.add(label);
      // beacon lamp + a thin light column so the mast can be found across the court
      const glow = extend(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.12, 0.05), emissiveIntensity: 6 }), []);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), glow);
      lamp.position.set(-0.14, 2.98, -0.02);
      const beamMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1.0, 0.16, 0.06) }, uAlpha: { value: 1 } },
        vertexShader: 'varying float vY; void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
        fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying float vY; void main() { float a = smoothstep( 60.0, 6.0, vY ) * smoothstep( 2.6, 4.5, vY ); gl_FragColor = vec4( uColor * a * uAlpha * 1.4, 1.0 ); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(-0.14, 0, -0.02); beam.renderOrder = 12;
      g.add(lamp, beam);
      scene.add(g);
      col.circles.push({ x: s.x, z: s.z, r: 0.5, top: 3 });
      this.relays.push({ id: s.id, x: s.x, y, z: s.z, group: g, glow, beam, cut: false, pulse: Math.random() * 6 });
    }
  }

  get cutCount() { return this.relays.reduce((n, r) => n + (r.cut ? 1 : 0), 0); }
  get done() { return this.cutCount === this.relays.length; }

  reset() {
    for (const r of this.relays) {
      r.cut = false;
      r.glow.emissive.setRGB(1, 0.12, 0.05);
      r.beam.visible = true; r.beam.material.uniforms.uColor.value.setRGB(1.0, 0.16, 0.06);
    }
    this.progress = 0; this.near = null;
  }

  /** Taking a hit breaks the cut: deal with whatever is shooting at you first. */
  interrupt() { this.progress = 0; }

  /** Nearest live relay in reach, and hold-to-cut progress. `holding` = interact key state. */
  update(dt, player, holding, active) {
    const t = performance.now() / 1000;
    let near = null, best = REACH;
    for (const r of this.relays) {
      r.glow.emissiveIntensity = r.cut ? 2.2 : 3 + 5 * Math.max(0, Math.sin(t * 5 + r.pulse));
      r.beam.material.uniforms.uAlpha.value = r.cut ? 0.35 : 0.75 + 0.25 * Math.sin(t * 2.2 + r.pulse);
      if (r.cut) continue;
      const d = Math.hypot(r.x - player.pos.x, r.z - player.pos.z);
      if (d < best && Math.abs(r.y - player.pos.y) < 1.5) { best = d; near = r; }
    }
    if (!active) near = null;
    if (near !== this.near) { this.near = near; this.progress = 0; }
    if (near && holding) {
      this.progress += dt / HOLD_TIME;
      if (this.progress >= 1) {
        near.cut = true;
        near.glow.emissive.setRGB(0.2, 0.85, 1.0);
        near.beam.material.uniforms.uColor.value.setRGB(0.2, 0.75, 1.0);
        this.progress = 0; this.near = null;
        this.onCut?.(near);
      }
    } else this.progress = Math.max(0, this.progress - dt * 1.5);
  }
}
