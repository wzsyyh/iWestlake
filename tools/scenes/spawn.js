// The opening view from the spawn point as wave 1 arrives.
(() => {
  const g = window.__game, p = g.player;
  g.advance(150, 1 / 30, false);
  g.drones.list.forEach((d, i) => { d.pos.set(92 - i * 9, 9 + i * 2.5, 52 - i * 7); d.vel.set(0, 0, 0); d.fireT = 9; d.retarget = 9; d.jinkT = 9; d.jink.set(0, 0, 0); });
  p.yaw = 0.78; p.pitch = 0.1;
  g.advance(3, 1 / 60, false);
  g.advance(1, 1 / 60, true);
  return { pos: p.pos.toArray().map((v) => +v.toFixed(1)), drones: g.drones.list.length };
})()
