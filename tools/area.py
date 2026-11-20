"""Shared definition of the playable area and the local coordinate frame.

World frame (three.js): metres, +X = east, +Y = up, -Z = north.
Origin = ORIGIN_LV95 (Swiss LV95 / EPSG:2056), placed near the Pont du Mont-Blanc
south abutment so numbers near the action stay small.
Y = 0 is the lake surface as flown in swissALTI3D 2021 (372.12 m, LN02).
"""
from pyproj import Transformer

# south, west, north, east (WGS84)
BBOX_WGS84 = (46.2000, 6.1420, 46.2130, 6.1620)

LAKE_LEVEL_M = 372.12

_to_lv95 = Transformer.from_crs("EPSG:4326", "EPSG:2056", always_xy=True)
_to_wgs = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)

# Pont du Mont-Blanc, south (Jardin Anglais) end, approx.
ORIGIN_WGS84 = (6.14820, 46.20520)  # lon, lat
ORIGIN_LV95 = tuple(round(v) for v in _to_lv95.transform(*ORIGIN_WGS84))


def wgs_to_lv95(lon, lat):
    return _to_lv95.transform(lon, lat)


def lv95_to_wgs(e, n):
    return _to_wgs.transform(e, n)


def wgs_to_world(lon, lat):
    """Return (x, z) in the three.js world frame."""
    e, n = _to_lv95.transform(lon, lat)
    return e - ORIGIN_LV95[0], -(n - ORIGIN_LV95[1])


def lv95_to_world(e, n):
    return e - ORIGIN_LV95[0], -(n - ORIGIN_LV95[1])


def bbox_lv95():
    s, w, n, e = BBOX_WGS84
    pts = [_to_lv95.transform(x, y) for x, y in ((w, s), (e, s), (e, n), (w, n))]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


if __name__ == "__main__":
    print("origin LV95", ORIGIN_LV95)
    print("bbox LV95", bbox_lv95())
