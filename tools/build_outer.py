"""Surroundings beyond the detailed play area.

mid ring: 16 x 14 km, 25 m grid. Heights from swissALTI3D 2 m (Switzerland) or Copernicus
          GLO-30 (France), colour from SWISSIMAGE 2 m, lake mask at 10 m.
far ring: 100 x 100 km, 250 m grid, Copernicus GLO-30 only (Jura, Salève, Voirons, Alps).

Outputs (web/assets):
  mid.bin, far.bin   Uint16 heights in decimetres above 300 m a.s.l., row 0 = north
  mid_ortho.jpg      colour for the mid ring
  mid_water.png      lake mask for the mid ring (10 m)
  outer.json         grid metadata
"""
import glob
import json
import pathlib
import sys

import numpy as np
import tifffile
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import area  # noqa: E402

OUTER = ROOT / "data" / "raw" / "outer"
COP = ROOT / "data" / "raw" / "cop"
OUT = ROOT / "web" / "assets"
E0, E1, N0, N1 = 2492000, 2508000, 1110000, 1124000  # mid ring LV95 extent


class Copernicus:
    """Bilinear sampling of the 1-arcsecond Copernicus DSM tiles."""

    def __init__(self):
        self.tiles = {}
        for f in glob.glob(str(COP / "*.tif")):
            name = pathlib.Path(f).name  # Copernicus_DSM_COG_10_N46_00_E006_00_DEM.tif
            lat = int(name.split("_N")[1][:2])
            lon = int(name.split("_E")[1][:3])
            self.tiles[(lat, lon)] = tifffile.imread(f).astype(np.float32)

    def sample(self, lon, lat):
        out = np.full(lon.shape, np.nan, np.float32)
        for (la, lo), a in self.tiles.items():
            m = (lat >= la) & (lat < la + 1) & (lon >= lo) & (lon < lo + 1)
            if not m.any():
                continue
            h, w = a.shape
            fx = (lon[m] - lo) * w - 0.5
            fy = (la + 1 - lat[m]) * h - 0.5
            x0 = np.clip(np.floor(fx).astype(int), 0, w - 2)
            y0 = np.clip(np.floor(fy).astype(int), 0, h - 2)
            tx, ty = np.clip(fx - x0, 0, 1), np.clip(fy - y0, 0, 1)
            v = (a[y0, x0] * (1 - tx) + a[y0, x0 + 1] * tx) * (1 - ty) + (a[y0 + 1, x0] * (1 - tx) + a[y0 + 1, x0 + 1] * tx) * ty
            out[m] = v
        return out


def lv95_grid(e0, e1, n0, n1, step):
    es = np.arange(e0, e1 + 0.1, step)
    ns = np.arange(n1, n0 - 0.1, -step)  # north first
    E, N = np.meshgrid(es, ns)
    return E, N


def to_wgs(E, N):
    lon, lat = area._to_wgs.transform(E.ravel(), N.ravel())
    return np.asarray(lon).reshape(E.shape), np.asarray(lat).reshape(E.shape)


def swiss_alti_mosaic(step):
    """swissALTI3D 2 m tiles -> grid at `step` m over the mid ring (NaN where missing)."""
    w, h = int((E1 - E0) / step), int((N1 - N0) / step)
    out = np.full((h + 1, w + 1), np.nan, np.float32)
    for f in glob.glob(str(OUTER / "alti_*.tif")):
        e, n = (int(v) for v in pathlib.Path(f).stem.split("_")[1].split("-"))
        a = tifffile.imread(f).astype(np.float32)  # 500 x 500, 2 m, row 0 = north
        a[a < -1000] = np.nan
        n_px = 1000 // step
        sub = np.asarray(Image.fromarray(a, "F").resize((n_px, n_px), Image.BOX))
        c0 = int((e * 1000 - E0) / step)
        r0 = int((N1 - (n + 1) * 1000) / step)
        out[r0:r0 + sub.shape[0], c0:c0 + sub.shape[1]] = sub
    return out


