"""Download swisstopo open data covering the play area.

Source: Federal Office of Topography swisstopo (free geodata, OGD). Attribution: "© swisstopo".
Output: data/raw/swisstopo/<filename>
"""
import pathlib
import sys

import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from area import BBOX_WGS84  # noqa: E402

API = "https://data.geo.admin.ch/api/stac/v1/collections/{}/items"

# (collection, item-id must contain, asset filename must contain)
WANTED = [
    ("ch.swisstopo.swissbuildings3d_2", "2021-09_1301-13", ".dxf.zip"),
    ("ch.swisstopo.swissalti3d", "_2021_", "_0.5_2056_5728.tif"),
    ("ch.swisstopo.swisssurface3d-raster", "_2025_", "_0.5_2056_5728.tif"),
    ("ch.swisstopo.swissimage-dop10", "_2026_", "_0.1_2056.tif"),
]


def items(col):
    s, w, n, e = BBOX_WGS84
    url, params = API.format(col), {"bbox": f"{w},{s},{e},{n}", "limit": 100}
    while url:
        d = requests.get(url, params=params, timeout=60).json()
        yield from d["features"]
        url = next((l["href"] for l in d["links"] if l["rel"] == "next"), None)
        params = None


def download(href, dest):
    if dest.exists() and dest.stat().st_size > 0:
        print("have", dest.name)
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(href, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.rename(dest)
    print("got", dest.name, round(dest.stat().st_size / 1e6, 1), "MB")


def main():
    out = ROOT / "data" / "raw" / "swisstopo"
    out.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1:]  # optional filter on collection substring
    for col, item_key, asset_key in WANTED:
        if only and not any(o in col for o in only):
            continue
        for f in items(col):
            if item_key not in f["id"]:
                continue
            for a in f["assets"].values():
                name = a["href"].split("/")[-1]
                if asset_key in name:
                    download(a["href"], out / name)


if __name__ == "__main__":
    main()
