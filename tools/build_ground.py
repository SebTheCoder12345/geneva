"""Ground surface classes and road markings for the play area.

Classes (index -> material):
  0 asphalt road   1 sidewalk asphalt   2 grass   3 park gravel   4 setts (cobbles)   5 stone slabs

Outputs (web/assets/ground/):
  classA.png  RGB weights for classes 0-2 (0.5 m)
  classB.png  RGB weights for classes 3-5 (0.5 m)
  marks.png   road paint from the 10 cm aerial photo, 0.2 m: R = white paint, G = yellow paint
  bridges are written by build_world (osm step); this only rasterises.
"""
import json
import pathlib
import sys

import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import area  # noqa: E402
from build_world import BX0, BX1, BY0, BY1, GRID_H, GRID_W, RAW, TILES_E, TILES_N, WORK  # noqa: E402

OUT = ROOT / "web" / "assets" / "ground"
RES = 0.5  # m per class pixel
ASPHALT, SIDEWALK, GRASS, GRAVEL, SETT, SLABS = range(6)

ROAD_W = {"motorway": 14, "trunk": 14, "primary": 13, "secondary": 11, "tertiary": 9, "unclassified": 7,
          "residential": 7, "living_street": 6, "service": 4.5, "busway": 6.5, "primary_link": 7,
          "secondary_link": 6, "tertiary_link": 6}
FOOT_W = {"footway": 2.5, "path": 2.0, "cycleway": 2.0, "pedestrian": 6.0, "steps": 2.5, "bridleway": 2.5,
          "track": 3.0, "platform": 3.0}
SURFACE = {"asphalt": None, "paved": None, "concrete": SLABS, "concrete:plates": SLABS, "paving_stones": SLABS,
           "sett": SETT, "cobblestone": SETT, "unhewn_cobblestone": SETT, "gravel": GRAVEL,
           "fine_gravel": GRAVEL, "compacted": GRAVEL, "unpaved": GRAVEL, "ground": GRAVEL, "dirt": GRAVEL,
           "sand": GRAVEL, "grass": GRASS, "grass_paver": GRASS, "wood": SLABS}


