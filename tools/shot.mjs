// Headless screenshot / smoke-test driver (software WebGL via SwiftShader).
//   node tools/shot.mjs out.png "?shot=6&cam=x,y,z,yaw,pitch"  [--w 1280 --h 720] [--eval "js"] [--dom]
//   Extra views from the same page load:  --cams "x,y,z,yaw,pitch;x,y,z,yaw,pitch"  -> out_1.png, out_2.png ...
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args[0] || '/tmp/shot.png';
const query = args[1] && !args[1].startsWith('--') ? args[1] : '';
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const W = +opt('w', 1280), H = +opt('h', 720), wait = +opt('wait', 0);
const evalJs = opt('evalfile', null) ? (await import('node:fs')).readFileSync(opt('evalfile'), 'utf8') : opt('eval', null);
const base = opt('url', process.env.WL_URL || 'http://localhost:4173/');
const exe = process.env.WL_CHROME || '/root/.cache/wl-chrome/chrome-headless-shell-linux64/chrome-headless-shell';

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: args.includes('--touch') });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|GL Driver Message/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(base + query, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction('window.__READY__ === true || window.__ERROR__', null, { timeout: +opt('timeout', 420000) });
} catch (e) { logs.push('[shot] timeout waiting for READY'); }
const err = await page.evaluate('window.__ERROR__ || null');
if (err) logs.push('[ERROR] ' + err);
if (evalJs) { try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[eval error] ' + e.message); } }
if (wait) await page.waitForTimeout(wait);
const fs = await import('node:fs');
const save = async (file, cam) => {
  const url = await page.evaluate((c) => window.__game.snap(c, c ? 2 : 1), cam);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  if (args.includes('--dom')) {
    // the software-rendered canvas stalls page screenshots, so grab the DOM overlay on its own
    // (canvas hidden, transparent page) and let the caller composite it over the frame
    await page.evaluate(() => { document.getElementById('view').style.display = 'none'; document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; });
    await page.screenshot({ path: file.replace(/\.png$/, '_hud.png'), omitBackground: true, timeout: 60000 });
    await page.evaluate(() => { document.getElementById('view').style.display = ''; });
  }
};
if (!err) {
  // a scene script may leave an extra frame in window.__extra (captured before its final state)
  const extra = await page.evaluate('window.__extra || null');
  if (extra) fs.writeFileSync(out.replace(/\.png$/, '_a.png'), Buffer.from(extra.split(',')[1], 'base64'));
  await save(out, null);
  const cams = opt('cams', '');
  let i = 1;
  for (const c of cams.split(';').filter(Boolean)) { await save(out.replace(/\.png$/, `_${i++}.png`), c.split(',').map(Number)); }
}
console.log(logs.slice(0, +opt('logs', 60)).join('\n'));
console.log(`[shot] ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
