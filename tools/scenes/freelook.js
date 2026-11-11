// The path a sandboxed preview takes: DEPLOY is clicked, pointer lock is refused, free-look takes over.
(async () => {
  const g = window.__game, out = [];
  g.skipRender = true;
  document.getElementById('opt-lang').value = 'zh';
  document.getElementById('opt-lang').dispatchEvent(new Event('change'));
  out.push('lang=' + document.documentElement.lang + ' deploy="' + document.getElementById('btn-deploy').textContent + '"');
  document.getElementById('btn-deploy').click();
  await new Promise((r) => setTimeout(r, 1600));
  out.push(`after DEPLOY: state=${g.state} free=${g.input.free} locked=${g.input.locked} noLock=${g.noLock}`);
  g.advance(30, 1 / 60, false);
  const yaw0 = g.player.yaw;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
  g.advance(30, 1 / 60, false);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
  out.push(`arrow-key turn: ${(g.player.yaw - yaw0).toFixed(2)} rad`);
  const canvas = document.getElementById('view');
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  g.advance(8, 1 / 60, false);
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  out.push(`click fires: shots=${g.stats.shots}`);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  out.push(`Esc: state=${g.state}`);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  out.push(`Esc again: state=${g.state} locked=${g.input.locked}`);
  out.push('wave label="' + document.getElementById('wave-label').textContent + '" weapon="' + document.getElementById('weapon-name').textContent + '"');
  g.skipRender = false;
  g.advance(1, 1 / 60, true);
  return out;
})()
