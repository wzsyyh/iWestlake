import * as THREE from 'three';

const MAX_P = 1400, MAX_TRACERS = 40, MAX_DECALS = 72, MAX_DEBRIS = 48;
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

function particleMaterial(additive, noise) {
  return new THREE.ShaderMaterial({
    uniforms: { uNoise: { value: noise }, uSun: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: /* glsl */`
      attribute vec4 aPos;      // xyz, size
      attribute vec4 aVel;      // xyz (for streaking), rotation
      attribute vec4 aCol;      // rgb, alpha
      varying vec2 vUv; varying vec4 vCol; varying float vRot;
      void main() {
        vec3 center = ( viewMatrix * vec4( aPos.xyz, 1.0 ) ).xyz;
        vec2 corner = position.xy;
        vUv = corner; vCol = aCol; vRot = aVel.w;
        #ifdef STREAK
          // stretch along the screen-space velocity so fast sparks read as streaks
          vec3 vv = ( viewMatrix * vec4( aVel.xyz, 0.0 ) ).xyz;
          float sp = length( vv.xy );
          vec2 dir = sp > 1e-3 ? vv.xy / sp : vec2( 0.0, 1.0 );
          vec2 perp = vec2( -dir.y, dir.x );
          float stretch = 1.0 + min( sp * 0.035, 7.0 );
          center.xy += ( dir * corner.y * stretch + perp * corner.x ) * aPos.w;
        #else
          float c = cos( aVel.w ), s = sin( aVel.w );
          center.xy += vec2( corner.x * c - corner.y * s, corner.x * s + corner.y * c ) * aPos.w;
        #endif
        gl_Position = projectionMatrix * vec4( center, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform vec3 uSun;
      varying vec2 vUv; varying vec4 vCol; varying float vRot;
      void main() {
        float r = length( vUv );
        if ( r > 1.0 ) discard;
        #ifdef STREAK
          float a = pow( 1.0 - r, 2.2 );
          gl_FragColor = vec4( vCol.rgb * a * vCol.a, 1.0 );
        #else
          float n = texture2D( uNoise, vUv * 0.23 + vRot * 0.37 ).r;
          float a = smoothstep( 1.0, 0.25, r ) * smoothstep( 0.18, 0.62, n + ( 1.0 - r ) * 0.5 );
          // fake lighting: brighter towards the top of the puff
          vec3 c = vCol.rgb * ( 0.62 + 0.38 * vUv.y ) * ( 0.55 + 0.45 * uSun );
          gl_FragColor = vec4( c, a * vCol.a );
        #endif
      }`,
    defines: additive ? { STREAK: '' } : {},
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
}

class ParticlePool {
  constructor(scene, additive, noise, max = MAX_P) {
    this.max = max; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(max * 4); this.vel = new Float32Array(max * 4); this.col = new Float32Array(max * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aVel', this.aVel); g.setAttribute('aCol', this.aCol);
    this.geo = g;
    // simulation state (not uploaded)
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max); this.spin = new Float32Array(max); this.bounce = new Uint8Array(max);
    this.mesh = new THREE.Mesh(g, particleMaterial(additive, noise));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 20 : 10;
    g.instanceCount = 0;
    scene.add(this.mesh);
  }

  emit(p, v, { size = 0.05, life = 0.5, color = [1, 1, 1], alpha = 1, gravity = 0, drag = 0, grow = 0, spin = 0, bounce = false } = {}) {
    let i = this.n;
    if (i >= this.max) { i = (Math.random() * this.max) | 0; } else this.n++;
    this.pos[i * 4] = p.x; this.pos[i * 4 + 1] = p.y; this.pos[i * 4 + 2] = p.z; this.pos[i * 4 + 3] = size;
    this.vel[i * 4] = v.x; this.vel[i * 4 + 1] = v.y; this.vel[i * 4 + 2] = v.z; this.vel[i * 4 + 3] = Math.random() * 6.28;
    this.col[i * 4] = color[0]; this.col[i * 4 + 1] = color[1]; this.col[i * 4 + 2] = color[2]; this.col[i * 4 + 3] = alpha;
    this.life[i] = this.maxLife[i] = life; this.grav[i] = gravity; this.drag[i] = drag; this.grow[i] = grow;
    this.alpha0[i] = alpha; this.spin[i] = spin; this.bounce[i] = bounce ? 1 : 0;
  }

  update(dt, groundY) {
    const { pos, vel, col, life } = this;
    for (let i = 0; i < this.n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // swap-remove
        const l = --this.n;
        if (i !== l) {
          for (let k = 0; k < 4; k++) { pos[i * 4 + k] = pos[l * 4 + k]; vel[i * 4 + k] = vel[l * 4 + k]; col[i * 4 + k] = col[l * 4 + k]; }
          life[i] = life[l]; this.maxLife[i] = this.maxLife[l]; this.grav[i] = this.grav[l]; this.drag[i] = this.drag[l];
          this.grow[i] = this.grow[l]; this.alpha0[i] = this.alpha0[l]; this.spin[i] = this.spin[l]; this.bounce[i] = this.bounce[l];
        }
        i--; continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      vel[i * 4] *= d; vel[i * 4 + 1] = vel[i * 4 + 1] * d - this.grav[i] * dt; vel[i * 4 + 2] *= d;
      pos[i * 4] += vel[i * 4] * dt; pos[i * 4 + 1] += vel[i * 4 + 1] * dt; pos[i * 4 + 2] += vel[i * 4 + 2] * dt;
      if (this.bounce[i] && pos[i * 4 + 1] < groundY + 0.02 && vel[i * 4 + 1] < 0) {
        pos[i * 4 + 1] = groundY + 0.02; vel[i * 4 + 1] *= -0.42; vel[i * 4] *= 0.6; vel[i * 4 + 2] *= 0.6;
      }
      pos[i * 4 + 3] += this.grow[i] * dt;
      vel[i * 4 + 3] += this.spin[i] * dt;
      const t = life[i] / this.maxLife[i];
      col[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 12 + 0.25);
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aCol.needsUpdate = true;
  }
}

function decalTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  if (kind === 'scorch') {
    grd.addColorStop(0, 'rgba(8,8,10,0.95)'); grd.addColorStop(0.25, 'rgba(14,13,13,0.85)'); grd.addColorStop(0.6, 'rgba(30,26,24,0.4)'); grd.addColorStop(1, 'rgba(40,35,30,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(10,10,10,0.5)';
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r0 = 8 + Math.random() * 10, r1 = 28 + Math.random() * 30; g.lineWidth = 0.6 + Math.random() * 1.6; g.beginPath(); g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); g.stroke(); }
  } else {
    // glass strike: bright frosted core with radial cracks
    grd.addColorStop(0, 'rgba(235,245,255,0.95)'); grd.addColorStop(0.12, 'rgba(210,225,240,0.7)'); grd.addColorStop(0.3, 'rgba(200,215,230,0.12)'); grd.addColorStop(1, 'rgba(200,215,230,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(225,238,250,0.8)';
    for (let i = 0; i < 13; i++) {
      let a = Math.random() * 6.28, x = 64, y = 64; g.lineWidth = 0.5 + Math.random() * 0.9; g.beginPath(); g.moveTo(x, y);
      const segs = 3 + (Math.random() * 3 | 0);
      for (let k = 0; k < segs; k++) { a += (Math.random() - 0.5) * 0.7; const l = 6 + Math.random() * 14; x += Math.cos(a) * l; y += Math.sin(a) * l; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(225,238,250,0.45)';
    for (const r of [14, 26]) { g.lineWidth = 0.6; g.beginPath(); for (let a = 0; a < 6.3; a += 0.5) { const rr = r + (Math.random() - 0.5) * 6; a === 0 ? g.moveTo(64 + rr, 64) : g.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr); } g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pooled visual effects: sparks, smoke, tracers, impact decals, debris and short-lived lights. */
export class FX {
  constructor(scene, noise, sunColor) {
    this.scene = scene;
    this.sparksPool = new ParticlePool(scene, true, noise);
    this.smokePool = new ParticlePool(scene, false, noise, 700);
    const sc = sunColor.clone(); const pk = Math.max(sc.r, sc.g, sc.b); sc.multiplyScalar(1 / pk);
    this.smokePool.mesh.material.uniforms.uSun.value.copy(sc);

    // tracers: camera-facing ribbons between two points
    const tg = new THREE.InstancedBufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    tg.setIndex([0, 1, 2, 0, 2, 3]);
    this.tA = new Float32Array(MAX_TRACERS * 4); this.tB = new Float32Array(MAX_TRACERS * 4); this.tC = new Float32Array(MAX_TRACERS * 4);
    this.tAa = new THREE.InstancedBufferAttribute(this.tA, 4).setUsage(THREE.DynamicDrawUsage);
    this.tBa = new THREE.InstancedBufferAttribute(this.tB, 4).setUsage(THREE.DynamicDrawUsage);
    this.tCa = new THREE.InstancedBufferAttribute(this.tC, 4).setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('aA', this.tAa); tg.setAttribute('aB', this.tBa); tg.setAttribute('aC', this.tCa);
    tg.instanceCount = 0;
    this.tracers = [];
    this.tracerMesh = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        attribute vec4 aA; attribute vec4 aB; attribute vec4 aC;
        varying vec2 vUv; varying vec4 vC;
        void main() {
          vec3 a = ( viewMatrix * vec4( aA.xyz, 1.0 ) ).xyz, b = ( viewMatrix * vec4( aB.xyz, 1.0 ) ).xyz;
          vec3 p = mix( a, b, position.x );
          vec2 d = normalize( ( b.xy / max( -b.z, 0.05 ) ) - ( a.xy / max( -a.z, 0.05 ) ) + 1e-6 );
          p.xy += vec2( -d.y, d.x ) * position.y * aA.w * ( 1.0 + ( -p.z ) * 0.012 );
          vUv = position.xy; vC = aC;
          gl_Position = projectionMatrix * vec4( p, 1.0 );
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying vec4 vC;
        void main() {
          float a = pow( 1.0 - abs( vUv.y ), 2.0 ) * smoothstep( 0.0, 0.25, vUv.x ) * ( 0.35 + 0.65 * vUv.x );
          gl_FragColor = vec4( vC.rgb * a * vC.a, 1.0 );
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.tracerMesh.frustumCulled = false; this.tracerMesh.renderOrder = 21;
    scene.add(this.tracerMesh);

    // decals
    this.decals = {};
    for (const kind of ['scorch', 'glass']) {
      const mat = new THREE.MeshBasicMaterial({ map: decalTexture(kind), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, fog: true, toneMapped: false });
      if (kind === 'scorch') mat.color.setScalar(0.5);
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX_DECALS);
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 5;
      scene.add(mesh);
      this.decals[kind] = { mesh, next: 0 };
    }

    // tumbling debris (wreck fragments)
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), null, MAX_DEBRIS);
    this.debrisMesh.count = 0; this.debrisMesh.frustumCulled = false; this.debrisMesh.castShadow = true;
    this.debris = [];
    scene.add(this.debrisMesh);

    // a fixed set of point lights (created up front so shaders never recompile mid-fight)
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.userData.life = 0; l.userData.max = 1; l.userData.peak = 0;
      scene.add(l); this.lights.push(l);
    }
  }

  setDebrisMaterial(mat) { this.debrisMesh.material = mat; }

  flash(pos, color, intensity, distance = 12, life = 0.07) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.userData.life <= 0) { best = l; break; } else if (l.userData.life < best.userData.life) best = l;
    best.position.copy(pos); best.color.set(color); best.distance = distance;
    best.userData.life = best.userData.max = life; best.userData.peak = intensity; best.intensity = intensity;
  }

  tracer(from, to, color = [0.5, 0.9, 1.6], width = 0.022, speed = 420) {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    const len = from.distanceTo(to);
    this.tracers.push({ a: from.clone(), b: to.clone(), len, t: 0, dur: Math.max(0.05, len / speed), color, width });
  }

  sparks(pos, normal, { count = 10, color = [3.2, 1.9, 0.7], speed = 6, size = 0.012, life = 0.45, spread = 0.9 } = {}) {
    for (let i = 0; i < count; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(spread).add(normal).normalize().multiplyScalar(speed * (0.35 + Math.random()));
      this.sparksPool.emit(pos, _v, { size: size * (0.6 + Math.random()), life: life * (0.5 + Math.random()), color, gravity: 9.8, drag: 0.6, bounce: true });
    }
  }

  puff(pos, normal, { count = 3, color = [0.6, 0.6, 0.58], size = 0.12, life = 0.9, speed = 0.8, alpha = 0.5, rise = 0.3 } = {}) {
    for (let i = 0; i < count; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8).add(normal).multiplyScalar(speed * (0.5 + Math.random()));
      this.smokePool.emit(pos, _v, { size: size * (0.7 + Math.random() * 0.6), life: life * (0.7 + Math.random() * 0.6), color, alpha, gravity: -rise, drag: 2.2, grow: size * 2.4, spin: (Math.random() - 0.5) * 1.5 });
    }
  }

  decal(kind, pos, normal, size = 0.2) {
    const d = this.decals[kind];
    const i = d.next; d.next = (d.next + 1) % MAX_DECALS;
    _q.setFromUnitVectors(_z, normal);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(_z, Math.random() * 6.28));
    _m.compose(_v.copy(pos).addScaledVector(normal, 0.012), _q, _s.set(size, size, size));
    d.mesh.setMatrixAt(i, _m);
    d.mesh.count = Math.max(d.mesh.count, i + 1);
    d.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Surface-appropriate impact for a weapon hit. */
  impact(hit, dir, energy = 1) {
    const { point, normal, surface } = hit;
    if (surface === 'glass') {
      this.decal('glass', point, normal, 0.16 + Math.random() * 0.1);
      this.sparks(point, normal, { count: 7, color: [1.6, 1.9, 2.2], speed: 4, size: 0.008, life: 0.35 });
      this.puff(point, normal, { count: 1, color: [0.85, 0.9, 0.95], size: 0.06, life: 0.4, alpha: 0.35 });
    } else if (surface === 'grass') {
      this.puff(point, normal, { count: 3, color: [0.25, 0.2, 0.13], size: 0.1, life: 0.7, speed: 1.4, alpha: 0.7, rise: -2.5 });
      this.sparks(point, normal, { count: 5, color: [0.18, 0.3, 0.08], speed: 3.2, size: 0.014, life: 0.6 });
    } else if (surface === 'metal') {
      this.decal('scorch', point, normal, 0.09 + Math.random() * 0.05);
      this.sparks(point, normal, { count: 16, color: [3.6, 2.4, 1.0], speed: 8, life: 0.5 });
    } else {
      this.decal('scorch', point, normal, 0.13 + Math.random() * 0.08);
      this.sparks(point, normal, { count: 8 * energy, speed: 5 });
      this.puff(point, normal, { count: 2, color: surface === 'wood' ? [0.5, 0.4, 0.28] : [0.66, 0.66, 0.64], size: 0.09, life: 0.8, speed: 1.1, alpha: 0.5 });
    }
  }

  explosion(pos, scale = 1, color = [3.5, 2.0, 0.8]) {
    this.flash(pos, 0xffb060, 900 * scale, 30 * scale, 0.35);
    _n.set(0, 1, 0);
    this.sparks(pos, _n, { count: Math.round(46 * scale), color, speed: 13 * scale, size: 0.022, life: 0.9, spread: 3 });
    this.sparks(pos, _n, { count: Math.round(20 * scale), color: [1.2, 2.2, 3.6], speed: 7 * scale, size: 0.016, life: 0.5, spread: 3 });
    // fireball core (additive, short) then rolling smoke
    for (let i = 0; i < 10 * scale; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(4 * scale);
      this.sparksPool.emit(pos, _v, { size: 0.28 * scale * (0.6 + Math.random()), life: 0.22 + Math.random() * 0.16, color: [2.6, 1.3, 0.4], drag: 3 });
    }
    for (let i = 0; i < 12 * scale; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(3.4 * scale);
      this.smokePool.emit(pos, _v, { size: 0.35 * scale, life: 1.6 + Math.random() * 1.4, color: [0.1, 0.1, 0.11], alpha: 0.75, gravity: -0.9, drag: 1.5, grow: 0.9 * scale, spin: (Math.random() - 0.5) * 1.2 });
    }
  }

  spawnDebris(pos, vel, count, size = 0.12) {
    for (let i = 0; i < count; i++) {
      if (this.debris.length >= MAX_DEBRIS) this.debris.shift();
      this.debris.push({
        p: pos.clone(), v: new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 6 + 1, (Math.random() - 0.5) * 9).add(vel),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        s: new THREE.Vector3(size * (0.4 + Math.random()), size * (0.2 + Math.random() * 0.5), size * (0.4 + Math.random() * 1.2)), life: 7 + Math.random() * 3,
      });
    }
  }

  update(dt, camera, groundAt) {
    const gy = 0;
    this.sparksPool.update(dt, gy);
    this.smokePool.update(dt, -100);

    // tracers
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      if (t.t > t.dur + 0.06) { this.tracers.splice(i, 1); continue; }
    }
    for (const t of this.tracers) {
      // a bright slug travelling down the line, leaving a short fading trail
      const head = Math.min(1, t.t / t.dur), tail = Math.max(0, head - Math.min(1, 14 / t.len));
      _v.lerpVectors(t.a, t.b, tail); _n.lerpVectors(t.a, t.b, head);
      const fade = t.t > t.dur ? 1 - (t.t - t.dur) / 0.06 : 1;
      this.tA.set([_v.x, _v.y, _v.z, t.width], n * 4); this.tB.set([_n.x, _n.y, _n.z, 0], n * 4);
      this.tC.set([t.color[0], t.color[1], t.color[2], fade], n * 4);
      n++;
    }
    this.tracerMesh.geometry.instanceCount = n;
    this.tAa.needsUpdate = this.tBa.needsUpdate = this.tCa.needsUpdate = true;

    // lights
    for (const l of this.lights) {
      if (l.userData.life > 0) {
        l.userData.life -= dt;
        const k = Math.max(0, l.userData.life / l.userData.max);
        l.intensity = l.userData.peak * k * k;
      } else l.intensity = 0;
    }

    // debris
    let dn = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) { this.debris.splice(i, 1); continue; }
      d.v.y -= 16 * dt;
      d.p.addScaledVector(d.v, dt);
      const g = groundAt ? groundAt(d.p.x, d.p.z) : 0;
      const half = d.s.y * 0.5;
      if (d.p.y < g + half) {
        d.p.y = g + half;
        if (d.v.y < -1.2) { d.v.y *= -0.35; d.v.x *= 0.65; d.v.z *= 0.65; d.w.multiplyScalar(0.6); } else { d.v.set(0, 0, 0); d.w.set(0, 0, 0); }
      }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
    }
    for (const d of this.debris) {
      const k = Math.min(1, d.life * 2);
      _m.compose(d.p, _q.setFromEuler(d.r), _s.copy(d.s).multiplyScalar(k));
      this.debrisMesh.setMatrixAt(dn++, _m);
    }
    this.debrisMesh.count = dn;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
  }
}
