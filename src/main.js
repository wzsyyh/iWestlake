import './style.css';
import { Game } from './game/game.js';
import { unpackEmbedded } from './engine/assets.js';
import { t } from './game/i18n.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const game = new Game(canvas, params);
window.__game = game;

/**
 * Automation hooks (used by tools/shot.mjs and tools/playtest.mjs; harmless in normal play):
 *   ?manual=1    do not start the frame loop; frames are stepped explicitly via __game.advance()
 *   ?autoplay=1  skip the menu and pointer lock, start the run immediately
 *   ?cam=x,y,z,yawDeg,pitchDeg  free camera for screenshots (with manual=1)
 */
/** Step the simulation; with render=false only the last frame is drawn (fast-forward for tests). */
game.advance = (frames = 1, dt = 1 / 60, render = true) => {
  for (let i = 0; i < frames; i++) { game.skipRender = !render && i < frames - 1; game.step(dt); }
  game.skipRender = false;
};
game.snap = (cam, frames = 2) => {
  const R = game.R;
  if (cam) {
    game.state = 'paused'; game.frames = 0;         // freeze gameplay, drive the camera directly
    game.weapon.pivot.visible = false;
    R.camera.position.set(cam[0], cam[1], cam[2]);
    R.camera.rotation.set((cam[4] || 0) * Math.PI / 180, (cam[3] || 0) * Math.PI / 180, 0, 'YXZ');
    if (cam[5]) { R.camera.fov = cam[5]; R.camera.updateProjectionMatrix(); }
    for (let i = 0; i < frames; i++) { game.world.update(R.camera); R.render(1 / 60); }
  } else {
    for (let i = 0; i < Math.max(1, frames); i++) game.step(1 / 60);
  }
  return canvas.toDataURL('image/png');
};

unpackEmbedded((p) => game.hud.loading(0.03 * p, t('l_unpack'))).then(() => game.init()).then(() => {
  if (params.has('autoplay')) {
    game.noLock = true;
    game.input.locked = true;
    game.startRun();
  }
  if (params.has('cam')) {
    const cam = params.get('cam').split(',').map(Number);
    game.hud.screen(null);
    game.snap(cam, parseInt(params.get('shot') || '3'));
  }
  if (params.has('manual') || params.has('shot')) {
    if (!params.has('cam')) game.advance(parseInt(params.get('shot') || '3'));
  } else {
    game.run();
  }
  window.__READY__ = true;
}).catch((e) => {
  console.error(e);
  window.__ERROR__ = String((e && e.stack) || e);
  const s = document.getElementById('load-status');
  if (s) s.textContent = 'Failed to start / 启动失败: ' + (e && e.message ? e.message : e);
});
