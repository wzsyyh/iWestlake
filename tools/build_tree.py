#!/usr/bin/env python3
"""
Turns Poly Haven's photoscanned `tree_small_02` (2M triangles, CC0) into a game-ready tree:

  * every modelled leaf becomes a single alpha-tested card; leaves are re-packed into a clean atlas
  * trunk + branches are welded, simplified and shaded with triplanar bark (no UVs needed)
  * three LODs, written as one small GLB:  public/assets/models/tree.glb
  * textures: public/assets/tex/leaf_atlas.png, leaf_nor.jpg, bark_col.jpg, bark_nor.jpg

    python3 tools/build_tree.py
"""
import json, os, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
import fast_simplification

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_assets import fetch, ph_files, RAW, OUT  # noqa: E402

ASSET = 'tree_small_02'
SRC = os.path.join(RAW, 'ph', ASSET, 'gltf')
ATLAS = 1024
rng = np.random.RandomState(7)


def download():
    files = ph_files(ASSET)
    g = files['gltf']['2k']['gltf']
    fetch(g['url'], os.path.join(SRC, 'tree.gltf'))
    for name, inc in g['include'].items():
        fetch(inc['url'], os.path.join(SRC, name), big=inc['size'] > 8e6)
    a = files['leaves_alpha']['2k']['png']
    fetch(a['url'], os.path.join(SRC, 'textures', 'leaves_alpha.png'))


