import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { extend } from '../engine/patch.js';

const MAG = 30, FIRE_INTERVAL = 0.105, RELOAD_TIME = 1.95;
const HIP = new THREE.Vector3(0.172, -0.178, -0.36), ADS = new THREE.Vector3(0, -0.0825, -0.265);
const MUZZLE = new THREE.Vector3(0, 0.004, -0.515);
const _v = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();

export async function createWeaponMaterials(assets) {
  const [gun, poly, carbon, steel] = await Promise.all([assets.pbr('gunmetal', 1), assets.pbr('polymer', 1), assets.pbr('carbon', 0.5), assets.pbr('brushed', 1)]);
  const std = (tex, p) => extend(new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.orm, metalnessMap: p.metalness ? tex.orm : null, ...p }), []);
  return {
    gunmetal: std(gun, { color: new THREE.Color(1.9, 1.95, 2.05), metalness: 1, roughness: 0.82, normalScale: new THREE.Vector2(0.6, 0.6) }),
    polymer: std(poly, { color: new THREE.Color(1.5, 1.52, 1.58), metalness: 0, roughness: 0.9, normalScale: new THREE.Vector2(0.8, 0.8) }),
    carbon: std(carbon, { color: new THREE.Color(1.5, 1.55, 1.65), metalness: 0, roughness: 0.62, normalScale: new THREE.Vector2(0.9, 0.9) }),
    steel: std(steel, { color: new THREE.Color(0.95, 0.96, 0.98), metalness: 1, roughness: 0.7, normalScale: new THREE.Vector2(0.4, 0.4) }),
    shell: extend(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.79, 0.8), roughness: 0.42, metalness: 0 }), []),
    caseShell: std(poly, { color: new THREE.Color(3.4, 3.6, 3.3), metalness: 0, roughness: 0.85, normalScale: new THREE.Vector2(0.8, 0.8) }),
    accent: extend(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.85, 0.24, 0.05), roughness: 0.5, metalness: 0 }), []),
    rubber: extend(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.045, 0.045, 0.05), roughness: 0.85 }), []),
    glow: extend(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.25, 0.85, 1.0), emissiveIntensity: 3 }), []),
    makeGlow: () => extend(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.25, 0.85, 1.0), emissiveIntensity: 3 }), []),
    glowRed: extend(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.12, 0.05), emissiveIntensity: 0.7 }), []),
    lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.6, 0.75), transparent: true, opacity: 0.07, depthWrite: false, fog: false }),
  };
}

/**
 * Collapse the many small meshes under `parent` into one mesh per material (transforms baked in).
 * Meshes listed in `keep` (animated or individually lit parts) are left alone.
 */
export function mergeByMaterial(parent, keep = new Set()) {
  const byMat = new Map();
  for (const m of [...parent.children]) {
    if (!m.isMesh || keep.has(m) || m.material.transparent) continue;
    m.updateMatrix();
    let g = m.geometry.clone().applyMatrix4(m.matrix);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!byMat.has(m.material)) byMat.set(m.material, { geos: [], cast: m.castShadow, receive: m.receiveShadow });
    byMat.get(m.material).geos.push(g);
    parent.remove(m);
  }
  for (const [mat, { geos, cast, receive }] of byMat) {
    const mesh = new THREE.Mesh(BGU.mergeGeometries(geos, false), mat);
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    parent.add(mesh);
  }
}

