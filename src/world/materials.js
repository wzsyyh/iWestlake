import * as THREE from 'three';
import { extend, Baked, Joints, Macro, Albedo, Mirror } from '../engine/patch.js';
import { ALBEDO } from './albedo.js';

/**
 * The architectural material palette, matched to HENN's photographs of the Yungu campus:
 * flamed light-grey granite paving, white UHPC cladding, honed stone in the Hall gallery,
 * a warm bamboo soffit, and coated curtain-wall glass.
 */
export async function createMaterials(assets) {
  const [granite, graniteFine, concrete, plaster, bamboo, anodized, soil] = await Promise.all([
    assets.pbr('granite', 2.4), assets.pbr('granite', 1.5), assets.pbr('concrete', 3.2),
    assets.pbr('plaster', 2.6), assets.pbr('bamboo', 1.4), assets.pbr('anodized', 0.8), assets.pbr('soil', 1.3),
  ]);
  const M = {};
  const std = (slot, tex, params, features = []) => {
    const m = new THREE.MeshStandardMaterial({
      map: tex?.map ?? null, normalMap: tex?.normalMap ?? null,
      roughnessMap: tex?.orm ?? null, aoMap: tex?.orm ?? null,
      ...params,
    });
    m.name = slot;
    m.userData.bake = ALBEDO[slot];
    m.userData.slot = slot;
    M[slot] = extend(m, features);
    return m;
  };
  const rgb = (r, g = r, b = g) => new THREE.Color(r, g, b);
  const v2 = (x) => new THREE.Vector2(x, x);
  // the scanned granite leans warm; the site's stone is a neutral light grey
  const stone = Albedo({ sat: 0.45, contrast: 0.9, mid: 0.6 });

  // --- ground stone
  std('paving', granite, { color: rgb(0.68, 0.685, 0.69), roughness: 0.86, roughnessMap: null, normalScale: v2(0.9) },
    [Baked(), stone, Joints({ size: [1.2, 0.6], width: 0.007, dark: 0.62, jitter: 0.62, stagger: 1, tint: 0.07, shuffle: true, bevel: 0.5, rough: 0.05 }),
      Macro({ scale: 0.021, amount: 0.10, roughAmount: 0.06 })]);
  std('pavingPath', graniteFine, { color: rgb(0.72, 0.72, 0.715), roughness: 0.86, roughnessMap: null, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 },
    [Baked(), stone, Joints({ size: [0.9, 0.45], width: 0.006, dark: 0.6, jitter: 0.5, stagger: 1, tint: 0.08, shuffle: true, bevel: 0.5, rough: 0.05 }),
      Macro({ scale: 0.03, amount: 0.09, roughAmount: 0.05 })]);
  std('kerb', graniteFine, { color: rgb(0.62, 0.62, 0.62), roughness: 0.8, roughnessMap: null, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 },
    [Baked(), stone, Joints({ size: [1.0, 1.0], width: 0.006, dark: 0.6, tint: 0.06, shuffle: true, bevel: 0.5 })]);
  std('plaza', granite, { color: rgb(0.70, 0.70, 0.695), roughness: 0.84, roughnessMap: null, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 },
    [Baked(), stone, Joints({ size: [0.9, 0.6], width: 0.007, dark: 0.6, jitter: 0.4, stagger: 1, tint: 0.07, shuffle: true, bevel: 0.5, rough: 0.05 }),
      Macro({ scale: 0.025, amount: 0.09, roughAmount: 0.05 })]);
  // honed stone of the Hall gallery: same granite family, polished to a soft mirror
  std('hallFloor', granite, { color: rgb(1.02, 1.015, 1.0), roughness: 0.16, roughnessMap: null, normalScale: v2(0.08), aoMap: null },
    [Baked({ specOcc: false }), Mirror(), Albedo({ sat: 0.5, contrast: 0.55, mid: 0.62 }), Joints({ size: [1.2, 1.2], width: 0.004, dark: 0.45, tint: 0.03, shuffle: true, bevel: 0.25, rough: 0.03 }),
      Macro({ scale: 0.05, amount: 0.04, roughAmount: 0.05 })]);
  std('hallSteps', granite, { color: rgb(0.93, 0.93, 0.92), roughness: 0.7, roughnessMap: null, normalScale: v2(0.5) },
    [Baked(), stone, Joints({ size: [1.5, 0.45], width: 0.005, dark: 0.5, tint: 0.04, shuffle: true, bevel: 0.4 })]);

  // --- white UHPC / metal cladding: keep the concrete's grain, lose its colour and stains
  const whiten = Albedo({ sat: 0.12, contrast: 0.42, mid: 0.6 });
  std('cladding', concrete, { color: rgb(1.25, 1.245, 1.235), roughness: 0.74, normalScale: v2(0.3) },
    [Baked(), whiten, Joints({ size: [1.8, 2.6], width: 0.012, dark: 0.72, tint: 0.02, shuffle: true, bevel: 0.7 }),
      Macro({ scale: 0.03, amount: 0.04, roughAmount: 0.05, streaks: 0.06 })]);
  std('column', concrete, { color: rgb(1.33, 1.325, 1.315), roughness: 0.42, roughnessMap: null, normalScale: v2(0.1) },
    [Baked(), Albedo({ sat: 0.08, contrast: 0.16, mid: 0.6 }), Joints({ size: [1.806, 3.4], width: 0.008, dark: 0.7, tint: 0.018, shuffle: true, bevel: 0.6 }),
      Macro({ scale: 0.04, amount: 0.03, roughAmount: 0.05, streaks: 0.035 })]);
  std('soffit', plaster, { color: rgb(1.3, 1.3, 1.295), roughness: 0.8, normalScale: v2(0.3) },
    [Baked(), Albedo({ sat: 0.3, contrast: 0.6, mid: 0.6 }), Joints({ size: [1.8, 2.265], width: 0.014, dark: 0.75, tint: 0.015, bevel: 0.7 })]);
  std('roof', concrete, { color: rgb(0.62), roughness: 0.95 }, [Baked(), whiten, Macro({ amount: 0.1 })]);
  std('wood', bamboo, { color: rgb(0.96, 0.85, 0.69), roughness: 0.6, normalScale: v2(0.5) },
    [Baked(), Albedo({ sat: 0.82, contrast: 1.0 }), Joints({ size: [0.6, 0.15], width: 0.004, dark: 0.42, stagger: 1, jitter: 0.0, tint: 0.12, shuffle: true, bevel: 0.5, rough: 0.06 })]);

  // --- metal and glass
  std('mullion', anodized, { color: rgb(0.62, 0.64, 0.66), roughness: 0.7, metalness: 1.0, aoMap: null }, [Baked()]);
  std('darkMetal', anodized, { color: rgb(0.34, 0.35, 0.36), roughness: 0.85, metalness: 1.0, aoMap: null }, [Baked()]);
  const glass = new THREE.MeshPhysicalMaterial({ color: rgb(0.016, 0.022, 0.026), roughness: 0.035, metalness: 0.0, ior: 2.15, envMapIntensity: 1.0 });
  glass.name = 'glass';
  glass.userData.bake = ALBEDO.glass;
  M.glass = extend(glass, [Baked({ specOcc: false })]);

  // --- site furniture
  std('bench', graniteFine, { color: rgb(0.8, 0.8, 0.795), roughness: 0.6, roughnessMap: null, normalScale: v2(0.6) }, [Baked(), stone, Macro({ scale: 0.2, amount: 0.06 })]);
  std('soil', soil, { color: rgb(0.62, 0.52, 0.42), roughness: 1.0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }, [Baked()]);

  // --- seen only from far away
  std('backdrop', null, { color: rgb(0.72, 0.73, 0.74), roughness: 0.9 }, [Baked()]);
  std('backdropGlass', null, { color: rgb(0.10, 0.13, 0.16), roughness: 0.12, metalness: 0.6 }, [Baked()]);
  std('farWhite', null, { color: rgb(0.6, 0.605, 0.61), roughness: 0.85 });
  std('farGlass', null, { color: rgb(0.07, 0.10, 0.13), roughness: 0.15, metalness: 0.5 });
  std('farMetal', null, { color: rgb(0.78, 0.8, 0.82), roughness: 0.34, metalness: 0.9 });
  std('farCity', null, { color: rgb(0.3, 0.32, 0.35), roughness: 0.9 });
  M.farHills = new THREE.MeshBasicMaterial({ color: rgb(0.11, 0.15, 0.17), side: THREE.DoubleSide, fog: true });
  std('farGround', null, { color: rgb(0.075, 0.10, 0.05), roughness: 1 });
  std('underGround', null, { color: rgb(0.2), roughness: 1 });
  return M;
}