def px(e, n):
    return ((e - BX0) / RES, (BY1 - n) / RES)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    W, H = int(GRID_W / RES), int(GRID_H / RES)
    osm = json.loads((ROOT / "data" / "raw" / "osm.json").read_text(encoding="utf-8"))

    # 1. base: sidewalk everywhere, grass where the aerial photo is green and nothing else claims it
    ortho = np.asarray(Image.open(WORK / "ortho_1m.png").convert("RGB").resize((W, H), Image.BILINEAR)).astype(np.float32)
    r, g, b = ortho[..., 0], ortho[..., 1], ortho[..., 2]
    exg = (2 * g - r - b) / (r + g + b + 1)
    cls = np.full((H, W), SIDEWALK, np.uint8)
    cls[exg > 0.06] = GRASS

    img = Image.fromarray(cls)
    dr = ImageDraw.Draw(img)

    def lv(geom):
        return [px(*area.wgs_to_lv95(p["lon"], p["lat"])) for p in geom]

    ways = [el for el in osm["elements"] if el["type"] == "way" and "geometry" in el]

    # 2. green areas (drawn first, paths and roads go on top)
    park = Image.new("L", (W, H), 0)
    pdr = ImageDraw.Draw(park)
    for el in ways:
        t = el.get("tags", {})
        if t.get("leisure") in ("park", "garden") and len(el["geometry"]) >= 3:
            pdr.polygon(lv(el["geometry"]), fill=255)
    for el in ways:
        t = el["tags"] if "tags" in el else {}
        if t.get("landuse") in ("grass", "meadow", "flowerbed", "village_green") or \
                t.get("leisure") in ("park", "garden", "pitch") and t.get("surface") not in ("asphalt", "paved"):
            pts = lv(el["geometry"])
            if len(pts) >= 3:
                dr.polygon(pts, fill=GRASS)

    # 3. paved areas: squares, pedestrian areas, platforms
    for el in ways:
        t = el.get("tags", {})
        closed = el["geometry"][0] == el["geometry"][-1]
        if not closed:
            continue
        if t.get("area") == "yes" and t.get("highway") in ("pedestrian", "footway") or t.get("place") == "square" \
                or "area:highway" in t or t.get("amenity") == "parking":
            c = SURFACE.get(t.get("surface", ""), None)
            pts = lv(el["geometry"])
            if len(pts) >= 3:
                dr.polygon(pts, fill=SLABS if c is None else c)

    # 4. footways and paths
    def line(el, width, cls_):
        pts = lv(el["geometry"])
        if len(pts) >= 2:
            w = max(1, int(round(width / RES)))
            dr.line(pts, fill=cls_, width=w, joint="curve")
            for p in (pts[0], pts[-1]):
                dr.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=cls_)

    for el in ways:
        t = el.get("tags", {})
        hw = t.get("highway")
        if hw in FOOT_W and t.get("area") != "yes":
            s = t.get("surface", "")
            c = SURFACE.get(s, SIDEWALK if s in ("asphalt", "paved") else None)
            if c is None:
                c = SIDEWALK if hw in ("footway", "cycleway", "pedestrian", "steps", "platform") else GRAVEL
            line(el, width(t, FOOT_W[hw]), c)

    # 5. roads on top
    for el in ways:
        t = el.get("tags", {})
        hw = t.get("highway")
        if hw in ROAD_W and t.get("area") != "yes" and t.get("tunnel") not in ("yes", "building_passage"):
            c = SURFACE.get(t.get("surface", ""), ASPHALT)
            line(el, width(t, ROAD_W[hw]), ASPHALT if c in (None, SLABS) else c)
    cls = np.asarray(img).copy()
    # untagged paths inside parks are the beige stabilised gravel of Geneva's parks
    cls[(cls == SIDEWALK) & (np.asarray(park) > 0)] = GRAVEL

    # 6. soft weights (linear filtering on the GPU blends 1-2 px borders)
    onehot = np.stack([(cls == k).astype(np.float32) for k in range(6)], -1)
    onehot = np.stack([np.asarray(Image.fromarray((onehot[..., k] * 255).astype(np.uint8))
                                  .filter(ImageFilter.GaussianBlur(0.8))) for k in range(6)], -1).astype(np.float32)
    s = onehot.sum(-1, keepdims=True) + 1e-6
    wts = (onehot / s * 255).round().astype(np.uint8)
    # two RGB images (no alpha: browsers may zero colour where alpha is 0)
    Image.fromarray(wts[..., 0:3], "RGB").save(OUT / "classA.png", optimize=True)
    Image.fromarray(wts[..., 3:6], "RGB").save(OUT / "classB.png", optimize=True)
    Image.fromarray(np.array([[0, 0, 0], [90, 90, 90], [40, 160, 40], [200, 180, 120], [140, 80, 60], [200, 200, 210]],
                             np.uint8)[cls]).resize((W // 2, H // 2)).save(WORK / "classes_preview.png")
    print("classes", cls.shape, np.bincount(cls.ravel(), minlength=6) / cls.size)

    build_marks_osm(osm)


def width(t, default):
    try:
        return float(str(t.get("width", "")).split()[0])
    except (ValueError, IndexError):
        pass
    try:
        return float(t.get("lanes", "")) * 3.1
    except ValueError:
        return default


def build_marks_osm(osm):
    """Road paint drawn from OSM: yellow Swiss zebra crossings and white dashed lane lines (0.2 m)."""
    MR = 0.2
    W, H = int(GRID_W / MR), int(GRID_H / MR)
    white = Image.new("L", (W, H), 0)
    yellow = Image.new("L", (W, H), 0)
    dw, dy = ImageDraw.Draw(white), ImageDraw.Draw(yellow)

    def P(lon, lat):
        e, n = area.wgs_to_lv95(lon, lat)
        return np.array([(e - BX0) / MR, (BY1 - n) / MR])

    node_ways = {}
    roads = []
    for el in osm["elements"]:
        t = el.get("tags", {})
        if el["type"] != "way" or t.get("highway") not in ROAD_W or "geometry" not in el:
            continue
        if t.get("tunnel") in ("yes", "building_passage") or t.get("area") == "yes":
            continue
        pts = [P(g["lon"], g["lat"]) for g in el["geometry"]]
        wm = width(t, ROAD_W[t["highway"]])
        roads.append((t, pts, wm))
        for i, g in enumerate(el["geometry"]):  # match crossing nodes by exact position
            node_ways.setdefault((round(g["lat"], 7), round(g["lon"], 7)), []).append((pts, i, wm))

    # dashed centre / lane lines on two-way roads with 2+ lanes; Swiss urban dash 3 m, gap 6 m
    for t, pts, wm in roads:
        lanes = int(float(t.get("lanes", "2" if t["highway"] in ("primary", "secondary", "tertiary") else "1")))
        if lanes < 2:
            continue
        oneway = t.get("oneway") == "yes"
        offsets = [(k - lanes / 2) * wm / lanes for k in range(1, lanes)]
        for off in offsets:
            phase = 0.0
            for a, b in zip(pts[:-1], pts[1:]):
                d = b - a
                L = np.linalg.norm(d)
                if L < 1e-6:
                    continue
                u = d / L
                nrm = np.array([-u[1], u[0]])
                pos = -phase
                while pos < L:
                    s0, s1 = max(pos, 0), min(pos + 3 / MR, L)
                    if s1 > s0:
                        p0 = a + u * s0 + nrm * off / MR
                        p1 = a + u * s1 + nrm * off / MR
                        # continuous line between opposite directions on wide two-way roads
                        dw.line([tuple(p0), tuple(p1)], fill=255, width=max(1, int(0.12 / MR + 0.5)))
                    pos += 9 / MR
                phase = (pos - L)
                phase = (9 / MR) - phase if phase > 0 else 0
                if not oneway and abs(off) < 0.01:
                    dw.line([tuple(a + nrm * off / MR), tuple(b + nrm * off / MR)], fill=255, width=1)

    # yellow zebra crossings: 0.5 m stripes, 0.5 m gaps, 4 m long, across the full carriageway
    n_cross = 0
    for el in osm["elements"]:
        t = el.get("tags", {})
        if el["type"] != "node" or t.get("highway") != "crossing":
            continue
        key = (round(el["lat"], 7), round(el["lon"], 7))
        if t.get("crossing") in ("unmarked", "no") or t.get("crossing:markings") == "no" or key not in node_ways:
            continue
        pts, i, wm = node_ways[key][0]
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        d = b - a
        if np.linalg.norm(d) < 1e-6:
            continue
        u = d / np.linalg.norm(d)
        nrm = np.array([-u[1], u[0]])
        c = pts[i]
        half = wm / 2 / MR
        k = -half + 0.25 / MR
        while k < half:
            q = c + nrm * k
            corners = [q - u * 2 / MR - nrm * 0.25 / MR, q + u * 2 / MR - nrm * 0.25 / MR,
                       q + u * 2 / MR + nrm * 0.25 / MR, q - u * 2 / MR + nrm * 0.25 / MR]
            dy.polygon([tuple(p) for p in corners], fill=255)
            k += 1.0 / MR
        n_cross += 1
    marks = np.stack([np.asarray(white), np.asarray(yellow), np.zeros((H, W), np.uint8)], -1)
    Image.fromarray(marks, "RGB").save(OUT / "marks.png", optimize=True)
    Image.fromarray(marks[2000:3500, 2000:4000]).save(WORK / "marks_preview.png")
    print("marks from OSM: crossings", n_cross, "roads", len(roads))


def build_marks(cls):
    """White and yellow road paint picked out of the 10 cm aerial photo, kept only on roads."""
    MR = 0.2
    W, H = int(GRID_W / MR), int(GRID_H / MR)
    k = int(MR / 0.1)
    road = np.asarray(Image.fromarray(((cls == ASPHALT) | (cls == SETT)).astype(np.uint8) * 255)
                      .resize((W, H), Image.NEAREST)) > 0
    white = np.zeros((H, W), np.uint8)
    yellow = np.zeros((H, W), np.uint8)
    for n in TILES_N:
        for e in TILES_E:
            x0, y1 = e * 1000, (n + 1) * 1000
            ox0, ox1 = max(x0, BX0), min(x0 + 1000, BX1)
            oy0, oy1 = max(y1 - 1000, BY0), min(y1, BY1)
            if ox0 >= ox1 or oy0 >= oy1:
                continue
            a = tifffile.imread(RAW / f"swissimage-dop10_2026_{e}-{n}_0.1_2056.tif")[..., :3]
            a = a[int((y1 - oy1) * 10):int((y1 - oy0) * 10), int((ox0 - x0) * 10):int((ox1 - x0) * 10)]
            hh, ww = a.shape[0] // k * k, a.shape[1] // k * k
            a = a[:hh, :ww].astype(np.float32).reshape(hh // k, k, ww // k, k, 3).mean(axis=(1, 3)) / 255
            lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
            # local background: paint is much brighter than the asphalt around it
            bg = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(9))) / 255
            mx, mn = a.max(-1), a.min(-1)
            sat = (mx - mn) / (mx + 1e-3)
            wht = (lum > 0.55) & (lum - bg > 0.16) & (sat < 0.22)
            ylw = (a[..., 0] > 0.55) & (a[..., 1] > 0.45) & (a[..., 2] < 0.45) & (sat > 0.35) & (lum - bg > 0.08)
            c0, r0 = int((ox0 - BX0) / MR), int((BY1 - oy1) / MR)
            white[r0:r0 + wht.shape[0], c0:c0 + wht.shape[1]] = wht * 255
            yellow[r0:r0 + ylw.shape[0], c0:c0 + ylw.shape[1]] = ylw * 255
            print("marks tile", e, n)
    white[~road] = 0
    yellow[~road] = 0
    # clean speckle: paint marks are lines/blocks, not single pixels
    white = np.asarray(Image.fromarray(white).filter(ImageFilter.MedianFilter(3)))
    marks = np.stack([white, yellow, np.zeros_like(white)], -1)
    Image.fromarray(marks, "RGB").save(OUT / "marks.png", optimize=True)
    Image.fromarray(white[2000:3500, 2000:4000]).save(WORK / "marks_preview.png")
    print("marks", marks.shape, "white px", int((white > 0).sum()))


if __name__ == "__main__":
    main()
