import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { buildStatic } from './static.js';
import { buildLawnMask, createLawnMaterial } from './lawn.js';
import { canopyBlockers, placeTrees } from './treeplace.js';
import { applyBake, decodeBake, bakeLighting } from './bake.js';
import { globals } from '../engine/patch.js';
import { createTrees } from './trees.js';
import { createGrass } from './grass.js';
import { buildBackdrop } from './backdrop.js';

/** Builds the level in the browser: materials, static geometry, baked lighting. */
export async function buildWorld({ scene, assets, sky, quality, progress = () => {} }) {
  progress(0.02, 'l_mat');
  const M = await createMaterials(assets);
  const world = { materials: M };

  // the lawn needs its coverage mask (which knows about tree pits) before geometry is assembled
  world.lawnMask = buildLawnMask(placeTrees().map((t) => ({ x: t.x, z: t.z, r: 0.55 * t.scale / 2.3 })));
  M.lawn = await createLawnMaterial(assets, world.lawnMask);

  progress(0.25, 'l_ring');
  const st = buildStatic(M);
  Object.assign(world, { group: st.group, statics: st.statics, trees: st.trees, lawnMesh: st.lawnMesh, colliders: st.colliders, boxes: st.boxes });
  scene.add(world.group);
  world.group.add(buildBackdrop(M));

  progress(0.35, 'l_trees');
  world.treeSystem = await createTrees(assets, world.trees, { lodScale: quality.treeLod, fineShadows: quality.fineTreeShadows });
  scene.add(world.treeSystem.group);
  world.grass = createGrass(world.lawnMask, { density: quality.grass });
  scene.add(world.grass);

  progress(0.45, 'l_bake');
  let baked = null;
  try {
    const res = await fetch(assets.url('bake.bin'));
    if (res.ok) baked = decodeBake(await res.arrayBuffer(), world.statics);
  } catch (e) { console.warn('[bake] could not read bake.bin:', e.message); }
  if (!baked) {
    console.warn('[bake] bake.bin missing or stale: running the low-quality runtime bake (run `npm run bake`)');
    progress(0.5, 'l_bakeRun');
    await new Promise((r) => setTimeout(r, 30));
    baked = bakeLighting(world.statics, {
      sunDir: sky.sunDir, sunE: sky.sunIrradiance.toArray(), skyE: sky.skyIrradiance.toArray(), groundRad: sky.bounce, sample: sky.sample,
    }, { rays: 12, bounces: 1, blockers: canopyBlockers(world.trees) });
  }
  applyBake(world.statics, baked);
  globals.uBaked.value = 1;
  /** Per-frame upkeep (LOD selection etc.). */
  world.update = (camera) => world.treeSystem.update(camera.position);
  return world;
}
