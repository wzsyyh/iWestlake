import { chromium } from 'playwright';
const exe = process.env.WL_CHROME || '/root/.cache/wl-chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage();
await page.setContent('<canvas id=c width=64 height=64></canvas>');
const info = await page.evaluate(() => {
  const gl = document.getElementById('c').getContext('webgl2');
  if (!gl) return { webgl2: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl2: true,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    cbf: !!gl.getExtension('EXT_color_buffer_float'), cbhf: !!gl.getExtension('EXT_color_buffer_half_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'), aniso: !!gl.getExtension('EXT_texture_filter_anisotropic'),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxSamples: gl.getParameter(gl.MAX_SAMPLES), gpu: !!navigator.gpu,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
