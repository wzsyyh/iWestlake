import * as THREE from 'three';

const WALK = 4.6, SPRINT = 7.3, CROUCH = 2.2, GRAVITY = 21, JUMP = 6.7;
const EYE_STAND = 1.68, EYE_CROUCH = 1.08, RADIUS = 0.36;

/** First-person controller: Quake-style acceleration, analytic collision, and all the camera "feel". */
export class Player {
  constructor(camera, collision) {
    this.camera = camera;
    this.col = collision;
    this.pos = new THREE.Vector3();          // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eye = EYE_STAND;
    this.onGround = true;
    this.crouching = false; this.sprinting = false; this.ads = 0;
    this.baseFov = 74;
    this.health = 100; this.maxHealth = 100; this.lastHurt = -99; this.alive = true;
    // camera feel
    this.bobPhase = 0; this.bobAmp = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.land = 0; this.landVel = 0;
    this.trauma = 0; this.roll = 0;
    this.coyote = 0; this.jumpBuffer = 0;
    this.speed = 0;
    this.onStep = null; this.onLand = null; this.onJump = null;
    this._stepAcc = 0;
    this.time = 0;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.col.groundHeight(x, z, 5), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.health = this.maxHealth; this.alive = true;
    this.recoilPitch = this.recoilYaw = this.trauma = 0;
  }

  get eyePos() { return _eye.set(this.pos.x, this.pos.y + this.eye, this.pos.z); }

  kick(pitch, yaw) { this.recoilPitch += pitch; this.recoilYaw += yaw; }
  shake(t) { this.trauma = Math.min(1, this.trauma + t); }

  update(dt, input, { adsHeld = false, canSprint = true, frozen = false } = {}) {
    this.time += dt;
    // ---- look
    if (!frozen) {
      const sens = 0.0022 * input.sensitivity * (1 - 0.45 * this.ads);
      this.yaw -= input.dx * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.dy * sens, -1.5, 1.5);
    }

    // ---- wish direction
    let fwd = 0, side = 0;
    if (!frozen) {
      if (input.down('KeyW')) fwd += 1;
      if (input.down('KeyS')) fwd -= 1;
      if (input.down('KeyD')) side += 1;
      if (input.down('KeyA')) side -= 1;
      fwd += input.moveY; side += input.moveX;       // gamepad stick
    }
    const len = Math.max(1, Math.hypot(fwd, side));
    fwd /= len; side /= len;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;

    this.crouching = !frozen && (input.down('ControlLeft') || input.down('KeyC'));
    this.sprinting = !frozen && canSprint && input.down('ShiftLeft') && fwd > 0.5 && !this.crouching && !adsHeld;
    this.ads += ((adsHeld && !this.sprinting ? 1 : 0) - this.ads) * (1 - Math.exp(-dt * 16));
    const max = (this.crouching ? CROUCH : this.sprinting ? SPRINT : WALK) * (1 - 0.4 * this.ads);

    // ---- horizontal velocity
    if (this.onGround) {
      const k = 1 - Math.exp(-dt * (fwd || side ? 11 : 14));
      this.vel.x += (wx * max - this.vel.x) * k;
      this.vel.z += (wz * max - this.vel.z) * k;
    } else {
      // air control: accelerate towards the wish direction without exceeding the cap
      const cur = this.vel.x * wx + this.vel.z * wz;
      const add = Math.max(0, Math.min(max - cur, 14 * dt));
      this.vel.x += wx * add; this.vel.z += wz * add;
    }

    // ---- jump (with a little coyote time and input buffering)
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    this.jumpBuffer = !frozen && input.hit('Space') ? 0.12 : this.jumpBuffer - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = JUMP; this.onGround = false; this.coyote = 0; this.jumpBuffer = 0;
      this.onJump?.();
    }

    // ---- integrate
    this.vel.y -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    const before = _v.copy(this.pos);
    if (this.col.resolve(this.pos, RADIUS, this.pos.y)) {
      // kill the velocity component that pushed into the wall so we slide along it
      const nx = this.pos.x - before.x, nz = this.pos.z - before.z, nl = Math.hypot(nx, nz);
      if (nl > 1e-5) {
        const into = (this.vel.x * nx + this.vel.z * nz) / nl;
        if (into < 0) { this.vel.x -= into * nx / nl; this.vel.z -= into * nz / nl; }
      }
    }
    const ground = this.col.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.36);
    const wasGround = this.onGround;
    if (this.pos.y <= ground + (wasGround ? 0.36 : 0) && this.vel.y <= 0) {
      if (!wasGround) {
        const impact = -this.vel.y;
        this.landVel -= Math.min(impact, 14) * 0.035;
        if (impact > 3) this.onLand?.(impact);
      }
      // steps: glide up rather than teleport
      this.pos.y = wasGround ? this.pos.y + (ground - this.pos.y) * Math.min(1, dt * 18) : ground;
      if (Math.abs(this.pos.y - ground) < 0.004) this.pos.y = ground;
      this.vel.y = 0; this.onGround = true;
    } else {
      this.onGround = false;
    }

    // ---- camera feel
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = this.onGround && this.speed > 0.6;
    this.bobAmp += ((moving ? Math.min(1, this.speed / SPRINT) : 0) - this.bobAmp) * (1 - Math.exp(-dt * 9));
    if (moving) {
      const rate = (this.sprinting ? 1.9 : 2.25) * this.speed;
      const prev = this.bobPhase;
      this.bobPhase += rate * dt;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) this.onStep?.(this.sprinting ? 1 : this.crouching ? 0.4 : 0.7);
    }
    this.eye += ((this.crouching ? EYE_CROUCH : EYE_STAND) - this.eye) * (1 - Math.exp(-dt * 12));
    // landing dip: damped spring
    this.landVel += (-this.land * 160 - this.landVel * 18) * dt;
    this.land += this.landVel * dt;
    // recoil recovers towards zero; most of the climb comes back down like a real weapon
    this.recoilPitch *= Math.exp(-dt * 7.5); this.recoilYaw *= Math.exp(-dt * 9);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const localSide = this.vel.x * cy - this.vel.z * sy;
    this.roll += ((-localSide / SPRINT) * 0.022 - this.roll) * (1 - Math.exp(-dt * 8));

    const cam = this.camera;
    const bob = this.bobAmp * (1 - 0.75 * this.ads);
    const bx = Math.cos(this.bobPhase) * 0.028 * bob, by = -Math.abs(Math.sin(this.bobPhase)) * 0.042 * bob;
    const sh = this.trauma * this.trauma, t = this.time * 31;
    cam.position.set(this.pos.x + cy * bx, this.pos.y + this.eye + by + this.land, this.pos.z - sy * bx);
    cam.rotation.set(
      this.pitch + this.recoilPitch + sh * 0.05 * Math.sin(t * 1.3 + 1),
      this.yaw + this.recoilYaw + sh * 0.05 * Math.sin(t + 4),
      this.roll + sh * 0.06 * Math.sin(t * 0.9 + 2), 'YXZ');
    const targetFov = this.baseFov * (1 - 0.3 * this.ads) + (this.sprinting ? 5 : 0);
    if (Math.abs(cam.fov - targetFov) > 0.01) { cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt * 10)); cam.updateProjectionMatrix(); }
  }
}

const _eye = new THREE.Vector3(), _v = new THREE.Vector3();
export { RADIUS as PLAYER_RADIUS };