function labelTexture(lines) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = 'rgba(235,238,240,0.92)';
  g.font = '600 44px "Helvetica Neue", Arial, sans-serif'; g.fillText(lines[0], 8, 50);
  g.font = '500 21px "Helvetica Neue", Arial, sans-serif'; g.fillText(lines[1], 10, 86);
  g.fillStyle = 'rgba(255,120,40,0.95)'; g.fillRect(8, 100, 120, 7);
  g.fillStyle = 'rgba(235,238,240,0.6)'; g.font = '500 15px monospace'; g.fillText(lines[2], 140, 110);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function reticleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 3.2;
  g.beginPath(); g.arc(64, 64, 34, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(64, 64, 3.6, 0, Math.PI * 2); g.fill();
  for (const a of [0, 0.5, 1, 1.5]) { const cs = Math.cos(a * Math.PI), sn = Math.sin(a * Math.PI); g.beginPath(); g.moveTo(64 + cs * 34, 64 + sn * 34); g.lineTo(64 + cs * 46, 64 + sn * 46); g.stroke(); }
  return new THREE.CanvasTexture(c);
}

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(170,235,255,0.9)'); grd.addColorStop(0.5, 'rgba(60,150,255,0.25)'); grd.addColorStop(1, 'rgba(0,60,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + 0.3, l = 40 + Math.random() * 22;
    const lg = g.createLinearGradient(64, 64, 64 + Math.cos(a) * l, 64 + Math.sin(a) * l);
    lg.addColorStop(0, 'rgba(220,245,255,0.9)'); lg.addColorStop(1, 'rgba(120,200,255,0)');
    g.strokeStyle = lg; g.lineWidth = 5 + Math.random() * 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

/** Procedurally modelled "VX-9" pulse carbine. The barrel points down -Z; units are metres. */
function buildCarbine(M) {
  const root = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = false; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const rbox = (w, h, d, r = 0.004) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
  const cyl = (r, l, seg = 20, r2 = r) => new THREE.CylinderGeometry(r2, r, l, seg).rotateX(Math.PI / 2);   // axis along Z

  // --- receiver (upper + lower) with machined panel lines
  add(rbox(0.05, 0.062, 0.33, 0.006), M.gunmetal, 0, 0.006, -0.03);
  add(rbox(0.054, 0.03, 0.2, 0.005), M.polymer, 0, -0.03, 0.0);
  add(rbox(0.0525, 0.024, 0.12, 0.003), M.shell, 0, 0.012, 0.045);          // white service panel
  add(rbox(0.053, 0.006, 0.12, 0.002), M.accent, 0, -0.0045, 0.045);        // orange stripe
  for (const sx of [-1, 1]) {
    add(rbox(0.003, 0.03, 0.07, 0.001), M.steel, sx * 0.0262, 0.012, -0.075);                       // ejection-port style cover
    for (let i = 0; i < 4; i++) add(cyl(0.0028, 0.003, 10), M.steel, sx * 0.0262, -0.012 + (i % 2) * 0.034, -0.15 + Math.floor(i / 2) * 0.24, 0, Math.PI / 2, 0);   // bolts
    add(rbox(0.004, 0.012, 0.022, 0.002), M.accent, sx * 0.0275, -0.02, 0.03);                      // selector
  }
  // --- top rail with teeth
  add(rbox(0.024, 0.01, 0.31, 0.002), M.gunmetal, 0, 0.041, -0.04);
  const tooth = rbox(0.026, 0.006, 0.006, 0.001);
  for (let i = 0; i < 26; i++) add(tooth, M.gunmetal, 0, 0.0475, 0.105 - i * 0.0116);

  // --- barrel shroud: carbon shell with vents, glowing accelerator coils inside
  add(rbox(0.046, 0.05, 0.2, 0.008), M.carbon, 0, 0.004, -0.3);
  const coils = [];
  for (let i = 0; i < 5; i++) {
    const z = -0.225 - i * 0.036;
    coils.push(add(new THREE.TorusGeometry(0.0165, 0.0042, 8, 20), M.glow, 0, 0.004, z));
    for (const sx of [-1, 1]) add(rbox(0.004, 0.024, 0.016, 0.002), M.rubber, sx * 0.0222, 0.004, z);     // vent slots
  }
  add(cyl(0.011, 0.3, 20), M.steel, 0, 0.004, -0.31);                    // barrel
  add(cyl(0.0175, 0.05, 24), M.gunmetal, 0, 0.004, -0.47);               // muzzle device
  for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.0178, 0.0018, 6, 24), M.steel, 0, 0.004, -0.452 - i * 0.012);
  const emitter = add(cyl(0.0105, 0.004, 20), M.glow, 0, 0.004, -0.4955);
  add(rbox(0.05, 0.012, 0.21, 0.003), M.polymer, 0, -0.026, -0.3);       // lower handguard
  add(rbox(0.03, 0.05, 0.04, 0.008), M.polymer, 0, -0.058, -0.27, -0.25);   // angled foregrip
  // --- holographic sight
  add(rbox(0.032, 0.014, 0.062, 0.003), M.gunmetal, 0, 0.055, -0.02);
  const hoodMat = M.gunmetal;
  add(rbox(0.004, 0.04, 0.036, 0.0015), hoodMat, -0.021, 0.082, -0.022);
  add(rbox(0.004, 0.04, 0.036, 0.0015), hoodMat, 0.021, 0.082, -0.022);
  add(rbox(0.046, 0.004, 0.036, 0.0015), hoodMat, 0, 0.1035, -0.022);
  add(new THREE.PlaneGeometry(0.038, 0.038), M.lens, 0, 0.082, -0.03);
  const reticle = add(new THREE.PlaneGeometry(0.03, 0.03), new THREE.MeshBasicMaterial({ map: reticleTexture(), color: new THREE.Color(3.2, 0.5, 0.25), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }), 0, 0.0825, -0.029);

  // --- grip, trigger, guard
  add(rbox(0.036, 0.098, 0.044, 0.01), M.polymer, 0, -0.083, 0.088, 0.3);
  add(rbox(0.006, 0.02, 0.008, 0.002), M.steel, 0, -0.052, 0.047, 0.25);
  add(new THREE.TorusGeometry(0.022, 0.003, 6, 16, Math.PI), M.polymer, 0, -0.046, 0.045, 0, Math.PI / 2, Math.PI);

  // --- energy cell (the "magazine") with a charge gauge
  const cell = new THREE.Group();
  cell.position.set(0, -0.092, -0.022); cell.rotation.x = -0.12;
  root.add(cell);
  add(rbox(0.034, 0.1, 0.058, 0.006), M.gunmetal, 0, 0, 0, 0, 0, 0, cell);
  add(rbox(0.036, 0.016, 0.06, 0.004), M.accent, 0, -0.044, 0, 0, 0, 0, cell);
  const bars = [];
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) {
    const b = add(rbox(0.002, 0.008, 0.03, 0.001), M.makeGlow(), sx * 0.0176, 0.034 - i * 0.012, 0, 0, 0, 0, cell);
    b.userData.level = i;
    bars.push(b);
  }
  // power cable from the cell to the shroud
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.019, -0.07, -0.05), new THREE.Vector3(0.031, -0.05, -0.1), new THREE.Vector3(0.03, -0.022, -0.16), new THREE.Vector3(0.024, -0.008, -0.2)]);
  add(new THREE.TubeGeometry(curve, 16, 0.0035, 8), M.rubber, 0, 0, 0);

  // --- skeleton stock (its own group: it sits behind the eye when aiming, so it is hidden then)
  const stock = new THREE.Group();
  root.add(stock);
  for (const sy of [0.018, -0.02]) add(rbox(0.014, 0.012, 0.17, 0.004), M.gunmetal, 0, sy, 0.215, 0, 0, 0, stock);
  add(rbox(0.034, 0.11, 0.026, 0.008), M.rubber, 0, -0.012, 0.305, 0, 0, 0, stock);
  add(rbox(0.03, 0.02, 0.05, 0.005), M.polymer, 0, 0.03, 0.24, 0, 0, 0, stock);          // cheek rest

  // --- printed markings
  const label = new THREE.MeshBasicMaterial({ map: labelTexture(['VX-9', 'WESTLAKE ENGINEERING · PULSE CARBINE', 'PROTO 0x7C / 12 kJ']), transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(0.55, 0.55, 0.55) });
  add(new THREE.PlaneGeometry(0.1, 0.025), label, -0.0268, 0.012, 0.045, 0, -Math.PI / 2, 0);

  // --- muzzle flash (two crossed cards + a facing card)
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(5, 8, 12), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  flash.position.copy(MUZZLE);
  root.add(flash);
  add(new THREE.PlaneGeometry(0.22, 0.22), flashMat, 0, 0, -0.01, 0, 0, 0, flash);
  add(new THREE.PlaneGeometry(0.34, 0.12), flashMat, 0, 0, -0.12, 0, Math.PI / 2, 0, flash);
  add(new THREE.PlaneGeometry(0.34, 0.12), flashMat, 0, 0, -0.12, Math.PI / 2, Math.PI / 2, 0, flash);
  flash.visible = false;

  mergeByMaterial(cell, new Set(bars));
  mergeByMaterial(stock);
  mergeByMaterial(root);
  return { root, cell, bars, flash, reticle, stock };
}

