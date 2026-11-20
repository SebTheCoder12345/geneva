"""Download OpenStreetMap data for the Rade de Genève area via Overpass.

Output: data/raw/osm.json  (Overpass JSON with geometry)
Data (c) OpenStreetMap contributors, ODbL.
"""
import json
import pathlib
import sys

import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from area import BBOX_WGS84  # noqa: E402

S, W, N, E = BBOX_WGS84
QUERY = f"""
[out:json][timeout:180];
(
  way({S},{W},{N},{E});
  relation["type"="multipolygon"]({S},{W},{N},{E});
  relation["building"]({S},{W},{N},{E});
  node["natural"="tree"]({S},{W},{N},{E});
  node["highway"]({S},{W},{N},{E});
  node["amenity"]({S},{W},{N},{E});
  node["man_made"]({S},{W},{N},{E});
  node["leisure"]({S},{W},{N},{E});
  node["tourism"]({S},{W},{N},{E});
);
out geom tags;
"""

ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def main():
    out = ROOT / "data" / "raw" / "osm.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for url in ENDPOINTS:
        try:
            r = requests.post(url, data={"data": QUERY}, timeout=240,
                              headers={"User-Agent": "geneva-explorable/0.1"})
            r.raise_for_status()
            d = r.json()
            out.write_text(json.dumps(d), encoding="utf-8")
            kinds = {}
            for el in d["elements"]:
                kinds[el["type"]] = kinds.get(el["type"], 0) + 1
            print("saved", out, kinds)
            return
        except Exception as e:  # try the next mirror
            last = e
            print("failed", url, e)
    raise SystemExit(f"all Overpass endpoints failed: {last}")


if __name__ == "__main__":
    main()
