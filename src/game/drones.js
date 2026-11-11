import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { extend } from '../engine/patch.js';
import { HALL, RING, ZONE } from '../world/layout.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export const DRONE_TYPES = {
  scout:  { key: 'scout', hp: 60,  radius: 0.5, speed: 11, accel: 16, range: [12, 26], alt: [3.2, 7.5], fireDelay: [2.0, 3.6], burst: 1, damage: 6,  boltSpeed: 52, score: 100, size: 1.0 },
  gunner: { key: 'gunner', hp: 150, radius: 0.7, speed: 7.5, accel: 10, range: [16, 30], alt: [4.5, 9],   fireDelay: [2.6, 4.0], burst: 3, damage: 6,  boltSpeed: 58, score: 250, size: 1.5 },
  warden: { key: 'warden', hp: 900, radius: 1.5,  speed: 4.6, accel: 5,  range: [20, 34], alt: [7, 11],    fireDelay: [2.0, 3.0], burst: 5, damage: 8, boltSpeed: 62, score: 1500, size: 3.2 },
};

function rotorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  // motion-blurred propeller disc: faint haze with two darker swept blades
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grd.addColorStop(0, 'rgba(20,20,22,0.55)'); grd.addColorStop(0.2, 'rgba(30,30,34,0.16)'); grd.addColorStop(0.9, 'rgba(30,30,34,0.2)'); grd.addColorStop(1, 'rgba(30,30,34,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 62, 0, 6.3); g.fill();
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 26; i++) {
      const a = k * Math.PI + i * 0.035;
      g.strokeStyle = `rgba(12,12,14,${0.2 * (1 - i / 26)})`; g.lineWidth = 7;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 8, 64 + Math.sin(a) * 8); g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); g.stroke();
    }
  }
  g.strokeStyle = 'rgba(240,120,40,0.5)'; g.lineWidth = 2; g.beginPath(); g.arc(64, 64, 59, 0, 6.3); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.center.set(0.5, 0.5);
  return t;
}

