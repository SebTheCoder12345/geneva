"""Build web assets for the play area from the raw open data.

Inputs  (data/raw): swisstopo swissALTI3D, swissSURFACE3D raster, SWISSIMAGE 10 cm,
                    swissBUILDINGS3D 2.0 DXF, OpenStreetMap JSON.
Outputs (web/assets):
  terrain.bin   Uint16 heights, mm above (LAKE - 20 m), 1 m grid, row 0 = north
  water.png     8-bit mask on the same grid (255 = water)
  ortho.jpg     aerial photo of the play area (4096 px, north up)
  buildings.glb walls + roofs, world metres, UV0 = facade metres, COLOR_0 = per-building tint
  world.json    grid metadata, trees, landmarks

World frame: +X east, +Y up, -Z north, metres, origin = area.ORIGIN_LV95, Y=0 = lake level.
Usage: python tools/build_world.py [terrain] [ortho] [buildings] [trees]   (default: all)
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

RAW = ROOT / "data" / "raw" / "swisstopo"
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "assets"
TILES_E = (2499, 2500, 2501)
TILES_N = (1118, 1117)  # north row first
MOSAIC_X0, MOSAIC_Y1 = 2499000, 1119000  # LV95 of the mosaic's top-left corner

# Play area grid, 1 m, snapped to whole metres
BX0, BY0, BX1, BY1 = (int(np.floor(v)) for v in area.bbox_lv95())
GRID_W, GRID_H = BX1 - BX0, BY1 - BY0
HEIGHT_BASE = area.LAKE_LEVEL_M - 20.0
WATER_TOL = 0.25  # metres above lake surface still counted as water


def mosaic(pattern, res):
    rows = []
    for n in TILES_N:
        rows.append(np.hstack([tifffile.imread(RAW / pattern.format(e=e, n=n)) for e in TILES_E]))
    m = np.vstack(rows).astype(np.float32)
    assert m.shape == (int(2000 / res * 1), int(3000 / res)), m.shape
    return m


def crop_to_grid(m, res):
    """Crop a mosaic (row 0 = north) at `res` m/px to the play-area grid, resampled to 1 m."""
    c0 = int((BX0 - MOSAIC_X0) / res)
    r0 = int((MOSAIC_Y1 - BY1) / res)
    k = int(round(1 / res))
    sub = m[r0:r0 + GRID_H * k, c0:c0 + GRID_W * k]
    return sub.reshape(GRID_H, k, GRID_W, k).mean(axis=(1, 3))


def build_terrain():
    dtm = crop_to_grid(mosaic("swissalti3d_2021_{e}-{n}_0.5_2056_5728.tif", 0.5), 0.5)
    dsm = crop_to_grid(mosaic("swisssurface3d-raster_2025_{e}-{n}_0.5_2056_5728.tif", 0.5), 0.5)
    np.save(WORK / "dtm_1m.npy", dtm)
    np.save(WORK / "dsm_1m.npy", dsm)

    # Water: flat lake surface, plus the Rhône which runs lower; both read as water in the DTM
    # where the surface model equals the terrain (nothing standing on it).
    from scipy import ndimage
    lake = dtm < area.LAKE_LEVEL_M + WATER_TOL
    # Rhône downstream of the Seujet dam sits lower; take any low, flat, connected region that
    # touches the lake body, and drop specks.
    lake = ndimage.binary_opening(lake, iterations=1)
    lab, n = ndimage.label(lake)
    sizes = ndimage.sum(lake, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes > 2000
    water = keep[lab]
    # the surface model must also be ~flat there (boats are fine, piers/bridges are not)
    bridge = (dsm - dtm) > 1.5
    water_vis = water & ~ndimage.binary_dilation(bridge & ~water, iterations=1)

    h = dtm.copy()
    # Lower the bed under water so the water plane never z-fights with terrain.
    h[water] = np.minimum(h[water], area.LAKE_LEVEL_M - 3.0)
    mm = np.clip((h - HEIGHT_BASE) * 1000.0, 0, 65535).astype("<u2")
    OUT.mkdir(parents=True, exist_ok=True)
    mm.tofile(OUT / "terrain.bin")
    Image.fromarray((water_vis * 255).astype(np.uint8)).save(OUT / "water.png", optimize=True)
    print("terrain", mm.shape, "water fraction", round(float(water.mean()), 3))


def build_ortho(size=4096):
    """Downsample the 10 cm aerial photo to one texture covering the play area."""
    scale = size / max(GRID_W, GRID_H)  # px per metre in the output
    canvas = Image.new("RGB", (int(round(GRID_W * scale)), int(round(GRID_H * scale))))
    for n in TILES_N:
        for e in TILES_E:
            x0, y1 = e * 1000, (n + 1) * 1000
            # overlap of this 1 km tile with the play area
            ox0, ox1 = max(x0, BX0), min(x0 + 1000, BX1)
            oy0, oy1 = max(y1 - 1000, BY0), min(y1, BY1)
            if ox0 >= ox1 or oy0 >= oy1:
                continue
            img = tifffile.imread(RAW / f"swissimage-dop10_2026_{e}-{n}_0.1_2056.tif")[..., :3]
            crop = img[int((y1 - oy1) * 10):int((y1 - oy0) * 10), int((ox0 - x0) * 10):int((ox1 - x0) * 10)]
            im = Image.fromarray(crop)
            w, hh = int(round((ox1 - ox0) * scale)), int(round((oy1 - oy0) * scale))
            im = im.resize((w, hh), Image.LANCZOS)
            canvas.paste(im, (int(round((ox0 - BX0) * scale)), int(round((BY1 - oy1) * scale))))
            del img, crop
            print("ortho tile", e, n)
    canvas = canvas.resize((size, size), Image.LANCZOS)  # square for mip-friendliness
    canvas.save(OUT / "ortho.jpg", quality=86, optimize=True, progressive=True)
    # 1 m reference copy for the critic / debugging
    canvas.resize((GRID_W, GRID_H), Image.LANCZOS).save(WORK / "ortho_1m.png")
    print("ortho", canvas.size)


def build_buildings():
    import ezdxf
    import trimesh
    from ezdxf.render import MeshBuilder

    dxf = glob.glob(str(RAW / "bld" / "**" / "*.dxf"), recursive=True)[0]
    doc = ezdxf.readfile(dxf)
    skip_layers = {"Gebaeude unsichtbar", "Unterirdisches Gebaeude"}
    rng = np.random.default_rng(7)
    wall_v, wall_uv, wall_c, wall_f = [], [], [], []
    roof_v, roof_uv, roof_c, roof_f = [], [], [], []
    n_bld = 0
    for e in doc.modelspace().query("POLYLINE"):
        if not e.is_poly_face_mesh or e.dxf.layer in skip_layers:
            continue
        mb = MeshBuilder.from_polyface(e)
        V = np.array([tuple(v) for v in mb.vertices], dtype=np.float64)
        if len(V) == 0:
            continue
        cx, cy = V[:, 0].mean(), V[:, 1].mean()
        if not (BX0 < cx < BX1 and BY0 < cy < BY1):
            continue
        n_bld += 1
        # world coords
        W = np.empty_like(V)
        W[:, 0] = V[:, 0] - area.ORIGIN_LV95[0]
        W[:, 1] = V[:, 2] - area.LAKE_LEVEL_M
        W[:, 2] = -(V[:, 1] - area.ORIGIN_LV95[1])
        base = W[:, 1].min()
        # per-building tint: warm Geneva limestone / render palette
        tint = np.array([0.93, 0.88, 0.80]) * rng.uniform(0.82, 1.08) + rng.normal(0, 0.025, 3)
        for face in mb.faces:
            if len(face) < 3:
                continue
            P = W[list(face)]
            nrm = np.cross(P[1] - P[0], P[2] - P[0])
            if np.linalg.norm(nrm) < 1e-9 and len(P) > 3:
                nrm = np.cross(P[2] - P[0], P[3] - P[0])
            ln = np.linalg.norm(nrm)
            if ln < 1e-9:
                continue
            nrm /= ln
            tris = [(0, i, i + 1) for i in range(1, len(P) - 1)]
            if abs(nrm[1]) < 0.35:  # wall
                t = np.array([-nrm[2], 0.0, nrm[0]])
                t /= np.linalg.norm(t) + 1e-12
                u = P @ t
                uv = np.stack([u - u.min(), P[:, 1] - base], 1)
                tgt_v, tgt_uv, tgt_c, tgt_f = wall_v, wall_uv, wall_c, wall_f
            else:
                if nrm[1] < 0:  # floor / underside: drop
                    continue
                uv = np.stack([P[:, 0], P[:, 2]], 1)
                tgt_v, tgt_uv, tgt_c, tgt_f = roof_v, roof_uv, roof_c, roof_f
            off = sum(len(x) for x in tgt_v)
            tgt_v.append(P)
            tgt_uv.append(uv)
            tgt_c.append(np.repeat(tint[None], len(P), 0))
            tgt_f.extend((off + a, off + b, off + c) for a, b, c in tris)

    def mesh(v, uv, c, f, name):
        V = np.vstack(v).astype(np.float32)
        m = trimesh.Trimesh(vertices=V, faces=np.array(f), process=False)
        m.visual = trimesh.visual.TextureVisuals(uv=np.vstack(uv).astype(np.float32))
        m.vertex_normals  # noqa: B018 - force flat-ish normals to be computed
        m.metadata["name"] = name
        # vertex colours as a custom attribute (three's GLTFLoader reads COLOR_0)
        m.vertex_attributes["color"] = np.clip(np.vstack(c) * 255, 0, 255).astype(np.uint8)
        return m

    scene = trimesh.Scene()
    scene.add_geometry(mesh(wall_v, wall_uv, wall_c, wall_f, "walls"), node_name="walls", geom_name="walls")
    scene.add_geometry(mesh(roof_v, roof_uv, roof_c, roof_f, "roofs"), node_name="roofs", geom_name="roofs")
    scene.export(OUT / "buildings.glb")
    print("buildings", n_bld, "wall tris", len(wall_f), "roof tris", len(roof_f))


def build_trees():
    """Street/park trees from OSM, heights and crown sizes from surface minus terrain."""
    dtm = np.load(WORK / "dtm_1m.npy")
    dsm = np.load(WORK / "dsm_1m.npy")
    chm = dsm - dtm
    osm = json.loads((ROOT / "data" / "raw" / "osm.json").read_text(encoding="utf-8"))
    trees = []
    for el in osm["elements"]:
        t = el.get("tags", {})
        if el["type"] != "node" or t.get("natural") != "tree":
            continue
        e, n = area.wgs_to_lv95(el["lon"], el["lat"])
        c, r = int(e - BX0), int(BY1 - n)
        if not (2 <= c < GRID_W - 2 and 2 <= r < GRID_H - 2):
            continue
        win = chm[r - 3:r + 4, c - 3:c + 4]
        h = float(np.clip(np.percentile(win, 95), 4.0, 32.0))
        # crown radius: how far the canopy stays above 40 % of the tree height
        rad = 2.0
        for k in range(2, 10):
            ring = chm[max(r - k, 0):r + k + 1, max(c - k, 0):c + k + 1]
            if (ring > 0.4 * h).mean() < 0.55:
                break
            rad = k
        x, z = area.lv95_to_world(e, n)
        trees.append([round(x, 2), round(float(dtm[r, c] - area.LAKE_LEVEL_M), 2), round(z, 2),
                      round(h, 1), float(rad), t.get("genus") or t.get("species") or t.get("leaf_type") or ""])
    print("trees", len(trees))
    return trees


def build_osm():
    """Bridges (decks over water) and a walk-blocking mask from OSM building footprints."""
    from PIL import ImageDraw
    from shapely.geometry import LineString, Polygon
    from shapely.ops import unary_union

    osm = json.loads((ROOT / "data" / "raw" / "osm.json").read_text(encoding="utf-8"))
    dtm = np.load(WORK / "dtm_1m.npy")
    water = np.array(Image.open(OUT / "water.png")) > 127

    def lv(geom):
        return [area.wgs_to_lv95(p["lon"], p["lat"]) for p in geom]

    # --- bridges -------------------------------------------------------------
    shapes = []
    for el in osm["elements"]:
        t = el.get("tags", {})
        if el["type"] != "way":
            continue
        pts = lv(el["geometry"])
        if t.get("man_made") == "bridge" and len(pts) >= 4:
            shapes.append(Polygon(pts).buffer(0))
        elif t.get("bridge") and t.get("bridge") != "no" and (t.get("highway") or t.get("railway")):
            try:
                w = float(str(t.get("width", "")).split()[0])
            except (ValueError, IndexError):
                w = {"primary": 14, "secondary": 12, "tertiary": 10, "footway": 3,
                     "cycleway": 3}.get(t.get("highway"), 6)
            shapes.append(LineString(pts).buffer(w / 2, cap_style=2, join_style=2))
    merged = unary_union(shapes)
    polys = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    bridges = []
    for p in polys:
        p = p.simplify(0.3)
        if p.area < 20:
            continue
        # deck surface: a plane fitted to the terrain on the dry ends, so the deck meets the road
        ring = np.array(p.exterior.coords)
        samples = []
        for e, n in np.array(p.buffer(1.5).exterior.coords):
            c, r = int(e - BX0), int(BY1 - n)
            if 0 <= c < GRID_W and 0 <= r < GRID_H and not water[r, c]:
                x, z = area.lv95_to_world(e, n)
                samples.append((x, z, dtm[r, c] - area.LAKE_LEVEL_M))
        if len(samples) >= 3:
            S = np.array(samples)
            A = np.c_[np.ones(len(S)), S[:, 0], S[:, 1]]
            coef, *_ = np.linalg.lstsq(A, S[:, 2], rcond=None)
            # one end only, or a noisy fit steeper than any real deck: keep it level
            if (np.ptp(S[:, 0]) < 3 and np.ptp(S[:, 1]) < 3) or max(abs(coef[1]), abs(coef[2])) > 0.06:
                coef = np.array([float(np.median(S[:, 2])), 0.0, 0.0])
        else:
            coef = np.array([3.0, 0.0, 0.0])
        y = float(np.median([coef[0] + coef[1] * x + coef[2] * z for x, z, _ in samples])) if samples else 3.0
        pts = [[round(a, 2), round(b, 2)] for a, b in (area.lv95_to_world(e, n) for e, n in ring)]
        bridges.append({"pts": pts, "y": round(y, 2), "plane": [round(float(v), 6) for v in coef]})
    print("bridges", len(bridges))

    # --- building footprints -> blocked mask ------------------------------------
    img = Image.new("L", (GRID_W, GRID_H), 0)
    dr = ImageDraw.Draw(img)
    nb = 0
    for el in osm["elements"]:
        t = el.get("tags", {})
        if el["type"] != "way" or "building" not in t or t.get("building") in ("roof", "no"):
            continue
        if t.get("layer", "0").startswith("-") or t.get("location") == "underground":
            continue
        pts = [(e - BX0, BY1 - n) for e, n in lv(el["geometry"])]
        if len(pts) >= 3:
            dr.polygon(pts, fill=255)
            nb += 1
    img.save(OUT / "blocked.png", optimize=True)
    print("footprints", nb)
    return bridges


def quay_spawn():
    """Walk from the Horloge Fleurie toward the Jet d'Eau and stop 5 m before the water."""
    water = np.array(Image.open(OUT / "water.png")) > 127
    blocked = np.array(Image.open(OUT / "blocked.png")) > 127
    sx, sz = area.wgs_to_world(6.15055, 46.20445)
    jx, jz = area.wgs_to_world(6.155949, 46.207430)
    gx0, gz0 = area.lv95_to_world(BX0, BY1)
    d = np.array([jx - sx, jz - sz]); d /= np.linalg.norm(d)
    last = (sx, sz)
    for t in np.arange(0, 600, 0.5):
        x, z = sx + d[0] * t, sz + d[1] * t
        c, r = int(x - gx0), int(z - gz0)
        if water[r, c]:
            break
        if not blocked[r, c]:
            last = (x - d[0] * 5, z - d[1] * 5)
    return {"x": round(float(last[0]), 1), "z": round(float(last[1]), 1)}


