/**
 * Diffuse albedo per material slot, used by the lighting bake for bounced light.
 * (Kept free of any rendering imports so the offline baker can use it from Node.)
 */
export const ALBEDO = {
  paving: [0.44, 0.44, 0.43],
  pavingPath: [0.47, 0.47, 0.46],
  kerb: [0.38, 0.38, 0.37],
  plaza: [0.46, 0.46, 0.45],
  hallFloor: [0.62, 0.62, 0.6],
  hallSteps: [0.56, 0.56, 0.54],
  cladding: [0.74, 0.74, 0.73],
  column: [0.78, 0.78, 0.77],
  soffit: [0.76, 0.76, 0.75],
  roof: [0.33, 0.33, 0.33],
  wood: [0.5, 0.36, 0.2],
  mullion: [0.3, 0.3, 0.3],
  darkMetal: [0.08, 0.08, 0.08],
  glass: [0.05, 0.06, 0.07],
  backdrop: [0.66, 0.66, 0.66],
  backdropGlass: [0.1, 0.1, 0.1],
  lawn: [0.10, 0.17, 0.05],
  soil: [0.12, 0.09, 0.06],
  bench: [0.5, 0.5, 0.49],
  prop: [0.2, 0.2, 0.2],
  foliage: [0.07, 0.12, 0.03],
};

/** Stand-in material set for running the level builders without a renderer. */
export function stubMaterials() {
  return new Proxy({}, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (!target[key]) target[key] = { name: key, isStub: true, userData: { bake: ALBEDO[key] || [0.5, 0.5, 0.5], slot: key } };
      return target[key];
    },
  });
}