def load_gltf():
    g = json.load(open(os.path.join(SRC, 'tree.gltf')))
    buf = np.memmap(os.path.join(SRC, g['buffers'][0]['uri']), dtype=np.uint8, mode='r')
    CT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def acc(i):
        a = g['accessors'][i]
        bv = g['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = NC[a['type']]
        arr = np.frombuffer(buf, dtype=CT[a['componentType']], count=a['count'] * n, offset=off)
        return arr.reshape(-1, n) if n > 1 else arr

    prims = {}
    for p in g['meshes'][0]['primitives']:
        name = g['materials'][p['material']]['name'].split('_')[-1]
        prims[name] = dict(
            pos=np.array(acc(p['attributes']['POSITION']), dtype=np.float64),
            nor=np.array(acc(p['attributes']['NORMAL']), dtype=np.float64),
            uv=np.array(acc(p['attributes']['TEXCOORD_0']), dtype=np.float64),
            idx=np.array(acc(p['indices']), dtype=np.int64).reshape(-1, 3),
        )
    return prims


def weld(pos, idx, q=20000.0):
    key = np.round(pos * q).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    first = np.zeros(len(uniq), dtype=np.int64)
    first[inv[::-1]] = np.arange(len(pos))[::-1]
    return pos[first], inv[idx], inv


def vertex_normals(pos, idx):
    fn = np.cross(pos[idx[:, 1]] - pos[idx[:, 0]], pos[idx[:, 2]] - pos[idx[:, 0]])
    n = np.zeros_like(pos)
    mag = np.zeros(len(pos))
    for k in range(3):
        np.add.at(n, idx[:, k], fn)
        np.add.at(mag, idx[:, k], np.linalg.norm(fn, axis=1))
    ln = np.linalg.norm(n, axis=1)
    # twigs that collapsed into two-sided slivers have opposing face normals that cancel out:
    # give those vertices a radial normal (away from the trunk axis) instead of a zero vector
    bad = ln < 0.25 * np.maximum(mag, 1e-20)
    if bad.any():
        axis = np.median(pos[:, [0, 2]], axis=0)
        radial = np.column_stack([pos[:, 0] - axis[0], np.full(len(pos), 0.35), pos[:, 2] - axis[1]])
        n[bad] = radial[bad]
        ln = np.linalg.norm(n, axis=1)
    return n / np.maximum(ln, 1e-12)[:, None]


# ---------------------------------------------------------------- leaves -> cards

def analyse_leaves(leaves):
    """Split the leaf mesh into connected components and group them by UV footprint.

    The source tree instances a handful of leaf / compound-leaf meshes thousands of times, so every
    component with the same UV bounding box is the same "sprite"."""
    pos, uv, idx = leaves['pos'], leaves['uv'], leaves['idx']
    _, widx, inv = weld(pos, idx)
    nw = inv.max() + 1
    e = np.concatenate([widx[:, [0, 1]], widx[:, [1, 2]]])
    ncomp, wl = connected_components(coo_matrix((np.ones(len(e), np.int8), (e[:, 0], e[:, 1])), shape=(nw, nw)), directed=False)
    vcomp = wl[inv]
    tcomp = vcomp[idx[:, 0]]
    lo = np.full((ncomp, 2), 9.0)
    hi = np.full((ncomp, 2), -9.0)
    np.minimum.at(lo, vcomp, uv)
    np.maximum.at(hi, vcomp, uv)
    key = np.round(np.column_stack([lo, hi]) * 500).astype(np.int64)
    kinds, ckind, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    ckind = ckind.ravel()
    return dict(ncomp=ncomp, vcomp=vcomp, tcomp=tcomp, lo=lo, hi=hi, ckind=ckind, nkinds=len(kinds), counts=counts)


def build_atlas(leaves, an, kinds):
    tex = os.path.join(SRC, 'textures')
    col = Image.open(os.path.join(tex, f'{ASSET}_leaves_diff_2k.jpg')).convert('RGB')
    nor = Image.open(os.path.join(tex, f'{ASSET}_leaves_nor_gl_2k.jpg')).convert('RGB')
    W, H = col.size
    uv, idx = leaves['uv'], leaves['idx']
    order = np.argsort(an['tcomp'], kind='stable')
    tstart = np.searchsorted(an['tcomp'][order], np.arange(an['ncomp'] + 1))
    sprites = {}
    for k in kinds:
        if an['counts'][k] < 20:
            continue
        c = int(np.nonzero(an['ckind'] == k)[0][0])
        tris = idx[order[tstart[c]:tstart[c + 1]]]
        u0, v0 = an['lo'][c]
        u1, v1 = an['hi'][c]
        w, h = (u1 - u0) * W, (v1 - v0) * H
        if w < 24 or h < 24:
            continue
        # exact silhouette: rasterise the component's own UV triangles (4x supersampled)
        ss = 4
        x0, y0 = int(np.floor(u0 * W)) - 2, int(np.floor(v0 * H)) - 2
        x1, y1 = int(np.ceil(u1 * W)) + 2, int(np.ceil(v1 * H)) + 2
        m = Image.new('L', ((x1 - x0) * ss, (y1 - y0) * ss), 0)
        d = ImageDraw.Draw(m)
        for t in ((uv[tris] * [W, H] - [x0, y0]) * ss).reshape(-1, 6):
            d.polygon(t.tolist(), fill=255)
        m = m.filter(ImageFilter.MinFilter(4 * ss + 1)).resize((x1 - x0, y1 - y0), Image.LANCZOS)   # shave the dark rim
        cover = np.asarray(m).mean() / 255.0
        sprites[k] = dict(box=(x0, y0, x1, y1), mask=m, count=int(an['counts'][k]), tris=len(tris), cover=cover)
    for k, sp in sorted(sprites.items(), key=lambda kv: -kv[1]['count']):
        x0, y0, x1, y1 = sp['box']
        print(f"    sprite {k:3d}: {sp['count']:6d} comps x {sp['tris']:3d} tris  {x1 - x0}x{y1 - y0}px  cover {sp['cover']:.2f}")

    # shelf-pack (source is 2k; sprites are scaled by s)
    pad = 5
    order_s = sorted(sprites.items(), key=lambda kv: -(kv[1]['box'][3] - kv[1]['box'][1]))

    def pack(s):
        x = y = pad
        row = 0
        out = []
        for k, sp in order_s:
            bx0, by0, bx1, by1 = sp['box']
            w, h = max(4, int(round((bx1 - bx0) * s))), max(4, int(round((by1 - by0) * s)))
            if x + w + pad > ATLAS:
                x, y, row = pad, y + row + pad, 0
            if y + h + pad > ATLAS:
                return None
            out.append((k, x, y, w, h))
            x += w + pad
            row = max(row, h)
        return out

    lo, hi = 0.05, 1.0
    for _ in range(18):
        mid = (lo + hi) / 2
        if pack(mid):
            lo = mid
        else:
            hi = mid
    placed = pack(lo)
    print(f'  atlas: {len(sprites)} sprites, scale {lo:.3f}')
    a_col = np.zeros((ATLAS, ATLAS, 3), np.uint8)
    a_nor = np.zeros((ATLAS, ATLAS, 3), np.uint8)
    a_nor[...] = (128, 128, 255)
    a_alpha = np.zeros((ATLAS, ATLAS), np.uint8)
    for k, x, y, w, h in placed:
        sp = sprites[k]
        a_alpha[y:y + h, x:x + w] = np.asarray(sp['mask'].resize((w, h), Image.LANCZOS))
        a_col[y:y + h, x:x + w] = np.asarray(col.crop(sp['box']).resize((w, h), Image.LANCZOS))
        a_nor[y:y + h, x:x + w] = np.asarray(nor.crop(sp['box']).resize((w, h), Image.LANCZOS))
        bx0, by0, bx1, by1 = sp['box']
        sp['src'] = (bx0 / W, by0 / H, bx1 / W, by1 / H)
        sp['dst'] = (x / ATLAS, y / ATLAS, (x + w) / ATLAS, (y + h) / ATLAS)
    # bleed colour into transparent texels so mip-maps do not pull in black
    solid = a_alpha > 128
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    rgba = np.dstack([a_col[iy, ix], a_alpha])
    os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'tex', 'leaf_atlas.png'), optimize=True)
    Image.fromarray(a_nor[iy, ix]).save(os.path.join(OUT, 'tex', 'leaf_nor.jpg'), quality=90, subsampling=0)
    # tileable bark from the branch material
    for src, dst, q in ((f'{ASSET}_branch_diff_2k.jpg', 'bark_col.jpg', 88), (f'{ASSET}_branch_nor_gl_2k.jpg', 'bark_nor.jpg', 90)):
        Image.open(os.path.join(tex, src)).convert('RGB').resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, 'tex', dst), quality=q)
    return sprites


