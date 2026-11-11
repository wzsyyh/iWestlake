#!/usr/bin/env python3
"""
Downloads the CC0 source assets (Poly Haven + ambientCG) and converts them into
the compact runtime set under public/assets/.

    python3 tools/build_assets.py            # everything
    python3 tools/build_assets.py textures   # only one stage (hdri | textures)

Raw downloads are cached in $WL_RAW (default /tmp/wl_assets_raw).
Tree geometry is handled separately by tools/build_tree.py.
"""
import io, json, os, subprocess, sys, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageFile

Image.MAX_IMAGE_PIXELS = None
ImageFile.MAXBLOCK = 1 << 25      # optimize=True needs a large encoder buffer for 2k normal maps
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.environ.get('WL_RAW', '/tmp/wl_assets_raw')
OUT = os.path.join(ROOT, 'public', 'assets')
UA = {'User-Agent': 'iwestlake-fps-asset-builder/1.0'}

# name -> (polyhaven id, output size)
PH_TEXTURES = {
    'concrete':  ('concrete_wall_008', 2048),
    'plaster':   ('plastered_wall_04', 1024),
    'bamboo':    ('bamboo_veneer', 2048),
    'soil':      ('farm_soil', 1024),
}
# name -> (ambientCG id, output size)
ACG_TEXTURES = {
    'granite':   ('Granite002A', 2048),
    'grass':     ('Grass005', 2048),
    'grass2':    ('Grass004', 1024),
    'brushed':   ('Metal009', 1024),
    'anodized':  ('Metal032', 1024),
    'gunmetal':  ('Metal038', 1024),
    'polymer':   ('Plastic006', 1024),
    'shell':     ('Plastic010', 1024),
    'carbon':    ('Fabric004', 1024),
    'scratches': ('Scratches004', 1024),
}
HDRIS = {
    'sky_late_afternoon': ('qwantani_late_afternoon_puresky', '4k'),
}
# (the single-file build embeds a half-resolution copy made by tools/make_small_sky.mjs)


def fetch(url, path, big=False):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    if big:
        # segmented download: single connections are heavily throttled on some networks
        head = urllib.request.urlopen(urllib.request.Request(url, headers=UA, method='HEAD'), timeout=60)
        total = int(head.headers['Content-Length'])
        n = 24
        seg = (total + n - 1) // n

        def part(i):
            s, e = i * seg, min(total, (i + 1) * seg) - 1
            for _ in range(6):
                try:
                    req = urllib.request.Request(url, headers={**UA, 'Range': f'bytes={s}-{e}'})
                    data = urllib.request.urlopen(req, timeout=600).read()
                    if len(data) == e - s + 1:
                        return data
                except Exception:
                    pass
            raise RuntimeError(f'segment {i} of {url} failed')

        with ThreadPoolExecutor(n) as ex:
            chunks = list(ex.map(part, range(n)))
        with open(tmp, 'wb') as f:
            for c in chunks:
                f.write(c)
    else:
        for attempt in range(5):
            try:
                data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()
                break
            except Exception as e:
                if attempt == 4:
                    raise
        with open(tmp, 'wb') as f:
            f.write(data)
    os.replace(tmp, path)
    return path


def ph_files(asset):
    p = fetch(f'https://api.polyhaven.com/files/{asset}', os.path.join(RAW, 'ph', asset, 'files.json'))
    return json.load(open(p))


def save_jpg(img, path, size, q=90):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if img.size != (size, size):
        img = img.resize((size, size), Image.LANCZOS)
    img.save(path, quality=q, subsampling=0 if 'nor' in os.path.basename(path) else 2, optimize=True)


def to_l(img):
    """8-bit greyscale regardless of the source bit depth."""
    if img.mode in ('I;16', 'I'):
        import numpy as np
        a = np.asarray(img).astype('float32')
        return Image.fromarray((a / 65535.0 * 255.0).clip(0, 255).astype('uint8'))
    return img.convert('L')


def build_ph_texture(name, asset, size):
    files = ph_files(asset)
    src = '4k' if size > 2048 else '2k'

    def grab(key):
        if key not in files:
            return None
        ent = files[key][src]
        fmt = 'jpg' if 'jpg' in ent else 'png'
        p = fetch(ent[fmt]['url'], os.path.join(RAW, 'ph', asset, f'{key}_{src}.{fmt}'))
        return Image.open(p)

    diff, nor, arm = grab('Diffuse'), grab('nor_gl'), grab('arm')
    save_jpg(diff.convert('RGB'), os.path.join(OUT, 'tex', f'{name}_col.jpg'), size)
    save_jpg(nor.convert('RGB'), os.path.join(OUT, 'tex', f'{name}_nor.jpg'), size, q=92)
    save_jpg(arm.convert('RGB'), os.path.join(OUT, 'tex', f'{name}_orm.jpg'), size, q=88)
    print('  ph ', name, asset)


def build_acg_texture(name, asset, size):
    z = fetch(f'https://ambientcg.com/get?file={asset}_2K-JPG.zip', os.path.join(RAW, 'acg', f'{asset}_2K-JPG.zip'), big=True)
    zf = zipfile.ZipFile(z)
    names = zf.namelist()

    def grab(suffix):
        for n in names:
            if n.endswith(f'_{suffix}.jpg'):
                return Image.open(io.BytesIO(zf.read(n)))
        return None

    col, nor = grab('Color'), grab('NormalGL')
    rough, metal, ao = grab('Roughness'), grab('Metalness'), grab('AmbientOcclusion')
    if col is not None:
        save_jpg(col.convert('RGB'), os.path.join(OUT, 'tex', f'{name}_col.jpg'), size)
    if nor is not None:
        save_jpg(nor.convert('RGB'), os.path.join(OUT, 'tex', f'{name}_nor.jpg'), size, q=92)
    base = (rough or col).size
    white = Image.new('L', base, 255)
    black = Image.new('L', base, 0)
    orm = Image.merge('RGB', (
        to_l(ao).resize(base) if ao is not None else white,
        to_l(rough).resize(base) if rough is not None else white,
        to_l(metal).resize(base) if metal is not None else black,
    ))
    save_jpg(orm, os.path.join(OUT, 'tex', f'{name}_orm.jpg'), size, q=88)
    print('  acg', name, asset, [n.split('_')[-1] for n in names if n.endswith('.jpg')])


def build_hdri(name, asset, res):
    files = ph_files(asset)
    url = files['hdri'][res]['hdr']['url']
    raw = fetch(url, os.path.join(RAW, 'ph', asset, f'{asset}_{res}.hdr'), big=True)
    dst = os.path.join(OUT, 'sky', f'{name}.hdr')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(raw):
        subprocess.check_call(['cp', raw, dst])
    print('  hdri', name, asset, os.path.getsize(dst) // 1024, 'KB')


def main():
    stages = sys.argv[1:] or ['hdri', 'textures']
    if 'textures' in stages:
        print('textures')
        with ThreadPoolExecutor(6) as ex:
            jobs = [ex.submit(build_ph_texture, n, a, s) for n, (a, s) in PH_TEXTURES.items()]
            jobs += [ex.submit(build_acg_texture, n, a, s) for n, (a, s) in ACG_TEXTURES.items()]
            for j in jobs:
                j.result()
    if 'hdri' in stages:
        print('hdri')
        with ThreadPoolExecutor(3) as ex:
            for j in [ex.submit(build_hdri, n, a, r) for n, (a, r) in HDRIS.items()]:
                j.result()
    print('done ->', OUT)


if __name__ == '__main__':
    main()
