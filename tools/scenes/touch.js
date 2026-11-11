// Touch-screen path: first touch enables the overlay; stick moves, drag looks, buttons fire / interact.
(async () => {
  const g = window.__game, out = [];
  g.skipRender = true;
  const fire = (el, type, x, y, id = 1) => {
    const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent(type, { changedTouches: [t], touches: type === 'touchend' ? [] : [t], bubbles: true, cancelable: true }));
  };
  const $ = (id) => document.getElementById(id);
  fire($('btn-deploy'), 'touchstart', 300, 380); fire($('btn-deploy'), 'touchend', 300, 380);
  $('btn-deploy').click();
  await new Promise((r) => setTimeout(r, 200));
  out.push(`after tap DEPLOY: state=${g.state} touch=${g.input.touch} free=${g.input.free} locked=${g.input.locked} overlay=${!$('touch').classList.contains('hidden')}`);
  g.advance(20, 1 / 60, false);
  const p0 = g.player.pos.clone(), yaw0 = g.player.yaw;
  const sr = $('t-stick').getBoundingClientRect();
  fire($('t-stick'), 'touchstart', sr.left + sr.width / 2, sr.top + 8, 5);          // push the stick forward
  g.advance(60, 1 / 60, false);
  out.push(`stick forward: moved ${g.player.pos.distanceTo(p0).toFixed(1)} m`);
  fire($('t-stick'), 'touchend', sr.left + sr.width / 2, sr.top + 8, 5);
  const view = $('view');
  fire(view, 'touchstart', 700, 300, 7); 
  for (let i = 1; i <= 10; i++) { fire(view, 'touchmove', 700 + i * 12, 300, 7); g.advance(1, 1 / 60, false); }
  fire(view, 'touchend', 820, 300, 7);
  out.push(`drag look: yaw ${(g.player.yaw - yaw0).toFixed(2)} rad`);
  const shots0 = g.stats.shots;
  fire($('t-fire'), 'touchstart', 1180, 620, 9); g.advance(20, 1 / 60, false); fire($('t-fire'), 'touchend', 1180, 620, 9);
  out.push(`fire button: shots=${g.stats.shots - shots0}`);
  fire($('t-use'), 'touchstart', 1050, 640, 11); out.push(`use button holds E: ${g.input.down('KeyE')}`); fire($('t-use'), 'touchend', 1050, 640, 11);
  fire($('t-pause'), 'touchstart', 1240, 30, 12); fire($('t-pause'), 'touchend', 1240, 30, 12);
  out.push(`pause button: state=${g.state}`);
  g.resume();
  g.skipRender = false;
  g.advance(1, 1 / 60, true);
  return out;
})()