/** Build one drone design as a handful of merged geometries (one per material). Nose points down -Z. */
function buildDesign(type) {
  const parts = { shell: [], dark: [], metal: [], glow: [], rotor: [] };
  const put = (slot, geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const g = geo.clone();
    g.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(new THREE.Euler(rx, ry, rz)), _s.set(sx, sy, sz)));
    parts[slot].push(g.index ? g.toNonIndexed() : g);
  };
  const rb = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, r);
  const cyl = (r, h, seg = 16, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg);
  const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const rotors = [];

  if (type === 'warden') {
    // heavy: armoured hull slung between four ducted fans
    put('shell', rb(1.5, 0.5, 1.9, 0.16), 0, 0.05, 0);
    put('dark', rb(1.3, 0.36, 1.6, 0.12), 0, -0.24, 0.05);
    put('shell', rb(0.9, 0.2, 0.9, 0.08), 0, 0.38, 0.2);
    put('dark', rb(0.5, 0.12, 0.5, 0.04), 0, 0.5, 0.2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * 1.25, z = sz * 1.05;
      put('dark', rb(0.9, 0.12, 0.18, 0.04), sx * 0.75, 0.05, z * 0.72, 0, sx * sz * 0.5, 0);
      put('metal', new THREE.TorusGeometry(0.62, 0.07, 8, 28).rotateX(Math.PI / 2), x, 0.1, z);
      put('shell', new THREE.CylinderGeometry(0.69, 0.69, 0.22, 28, 1, true), x, 0.1, z);
      put('dark', cyl(0.11, 0.2), x, 0.08, z);
      put('rotor', disc, x, 0.12, z, 0, 0, 0, 0.6, 1, 0.6);
      rotors.push([x, z]);
    }
    for (const sx of [-1, 1]) {
      put('dark', rb(0.26, 0.26, 1.0, 0.06), sx * 0.62, -0.36, -0.5);      // gun pods
      put('metal', cyl(0.05, 0.9, 12).rotateX(Math.PI / 2), sx * 0.62, -0.36, -1.15);
      put('glow', cyl(0.055, 0.03, 12).rotateX(Math.PI / 2), sx * 0.62, -0.36, -1.61);
      put('shell', rb(0.1, 0.5, 1.3, 0.04), sx * 0.8, 0.05, 0.1);          // side armour
    }
    put('dark', new THREE.SphereGeometry(0.34, 20, 14), 0, -0.02, -0.92);  // sensor socket
    put('glow', new THREE.SphereGeometry(0.2, 16, 12), 0, -0.02, -1.14);   // the eye (weak spot)
    put('metal', new THREE.TorusGeometry(0.24, 0.03, 8, 20), 0, -0.02, -1.1);
    for (const sx of [-1, 1]) put('glow', rb(0.03, 0.03, 0.6, 0.01), sx * 0.76, 0.31, 0.1);
    put('metal', cyl(0.012, 0.7, 6), 0.3, 0.9, 0.5);
    return { parts, rotors, eye: new THREE.Vector3(0, -0.02, -1.14), muzzles: [new THREE.Vector3(-0.62, -0.36, -1.65), new THREE.Vector3(0.62, -0.36, -1.65)] };
  }

  const g = type === 'gunner' ? 1.45 : 1;
  // quad-rotor: white shell over a carbon chassis
  put('shell', rb(0.3 * g, 0.085 * g, 0.44 * g, 0.035 * g), 0, 0.02 * g, 0);
  put('dark', rb(0.24 * g, 0.07 * g, 0.36 * g, 0.025 * g), 0, -0.045 * g, 0.01 * g);
  put('shell', rb(0.16 * g, 0.04 * g, 0.2 * g, 0.018 * g), 0, 0.075 * g, 0.05 * g);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * 0.34 * g, z = sz * 0.31 * g;
    put('dark', rb(0.42 * g, 0.022 * g, 0.04 * g, 0.008 * g), sx * 0.19 * g, 0.012 * g, sz * 0.175 * g, 0, -sx * sz * 0.74, 0);
    put('metal', cyl(0.03 * g, 0.06 * g, 12), x, 0.04 * g, z);
    put('rotor', disc, x, 0.076 * g, z, 0, 0, 0, 0.2 * g, 1, 0.2 * g);
    put('dark', cyl(0.008 * g, 0.12 * g, 6), x, -0.04 * g, z);            // landing leg
    rotors.push([x, z]);
  }
  put('dark', new THREE.SphereGeometry(0.075 * g, 16, 12), 0, -0.02 * g, -0.22 * g);
  put('glow', new THREE.SphereGeometry(0.042 * g, 14, 10), 0, -0.02 * g, -0.275 * g);
  put('metal', new THREE.TorusGeometry(0.052 * g, 0.008 * g, 6, 16), 0, -0.02 * g, -0.265 * g);
  put('glow', rb(0.012 * g, 0.012 * g, 0.2 * g, 0.004 * g), 0, 0.097 * g, 0.05 * g);
  put('metal', cyl(0.004 * g, 0.2 * g, 6), 0.07 * g, 0.16 * g, 0.16 * g);
  const muzzles = [];
  if (type === 'gunner') {
    for (const sx of [-1, 1]) {
      put('dark', rb(0.09 * g, 0.09 * g, 0.34 * g, 0.02 * g), sx * 0.2 * g, -0.07 * g, -0.06 * g);
      put('metal', cyl(0.018 * g, 0.26 * g, 10).rotateX(Math.PI / 2), sx * 0.2 * g, -0.07 * g, -0.3 * g);
      put('glow', cyl(0.02 * g, 0.012 * g, 10).rotateX(Math.PI / 2), sx * 0.2 * g, -0.07 * g, -0.435 * g);
      put('shell', rb(0.02 * g, 0.12 * g, 0.3 * g, 0.008 * g), sx * 0.255 * g, -0.06 * g, -0.04 * g);
      muzzles.push(new THREE.Vector3(sx * 0.2 * g, -0.07 * g, -0.45 * g));
    }
  } else {
    put('dark', rb(0.05, 0.05, 0.2, 0.012), 0, -0.095, -0.1);
    put('metal', cyl(0.012, 0.16, 10).rotateX(Math.PI / 2), 0, -0.095, -0.25);
    put('glow', cyl(0.014, 0.01, 10).rotateX(Math.PI / 2), 0, -0.095, -0.333);
    muzzles.push(new THREE.Vector3(0, -0.095, -0.345));
  }
  return { parts, rotors, eye: new THREE.Vector3(0, -0.02 * g, -0.275 * g), muzzles };
}

