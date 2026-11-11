import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Renderer, QUALITY } from '../engine/render.js';
import { Assets } from '../engine/assets.js';
import { loadSky, createSkyDome } from '../engine/sky.js';
import { globals, setCSM, makeNoiseTexture, installAtmosphere, installSoftShadows } from '../engine/patch.js';
import { captureProbe } from '../engine/probe.js';
import { PlanarMirror } from '../engine/mirror.js';
import { HALL as HALL_GEO } from '../world/layout.js';
import { buildWorld } from '../world/world.js';
import { buildSignage } from '../world/signage.js';
import { SUN_AZIMUTH, SUN_BOOST, SUN_TINT, SKY, ZONE, HALL } from '../world/layout.js';
import { Input } from './input.js';
import { Collision } from './collide.js';
import { Player } from './player.js';
import { FX } from './fx.js';
import { Weapon, createWeaponMaterials, mergeByMaterial, WEAPON } from './weapon.js';
import { Drones, DRONE_TYPES } from './drones.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Mission } from './mission.js';
import { t, setLanguage, detectLanguage, getLanguage } from './i18n.js';

// Drones that arrive at the start and after each uplink is cut (the last group brings the boss).
const GROUPS = [
  { scout: 4 },
  { scout: 3, gunner: 2 },
  { scout: 4, gunner: 3 },
  { warden: 1, scout: 4, gunner: 2 },
];
const SPAWN = { x: 112, z: 90, yaw: 0.72 };
// equipment cases the lab left out on the court: cover for the player  [x, z, yaw, w, h, d]
const CASES = [
  [104, 80, 0.5, 1.5, 0.95, 0.9], [105.2, 81.4, 1.2, 0.8, 0.6, 0.7], [84, 66, -0.4, 1.5, 0.95, 0.9], [82.6, 64.9, 0.3, 1.0, 1.25, 0.8],
  [66, 44, 0.9, 1.5, 0.95, 0.9], [98, 40, -0.2, 1.5, 0.95, 0.9], [99.4, 41.2, 0.8, 0.8, 0.6, 0.7], [52, 70, 0.1, 1.0, 1.25, 0.8],
  [118, 58, 1.1, 1.5, 0.95, 0.9], [74, 92, -0.7, 1.5, 0.95, 0.9], [75, 93.5, 0.4, 0.8, 0.6, 0.7], [90, 20, 0.3, 1.0, 1.25, 0.8],
];
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();

function loadSettings() {
  // phones and tablets start on the lightest preset
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const def = { quality: coarse ? 'low' : 'high', sens: 1, fov: 74, vol: 0.8 };
  try { return { ...def, ...JSON.parse(localStorage.getItem('ringzero.settings') || '{}') }; } catch { return def; }
}

export class Game {
  constructor(canvas, params) {
    this.canvas = canvas; this.params = params;
    this.settings = loadSettings();
    if (params.get('q')) this.settings.quality = params.get('q');
    setLanguage(detectLanguage(params));
    this.hud = new HUD();
    // sound is a nicety: a failure inside the synthesiser must never take the game loop down with it
    const audio = new Audio();
    let warned = false;
    this.audio = new Proxy(audio, {
      get(target, key) {
        const v = target[key];
        if (typeof v !== 'function') return v;
        return (...args) => {
          try { return v.apply(target, args); } catch (e) { if (!warned) { warned = true; console.warn('[audio]', key, e); } return undefined; }
        };
      },
    });
    this.state = 'loading';
    this.time = 0; this.frames = 0;
    this.stats = { shots: 0, hits: 0, kills: 0, score: 0, time: 0 };
    this.wave = 0; this.queue = []; this.spawnT = 0; this.betweenT = 0; this.waveActive = false; this.endless = false;
    this.phase = 0; this.pendingGroup = null; this.reinforceT = 0; this.radioQueue = []; this.hurtHint = false;
    this.exposureAdapt = 1; this.lightProbeT = 0; this.lightTarget = 1;
    this.fpsAcc = 0; this.fpsN = 0; this.showStats = false;
    this.timeScale = 1;
  }

  _useFreeLook() {
    if (this.input.free) return;
    this.input.setFree();
    this.noLock = true;
    this.hud.toast(t('nolock'), true);
    if (this.state === 'paused') this.resume();
  }

