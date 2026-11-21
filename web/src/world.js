// Loads the baked world data and answers spatial queries (ground height, walkability).
// World frame: +X east, +Y up, -Z north, metres; Y = 0 is the lake surface.
import * as THREE from 'three';

export async function loadWorld(base, onProgress) {
  const meta = await (await fetch(base + 'world.json')).json();
  onProgress?.(0.05, 'terrain');
  const buf = await (await fetch(base + 'terrain.bin')).arrayBuffer();
  const raw = new Uint16Array(buf);
  const g = meta.grid;
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = g.height_base + raw[i] * g.height_scale;

  const [water, blocked] = await Promise.all([loadMask(base + 'water.png'), loadMask(base + 'blocked.png')]);
  return new World(meta, heights, water, blocked);
}

async function loadMask(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const m = new Uint8Array(c.width * c.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
  return m;
}

export class World {
  constructor(meta, heights, water, blocked) {
    this.meta = meta;
    this.g = meta.grid;
    this.heights = heights;
    this.water = water;
    this.blocked = blocked;
    this.bridges = meta.bridges.map(b => ({ y: b.y, plane: b.plane || [b.y, 0, 0], pts: b.pts, box: bbox(b.pts) }));
  }
  get width() { return this.g.w; }
  get depth() { return this.g.h; }

  // fractional grid coords
  _gc(x, z) { return [(x - this.g.x0) / this.g.cell, (z - this.g.z0) / this.g.cell]; }

  terrainHeight(x, z) {
    const { w, h } = this.g;
    let [u, v] = this._gc(x, z);
    u = Math.min(Math.max(u, 0), w - 1.001);
    v = Math.min(Math.max(v, 0), h - 1.001);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const H = this.heights, k = j * w + i;
    const a = H[k], b = H[k + 1], c = H[k + w], d = H[k + w + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  _cell(mask, x, z) {
    const [u, v] = this._gc(x, z);
    const i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i >= this.g.w || j >= this.g.h) return -1;
    return mask[j * this.g.w + i];
  }

  bridgeAt(x, z) {
    for (const b of this.bridges) {
      if (x < b.box[0] || x > b.box[2] || z < b.box[1] || z > b.box[3]) continue;
      if (pointInPoly(x, z, b.pts)) return b;
    }
    return null;
  }

  // Height a walker stands on, or null if the spot is not walkable.
  groundAt(x, z, footY = Infinity) {
    const br = this.bridgeAt(x, z);
    if (br) {
      const by = deckY(br, x, z);
      if (by <= footY + 1.0) return by;
    }
    const inside = this._cell(this.water, x, z);
    if (inside === -1) return null;          // off the map
    if (inside === 1) return null;           // lake / river
    if (this._cell(this.blocked, x, z) === 1) return null;  // inside a building
    return this.terrainHeight(x, z);
  }

  // Ground under a flying camera (for not flying through the floor)
  floorAt(x, z) {
    const br = this.bridgeAt(x, z);
    const t = this._cell(this.water, x, z) === 1 ? 0 : this.terrainHeight(x, z);
    return br ? Math.max(deckY(br, x, z), t) : t;
  }

  // world-space UV for textures that cover the grid (north up, flipY = true)
  uvOf(x, z) {
    const [u, v] = this._gc(x, z);
    return [u / this.g.w, 1 - v / this.g.h];
  }

  maskUniforms() {
    return {
      gridOrigin: new THREE.Vector2(this.g.x0, this.g.z0),
      gridSize: new THREE.Vector2(this.g.w * this.g.cell, this.g.h * this.g.cell),
    };
  }
}

function deckY(b, x, z) { return b.plane[0] + b.plane[1] * x + b.plane[2] * z; }

function bbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of pts) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
  return [a, b, c, d];
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
