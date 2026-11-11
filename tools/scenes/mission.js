// Mission HUD check: compass, objective markers, radio line, and the hold-to-cut prompt at uplink A.
(() => {
  const g = window.__game, p = g.player;
  g.advance(240, 1 / 60, false);                       // radio line 1 is on screen by now
  g.advance(1, 1 / 60, true);
  window.__extra = document.getElementById('view').toDataURL('image/png');
  const r = g.mission.relays[0];
  g.drones.clear(); g.queue.length = 0; g.reinforceT = 999;
  p.pos.set(r.x + 1.9, r.y, r.z + 0.9); p.yaw = Math.atan2(-(r.x - p.pos.x), -(r.z - p.pos.z)) + 0.25; p.pitch = 0.05;
  g.input.keys.add('KeyE');
  g.advance(90, 1 / 60, false);
  g.advance(1, 1 / 60, true);
  return { relays: g.mission.relays.map((q) => [q.id, +q.x.toFixed(1), +q.z.toFixed(1), q.cut]), near: g.mission.near && g.mission.near.id, progress: +g.mission.progress.toFixed(2) };
})()
