// Stages a close firefight for a screenshot: three drones ahead, one exploding, weapon mid-burst.
(() => {
  const g = window.__game, p = g.player;
  g.advance(200, 1 / 30, false);
  p.pos.set(96, 0, 70); p.yaw = 2.5; p.pitch = 0.1;
  g.advance(1, 1 / 60, false);
  const f = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
  g.drones.list.forEach((d, i) => {
    const k = 9 + i * 6;
    d.pos.set(p.pos.x + f.x * k + (i - 1) * 3, p.pos.y + 1.68 + f.y * k + 0.5 * i, p.pos.z + f.z * k);
    d.vel.set(0, 0, 0); d.fireT = 9; d.retarget = 9;
  });
  const e = p.pos.clone(); e.x += f.x * 16 + 5; e.y = 2.2; e.z += f.z * 16;
  g.fx.explosion(e, 1.0);
  g.input.buttons[0] = true;
  g.advance(4, 1 / 60, false);
  g.weapon.cooldown = 0;
  g.advance(1, 1 / 60, true);
  return { state: g.state, shots: g.stats.shots, hits: g.stats.hits, ammo: g.weapon.ammo, flash: g.weapon.flash.visible };
})()