def fit_components(leaves, an):
    """Affine fit  p = X^T [u v 1]  per component; returns the components that are flat enough to be cards."""
    pos, uv, nor = leaves['pos'], leaves['uv'], leaves['nor']
    ncomp, vcomp = an['ncomp'], an['vcomp']
    A = np.column_stack([uv, np.ones(len(uv))])
    ATA = np.zeros((ncomp, 3, 3))
    ATP = np.zeros((ncomp, 3, 3))
    np.add.at(ATA, vcomp, A[:, :, None] * A[:, None, :])
    np.add.at(ATP, vcomp, A[:, :, None] * pos[:, None, :])
    nsum = np.zeros((ncomp, 3))
    np.add.at(nsum, vcomp, nor)
    comps = np.arange(ncomp)
    good = np.abs(np.linalg.det(ATA)) > 1e-14
    comps = comps[good]
    X = np.linalg.solve(ATA[comps], ATP[comps])        # rows: dP/du, dP/dv, origin
    # a flat leaf maps isotropically; unwrapped twig tubes collapse along u and are dropped
    su, sv = np.linalg.norm(X[:, 0], axis=1), np.linalg.norm(X[:, 1], axis=1)
    ratio = su / np.maximum(sv, 1e-12)
    cosang = np.abs((X[:, 0] * X[:, 1]).sum(1)) / np.maximum(su * sv, 1e-12)
    iso = (ratio > 0.5) & (ratio < 2.0) & (cosang < 0.5)
    return comps[iso], X[iso], nsum


