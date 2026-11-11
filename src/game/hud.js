import { getLanguage } from './i18n.js';

const $ = (id) => document.getElementById(id);
const CARDS = { en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], zh: ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] };
const HALF_SPAN = Math.PI / 3;          // the compass strip shows +-60 degrees

/** DOM heads-up display and menu screens. */
export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'loading', 'menu', 'pause', 'end', 'crosshair', 'hitmarker', 'damage-dirs', 'hurt', 'barrier-warn', 'wave-label', 'hostile-count',
      'banner', 'banner-title', 'banner-sub', 'toasts', 'vitals', 'health-fill', 'health-lag', 'health-num', 'ammo', 'ammo-mag', 'ammo-res', 'ammo-pips',
      'reload-hint', 'score', 'fps', 'load-fill', 'load-status', 'end-kicker', 'end-title', 'end-stats', 'btn-again',
      'compass', 'compass-tape', 'markers', 'interact', 'interact-text', 'interact-fill', 'radio', 'radio-who', 'radio-line']) this.el[id] = $(id);
    this.pips = [];
    for (let i = 0; i < 30; i++) { const p = document.createElement('i'); this.el['ammo-pips'].appendChild(p); this.pips.push(p); }
    this._bannerTimer = 0;
    this._last = {};
    // compass tape: 8 cardinal labels, ticks every 15 degrees, plus pooled objective / hostile marks
    const tape = this.el['compass-tape'];
    const mk = (cls, text = '') => { const e = document.createElement('span'); e.className = cls; e.textContent = text; tape.appendChild(e); return e; };
    this.cards = CARDS.en.map((_, i) => ({ el: mk('card'), bearing: i * Math.PI / 4 }));
    this.ticks = [];
    for (let i = 0; i < 24; i++) if (i % 3 !== 0) this.ticks.push({ el: mk('tick'), bearing: i * Math.PI / 12 });
    this.objMarks = new Map();
    this.foeMarks = Array.from({ length: 10 }, () => mk('foe'));
    this.markerEls = new Map();
    this._radioTimer = 0;
    this.relabel();
  }

  relabel() {
    const names = CARDS[getLanguage()] || CARDS.en;
    this.cards.forEach((c, i) => { c.el.textContent = names[i]; });
  }

  /** heading / bearings in radians (0 = north, clockwise). objs: [{ id, bearing, cut }], foes: [bearing]. */
  compass(heading, objs, foes) {
    const w = this.el.compass.clientWidth / 2;
    const place = (el, bearing, half = 0) => {
      let rel = bearing - heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) > HALF_SPAN * 1.02) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
      if (el.style.display === 'none') el.style.display = '';
      el.style.transform = `translateX(${(rel / HALF_SPAN * w - half).toFixed(1)}px)`;
    };
    for (const c of this.cards) place(c.el, c.bearing, c.el.offsetWidth / 2);
    for (const k of this.ticks) place(k.el, k.bearing);
    for (const o of objs) {
      let el = this.objMarks.get(o.id);
      if (!el) { el = document.createElement('span'); el.textContent = `◆${o.id}`; this.el['compass-tape'].appendChild(el); this.objMarks.set(o.id, el); }
      el.className = o.cut ? 'obj cut' : 'obj';
      place(el, o.bearing, 9);
    }
    this.foeMarks.forEach((el, i) => { if (i < foes.length) place(el, foes[i], 2); else if (el.style.display !== 'none') el.style.display = 'none'; });
  }

  /** World-space objective markers. list: [{ id, x, y, dist, show }] in CSS pixels. */
  markers(list) {
    for (const m of list) {
      let el = this.markerEls.get(m.id);
      if (!el) { el = document.createElement('div'); el.innerHTML = `<b><i>${m.id}</i></b><span></span>`; this.el.markers.appendChild(el); this.markerEls.set(m.id, el); }
      if (!m.show) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      if (el.style.display === 'none') el.style.display = '';
      el.style.transform = `translate(${(m.x - 20).toFixed(0)}px, ${(m.y - 30).toFixed(0)}px)`;
      const d = `${Math.round(m.dist)} m`;
      if (el.lastChild.textContent !== d) el.lastChild.textContent = d;
    }
  }

  interact(text, progress = 0) {
    const key = text || '';
    if (this._last.interact !== key) { this._last.interact = key; this.el.interact.classList.toggle('hidden', !text); if (text) this.el['interact-text'].textContent = text; }
    if (text) this.el['interact-fill'].style.width = `${Math.round(progress * 100)}%`;
  }

  radio(who, line, seconds = 6) {
    this.el['radio-who'].textContent = who;
    this.el['radio-line'].textContent = line;
    this.el.radio.classList.add('show');
    clearTimeout(this._radioTimer);
    this._radioTimer = setTimeout(() => this.el.radio.classList.remove('show'), seconds * 1000);
  }

  clearTransient() {
    this.el.radio.classList.remove('show'); this.el.banner.classList.remove('show');
    this.interact(null);
  }

  screen(name) {
    for (const s of ['loading', 'menu', 'pause', 'end']) this.el[s].classList.toggle('hidden', s !== name);
  }

  showHud(on) { this.el.hud.classList.toggle('hidden', !on); }

  /** Forget cached text so dynamic labels are redrawn (after a language switch). */
  refresh() { this._last = {}; this.relabel(); }

  loading(p, text) {
    this.el['load-fill'].style.width = `${Math.round(p * 100)}%`;
    if (text) this.el['load-status'].textContent = text;
  }

  ammo(mag, reserve, size, reloading) {
    const key = `${mag}/${reserve}/${reloading}`;
    if (this._last.ammo === key) return;
    this._last.ammo = key;
    this.el['ammo-mag'].textContent = mag;
    this.el['ammo-res'].textContent = reserve;
    this.el.ammo.classList.toggle('low', mag <= size * 0.2);
    this.pips.forEach((p, i) => p.classList.toggle('off', i >= mag));
    this.el['reload-hint'].classList.toggle('hidden', !(mag <= size * 0.2 && !reloading && reserve > 0));
  }

  health(h, max) {
    const v = Math.max(0, Math.ceil(h));
    if (this._last.health === v) return;
    this._last.health = v;
    const pct = `${Math.max(0, h / max * 100)}%`;
    this.el['health-fill'].style.width = pct; this.el['health-lag'].style.width = pct;
    this.el['health-num'].textContent = v;
    this.el.vitals.classList.toggle('low', h < max * 0.3);
    this.el.hurt.style.opacity = h < max * 0.35 ? String(0.75 * (1 - h / (max * 0.35))) : '0';
  }

  wave(label, hostiles) {
    if (this._last.wave !== label) { this._last.wave = label; this.el['wave-label'].textContent = label; }
    if (this._last.hostiles !== hostiles) { this._last.hostiles = hostiles; this.el['hostile-count'].textContent = hostiles; }
  }

  score(n) { if (this._last.score !== n) { this._last.score = n; this.el.score.textContent = n.toLocaleString('en-US'); } }

  crosshair(spread, visible) {
    const gap = Math.round(5 + spread * 620);
    if (this._last.gap !== gap) { this._last.gap = gap; this.el.crosshair.style.setProperty('--gap', `${gap}px`); }
    const op = visible ? '1' : '0';
    if (this._last.chOp !== op) { this._last.chOp = op; this.el.crosshair.style.opacity = op; }
  }

  hit(kill) {
    const h = this.el.hitmarker;
    h.classList.remove('hit', 'kill');
    void h.offsetWidth;                 // restart the animation
    h.classList.add(kill ? 'kill' : 'hit');
  }

  /** angle: radians, 0 = from straight ahead, positive = from the right. */
  damageFrom(angle) {
    const d = document.createElement('div');
    d.className = 'dir';
    d.style.transform = `rotate(${angle}rad)`;
    this.el['damage-dirs'].appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }

  banner(title, sub = '', seconds = 3) {
    this.el['banner-title'].textContent = title;
    this.el['banner-sub'].textContent = sub;
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.remove('show'), seconds * 1000);
  }

  toast(text, plus = false) {
    const d = document.createElement('div');
    d.textContent = text;
    if (plus) d.className = 'plus';
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 3300);
  }

  barrier(on) { this.el['barrier-warn'].classList.toggle('hidden', !on); }

  stats(text) { this.el.fps.textContent = text; }
  toggleStats() { return !this.el.fps.classList.toggle('hidden'); }

  end({ victory, kicker, title, rows, again }) {
    this.el['end-kicker'].textContent = kicker;
    this.el['end-title'].textContent = title;
    this.el['end-title'].style.color = victory ? '' : 'var(--warn)';
    this.el['end-stats'].innerHTML = rows.map(([k, v]) => `${k}<b>${v}</b>`).join('<br>');
    this.el['btn-again'].textContent = again;
    this.screen('end');
  }
}