/** View-model weapon: firing, recoil, ADS, reload and all procedural animation. */
export class Weapon {
  constructor(camera, materials) {
    this.camera = camera;
    this.M = materials;
    const built = buildCarbine(materials);
    Object.assign(this, built);
    this.pivot = new THREE.Group();
    this.pivot.add(this.root);
    camera.add(this.pivot);
    this.ammo = MAG; this.reserve = 150; this.magSize = MAG;
    this.cooldown = 0; this.reload = -1; this.heat = 0; this.spread = 0;
    this.kickZ = 0; this.kickRot = 0; this.kickVel = 0; this.kickRotVel = 0; this.kickRoll = 0;
    this.swayX = 0; this.swayY = 0; this.flashT = 0;
    this.retract = 0; this.equip = 1;
    this.onFire = null; this.onDry = null; this.onReloadStart = null; this.onReloadEvent = null;
    this.shotsFired = 0;
    this._dryT = 0; this._events = 0;
    this._setBars();
  }

  get muzzleWorld() { return this.root.localToWorld(_v.copy(MUZZLE)); }
  get reloading() { return this.reload >= 0; }

  reset() { this.ammo = MAG; this.reserve = 150; this.reload = -1; this.heat = 0; this.cooldown = 0; this._setBars(); }

  addAmmo(n) { this.reserve = Math.min(300, this.reserve + n); }