def build_leaf_cards(an, comps, X, nsum, sprites):
    ckind = an['ckind']
    has = np.isin(ckind[comps], list(sprites.keys()))
    comps, X = comps[has], X[has]
    src = np.array([sprites[k]['src'] for k in ckind[comps]])
    dst = np.array([sprites[k]['dst'] for k in ckind[comps]])

    def at(u, v):
        return X[:, 0] * u[:, None] + X[:, 1] * v[:, None] + X[:, 2]

    P = np.stack([at(src[:, 0], src[:, 1]), at(src[:, 2], src[:, 1]), at(src[:, 2], src[:, 3]), at(src[:, 0], src[:, 3])], 1)
    UV = np.stack([dst[:, [0, 1]], dst[:, [2, 1]], dst[:, [2, 3]], dst[:, [0, 3]]], 1)
    ctr = P.mean(1)
    span = np.linalg.norm(P[:, 2] - P[:, 0], axis=1)
    sane = (span > 0.008) & (span < 0.30)
    P, UV, ctr, comps = P[sane], UV[sane], ctr[sane], comps[sane]
    n = np.cross(P[:, 1] - P[:, 0], P[:, 3] - P[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    flip = (n * nsum[comps]).sum(1) < 0
    n[flip] *= -1
    print(f'  leaves: {an["ncomp"]} components -> {len(P)} cards (median span {np.median(span[sane]) * 100:.1f} cm)')
    return P, UV, n, ctr


def leaf_lod(P, UV, n, ctr, fraction, scale, canopy_c, canopy_r):
    m = len(P)
    sel = np.arange(m) if fraction >= 1 else np.sort(rng.choice(m, int(m * fraction), replace=False))
    P, UV, n, ctr = P[sel], UV[sel], n[sel], ctr[sel]
    P = ctr[:, None, :] + (P - ctr[:, None, :]) * scale
    # shading normal: leaf normal folded to the outward hemisphere, blended with the canopy "puff" normal
    out = (ctr - canopy_c) / canopy_r
    rad = np.linalg.norm(out, axis=1, keepdims=True)
    outn = out / np.maximum(rad, 1e-6)
    n = np.where(((n * outn).sum(1) < 0)[:, None], -n, n)
    sn = n * 0.45 + outn * 0.55
    sn /= np.linalg.norm(sn, axis=1, keepdims=True)
    # per-leaf data: random phase, occlusion (inner / lower leaves see less sky)
    depth = np.clip(rad[:, 0], 0, 1)
    low = np.clip((ctr[:, 1] - (canopy_c[1] - canopy_r[1])) / (2 * canopy_r[1]), 0, 1)
    ao = np.clip(0.30 + 0.55 * depth ** 1.6 + 0.25 * low, 0, 1)
    phase = rng.rand(len(P))
    k = len(P)
    pos = P.reshape(-1, 3)
    uv = UV.reshape(-1, 2)
    nor = np.repeat(sn, 4, 0)
    data = np.repeat(np.column_stack([phase, ao, np.zeros(k)]), 4, 0)
    base = (np.arange(k) * 4)[:, None]
    idx = (base + np.array([[0, 1, 2, 0, 2, 3]])).reshape(-1, 3)
    return pos, nor, uv, data, idx


# ---------------------------------------------------------------- wood

def build_wood(prims, targets):
    parts = []
    off = 0
    P, I = [], []
    for name in ('trunk', 'branches'):
        p, i, _ = weld(prims[name]['pos'], prims[name]['idx'])
        P.append(p)
        I.append(i + off)
        off += len(p)
    P, I = np.concatenate(P), np.concatenate(I)
    P, I, _ = weld(P, I)
    I = I[(I[:, 0] != I[:, 1]) & (I[:, 1] != I[:, 2]) & (I[:, 0] != I[:, 2])]
    print(f'  wood: {len(I)} tris welded')
    out = []
    for t in targets:
        red = 1.0 - t / len(I)
        p, f = fast_simplification.simplify(P.astype(np.float32), I.astype(np.int32), target_reduction=red, agg=6)
        p = p.astype(np.float64)
        f = f.astype(np.int64)
        out.append((p, vertex_normals(p, f), f))
        print(f'    lod target {t}: {len(f)} tris')
    return out


# ---------------------------------------------------------------- glb writer

def write_glb(path, meshes):
    """meshes: list of (name, {attr: array}, indices)"""
    bin_parts, views, accessors, gmeshes, nodes = [], [], [], [], []
    offset = 0

    def add(arr, target):
        nonlocal offset
        raw = arr.tobytes()
        pad = (-len(raw)) % 4
        views.append(dict(buffer=0, byteOffset=offset, byteLength=len(raw), target=target))
        bin_parts.append(raw + b'\0' * pad)
        offset += len(raw) + pad
        return len(views) - 1

    TYPES = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}
    for name, attrs, idx in meshes:
        prim = dict(attributes={}, mode=4)
        for key, arr in attrs.items():
            a = np.ascontiguousarray(arr, dtype=np.float32)
            acc = dict(bufferView=add(a, 34962), componentType=5126, count=len(a), type=TYPES[a.shape[1]])
            if key == 'POSITION':
                acc['min'], acc['max'] = a.min(0).tolist(), a.max(0).tolist()
            accessors.append(acc)
            prim['attributes'][key] = len(accessors) - 1
        ii = np.ascontiguousarray(idx.reshape(-1), dtype=np.uint32)
        accessors.append(dict(bufferView=add(ii, 34963), componentType=5125, count=len(ii), type='SCALAR'))
        prim['indices'] = len(accessors) - 1
        gmeshes.append(dict(name=name, primitives=[prim]))
        nodes.append(dict(name=name, mesh=len(gmeshes) - 1))
    doc = dict(asset=dict(version='2.0', generator='iwestlake build_tree.py', copyright='Derived from "tree_small_02" by Poly Haven (CC0)'),
               scene=0, scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes, meshes=gmeshes,
               accessors=accessors, bufferViews=views, buffers=[dict(byteLength=offset)])
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    blob = b''.join(bin_parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + blob)
    print(f'  wrote {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


def main():
    print('tree: download')
    download()
    prims = load_gltf()
    print('tree: leaf sprites')
    an = analyse_leaves(prims['leaves'])
    comps, X, nsum = fit_components(prims['leaves'], an)
    sprites = build_atlas(prims['leaves'], an, np.unique(an['ckind'][comps]).tolist())
    print('tree: leaf cards')
    P, UV, n, ctr = build_leaf_cards(an, comps, X, nsum, sprites)
    lo, hi = np.percentile(ctr, 1, axis=0), np.percentile(ctr, 99, axis=0)
    canopy_c, canopy_r = (lo + hi) / 2, (hi - lo) / 2 * 1.05
    print('  canopy centre', canopy_c.round(2), 'radii', canopy_r.round(2))
    print('tree: wood')
    wood = build_wood(prims, [26000, 6000, 800])
    meshes = []
    for lod, (frac, scale) in enumerate([(1.0, 1.0), (0.36, 1.65), (0.065, 3.6)]):
        pos, nor, uv, data, idx = leaf_lod(P, UV, n, ctr, frac, scale, canopy_c, canopy_r)
        wp, wn, wi = wood[lod]
        meshes.append((f'wood_lod{lod}', dict(POSITION=wp, NORMAL=wn), wi))
        meshes.append((f'leaves_lod{lod}', dict(POSITION=pos, NORMAL=nor, TEXCOORD_0=uv, _LEAFDATA=data), idx))
        print(f'  lod{lod}: wood {len(wi)} tris, leaves {len(idx)} tris')
    write_glb(os.path.join(OUT, 'models', 'tree.glb'), meshes)
    meta = dict(canopy_center=canopy_c.tolist(), canopy_radius=canopy_r.tolist(),
                height=float(max(P.reshape(-1, 3)[:, 1].max(), wood[0][0][:, 1].max())))
    json.dump(meta, open(os.path.join(OUT, 'models', 'tree.json'), 'w'))
    print('  meta', meta)


if __name__ == '__main__':
    main()
