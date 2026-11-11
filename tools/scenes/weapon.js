// Weapon beauty shots: (1) hip in the open sun, drones overhead  (2) aiming down the sight at a drone.
(() => {
  const g = window.__game, p = g.player;
  g.advance(200, 1 / 30, false);
  p.pos.set(86, 0, 58); p.yaw = -2.2; p.pitch = 0.05;
  g.advance(20, 1 / 60, false);
  const aim = (k, up) => {
    const f = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
    g.drones.list.forEach((d, i) => {
      d.pos.set(p.pos.x + f.x * (k + i * 4) + (i - 1) * 1.6, p.pos.y + 1.68 + f.y * (k + i * 4) + up + i * 0.4, p.pos.z + f.z * (k + i * 4));
      d.vel.set(0, 0, 0); d.fireT = 9; d.retarget = 9; d.jinkT = 9; d.jink.set(0, 0, 0);
    });
  };
  aim(5, 0.35);
  g.advance(2, 1 / 60, false);
  window.__shots = [document.getElementById('view').toDataURL ? null : null];
  g.advance(1, 1 / 60, true);
  const a = document.getElementById('view').toDataURL('image/png');
  // ADS
  g.input.buttons[2] = true;
  aim(11, 0.0);
  g.advance(40, 1 / 60, false);
  aim(11, 0.0);
  g.advance(1, 1 / 60, true);
  window.__extra = a;
  return { ads: +p.ads.toFixed(2), fov: +g.R.camera.fov.toFixed(1) };
})()
