// Packs the production build into ONE self-contained HTML file (code, styles and every asset
// inlined), so the game can be opened by double-click or shared as a single attachment.
//   npm run single        ->  RING-ZERO_西湖大学云谷校区.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const outName = process.argv[2] || 'RING-ZERO_西湖大学云谷校区.html';
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// --- styles and code
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/, (_, href) =>
  `<style>\n${fs.readFileSync(path.join(dist, href), 'utf8')}\n</style>`);
let js = null;
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/, (_, src) => {
  js = fs.readFileSync(path.join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<!--WL_CODE-->';
});
if (!js) throw new Error('could not find the module script in dist/index.html (run `npm run build` first)');

// --- assets: everything under dist/assets except the bundle itself; the sky is swapped for its 2k copy
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.json': 'application/json' };
const files = [];
const walk = (dir, rel = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), rel + e.name + '/');
    else if (MIME[path.extname(e.name)]) files.push(rel + e.name);
  }
};
walk(path.join(dist, 'assets'));
let total = 0;
const blocks = files.map((rel) => {
  let file = path.join(dist, 'assets', rel);
  const small = path.join(root, 'assets_single', rel);
  if (fs.existsSync(small)) file = small;
  const data = fs.readFileSync(file);
  total += data.length;
  return `<script type="application/x-wl-asset" data-path="${rel}" data-mime="${MIME[path.extname(rel)]}">${data.toString('base64')}</script>`;
});

// assets first (so they are in the DOM when the module runs), then the code
html = html.replace('<!--WL_CODE-->', () => `${blocks.join('\n')}\n<script type="module">\n${js}\n</script>`);
const out = path.join(root, outName);
fs.writeFileSync(out, html);
console.log(`${files.length} assets (${(total / 1e6).toFixed(1)} MB) + ${(js.length / 1e6).toFixed(2)} MB of code -> ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
