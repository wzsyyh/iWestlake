// Exercises the menu / pause / end-screen state machine without pointer lock.
(() => {
  const g = window.__game, out = [];
  const vis = (id) => !document.getElementById(id).classList.contains('hidden');
  const snap = (label) => out.push(`${label}: state=${g.state} hud=${vis('hud')} menu=${vis('menu')} pause=${vis('pause')} end=${vis('end')}`);
  g.skipRender = true;
  snap('after autoplay');
  g.advance(120, 1 / 60, false);
  g.pause(); snap('pause()');
  const t0 = g.stats.time; g.advance(60, 1 / 60, false);
  out.push(`time frozen while paused: ${g.stats.time === t0}`);
  g.resume(); snap('resume()');
  g.player.health = 1; g.drones.onPlayerHit(50, g.player.pos, { x: 0, y: 0, z: 1 }); snap('lethal hit');
  g.advance(200, 1 / 60, false); snap('after death beat');
  document.getElementById('btn-again').click(); snap('RETRY WAVE');
  g.advance(30, 1 / 60, false);
  document.getElementById('btn-quit').click(); snap('MAIN MENU');
  g.advance(30, 1 / 60, false);
  out.push(`drones cleared in menu: ${g.drones.list.length === 0}`);
  document.getElementById('btn-deploy').click(); snap('DEPLOY');
  out.push(`fresh run: wave=${g.wave} hp=${g.player.health} ammo=${g.weapon.ammo}/${g.weapon.reserve} score=${g.stats.score}`);
  // win path: all three uplinks cut and the sky empty
  for (const r of g.mission.relays) r.cut = true;
  g.pendingGroup = null; g.queue.length = 0; g.drones.clear();
  g.advance(5, 1 / 60, false); snap('uplinks cut + sky clear');
  g.advance(300, 1 / 60, false); snap('after victory beat');
  document.getElementById('btn-again').click(); snap('KEEP FIGHTING');
  g.advance(260, 1 / 60, false);
  out.push(`endless: wave=${g.wave} endless=${g.endless} hostiles=${g.drones.list.length + g.queue.length}`);
  // a fresh run must reset the mission
  document.getElementById('btn-end-menu').click(); document.getElementById('btn-deploy').click();
  out.push(`new run: uplinks cut=${g.mission.cutCount} endless=${g.endless} label="${document.getElementById('wave-label').textContent}"`);
  g.advance(2, 1 / 60, false);
  out.push(`label after a frame: "${document.getElementById('wave-label').textContent}"`);
  g.skipRender = false;
  return out;
})()