def landmarks():
    jx, jz = area.wgs_to_world(6.155949, 46.207430)  # Jet d'Eau nozzle (OSM node 60018172)
    return {"jet_d_eau": {"x": round(jx, 2), "z": round(jz, 2), "height": 140}}


def write_world_json(trees, bridges):
    gx0, gz0 = area.lv95_to_world(BX0, BY1)  # top-left (north-west) corner
    meta = {
        "grid": {"w": GRID_W, "h": GRID_H, "x0": gx0, "z0": gz0, "cell": 1.0,
                 "height_base": HEIGHT_BASE - area.LAKE_LEVEL_M, "height_scale": 0.001},
        "lake_level_m": area.LAKE_LEVEL_M,
        "origin_lv95": area.ORIGIN_LV95,
        "trees": trees,
        "bridges": bridges,
        "landmarks": landmarks(),
        # Jardin Anglais quay, by the Horloge Fleurie, facing the Jet d'Eau
        "spawn": quay_spawn(),
    }
    (OUT / "world.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    print("world.json written")


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    steps = set(sys.argv[1:]) or {"terrain", "ortho", "buildings", "osm"}
    if "terrain" in steps:
        build_terrain()
    if "ortho" in steps:
        build_ortho()
    if "buildings" in steps:
        build_buildings()
    if "trees" in steps or "osm" in steps:
        write_world_json(build_trees(), build_osm())


if __name__ == "__main__":
    main()
