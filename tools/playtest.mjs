// Headless playthrough: a simple bot plays the whole game with rendering skipped, to check that
// the wave director, combat, pickups, death and victory logic all hold together.
//   node tools/playtest.mjs [--url http://localhost:4173/] [--seconds 600] [--skill 0.8]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const base = opt('url', process.env.WL_URL || 'http://localhost:4173/');
const exe = process.env.WL_CHROME || '/root/.cache/wl-chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const seconds = +opt('seconds', 600), skill = +opt('skill', 0.8), passive = args.includes('--passive'), withAudio = args.includes('--audio');

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || /^\[audio\]/.test(m.text())) && !/GPU stall/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(base + '?q=low&autoplay=1&manual=1&shot=1', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__READY__ === true || window.__ERROR__', null, { timeout: 420000 });
const bootError = await page.evaluate('window.__ERROR__ || null');
if (bootError) { console.log('BOOT ERROR', bootError); await browser.close(); process.exit(1); }

const result = await page.evaluate(({ seconds, skill, passive, withAudio }) => {
  const g = window.__game, p = g.player, input = g.input;
  if (withAudio) g.audio.start();
  const log = [];
  const dt = 1 / 60;
  let lastWave = 0, lastState = g.state, lastCut = 0, t = 0, strafe = 1, strafeT = 0, minHealth = 100, retries = 0;
  const note = (s) => log.push(`[${t.toFixed(1)}s] ${s}`);
  g.skipRender = true;
  for (let f = 0; f < seconds * 60; f++) {
    t = f * dt;
    // --- bot: face the nearest live drone, hold the trigger when roughly on target, keep strafing
    let best = null, bd = 1e9;
    for (const d of g.drones.list) { if (d.state === 'dying') continue; const dd = d.pos.distanceTo(p.pos); if (dd < bd) { bd = dd; best = d; } }
    input.keys.clear(); input.buttons[0] = false;
    if (g.state === 'playing' || g.state === 'winning') {
      strafeT -= dt; if (strafeT <= 0) { strafeT = 0.8 + Math.random() * 1.6; strafe = -strafe; }
      if (!passive) input.keys.add(strafe > 0 ? 'KeyD' : 'KeyA');
      if (!passive && Math.random() < 0.3) input.keys.add('KeyW');
      if (best && !passive) {
        const dx = best.pos.x - p.pos.x, dy = best.pos.y - (p.pos.y + p.eye), dz = best.pos.z - p.pos.z;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
        let ey = yaw - p.yaw; ey = Math.atan2(Math.sin(ey), Math.cos(ey));
        const k = Math.min(1, dt * 9 * skill);
        p.yaw += ey * k + (Math.random() - 0.5) * 0.01 * (1 - skill); p.pitch += (pitch - p.pitch) * k;
        if (Math.abs(ey) < 0.06 && bd < 70) input.buttons[0] = true;
      }
      // objective: walk to the nearest live uplink and hold the interact key
      const steer = (tx, tz) => {
        const want = Math.atan2(-(tx - p.pos.x), -(tz - p.pos.z));
        const rel = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
        input.keys.delete('KeyW'); input.keys.delete('KeyS'); input.keys.delete('KeyA'); input.keys.delete('KeyD');
        if (Math.cos(rel) > 0.35) input.keys.add('KeyW'); else if (Math.cos(rel) < -0.35) input.keys.add('KeyS');
        if (Math.sin(rel) > 0.35) input.keys.add('KeyA'); else if (Math.sin(rel) < -0.35) input.keys.add('KeyD');
        if (!best) { p.yaw += rel * Math.min(1, dt * 6); p.pitch *= 0.9; }
      };
      const pk = g.drones.pickups[0];
      const relay = g.endless ? null : g.mission.relays.filter((r) => !r.cut).sort((a, b) => Math.hypot(a.x - p.pos.x, a.z - p.pos.z) - Math.hypot(b.x - p.pos.x, b.z - p.pos.z))[0];
      if (!passive) {
        if (pk && (p.health < 55 || g.weapon.reserve < 60)) steer(pk.group.position.x, pk.group.position.z);
        else if (relay) {
          if (Math.hypot(relay.x - p.pos.x, relay.z - p.pos.z) > 1.7) steer(relay.x, relay.z);
          else { input.keys.delete('KeyW'); input.keys.delete('KeyA'); input.keys.delete('KeyD'); input.keys.add('KeyE'); }
        } else if (pk && !best) steer(pk.group.position.x, pk.group.position.z);
      }
    }
    g.step(dt);
    minHealth = Math.min(minHealth, p.health);
    if (g.wave !== lastWave) { lastWave = g.wave; note(`endless wave ${g.wave} started (${g.queue.length + g.drones.list.length} hostiles)`); }
    if (g.mission.cutCount !== lastCut) { lastCut = g.mission.cutCount; note(`uplink cut (${lastCut}/3)  hp=${p.health.toFixed(0)} kills=${g.stats.kills}`); }
    if (g.state !== lastState) {
      note(`state ${lastState} -> ${g.state}  hp=${p.health.toFixed(0)} kills=${g.stats.kills}`);
      lastState = g.state;
      if (g.state === 'lost') { retries++; if (retries > 6) break; g._retryWave(); note('retry wave'); lastState = g.state; }
      if (g.state === 'won') break;
    }
    if (!isFinite(p.pos.x + p.pos.y + p.pos.z)) { note('NaN position!'); break; }
  }
  g.skipRender = false;
  const st = g.stats;
  return {
    log, final: g.state, uplinks: g.mission.cutCount, wave: g.wave, time: +st.time.toFixed(1), kills: st.kills, shots: st.shots, hits: st.hits,
    accuracy: st.shots ? +(st.hits / st.shots).toFixed(2) : 0, score: st.score, minHealth: +minHealth.toFixed(0), retries,
    pos: p.pos.toArray().map((v) => +v.toFixed(1)), ammo: [g.weapon.ammo, g.weapon.reserve],
    audio: withAudio ? { state: g.audio.ctx ? g.audio.ctx.state : 'none', hums: g.audio.hums.size } : undefined,
  };
}, { seconds, skill, passive, withAudio });

console.log(result.log.join('\n'));
delete result.log;
console.log(JSON.stringify(result));
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 20).join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