def build_mid(cop):
    step = 25
    E, N = lv95_grid(E0, E1, N0, N1, step)
    lon, lat = to_wgs(E, N)
    h = cop.sample(lon, lat)
    sw = swiss_alti_mosaic(step)
    sw = sw[: h.shape[0], : h.shape[1]]
    good = ~np.isnan(sw)
    h[good] = sw[good]
    h = np.nan_to_num(h, nan=area.LAKE_LEVEL_M)
    # lake: flat at lake level (Copernicus surface over water is noisy by a metre or so)
    lake_lo = h < area.LAKE_LEVEL_M + 1.2
    h[lake_lo] = np.minimum(h[lake_lo], area.LAKE_LEVEL_M - 4)
    enc(h).tofile(OUT / "mid.bin")

    # 10 m lake mask from the 2 m swissALTI3D where we have it, Copernicus elsewhere
    m_step = 10
    Em, Nm = lv95_grid(E0, E1, N0, N1, m_step)
    lonm, latm = to_wgs(Em, Nm)
    hm = cop.sample(lonm, latm)
    swm = swiss_alti_mosaic(m_step)[: hm.shape[0], : hm.shape[1]]
    ok = ~np.isnan(swm)
    hm[ok] = swm[ok]
    water = np.nan_to_num(hm, nan=999) < area.LAKE_LEVEL_M + 0.35
    from scipy import ndimage
    water = ndimage.binary_opening(water, iterations=1)
    lab, n = ndimage.label(water)
    sizes = ndimage.sum(water, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes > 400
    Image.fromarray((keep[lab] * 255).astype(np.uint8)).save(OUT / "mid_water.png", optimize=True)

    # colour: SWISSIMAGE 2 m tiles, 4 m/px; France filled with a neutral countryside tone
    px = 4
    W, H = (E1 - E0) // px, (N1 - N0) // px
    img = Image.new("RGB", (W, H), (104, 112, 88))
    for f in glob.glob(str(OUTER / "img_*.tif")):
        e, n = (int(v) for v in pathlib.Path(f).stem.split("_")[1].split("-"))
        a = tifffile.imread(f)[..., :3]
        tile = Image.fromarray(a).resize((1000 // px, 1000 // px), Image.LANCZOS)
        img.paste(tile, ((e * 1000 - E0) // px, (N1 - (n + 1) * 1000) // px))
    img = img.resize((4096, 4096 * H // W // 4 * 4), Image.LANCZOS)
    img.save(OUT / "mid_ortho.jpg", quality=84, optimize=True, progressive=True)
    x0, z0 = area.lv95_to_world(E0, N1)
    return {"w": h.shape[1], "h": h.shape[0], "x0": x0, "z0": z0, "cell": step}


def build_far(cop):
    step = 300
    half = 75000  # Mont Blanc is ~63 km south-east
    oe, on = area.ORIGIN_LV95
    e0, e1 = oe - half, oe + half
    n0, n1 = on - half, on + half
    E, N = lv95_grid(e0, e1, n0, n1, step)
    lon, lat = to_wgs(E, N)
    h = cop.sample(lon, lat)
    h = np.nan_to_num(h, nan=area.LAKE_LEVEL_M)
    lake = h < area.LAKE_LEVEL_M + 2.0
    h[lake] = area.LAKE_LEVEL_M - 6
    enc(h).tofile(OUT / "far.bin")
    x0, z0 = area.lv95_to_world(e0, n1)
    return {"w": h.shape[1], "h": h.shape[0], "x0": x0, "z0": z0, "cell": step}


def enc(h):
    return np.clip((h - 300.0) * 10.0, 0, 65535).astype("<u2")


def main():
    cop = Copernicus()
    meta = {"mid": build_mid(cop), "far": build_far(cop),
            "encoding": {"base_m": 300.0, "scale": 0.1, "lake_level_m": area.LAKE_LEVEL_M}}
    (OUT / "outer.json").write_text(json.dumps(meta), encoding="utf-8")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