  /** Capture the mouse for play (pointer lock, or the free-look fallback). */
  _grab() {
    if (this.input.free) { this.input.lock(); return; }
    if (this.noLock) return;
    this.input.lock();
    // some embedded viewers neither grant the lock nor report an error
    clearTimeout(this._grabTimer);
    this._grabTimer = setTimeout(() => {
      if (!this.input.locked && !this.input.everLocked && (this.state === 'playing' || this.state === 'paused')) this._useFreeLook();
    }, 1200);
  }

  saveSettings() { try { localStorage.setItem('ringzero.settings', JSON.stringify(this.settings)); } catch { /* private mode */ } }

  async init() {
    const { hud, settings } = this;
    hud.loading(0.03, t('l_start'));
    const R = this.R = new Renderer(this.canvas, settings.quality);
    const assets = this.assets = new Assets(R.anisotropy);
    hud.loading(0.06, t('l_sky'));
    const sky = this.sky = await loadSky(assets.url(`sky/${this.params.get('sky') || SKY}.hdr`), {
      sunAzimuth: SUN_AZIMUTH, sunBoost: SUN_BOOST, sunTint: SUN_TINT,
      onProgress: (e) => { if (e.total) hud.loading(0.06 + 0.2 * e.loaded / e.total); },
    });
    globals.uNoise.value = makeNoiseTexture();
    // haze colours come from the sky's own horizon, capped so distant haze never out-shines sunlit surfaces
    const capLum = (c, max) => { const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; return c.clone().multiplyScalar(Math.min(1, max / l)); };
    installAtmosphere({ sunDir: sky.sunDir, sunColor: capLum(sky.horizonSun, 1.4) });
    R.scene.fog = new THREE.FogExp2(capLum(sky.horizon, 0.8), parseFloat(this.params.get('fog') || '0.00055'));
    setCSM(R.setupSun(sky.sunDir, sky.sunIrradiance));
    if (R.q.softShadows) installSoftShadows({ blockerTaps: R.quality === 'ultra' ? 16 : 10, filterTaps: R.quality === 'ultra' ? 24 : 16 });
    const pmrem = new THREE.PMREMGenerator(R.renderer);
    R.scene.environment = pmrem.fromEquirectangular(sky.ambient).texture;
    pmrem.dispose();
    R.scene.add(createSkyDome(sky));

    const world = this.world = await buildWorld({ scene: R.scene, assets, sky, quality: R.q, progress: (p, key) => hud.loading(0.28 + p * 0.5, t(key)) });
    hud.loading(0.8, t('l_gear'));
    R.setupPost(sky.sunDir);
    this.baseExposure = parseFloat(this.params.get('ev') || '0.85');
    R.exposure = this.baseExposure;

    // ---- gameplay systems
    this.input = new Input(this.canvas);
    this.input.sensitivity = settings.sens;
    this.col = new Collision(world);
    this.player = new Player(R.camera, this.col);
    this.player.baseFov = settings.fov;
    this.fx = new FX(R.scene, globals.uNoise.value, sky.sunIrradiance);
    const wm = this.weaponMats = await createWeaponMaterials(assets);
    this.fx.setDebrisMaterial(wm.carbon);
    this.weapon = new Weapon(R.camera, wm);
    this.drones = new Drones(R.scene, wm, this.fx, this.col, world.trees);
    this._buildCases(wm);
    const signs = buildSignage((x, z) => this.col.groundHeight(x, z, 0));
    R.scene.add(signs.group);
    for (const c of signs.colliders) this.col.circles.push({ x: c.x, z: c.z, r: c.r, top: c.h });
    this._buildBarrier();
    this.mission = new Mission(R.scene, wm, this.col, (x, z) => this.col.groundHeight(x, z, 0));
    this.mission.onCut = (relay) => this._onUplinkCut(relay);
    this._wire();
    if (R.q.mirror) {
      const floor = world.statics.find((m) => m.name === 'hall.floor');
      this.mirror = new PlanarMirror(R, floor, { height: HALL_GEO.plinth, centre: { x: HALL_GEO.x, z: HALL_GEO.z }, range: HALL_GEO.rPlinth + 34, hide: [this.weapon.pivot, world.grass, this.barrier] });
    }

    // ---- reflection probe + shader warm-up (so the first shot / first drone never hitches)
    hud.loading(0.9, t('l_probe'));
    await new Promise((r) => setTimeout(r, 20));
    this.weapon.pivot.visible = false;
    R.camera.position.set(ZONE.x + 2, 2.6, ZONE.z - 10); R.camera.rotation.set(0, 0.6, 0);
    world.update(R.camera); R.render(1 / 60);
    R.scene.environment = captureProbe(R, sky, R.camera.position, { hide: [world.grass, this.barrier, ...this.mission.relays.map((r) => r.beam)] });
    const warm = Object.keys(DRONE_TYPES).map((t) => this.drones.spawn(t, R.camera.position));
    warm.forEach((d, i) => { d.pos.set(ZONE.x + i * 4, 6, ZONE.z - 30); d.group.position.copy(d.pos); });
    this.drones.dropPickup(_v.set(ZONE.x, 0, ZONE.z - 28), 'ammo');
    this.weapon.pivot.visible = true;
    R.renderer.compile(R.scene, R.camera);
    R.render(1 / 60);
    this.drones.clear();
    hud.loading(1, t('l_ready'));

    this.audio.setVolume(settings.vol);
    this._bindUi();
    addEventListener('resize', () => R.resize());
    this.toMenu();
  }