/** Rogue lab drones: flight AI, plasma bolts, wrecks and pickups. */
export class Drones {
  constructor(scene, weaponMats, fx, collision, trees) {
    this.scene = scene; this.fx = fx; this.col = collision;
    this.list = []; this.bolts = []; this.pickups = [];
    this.trees = trees;
    this.onPlayerHit = null; this.onKill = null; this.onShoot = null; this.onExplode = null; this.onPickup = null; this.onBoltNear = null;
    const M = weaponMats;
    this.mats = {
      shell: M.shell, dark: M.carbon, metal: M.gunmetal,
      rotor: new THREE.MeshBasicMaterial({ map: rotorTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }),
    };
    this.designs = {};
    for (const type of Object.keys(DRONE_TYPES)) {
      const d = buildDesign(type);
      const merged = {};
      for (const slot of Object.keys(d.parts)) if (d.parts[slot].length) merged[slot] = BGU.mergeGeometries(d.parts[slot], false);
      this.designs[type] = { ...d, geo: merged };
    }
    this.makeGlow = (rgb) => extend(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(...rgb), emissiveIntensity: 4 }), []);

    // bolts: instanced glowing slugs
    const bg = new THREE.CapsuleGeometry(0.045, 0.7, 3, 8).rotateX(Math.PI / 2);
    this.boltMesh = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 2.2, 0.6), toneMapped: false, fog: false }), 96);
    this.boltMesh.count = 0; this.boltMesh.frustumCulled = false;
    scene.add(this.boltMesh);

    // pickups
    this.pickupGeo = new RoundedBoxGeometry(0.2, 0.32, 0.2, 2, 0.04);
    this.pickupMats = { ammo: this.makeGlow([0.2, 0.8, 1.0]), health: this.makeGlow([0.25, 1.0, 0.35]) };
    this.pickupCase = M.gunmetal;
    this.time = 0;
  }

  get alive() { return this.list.reduce((n, d) => n + (d.state !== 'dying' ? 1 : 0), 0); }

  spawn(type, playerPos, index = 0, total = 1) {
    const T = DRONE_TYPES[type], design = this.designs[type];
    const group = new THREE.Group();
    const glowMat = this.makeGlow([1.0, 0.16, 0.06]);
    for (const slot of Object.keys(design.geo)) {
      const mat = slot === 'glow' ? glowMat : this.mats[slot];
      const m = new THREE.Mesh(design.geo[slot], mat);
      m.castShadow = slot !== 'rotor' && slot !== 'glow'; m.receiveShadow = slot !== 'rotor';
      if (slot === 'rotor') m.renderOrder = 8;
      group.add(m);
    }
    // arrive from beyond the ring, high up, fanned out around the fight
    const a = Math.atan2(playerPos.x - ZONE.x, playerPos.z - ZONE.z) + Math.PI + (index / Math.max(1, total) - 0.5) * 2.4 + (Math.random() - 0.5) * 0.5;
    const r = 95 + Math.random() * 30;
    const pos = new THREE.Vector3(ZONE.x + Math.sin(a) * r, 26 + Math.random() * 10, ZONE.z + Math.cos(a) * r);
    group.position.copy(pos);
    this.scene.add(group);
    const d = {
      type, T, group, glowMat, design, pos, vel: new THREE.Vector3(), hp: T.hp, state: 'fight',
      yaw: 0, tilt: new THREE.Vector2(), orbit: Math.random() * 6.28, orbitDir: Math.random() < 0.5 ? 1 : -1,
      range: THREE.MathUtils.lerp(T.range[0], T.range[1], Math.random()), alt: THREE.MathUtils.lerp(T.alt[0], T.alt[1], Math.random()),
      fireT: 2.5 + Math.random() * 2, charge: 0, burstLeft: 0, burstT: 0, hitFlash: 0, jink: new THREE.Vector3(), jinkT: 0,
      retarget: 0, dead: 0, spin: 0, smokeT: 0, bob: Math.random() * 6.28,
    };
    this.list.push(d);
    return d;
  }

  /** Ray vs drones. Returns { drone, distance, point, crit } for the nearest hit, or null. */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const d of this.list) {
      if (d.state === 'dying') continue;
      _v.subVectors(d.pos, origin);
      const tc = _v.dot(dir);
      if (tc < 0 || tc > maxDist + d.T.radius) continue;
      const d2 = _v.lengthSq() - tc * tc, r = d.T.radius;
      if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2);
      if (t < 0 || (best && t >= best.distance)) continue;
      // the Warden's eye is a weak spot
      let crit = false;
      if (d.type === 'warden') {
        _w.copy(d.design.eye).applyQuaternion(d.group.quaternion).add(d.pos).sub(origin);
        const te = _w.dot(dir);
        crit = te > 0 && _w.lengthSq() - te * te < 0.3 * 0.3;
      }
      best = { drone: d, distance: t, point: new THREE.Vector3().copy(origin).addScaledVector(dir, t), crit };
    }
    return best;
  }

  damage(d, amount, dir, point) {
    if (d.state === 'dying') return false;
    d.hp -= amount;
    d.hitFlash = 0.12;
    d.vel.addScaledVector(dir, 2.2 / d.T.size);
    d.jinkT = 0;        // being hit makes it jink immediately
    this.fx.sparks(point, _v.copy(dir).negate(), { count: 9, color: [1.4, 2.4, 3.6], speed: 6, size: 0.012, life: 0.4 });
    this.fx.sparks(point, _v, { count: 4, color: [3.4, 2.2, 0.8], speed: 4, size: 0.01, life: 0.5 });
    if (d.hp <= 0) {
      d.state = 'dying'; d.dead = 0;
      d.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 5);
      d.vel.y += 2 + Math.random() * 2;
      this.onKill?.(d);
      return true;
    }
    return false;
  }

  fireBolt(d, playerPos, playerVel, accuracy) {
    const muzzle = d.design.muzzles[(d.burstLeft + (d.muzzleFlip = !d.muzzleFlip ? 1 : 0)) % d.design.muzzles.length];
    const from = _v.copy(muzzle).applyQuaternion(d.group.quaternion).add(d.pos).clone();
    // lead the target, with error that shrinks as the director raises accuracy
    const dist = from.distanceTo(playerPos), tt = dist / d.T.boltSpeed;
    const aim = _w.copy(playerPos).addScaledVector(playerVel, tt * 0.75);
    aim.y += 1.15;
    const err = (1 - accuracy) * 0.07 * dist + 0.25;
    aim.x += (Math.random() - 0.5) * err; aim.y += (Math.random() - 0.5) * err * 0.7; aim.z += (Math.random() - 0.5) * err;
    const vel = aim.sub(from).normalize().multiplyScalar(d.T.boltSpeed);
    this.bolts.push({ p: from, v: vel.clone(), life: 3.2, damage: d.T.damage, whizzed: false });
    this.fx.flash(from, 0xff5a20, 60, 8, 0.06);
    this.onShoot?.(d, from);
  }

  dropPickup(pos, kind) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.pickupGeo, this.pickupCase); body.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.09, 0.215), this.pickupMats[kind]);
    g.add(body, band);
    g.position.set(pos.x, this.col.groundHeight(pos.x, pos.z, 0) + 0.35, pos.z);
    this.scene.add(g);
    this.pickups.push({ kind, group: g, life: 45, base: g.position.y });
  }

  clear() {
    for (const d of this.list) this.scene.remove(d.group);
    for (const p of this.pickups) this.scene.remove(p.group);
    this.list.length = 0; this.bolts.length = 0; this.pickups.length = 0;
    this.boltMesh.count = 0;
  }

  update(dt, player, accuracy = 0.5, active = true) {
    this.time += dt;
    const pp = player.pos, eye = _d.set(pp.x, pp.y + 1.2, pp.z);
    this.mats.rotor.map.rotation += dt * 38;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i], T = d.T;
      if (d.state === 'dying') {
        // spin out trailing smoke, then blow up on the ground
        d.dead += dt;
        d.vel.y -= 13 * dt; d.vel.multiplyScalar(Math.exp(-dt * 0.4));
        d.pos.addScaledVector(d.vel, dt);
        d.group.rotation.y += d.spin * dt; d.group.rotation.z += d.spin * 0.35 * dt; d.group.rotation.x += d.spin * 0.2 * dt;
        d.smokeT -= dt;
        if (d.smokeT <= 0) {
          d.smokeT = 0.035;
          this.fx.puff(d.pos, _up, { count: 1, color: [0.09, 0.09, 0.1], size: 0.22 * T.size, life: 1.3, alpha: 0.7, speed: 0.4 });
          if (Math.random() < 0.5) this.fx.sparks(d.pos, _up, { count: 2, color: [3.2, 1.7, 0.5], speed: 3, life: 0.4 });
        }
        const ground = this.col.groundHeight(d.pos.x, d.pos.z, 0);
        const hitHall = Math.hypot(d.pos.x - HALL.x, d.pos.z - HALL.z) < HALL.rRoof && d.pos.y < HALL.hRoof + 0.3 && d.pos.y > HALL.hRoof - 1.5;
        if (d.pos.y < ground + 0.25 * T.size || hitHall || d.dead > 4) {
          d.pos.y = Math.max(d.pos.y, ground + 0.2);
          this.fx.explosion(d.pos, T.size * 0.75);
          this.fx.spawnDebris(d.pos, _v.copy(d.vel).multiplyScalar(0.3), Math.round(6 * T.size), 0.11 * T.size);
          if (!hitHall && d.pos.y < ground + 1) this.fx.decal('scorch', _v.set(d.pos.x, ground + 0.005, d.pos.z), _up, 1.3 * T.size);
          this.onExplode?.(d);
          this.scene.remove(d.group);
          d.glowMat.dispose();
          this.list.splice(i, 1);
        } else d.group.position.copy(d.pos);
        continue;
      }

      // ---- choose where to be: orbit the player at a preferred range and height
      const toP = _v.subVectors(eye, d.pos);
      const dist = toP.length();
      d.orbit += d.orbitDir * dt * (T.speed / Math.max(d.range, 8)) * 0.55;
      d.retarget -= dt;
      if (d.retarget <= 0) {
        d.retarget = 3 + Math.random() * 4;
        if (Math.random() < 0.35) d.orbitDir *= -1;
        d.range = THREE.MathUtils.lerp(T.range[0], T.range[1], Math.random());
        d.alt = THREE.MathUtils.lerp(T.alt[0], T.alt[1], Math.random());
      }
      d.jinkT -= dt;
      if (d.jinkT <= 0) { d.jinkT = 0.7 + Math.random() * 1.3; d.jink.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 6).multiplyScalar(1 / Math.sqrt(T.size)); }
      const tx = pp.x + Math.sin(d.orbit) * d.range + d.jink.x, tz = pp.z + Math.cos(d.orbit) * d.range + d.jink.z;
      const ground = this.col.groundHeight(tx, tz, 0);
      const ty = ground + d.alt + Math.sin(this.time * 1.3 + d.bob) * 0.5 + d.jink.y;
      const want = _w.set(tx - d.pos.x, ty - d.pos.y, tz - d.pos.z);
      const wl = want.length();
      want.multiplyScalar(Math.min(T.speed, wl * 1.6) / (wl || 1));

      // ---- stay out of the architecture and the trees
      const rho = Math.hypot(d.pos.x - HALL.x, d.pos.z - HALL.z);
      if (rho < HALL.rRoof + 5 && d.pos.y < HALL.hDrum + 3) {
        const k = (HALL.rRoof + 5 - rho) * 1.6;
        want.x += (d.pos.x - HALL.x) / rho * k; want.z += (d.pos.z - HALL.z) / rho * k; want.y += 2;
      }
      const rr = Math.hypot(d.pos.x, d.pos.z);
      if (rr > RING.rCanopy - 5 && d.pos.y < RING.hTop + 3) {
        const k = (rr - (RING.rCanopy - 5)) * 1.8;
        want.x -= d.pos.x / rr * k; want.z -= d.pos.z / rr * k;
        if (rr > RING.rCanopy) want.y += 5;
      }
      for (const t of this.trees) {
        const dx = d.pos.x - t.x, dz = d.pos.z - t.z, dd = dx * dx + dz * dz, rad = 2.9 * t.scale;
        if (dd < rad * rad && d.pos.y < 5.2 * t.scale) { const l = Math.sqrt(dd) || 1, k = (rad - l) * 2.5; want.x += dx / l * k; want.z += dz / l * k; }
      }
      for (const o of this.list) {
        if (o === d || o.state === 'dying') continue;
        const dx = d.pos.x - o.pos.x, dy = d.pos.y - o.pos.y, dz = d.pos.z - o.pos.z, dd = dx * dx + dy * dy + dz * dz, rad = (T.size + o.T.size) * 1.3;
        if (dd < rad * rad) { const l = Math.sqrt(dd) || 1, k = (rad - l) * 3; want.x += dx / l * k; want.y += dy / l * k; want.z += dz / l * k; }
      }
      const minY = this.col.groundHeight(d.pos.x, d.pos.z, 0) + 1.6 * Math.sqrt(T.size);
      if (d.pos.y < minY + 1) want.y += (minY + 1 - d.pos.y) * 4;

      // ---- fly
      const dv = want.sub(d.vel);
      const dl = dv.length(), maxDv = T.accel * dt;
      if (dl > maxDv) dv.multiplyScalar(maxDv / dl);
      d.vel.add(dv);
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < minY) { d.pos.y = minY; d.vel.y = Math.max(0, d.vel.y); }

      // face the player; bank into the direction of travel like a real multirotor
      const yawT = Math.atan2(-toP.x, -toP.z);
      let dy = yawT - d.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      d.yaw += dy * Math.min(1, dt * 5);
      const cy = Math.cos(d.yaw), sy = Math.sin(d.yaw);
      const fwdV = -d.vel.x * sy - d.vel.z * cy, sideV = d.vel.x * cy - d.vel.z * sy;
      d.tilt.x += ((-fwdV * 0.035) - d.tilt.x) * Math.min(1, dt * 5);
      d.tilt.y += ((-sideV * 0.04) - d.tilt.y) * Math.min(1, dt * 5);
      const pitchToP = Math.atan2(toP.y, Math.hypot(toP.x, toP.z));
      d.group.position.copy(d.pos);
      d.group.rotation.set(THREE.MathUtils.clamp(d.tilt.x + pitchToP * 0.5, -0.6, 0.6), d.yaw, THREE.MathUtils.clamp(d.tilt.y, -0.5, 0.5), 'YXZ');

      // ---- shoot
      d.hitFlash -= dt;
      let glow = 3.5 + Math.sin(this.time * 6 + d.bob) * 0.6;
      if (active && player.alive) {
        if (d.burstLeft > 0) {
          d.burstT -= dt;
          if (d.burstT <= 0) { d.burstT = 0.11; d.burstLeft--; this.fireBolt(d, pp, player.vel, accuracy); }
          glow = 14;
        } else {
          d.fireT -= dt;
          if (d.fireT < 0.5) {
            // telegraph: the eye flares before a volley
            d.charge = 1 - Math.max(0, d.fireT) / 0.5;
            glow = 4 + d.charge * 16;
            if (d.fireT <= 0) {
              d.fireT = THREE.MathUtils.lerp(T.fireDelay[0], T.fireDelay[1], Math.random());
              const firing = this.list.reduce((n, o) => n + (o.burstLeft > 0 ? 1 : 0), 0);
              if (firing < 2 && dist < T.range[1] + 14 && this.col.clear(d.pos, eye)) { d.burstLeft = T.burst; d.burstT = 0; }
              else if (firing >= 2) d.fireT = 0.6 + Math.random() * 0.6;            // wait for a slot
            }
          }
        }
      }
      if (d.hitFlash > 0) glow = 40;
      d.glowMat.emissiveIntensity = glow;
    }

    // ---- bolts
    let nb = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const step = b.v.length() * dt;
      _v.copy(b.v).normalize();
      let done = b.life <= 0;
      // player: closest approach of this frame's segment to the body's centre line
      if (!done && player.alive) {
        _w.set(pp.x, pp.y + 0.95, pp.z).sub(b.p);
        const t = THREE.MathUtils.clamp(_w.dot(_v), 0, step);
        const cx = b.p.x + _v.x * t - pp.x, cy = b.p.y + _v.y * t, cz = b.p.z + _v.z * t - pp.z;
        const dyc = cy < pp.y + 0.2 ? cy - (pp.y + 0.2) : cy > pp.y + 1.7 ? cy - (pp.y + 1.7) : 0;
        const d2 = cx * cx + cz * cz + dyc * dyc;
        if (d2 < 0.42 * 0.42) { this.onPlayerHit?.(b.damage, b.p, _v); done = true; }
        else if (!b.whizzed && d2 < 2.2 * 2.2) { b.whizzed = true; this.onBoltNear?.(b.p); }
      }
      if (!done) {
        const h = this.col.raycast(b.p, _v, step + 0.1);
        if (h) {
          this.fx.impact(h, _v, 1);
          this.fx.flash(h.point, 0xff6a30, 40, 6, 0.08);
          done = true;
        }
      }
      if (done) { this.bolts.splice(i, 1); continue; }
      b.p.addScaledVector(b.v, dt);
    }
    for (const b of this.bolts) {
      _q.setFromUnitVectors(_s.set(0, 0, 1), _v.copy(b.v).normalize());
      this.boltMesh.setMatrixAt(nb++, _m.compose(b.p, _q, _s.set(1, 1, 1)));
    }
    this.boltMesh.count = nb;
    this.boltMesh.instanceMatrix.needsUpdate = true;

    // ---- pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt;
      p.group.rotation.y += dt * 1.6;
      p.group.position.y = p.base + Math.sin(this.time * 2.4 + i) * 0.06;
      p.group.scale.setScalar(p.life < 5 ? 0.6 + 0.4 * Math.abs(Math.sin(this.time * 9)) : 1);
      const near = Math.hypot(p.group.position.x - pp.x, p.group.position.z - pp.z) < 1.4 && Math.abs(p.base - pp.y) < 2.2;
      if ((near && player.alive && this.onPickup?.(p.kind)) || p.life <= 0) {
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
      }
    }
  }
}
