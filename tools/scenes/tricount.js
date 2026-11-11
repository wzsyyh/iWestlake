// Per-category triangle / draw-call budget at the spawn point (includes shadow passes).
(() => {
  const g = window.__game, R = g.R, w = g.world;
  g.advance(30, 1 / 30, false);
  const measure = () => { g.advance(2, 1 / 60, true); const i = R.renderer.info.render; return [i.calls, Math.round(i.triangles / 1000)]; };
  const out = { all: measure() };
  const toggle = (name, objs) => { objs.forEach((o) => { o.visible = false; }); out['without ' + name] = measure(); objs.forEach((o) => { o.visible = true; }); };
  toggle('trees', [w.treeSystem.group]);
  toggle('grass', [w.grass]);
  toggle('statics', [w.group]);
  toggle('weapon', [g.weapon.pivot]);
  const lights = R.csm.lights; lights.forEach((l) => { l.castShadow = false; });
  out['without shadows'] = measure();
  lights.forEach((l) => { l.castShadow = true; });
  return out;
})()
