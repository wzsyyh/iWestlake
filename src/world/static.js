import * as THREE from 'three';
import { buildRing } from './ring.js';
import { buildHall } from './hall.js';
import { buildGround } from './ground.js';
import { placeTrees } from './treeplace.js';
import { buildProps } from './props.js';

/**
 * Assembles all static level geometry. Pure (no DOM / GPU) and deterministic, so the offline
 * lighting baker (tools/bake.mjs) builds exactly the same vertices as the game.
 * `M` maps material slot names to materials (real ones in the game, stubs in the baker).
 */
export function buildStatic(M) {
  const group = new THREE.Group();
  group.name = 'world';
  const trees = placeTrees();
  group.add(buildRing(M));
  group.add(buildHall(M));
  const ground = buildGround(M);
  group.add(ground.group);
  const props = buildProps(M, trees);
  group.add(props.group);
  const statics = [];
  group.traverse((o) => { if (o.isMesh && o.userData.static) statics.push(o); });
  return { group, statics, trees, lawnMesh: ground.lawnMesh, colliders: props.colliders, boxes: props.boxes };
}
