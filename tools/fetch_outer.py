"""Coarse terrain + aerial photo for the surroundings (far shores, Cologny, Salève).

swissALTI3D 2 m and SWISSIMAGE 2 m tiles over OUTER_LV95 (1 km tiles).
Output: data/raw/outer/<filename>.  © swisstopo.
"""
import concurrent.futures as cf
import pathlib
import sys

import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTDIR = ROOT / "data" / "raw" / "outer"

# LV95 km ranges (inclusive of start, exclusive of end): ~16 x 14 km around the Rade,
# reaching the Salève to the south-east. Only tiles inside Switzerland exist.
E_RANGE = range(2492, 2508)
N_RANGE = range(1110, 1124)

ALTI = "https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_{y}_{e}-{n}/swissalti3d_{y}_{e}-{n}_2_2056_5728.tif"
IMG = "https://data.geo.admin.ch/ch.swisstopo.swissimage-dop10/swissimage-dop10_{y}_{e}-{n}/swissimage-dop10_{y}_{e}-{n}_2_2056.tif"


def get(url, dest):
    if dest.exists():
        return "have"
    r = requests.get(url, timeout=60)
    if r.status_code != 200:
        return f"miss {r.status_code}"
    dest.write_bytes(r.content)
    return "got"


def job(kind, e, n):
    years = (2021, 2019, 2022, 2023, 2020) if kind == "alti" else (2026, 2023, 2020, 2024, 2025, 2022)
    for y in years:
        url = (ALTI if kind == "alti" else IMG).format(y=y, e=e, n=n)
        dest = OUTDIR / f"{kind}_{e}-{n}.tif"
        res = get(url, dest)
        if res in ("have", "got"):
            return f"{kind} {e}-{n} {y} {res}"
    return f"{kind} {e}-{n} none"


def main():
    OUTDIR.mkdir(parents=True, exist_ok=True)
    jobs = [(k, e, n) for k in ("alti", "img") for e in E_RANGE for n in N_RANGE]
    ok = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(lambda a: job(*a), jobs):
            ok += "none" not in res
    print("tiles available", ok, "of", len(jobs))


if __name__ == "__main__":
    sys.exit(main())
