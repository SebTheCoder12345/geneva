# Genève · Rade

An explorable recreation of Geneva's waterfront (Jardin Anglais, Pont du Mont-Blanc, the Rade and the Jet d'Eau) in three.js, built from open geodata.

- `tools/` Python pipeline: downloads swisstopo, OpenStreetMap and Copernicus data into `data/raw/` (not committed) and bakes web assets into `web/assets/`.
- `web/` the static site (no build step; three.js from a CDN via an import map). Deployed to GitHub Pages on every push to `main`.

## Rebuild the data

```
py -m venv .venv
.venv/Scripts/python -m pip install numpy pillow requests shapely pyproj ezdxf tifffile imagecodecs scipy trimesh
.venv/Scripts/python tools/fetch_osm.py
.venv/Scripts/python tools/fetch_swisstopo.py
.venv/Scripts/python tools/fetch_outer.py      # plus Copernicus tiles into data/raw/cop/
.venv/Scripts/python tools/build_world.py
.venv/Scripts/python tools/build_outer.py
.venv/Scripts/python tools/serve.py            # http://127.0.0.1:8765
```

URL options: `?q=low|high` quality, `?fps` frame counter, `?cam=x,y,z,yawDeg,pitchDeg` fixed camera.

Data © swisstopo, © OpenStreetMap contributors (ODbL), Copernicus DEM © DLR/Airbus. See `web/credits.html`.
