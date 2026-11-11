// Player standing in the Academic Hall's colonnade gallery, late sun raking through the columns.
(() => {
  const g = window.__game, p = g.player;
  g.advance(60, 1 / 30, false);
  g.drones.clear(); g.queue.length = 0; g.betweenT = 999; g.waveActive = false;
  p.pos.set(50.3, 0.45, -6.6); p.yaw = 70 * Math.PI / 180; p.pitch = 0.06;
  g.advance(150, 1 / 60, false);
  g.advance(1, 1 / 60, true);
  window.__extra = document.getElementById('view').toDataURL('image/png');
  // and aiming down the sight from the lawn towards the Ring
  p.pos.set(86, 0, 58); p.yaw = -2.2; p.pitch = 0.08;
  g.input.buttons[2] = true;
  g.advance(90, 1 / 60, false);
  g.advance(1, 1 / 60, true);
  return { exposure: +g.R.exposure.toFixed(2), ads: +p.ads.toFixed(2) };
})()