  // ------------------------------------------------------------------ construction helpers

  _buildCases(M) {
    // built as loose parts, then merged into one mesh per material (a handful of draw calls for all of them)
    const group = new THREE.Group();
    group.name = 'cases';
    const add = (geo, mat, g, x, y, z, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.updateMatrix();
      m.geometry = geo.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(g, m.matrix));
      m.position.set(0, 0, 0); m.castShadow = cast; m.receiveShadow = true;
      group.add(m);
    };
    const xf = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    for (const [x, z, yaw, w, h, d] of CASES) {
      const y = this.col.groundHeight(x, z, 0);
      xf.compose(_v.set(x, y + h / 2, z), q.setFromEuler(e.set(0, yaw, 0)), one);
      add(new RoundedBoxGeometry(w, h, d, 3, 0.045), M.caseShell, xf, 0, 0, 0);
      add(new RoundedBoxGeometry(w + 0.02, 0.06, d + 0.02, 2, 0.02), M.gunmetal, xf, 0, h * 0.22, 0);
      add(new THREE.BoxGeometry(w + 0.012, 0.07, d + 0.012), M.accent, xf, 0, -h * 0.28, 0);
      add(new THREE.BoxGeometry(0.06, 0.02, 0.012), M.glow, xf, w * 0.32, h * 0.32, d / 2 + 0.004, false);
      for (const sx of [-1, 1]) add(new RoundedBoxGeometry(0.1, 0.12, 0.03, 2, 0.01), M.steel, xf, sx * w * 0.28, h * 0.22, d / 2 + 0.012, false);
      this.col.addBox(x, z, w / 2, d / 2, yaw, y + h);
    }
    mergeByMaterial(group);
    this.R.scene.add(group);
  }

  _buildBarrier() {
    // the containment field only shows itself when you get close to it
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: globals.uTime, uPlayer: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uPlayer; varying vec3 vW;
        void main() {
          float d = distance( vW.xz, uPlayer.xz );
          float near = smoothstep( 13.0, 2.0, d );
          float ang = atan( vW.x - ${ZONE.x.toFixed(1)}, vW.z - ${ZONE.z.toFixed(1)} ) * ${(ZONE.r).toFixed(1)};
          vec2 g = vec2( ang, vW.y ) * 1.6;
          // hexagon-ish lattice
          vec2 h = vec2( g.x + floor( g.y ) * 0.5, g.y );
          vec2 f = abs( fract( h ) - 0.5 );
          float line = smoothstep( 0.42, 0.5, max( f.x, f.y ) );
          float scan = 0.5 + 0.5 * sin( vW.y * 9.0 - uTime * 3.0 );
          float a = near * ( line * 0.8 + 0.08 + scan * 0.06 ) * smoothstep( 4.5, 0.0, vW.y );
          gl_FragColor = vec4( vec3( 0.35, 1.3, 2.2 ) * a, 1.0 );
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    const mesh = this.barrier = new THREE.Mesh(new THREE.CylinderGeometry(ZONE.r, ZONE.r, 4.5, 160, 1, true), mat);
    mesh.position.set(ZONE.x, 2.25, ZONE.z);
    mesh.renderOrder = 15; mesh.frustumCulled = false;
    this.R.scene.add(mesh);
  }

  _wire() {
    const { weapon, drones, fx, audio, hud, player, col } = this;
    weapon.onFire = (spread) => this._shoot(spread);
    weapon.onDry = () => audio.dryFire();
    weapon.onReloadStart = () => audio.reload('start');
    weapon.onReloadEvent = (e) => audio.reload(e);
    player.onStep = (s) => audio.step(this._surfaceUnder(), s);
    player.onLand = (v) => audio.land(v);
    player.onJump = () => audio.jump();

    drones.onShoot = (d, pos) => audio.droneShot(pos, d.type === 'warden');
    drones.onBoltNear = (pos) => audio.whiz(pos);
    drones.onExplode = (d) => { audio.explosion(d.pos, d.T.size); audio.hum(d, null, 0, 1, false); const dist = d.pos.distanceTo(player.pos); player.shake(Math.max(0, 0.6 - dist / 40) * d.T.size); };
    drones.onKill = (d) => {
      this.stats.kills++; this.stats.score += d.T.score;
      hud.toast(t('destroyed', t(d.T.key), d.T.score));
      // resupply falls out of the wreck now and then (more readily when the player is hurting)
      const r = Math.random();
      const needHealth = player.health < 55, needAmmo = weapon.reserve < 60;
      if (r < (needHealth ? 0.5 : 0.16)) drones.dropPickup(d.pos, 'health');
      else if (r < (needAmmo ? 0.95 : 0.52) || d.type === 'warden') drones.dropPickup(d.pos, 'ammo');
    };
    drones.onPlayerHit = (dmg, pos, dir) => {
      if (!player.alive || this.state !== 'playing') return;
      player.health -= dmg; player.lastHurt = this.time;
      this.mission.interrupt();
      player.shake(0.35);
      audio.hurt();
      // direction of the attacker relative to where we are looking
      const a = Math.atan2(-dir.x, -dir.z) - player.yaw;
      hud.damageFrom(-a);
      if (player.health <= 0) this._die();
    };
    drones.onPickup = (kind) => {
      if (kind === 'ammo') { if (weapon.reserve >= 300) return false; weapon.addAmmo(45); hud.toast(t('p_ammo'), true); }
      else { if (player.health >= player.maxHealth) return false; player.health = Math.min(player.maxHealth, player.health + 35); hud.toast(t('p_health'), true); }
      audio.pickup(kind);
      return true;
    };
    void fx; void col;
  }

  _bindUi() {
    const $ = (id) => document.getElementById(id);
    const s = this.settings;
    $('opt-quality').value = QUALITY[s.quality] ? s.quality : 'high';
    $('opt-sens').value = s.sens; $('opt-fov').value = s.fov; $('opt-vol').value = s.vol;
    $('opt-quality').onchange = (e) => {
      s.quality = e.target.value; this.saveSettings();
      const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString();     // rebuilds the render pipeline
    };
    $('opt-sens').oninput = (e) => { s.sens = +e.target.value; this.input.sensitivity = s.sens; this.saveSettings(); };
    $('opt-fov').oninput = (e) => { s.fov = +e.target.value; this.player.baseFov = s.fov; this.saveSettings(); };
    $('opt-vol').oninput = (e) => { s.vol = +e.target.value; this.audio.setVolume(s.vol); this.saveSettings(); };
    $('opt-lang').value = getLanguage();
    $('opt-lang').onchange = (e) => { setLanguage(e.target.value); this.hud.refresh(); };
    $('btn-deploy').onclick = () => { this.audio.start(); this.audio.ui(); this.startRun(); };
    $('btn-resume').onclick = () => { this.audio.ui(); this.resume(); };
    $('btn-restart').onclick = () => { this.audio.ui(); this.startRun(); };
    $('btn-quit').onclick = () => { this.audio.ui(); this.toMenu(); };
    $('btn-end-menu').onclick = () => { this.audio.ui(); this.toMenu(); };
    $('btn-again').onclick = () => {
      this.audio.ui();
      if (this.state === 'won') { this.endless = true; this._resumeAfterEnd(); } else this._retryWave();
    };
    this.input.onLockChange = (locked) => {
      if (!locked && (this.state === 'playing' || this.state === 'winning') && !this.noLock) this.pause();
    };
    this.input.onLockError = () => {
      if (this.noLock) return;
      // never managed to capture the mouse (sandboxed preview?): switch to the free-look fallback
      if (!this.input.everLocked) this._useFreeLook();
      // browsers also refuse to re-lock for a moment after Esc: just fall back to the pause screen
      else if (this.state === 'playing') this.pause();
    };
    // the first touch switches on the on-screen controls
    addEventListener('touchstart', () => {
      this.input.enableTouch({ root: $('touch'), stick: $('t-stick'), fire: $('t-fire'), aim: $('t-aim'), reload: $('t-reload'), jump: $('t-jump'), use: $('t-use'), pause: $('t-pause') });
      this.noLock = true;
    }, { once: true, passive: true });
    this.input.onPadButton = (b) => { if (b === 'pause') { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); } };
    this.canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked && !this.noLock) this.input.lock(); });
    addEventListener('blur', () => { if (this.state === 'playing' && !this.noLock) this.pause(); });
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.showStats = this.hud.toggleStats(); }
      if (e.code === 'KeyP' && this.state === 'playing') this.pause();
      // without pointer lock there is no "lock lost" event, so Esc toggles the pause screen directly
      if (e.code === 'Escape' && this.input.free) { if (this.state === 'playing' || this.state === 'winning') this.pause(); else if (this.state === 'paused') this.resume(); }
    });
  }

  // ------------------------------------------------------------------ state changes

  toMenu() {
    this.state = 'menu';
    this.input.unlock();
    this.drones.clear(); this.audio.stopAllHums();
    this.hud.showHud(false); this.hud.screen('menu'); this.hud.clearTransient();
    this.weapon.pivot.visible = false;
    this.R.grade.uniforms.get('desat').value = 0;
    this.timeScale = 1;
  }

  startRun() {
    this.stats = { shots: 0, hits: 0, kills: 0, score: 0, time: 0 };
    this.wave = 0; this.endless = false; this.phase = 0; this.hurtHint = false;
    this.mission.reset();
    this.weapon.reset();
    this._beginPlay(true);
    this._enqueueGroup(0, 1.5);
    this.hud.banner(t('b_intro'), t('b_introSub'), 3.4);
    this._radio('r_start', 3.6);
  }

  _beginPlay(respawn) {
    this.drones.clear(); this.audio.stopAllHums();
    this.queue.length = 0; this.pendingGroup = null; this.radioQueue.length = 0; this.reinforceT = 14;
    this.hud.clearTransient();
    if (respawn) this.player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.player.health = this.player.maxHealth; this.player.alive = true;
    this.state = 'playing'; this.timeScale = 1;
    this.R.grade.uniforms.get('desat').value = 0;
    this.weapon.pivot.visible = true;
    this.hud.screen(null); this.hud.showHud(true);
    this._grab();
    this.audio.resume();
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'winning') return;
    this._resumeTo = this.state;
    this.state = 'paused';
    this.input.unlock();
    this.hud.screen('pause');
    this.audio.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this._resumeTo || 'playing';
    this.hud.screen(null);
    this._grab();
    this.audio.resume();
  }

  _die() {
    this.player.alive = false; this.player.health = 0;
    this.state = 'dying'; this.deathT = 0;
    this.audio.stinger('defeat');
  }

  /** After a death: back to the spawn with the uplinks already cut still cut. */
  _retryWave() {
    this.weapon.reset();
    this._beginPlay(true);
    if (this.endless) { this.wave = Math.max(0, this.wave - 1); this._queueWave(1.5); } else this._enqueueGroup(this.phase, 1.5);
  }

  _resumeAfterEnd() {
    this._beginPlay(false);
    this._queueWave(3);
  }

  _showEnd(victory) {
    this.state = victory ? 'won' : 'lost';
    this.input.unlock();
    const st = this.stats, mm = Math.floor(st.time / 60), ss = String(Math.floor(st.time % 60)).padStart(2, '0');
    const acc = st.shots ? Math.round(st.hits / st.shots * 100) : 0;
    this.hud.end({
      victory,
      kicker: victory ? t('e_winKicker') : this.endless ? t('e_loseKicker', this.wave) : t('objective', this.mission.cutCount, this.mission.relays.length),
      title: victory ? t('e_win') : t('e_lose'),
      rows: [[t('e_time'), `${mm}:${ss}`], [t('e_kills'), st.kills], [t('e_acc'), `${acc}%`], [t('e_score'), st.score.toLocaleString('en-US')]],
      again: victory ? t('e_again') : t('e_retry'),
    });
  }

  // ------------------------------------------------------------------ director

  _radio(key, delay = 0) { this.radioQueue.push({ at: this.time + delay, key }); }

  /** Schedule the drones for mission phase i (0 = opening group, 3 = boss group). */
  _enqueueGroup(i, delay) { this.pendingGroup = { i, t: delay }; }

  _launch(def, title, sub) {
    const group = [];
    for (const type of ['gunner', 'scout']) for (let k = 0; k < (def[type] || 0); k++) group.push(type);
    group.sort(() => Math.random() - 0.5);
    if (def.warden) group.splice(1, 0, 'warden');
    this.queue.push(...group);
    this.waveTotal = this.queue.length; this.spawned = 0; this.spawnT = 0;
    if (title) this.hud.banner(title, sub, 3);
    this.audio.stinger('wave');
  }

  _onUplinkCut(relay) {
    const m = this.mission, n = m.cutCount;
    this.phase = n;
    this.stats.score += 500;
    _v.set(relay.x, relay.y + 1.2, relay.z);
    this.fx.sparks(_v, _d.set(0, 1, 0), { count: 30, color: [1.2, 2.4, 3.6], speed: 7, life: 0.7, spread: 2.5 });
    this.fx.flash(_v, 0x6fd6ff, 300, 14, 0.3);
    this.audio.pickup('ammo');
    this.hud.banner(t('b_cut', relay.id), t('b_cutSub', n, m.relays.length), 2.6);
    this._radio(`r_cut${n}`, 1.2);
    this._enqueueGroup(n, 3.2);
    this.reinforceT = 18;
  }

  // endless mode (after the mission): plain escalating waves
  _queueWave(delay) { this.betweenT = delay; this.waveActive = false; }

  _startWave() {
    this.wave++;
    const n = this.wave + 3;
    this._launch({ scout: 2 + n, gunner: Math.floor(n / 2), warden: this.wave % 3 === 0 ? 1 : 0 }, null, null);
    this.hud.banner(t('b_wave', this.wave), t('b_waveSub', this.waveTotal), 3);
    this.waveActive = true;
  }

  _director(dt) {
    const { drones, mission } = this;
    // spawn whatever is queued, a drone at a time
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0 && drones.alive < 8) {
      drones.spawn(this.queue.shift(), this.player.pos, this.spawned++, this.waveTotal || 1);
      this.spawnT = 0.9 + Math.random() * 0.8;
    }
    if (this.endless) {
      if (!this.waveActive) { this.betweenT -= dt; if (this.betweenT <= 0) this._startWave(); return; }
      if (!this.queue.length && drones.list.length === 0) { this.hud.banner(t('b_clear'), t('b_clearSub'), 2.6); this._queueWave(6.5); }
      return;
    }
    if (this.pendingGroup) {
      this.pendingGroup.t -= dt;
      if (this.pendingGroup.t <= 0) {
        const def = GROUPS[this.pendingGroup.i];
        this.pendingGroup = null;
        if (def.warden) this._launch(def, t('b_boss'), t('b_bossSub')); else this._launch(def, null, null);
      }
      return;
    }
    if (!mission.done) {
      // while an uplink is still live the swarm keeps being topped up, so holding still never wins
      this.reinforceT -= dt;
      if (this.reinforceT <= 0 && drones.alive + this.queue.length < 2 + this.phase) {
        this.queue.push('scout');
        if (this.phase >= 1 && Math.random() < 0.35) this.queue.push(this.phase >= 2 ? 'gunner' : 'scout');
        this.reinforceT = 15 - this.phase * 2;
      }
    } else if (!this.queue.length && drones.list.length === 0) {
      this.state = 'winning'; this.winT = 0;
      this.audio.stinger('victory');
      this.hud.banner(t('b_win'), t('b_winSub'), 4);
      this._radio('r_win', 1.0);
    }
  }

  // ------------------------------------------------------------------ combat

  _shoot(spread) {
    const { R, weapon, drones, fx, audio, hud, col } = this;
    const cam = R.camera;
    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    // random point in a disc -> small angular offset
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * spread;
    _v.set(Math.cos(a) * r, Math.sin(a) * r, 0).applyQuaternion(cam.quaternion);
    _d.add(_v).normalize();
    const wall = col.raycast(_o, _d, 400);
    const hit = drones.raycast(_o, _d, wall ? wall.distance : 400);
    const end = hit ? hit.point : wall ? wall.point : _v.copy(_o).addScaledVector(_d, 300);
    const muzzle = weapon.muzzleWorld.clone();
    fx.tracer(muzzle, end);
    fx.flash(muzzle, 0x7fdcff, 160, 10, 0.05);
    audio.shot();
    this.stats.shots++;
    if (hit) {
      const killed = drones.damage(hit.drone, WEAPON.DAMAGE * (hit.crit ? 2.6 : 1), _d, hit.point);
      this.stats.hits++;
      hud.hit(killed); audio.hitmarker(killed);
      if (hit.crit && !killed) fx.sparks(hit.point, _v.copy(_d).negate(), { count: 14, color: [3.6, 0.8, 0.3], speed: 9, life: 0.5 });
    } else if (wall) {
      fx.impact(wall, _d);
      audio.impact(wall.point, wall.surface);
    }
  }

  _surfaceUnder() {
    const p = this.player.pos;
    if (Math.hypot(p.x - HALL.x, p.z - HALL.z) < HALL.rPlinth + 0.8) return 'hall';
    return this.world.lawnMask.sample(p.x, p.z) > 0.5 ? 'grass' : 'stone';
  }

  // ------------------------------------------------------------------ frame

  step(rawDt) {
    const { R, input, player, weapon, drones, fx, hud, audio, world } = this;
    const dt = Math.min(rawDt, 0.05) * this.timeScale;
    this.time += dt; this.frames++;
    input.beginFrame(Math.min(rawDt, 0.05));
    globals.uTime.value += dt;
    const cam = R.camera;

    if (this.state === 'menu' || this.state === 'loading') {
      // slow establishing shot along the promenade
      const t = globals.uTime.value * 0.035;
      cam.position.set(92 + Math.sin(t) * 34, 2.4 + Math.sin(t * 0.7) * 0.9 + 1.2, 74 + Math.cos(t) * 26);
      cam.lookAt(_v.set(64, 9, -30));
      if (Math.abs(cam.fov - 58) > 0.01) { cam.fov = 58; cam.updateProjectionMatrix(); }
      fx.update(dt, cam, null);
    } else if (this.state !== 'paused') {
      // the player keeps control through the short victory beat after the last drone falls
      const fighting = this.state === 'playing';
      const playing = fighting || this.state === 'winning';
      player.update(dt, input, { adsHeld: playing && input.buttons[2] && !weapon.reloading, frozen: !playing });
      cam.updateMatrixWorld(true);
      // keep the muzzle out of walls
      cam.getWorldDirection(_d);
      const wall = this.col.raycast(player.eyePos, _d, 1.2);
      weapon.update(dt, input, player, { enabled: playing, wallDist: wall ? wall.distance : 9 });

      if (fighting) {
        this.stats.time += dt;
        this._director(dt);
      }
      if (playing) {
        // slow regeneration once you have stayed out of trouble for a while
        if (this.time - player.lastHurt > 4 && player.health < player.maxHealth) player.health = Math.min(player.maxHealth, player.health + 12 * dt);
      }
      const accuracy = Math.min(0.8, 0.3 + (this.endless ? 3 + this.wave : this.phase) * 0.09);
      drones.update(dt, player, accuracy, playing);
      fx.update(dt, cam, (x, z) => this.col.groundHeight(x, z, 0));
      for (const d of drones.list) audio.hum(d, d.pos, Math.min(1, d.vel.length() / d.T.speed), d.T.size, true);

      if (this.state === 'dying') {
        this.deathT += rawDt;
        this.timeScale = Math.max(0.2, 1 - this.deathT * 1.4);
        R.grade.uniforms.get('desat').value = Math.min(0.85, this.deathT * 0.9);
        player.pitch += (-0.5 - player.pitch) * rawDt * 0.6; player.eye = Math.max(0.45, player.eye - rawDt * 0.9);
        if (this.deathT > 2.2) this._showEnd(false);
      }
      if (this.state === 'winning') {
        this.winT += rawDt;
        if (this.winT > 4.2) this._showEnd(true);
      }

      // ---- HUD
      hud.ammo(weapon.ammo, weapon.reserve, weapon.magSize, weapon.reloading);
      hud.health(player.health, player.maxHealth);
      const mission = this.mission;
      mission.update(dt, player, input.down('KeyE'), fighting && !this.endless);
      hud.interact(mission.near ? t('interact', mission.near.id) : null, mission.progress);
      hud.wave(this.endless ? t('waveEndless', Math.max(1, this.wave)) : mission.done ? t('objectiveDone') : t('objective', mission.cutCount, mission.relays.length), drones.alive + this.queue.length);
      // radio lines from command
      while (this.radioQueue.length && this.radioQueue[0].at <= this.time) {
        hud.radio(t('command'), t(this.radioQueue.shift().key), 6.5);
        audio.radio();
      }
      if (!this.hurtHint && player.health < 38 && player.alive) { this.hurtHint = true; this._radio('r_hurt', 0.3); }
      // compass + objective markers
      const heading = -player.yaw;
      this._objs = this._objs || mission.relays.map((r) => ({ id: r.id, bearing: 0, cut: false }));
      const marks = this._marks = this._marks || mission.relays.map((r) => ({ id: r.id, x: 0, y: 0, dist: 0, show: false }));
      const W = R.width, H = R.height;
      mission.relays.forEach((r, i) => {
        const o = this._objs[i], m = marks[i];
        o.bearing = Math.atan2(r.x - player.pos.x, -(r.z - player.pos.z)); o.cut = r.cut;
        m.dist = Math.hypot(r.x - player.pos.x, r.z - player.pos.z);
        _v.set(r.x, r.y + 3.5, r.z).project(cam);
        m.show = !r.cut && !this.endless && m.dist > 7 && _v.z < 1 && Math.abs(_v.x) < 0.96 && Math.abs(_v.y) < 0.92;
        m.x = (_v.x * 0.5 + 0.5) * W; m.y = (1 - (_v.y * 0.5 + 0.5)) * H;
      });
      const foes = this._foes = this._foes || [];
      foes.length = 0;
      for (const d of drones.list) if (d.state !== 'dying' && foes.length < 10) foes.push(Math.atan2(d.pos.x - player.pos.x, -(d.pos.z - player.pos.z)));
      hud.compass(heading, this.endless ? [] : this._objs, foes);
      hud.markers(marks);
      hud.score(this.stats.score);
      const moveSpread = (0.0035 + weapon.spread) + Math.min(player.speed, 8) * 0.0012 + (player.onGround ? 0 : 0.02);
      hud.crosshair(moveSpread, player.ads < 0.5 && !player.sprinting && !weapon.reloading && playing);
      const edge = ZONE.r - Math.hypot(player.pos.x - ZONE.x, player.pos.z - ZONE.z);
      hud.barrier(edge < 4);
      this.barrier.material.uniforms.uPlayer.value.copy(player.pos);
      R.grade.uniforms.get('damage').value = Math.max(0, 1 - (this.time - player.lastHurt) / 0.5) * 0.6;

      // ---- eye adaptation: open up in shade, stop down in full sun
      this.lightProbeT -= rawDt;
      if (this.lightProbeT <= 0) {
        this.lightProbeT = 0.18;
        const eye = player.eyePos;
        const sunny = this.col.raycast(eye, this.sky.sunDir, 300) === null;
        const open = this.col.raycast(eye, _v.set(0, 1, 0), 60) === null;
        this.lightTarget = sunny ? 1.0 : open ? 1.22 : 1.5;
      }
      this.exposureAdapt += (this.lightTarget - this.exposureAdapt) * (1 - Math.exp(-rawDt * 1.3));
      R.exposure = this.baseExposure * this.exposureAdapt;
      cam.getWorldDirection(_d);
      audio.setListener(cam.position, _d);
    }

    world.update(cam);
    if ((this.state !== 'paused' || this.frames < 3) && !this.skipRender) R.render(Math.max(dt, 1 / 240));
    input.endFrame();

    if (this.showStats) {
      this.fpsAcc += rawDt; this.fpsN++;
      if (this.fpsAcc > 0.5) {
        const i = R.renderer.info.render;
        hud.stats(`${Math.round(this.fpsN / this.fpsAcc)} fps\n${i.calls} calls\n${(i.triangles / 1e6).toFixed(2)}M tris\n${R.quality} · ${R.renderer.domElement.width}x${R.renderer.domElement.height}`);
        this.fpsAcc = 0; this.fpsN = 0;
      }
    }
  }

  run() {
    const clock = new THREE.Clock();
    const loop = () => { this.step(clock.getDelta()); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
