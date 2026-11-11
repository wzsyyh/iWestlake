// A fast turn while sprinting past the Hall: checks motion blur, sprint pose and the damage vignette.
(() => {
  const g = window.__game, p = g.player;
  g.advance(100, 1 / 30, false);
  p.pos.set(70, 0, 30); p.yaw = 0.2; p.pitch = 0.0;
  g.input.keys.add('KeyW');
  g.advance(30, 1 / 60, false);
  // a brisk but plausible flick: ~3 degrees per frame
  for (let i = 0; i < 4; i++) { g.input.dx = 24; g.advance(1, 1 / 60, true); }
  window.__extra = document.getElementById('view').toDataURL('image/png');
  return { speed: +p.speed.toFixed(1), blur: !!g.R.motionBlur, strength: g.R.motionBlur ? +g.R.motionBlur.uniforms.get('strength').value.toFixed(2) : 0 };
})()