  startReload() {
    if (this.reloading || this.ammo >= MAG || this.reserve <= 0) return;
    this.reload = 0; this._events = 0;
    this.onReloadStart?.();
  }

  _setBars() {
    const lit = Math.ceil(this.ammo / MAG * 6);
    for (const b of this.bars) {
      const on = 5 - b.userData.level < lit;
      b.material.emissiveIntensity = on ? (this.ammo <= 6 ? 4 : 3) : 0.04;
      b.material.emissive.setRGB(this.ammo <= 6 ? 1 : 0.25, this.ammo <= 6 ? 0.2 : 0.85, this.ammo <= 6 ? 0.05 : 1);
    }
  }

  update(dt, input, player, { enabled = true, wallDist = 9 } = {}) {
    const ads = player.ads;
    this.cooldown -= dt;
    this._dryT -= dt;

    // ---- reload timeline
    if (this.reloading) {
      this.reload += dt;
      const t = this.reload / RELOAD_TIME;
      if (t > 0.3 && this._events < 1) { this._events = 1; this.onReloadEvent?.('out'); }
      if (t > 0.62 && this._events < 2) { this._events = 2; this.onReloadEvent?.('in'); }
      if (t > 0.78 && this._events < 3) {
        this._events = 3;
        const take = Math.min(MAG - this.ammo, this.reserve);
        this.ammo += take; this.reserve -= take; this._setBars();
        this.onReloadEvent?.('charge');
      }
      if (t >= 1) this.reload = -1;
    }

    // ---- fire
    const trigger = enabled && input.buttons[0] && !player.sprinting;
    if (trigger && this.cooldown <= 0 && !this.reloading) {
      if (this.ammo > 0) {
        this.cooldown = FIRE_INTERVAL;
        this.ammo--; this.shotsFired++; this._setBars();
        const spreadNow = (0.0035 + this.spread) * (1 - 0.82 * ads) + (player.onGround ? 0 : 0.02) + Math.min(player.speed, 8) * 0.0012 * (1 - ads);
        this.spread = Math.min(0.03, this.spread + 0.0042);
        this.heat = Math.min(1, this.heat + 0.085);
        // recoil: view kick + weapon kick
        const k = 1 - 0.35 * ads;
        player.kick(0.0105 * k * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 0.008 * k);
        this.kickVel += 1.15; this.kickRotVel += 2.0 + Math.random() * 0.8; this.kickRoll = (Math.random() - 0.5) * 0.05;
        this.flashT = 0.045;
        this.flash.rotation.z = Math.random() * 6.28;
        this.flash.scale.setScalar(0.75 + Math.random() * 0.6);
        this.onFire?.(spreadNow);
        if (this.ammo === 0) this.startReload();
      } else if (this._dryT <= 0) {
        this._dryT = 0.3;
        this.onDry?.();
        this.startReload();
      }
    }
    if (enabled && input.hit('KeyR')) this.startReload();
    this.spread = Math.max(0, this.spread - dt * 0.04);
    this.heat = Math.max(0, this.heat - dt * 0.45);

    // ---- springs
    this.kickVel += (-this.kickZ * 420 - this.kickVel * 30) * dt; this.kickZ += this.kickVel * dt;
    this.kickRotVel += (-this.kickRot * 380 - this.kickRotVel * 26) * dt; this.kickRot += this.kickRotVel * dt;
    this.kickRoll *= Math.exp(-dt * 14);
    const lag = 1 - Math.exp(-dt * 10);
    this.swayX += (THREE.MathUtils.clamp(-input.dx * 0.00045, -0.045, 0.045) - this.swayX) * lag;
    this.swayY += (THREE.MathUtils.clamp(-input.dy * 0.00045, -0.045, 0.045) - this.swayY) * lag;
    this.retract += ((wallDist < 0.85 ? 1 - wallDist / 0.85 : 0) - this.retract) * (1 - Math.exp(-dt * 12));
    this.equip += ((enabled ? 0 : 1) - this.equip) * (1 - Math.exp(-dt * 7));

    // ---- compose pose
    const p = this.pivot;
    const sprint = player.sprinting ? 1 : 0;
    this._sprint = (this._sprint || 0) + (sprint - (this._sprint || 0)) * (1 - Math.exp(-dt * 9));
    const sp = this._sprint * (1 - ads);
    p.position.lerpVectors(HIP, ADS, ads);
    const bob = player.bobAmp * (1 - 0.86 * ads);
    const t = player.time;
    // breathing + walk bob (figure of eight)
    p.position.x += Math.cos(player.bobPhase) * 0.0052 * bob + Math.sin(t * 0.9) * 0.0008 * (1 - ads);
    p.position.y += -Math.abs(Math.sin(player.bobPhase)) * 0.0075 * bob + Math.sin(t * 1.3) * 0.0012 * (1 - 0.8 * ads);
    p.position.y += THREE.MathUtils.clamp(-player.vel.y * 0.0035, -0.03, 0.03) + player.land * 0.5;
    p.position.z += this.kickZ * (1 - 0.3 * ads);
    p.position.x += sp * -0.03; p.position.y += sp * -0.045 - this.retract * 0.05 - this.equip * 0.3;
    p.position.z += this.retract * 0.12;
    _e.set(
      this.kickRot * (1 - 0.5 * ads) + this.swayY * (1 - 0.6 * ads) + sp * -0.22 + this.retract * 0.55 - this.equip * 0.9,
      0.045 * (1 - ads) + this.swayX * (1 - 0.6 * ads) + sp * 0.55,
      this.kickRoll * (1 - 0.6 * ads) - this.swayX * 0.8 + sp * 0.28 - player.roll * 1.6, 'YXZ');
    p.quaternion.setFromEuler(_e);

    // reload animation: roll the weapon in, drop the cell, seat a fresh one
    let cellDrop = 0;
    if (this.reloading) {
      const u = this.reload / RELOAD_TIME;
      const inOut = THREE.MathUtils.smoothstep(u, 0, 0.16) * (1 - THREE.MathUtils.smoothstep(u, 0.84, 1));
      _q.setFromEuler(_e.set(0.32 * inOut, -0.18 * inOut, 0.62 * inOut, 'YXZ'));
      p.quaternion.multiply(_q);
      p.position.y -= 0.035 * inOut; p.position.x -= 0.02 * inOut;
      cellDrop = u < 0.3 ? 0 : u < 0.46 ? (u - 0.3) / 0.16 : u < 0.6 ? 1 : u < 0.76 ? 1 - (u - 0.6) / 0.16 : 0;
      if (u > 0.76 && u < 0.84) p.position.y += Math.sin((u - 0.76) / 0.08 * Math.PI) * 0.012;      // the slap that seats it
    }
    this.cell.position.y = -0.092 - cellDrop * 0.26;
    this.cell.visible = cellDrop < 0.98;

    // ---- emissives
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.M.glow.emissiveIntensity = 1.6 + this.heat * 9 + (this.flashT > 0 ? 6 : 0);
    this.reticle.material.opacity = 0.25 + 0.75 * ads;
    this.stock.visible = ads < 0.55;
  }
}

export const WEAPON = { MAG, FIRE_INTERVAL, RELOAD_TIME, DAMAGE: 24, name: 'VX-9 PULSE CARBINE' };
