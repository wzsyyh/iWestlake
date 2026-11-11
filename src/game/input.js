/**
 * Keyboard, mouse and gamepad input with per-frame edge detection.
 *
 * Mouse look normally uses pointer lock. Where the browser will not grant it (sandboxed previews,
 * some embedded viewers) the input falls back to "free" mode: the mouse turns the view by moving
 * over the canvas and by resting near the screen edges, and the arrow keys / IJKL always turn.
 */
export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.pressed = new Set();       // went down this frame
    this.buttons = [false, false, false];
    this.buttonPressed = [false, false, false];
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;            // true while we should act on mouse input (pointer lock or free mode)
    this.free = false;              // fallback mode: no pointer lock available
    this.everLocked = false;
    this.sensitivity = 1;
    this.moveX = 0; this.moveY = 0; // analogue movement from a gamepad (-1..1)
    this.padConnected = false;
    this.onLockChange = null; this.onLockError = null; this.onPadButton = null;
    this._mx = 0.5; this._my = 0.5; this._inside = false;
    this._pad = { fire: false, ads: false, held: new Set() };
    this.touch = false; this._stick = { x: 0, y: 0 };

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (this.locked && ['Space', 'Tab', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.fill(false); });
    addEventListener('mousedown', (e) => {
      if (!this.locked || e.button > 2) return;
      if (this.free && e.target !== this.el) return;           // in free mode only clicks on the game view count
      this.buttons[e.button] = true; this.buttonPressed[e.button] = true;
    });
    addEventListener('mouseup', (e) => { if (e.button < 3) this.buttons[e.button] = false; });
    addEventListener('mousemove', (e) => {
      this._mx = e.clientX / innerWidth; this._my = e.clientY / innerHeight; this._inside = true;
      if (!this.locked) return;
      // some browsers report one-off spikes on lock; ignore anything absurd
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    document.addEventListener('mouseleave', () => { this._inside = false; });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockerror', () => this.onLockError?.());
    document.addEventListener('pointerlockchange', () => {
      if (this.free) return;
      this.locked = document.pointerLockElement === this.el;
      if (this.locked) this.everLocked = true;
      else { this.keys.clear(); this.buttons.fill(false); }
      this.onLockChange?.(this.locked);
    });
    addEventListener('gamepadconnected', () => { this.padConnected = true; });
  }

  lock() {
    if (this.free) { this.locked = true; return; }
    if (!this.el.requestPointerLock) { this.onLockError?.(); return; }
    // raw (unaccelerated) mouse input where the browser supports it; fall back to the plain request
    let p;
    try { p = this.el.requestPointerLock({ unadjustedMovement: true }); } catch { p = null; }
    if (p && p.catch) {
      p.catch(() => {
        let q;
        try { q = this.el.requestPointerLock(); } catch { q = null; }
        if (q && q.catch) q.catch(() => this.onLockError?.());
      });
    }
  }

  unlock() {
    if (this.free) { this.locked = false; this.keys.clear(); this.buttons.fill(false); return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Switch to the no-pointer-lock fallback. */
  setFree() {
    this.free = true; this.locked = true;
    this.el.style.cursor = 'crosshair';
  }

  /**
   * Touch-screen controls: a virtual stick (left), drag anywhere else to look, and action buttons.
   * `ui` maps names to elements: { root, stick, fire, aim, reload, jump, use, pause }.
   */
  enableTouch(ui) {
    if (this.touch) return;
    this.touch = true;
    this.setFree();
    this.el.style.cursor = '';
    ui.root.classList.remove('hidden');
    document.body.classList.add('touch');
    const knob = ui.stick.firstElementChild;
    let stickId = null, lookId = null, lx = 0, ly = 0;
    const stickMove = (t) => {
      const r = ui.stick.getBoundingClientRect(), R = r.width / 2;
      let x = (t.clientX - r.left - R) / R, y = (t.clientY - r.top - R) / R;
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this._stick.x = x; this._stick.y = -y;
      knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
    };
    ui.stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; stickId = t.identifier; stickMove(t); }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) stickMove(t);
        else if (t.identifier === lookId && this.locked) { this.dx += (t.clientX - lx) * 2.4; this.dy += (t.clientY - ly) * 2.4; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this._stick.x = this._stick.y = 0; knob.style.transform = ''; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
    // any touch that starts on the game view (or the fire button) steers the camera
    const startLook = (e) => { if (lookId === null) { const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY; } };
    this.el.addEventListener('touchstart', (e) => { e.preventDefault(); startLook(e); }, { passive: false });
    const hold = (el, down, up) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('on'); down(e); }, { passive: false });
      const off = (e) => { e.preventDefault(); el.classList.remove('on'); up && up(e); };
      el.addEventListener('touchend', off, { passive: false }); el.addEventListener('touchcancel', off, { passive: false });
    };
    hold(ui.fire, (e) => { if (this.locked) { this.buttons[0] = true; this.buttonPressed[0] = true; } startLook(e); }, () => { this.buttons[0] = false; });
    ui.aim.addEventListener('touchstart', (e) => { e.preventDefault(); this.buttons[2] = !this.buttons[2]; ui.aim.classList.toggle('on', this.buttons[2]); }, { passive: false });
    const key = (el, code) => hold(el, () => { this.keys.add(code); this.pressed.add(code); }, () => this.keys.delete(code));
    key(ui.reload, 'KeyR'); key(ui.jump, 'Space'); key(ui.use, 'KeyE');
    hold(ui.pause, () => this.onPadButton?.('pause'));
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  /** Call at the start of every frame: keyboard / edge / gamepad look, gamepad buttons. */
  beginFrame(dt) {
    this.moveX = 0; this.moveY = 0;
    if (!this.locked) return;
    this.moveX = this._stick.x; this.moveY = this._stick.y;
    // keyboard look (pixels-equivalent per second)
    const kx = (this.down('ArrowRight') || this.down('KeyL') ? 1 : 0) - (this.down('ArrowLeft') || this.down('KeyJ') ? 1 : 0);
    const ky = (this.down('ArrowDown') || this.down('KeyK') ? 1 : 0) - (this.down('ArrowUp') || this.down('KeyI') ? 1 : 0);
    this.dx += kx * 950 * dt; this.dy += ky * 620 * dt;
    if (this.free && !this.touch && this._inside) {
      // resting the cursor near an edge keeps the view turning
      const edge = (v) => (v < 0.12 ? -(0.12 - v) / 0.12 : v > 0.88 ? (v - 0.88) / 0.12 : 0);
      this.dx += edge(this._mx) * 1100 * dt; this.dy += edge(this._my) * 520 * dt;
    }
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected && p.mapping === 'standard');
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    this.moveX += dz(gp.axes[0]); this.moveY -= dz(gp.axes[1]);
    const lx = dz(gp.axes[2]), ly = dz(gp.axes[3]);
    this.dx += lx * Math.abs(lx) * 1500 * dt; this.dy += ly * Math.abs(ly) * 1000 * dt;
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    const set = (state, idx) => { if (state !== this._pad[idx]) { this._pad[idx] = state; this.buttons[idx === 'fire' ? 0 : 2] = state; if (state) this.buttonPressed[idx === 'fire' ? 0 : 2] = true; } };
    set(b(7), 'fire'); set(b(6), 'ads');
    // A jump, B crouch, X reload, L3 sprint, Start pause
    const map = [[0, 'Space'], [1, 'ControlLeft'], [2, 'KeyR'], [3, 'KeyE'], [10, 'ShiftLeft'], [9, 'Pause']];
    for (const [i, code] of map) {
      const on = b(i), was = this._pad.held.has(code);
      if (on && !was) { this._pad.held.add(code); this.keys.add(code); this.pressed.add(code); if (code === 'Pause') this.onPadButton?.('pause'); }
      if (!on && was) { this._pad.held.delete(code); this.keys.delete(code); }
    }
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressed.clear(); this.buttonPressed.fill(false);
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
}
