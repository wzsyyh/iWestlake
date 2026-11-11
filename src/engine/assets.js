import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = import.meta.env.BASE_URL + 'assets/';

// Single-file build: assets travel inside the HTML as base64 <script type="application/x-wl-asset">
// blocks and are turned into blob URLs once at start-up (see tools/build_single.mjs).
const embedded = new Map();

export async function unpackEmbedded(onProgress) {
  const tags = [...document.querySelectorAll('script[type="application/x-wl-asset"]')];
  let done = 0;
  for (const tag of tags) {
    const bin = atob(tag.textContent.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    embedded.set(tag.dataset.path, URL.createObjectURL(new Blob([bytes], { type: tag.dataset.mime || 'application/octet-stream' })));
    tag.remove();
    onProgress?.(++done / tags.length);
    await new Promise((r) => setTimeout(r, 0));          // let the loading bar repaint
  }
  return tags.length;
}

/** Loads and caches textures / models, and reports progress for the loading screen. */
export class Assets {
  constructor(anisotropy = 8) {
    this.anisotropy = anisotropy;
    this.manager = new THREE.LoadingManager();
    this.texLoader = new THREE.TextureLoader(this.manager);
    this.gltfLoader = new GLTFLoader(this.manager);
    this.cache = new Map();
    this.onProgress = null;
    this.manager.onProgress = (_url, loaded, total) => this.onProgress?.(loaded / total);
  }

  url(path) { return embedded.get(path) || BASE + path; }

  /** Base texture (shared GPU upload); use `.variant()` for a different repeat. */
  async texture(file, { srgb = false } = {}) {
    const key = file + (srgb ? ':srgb' : '');
    if (!this.cache.has(key)) {
      this.cache.set(key, this.texLoader.loadAsync(this.url('tex/' + file)).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.anisotropy;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        return t;
      }));
    }
    return this.cache.get(key);
  }

  /** PBR set { map, normalMap, orm } tiled every `tile` metres (geometry UVs are in metres). */
  async pbr(name, tile = 1, { col = true, nor = true, orm = true } = {}) {
    const [c, n, o] = await Promise.all([
      col ? this.texture(`${name}_col.jpg`, { srgb: true }) : null,
      nor ? this.texture(`${name}_nor.jpg`) : null,
      orm ? this.texture(`${name}_orm.jpg`) : null,
    ]);
    const v = (t) => {
      if (!t) return null;
      const k = t.clone();
      k.repeat.set(1 / tile, 1 / tile);
      k.needsUpdate = true;
      return k;
    };
    return { map: v(c), normalMap: v(n), orm: v(o) };
  }

  async gltf(file) {
    return this.gltfLoader.loadAsync(this.url('models/' + file));
  }

  async json(file) {
    return (await fetch(this.url(file))).json();
  }
}
