// Terrain (swissALTI3D heights, SWISSIMAGE colour), the lake and river, and bridge decks.
import * as THREE from 'three';

export function createTerrain(world, mat, quality) {
  // Heights on the shoreline: water cells next to land take the land height, so terrain
  // triangles that straddle the shore stay flat up to the quay wall instead of sagging into
  // a staircase. The material then cuts the terrain exactly at the water line.
  const g = world.g, H = world.heights, W = world.water;
  const h = new Float32Array(H);
  const R = 3;
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const k = j * g.w + i;
    if (!W[k]) continue;
    let best = -Infinity;
    for (let dj = -R; dj <= R; dj++) {
      const jj = j + dj; if (jj < 0 || jj >= g.h) continue;
      for (let di = -R; di <= R; di++) {
        const ii = i + di; if (ii < 0 || ii >= g.w) continue;
        const kk = jj * g.w + ii;
        if (!W[kk] && H[kk] > best) best = H[kk];
      }
    }
    if (best > -Infinity) h[k] = best;
  }
  // land within 2 m of the water: level it up to the quay top so the coping sits on flat paving
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const k = j * g.w + i;
    if (W[k]) continue;
    let nearWater = false, best = H[k];
    for (let dj = -2; dj <= 2 && !nearWater; dj++) for (let di = -2; di <= 2; di++) {
      const jj = j + dj, ii = i + di;
      if (jj >= 0 && jj < g.h && ii >= 0 && ii < g.w && W[jj * g.w + ii]) { nearWater = true; break; }
    }
    if (!nearWater) continue;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const jj = j + dj, ii = i + di;
      if (jj >= 0 && jj < g.h && ii >= 0 && ii < g.w && !W[jj * g.w + ii]) best = Math.max(best, H[jj * g.w + ii]);
    }
    h[k] = Math.min(best, H[k] + 1.5);
  }

  // walkers, trees and props stand on the same leveled ground
  world.heights.set(h);

  // Tiles of ~128 m so the camera only draws what is in view
  const step = quality.terrainStep, TILE = 64 * step;
  const group = new THREE.Group();
  group.name = 'terrain';
  for (let tj = 0; tj < g.h - 1; tj += TILE) {
    for (let ti = 0; ti < g.w - 1; ti += TILE) {
      const i1 = Math.min(ti + TILE, g.w - 1), j1 = Math.min(tj + TILE, g.h - 1);
      const cols = [], rows = [];
      for (let i = ti; i < i1; i += step) cols.push(i);
      cols.push(i1);
      for (let j = tj; j < j1; j += step) rows.push(j);
      rows.push(j1);
      const nx = cols.length, nz = rows.length;
      const pos = new Float32Array(nx * nz * 3), nrm = new Float32Array(nx * nz * 3);
      let p = 0;
      const hAt = (i, j) => h[Math.min(Math.max(j, 0), g.h - 1) * g.w + Math.min(Math.max(i, 0), g.w - 1)];
      for (const j of rows) for (const i of cols) {
        // normals from the height field itself, so neighbouring tiles match at their seams
        const dx = (hAt(i + step, j) - hAt(i - step, j)) / (2 * step * g.cell);
        const dz = (hAt(i, j + step) - hAt(i, j - step)) / (2 * step * g.cell);
        const l = Math.hypot(dx, 1, dz);
        nrm[p] = -dx / l; nrm[p + 1] = 1 / l; nrm[p + 2] = -dz / l;
        pos[p++] = g.x0 + i * g.cell; pos[p++] = h[j * g.w + i]; pos[p++] = g.z0 + j * g.cell;
      }
      const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
      let k = 0;
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return { mesh: group };
}

export function createBridges(world, groundMat) {
  // Deck top uses the ground material (asphalt, paint) so it continues the road seamlessly;
  // the edges get a stone fascia down to 1.4 m below the deck.
  const group = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ color: 0xb8b1a3, roughness: 0.85 });
  for (const b of world.bridges) {
    const [a0, bx, bz] = b.plane;
    const yAt = (x, z) => a0 + bx * x + bz * z + 0.03;
    const shape = new THREE.Shape(b.pts.map(([x, z]) => new THREE.Vector2(x, z)));
    const top = new THREE.ShapeGeometry(shape);
    // ShapeGeometry lies in XY; move (x, y) -> world (x, z) and lift onto the deck plane
    const pa = top.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), z = pa.getY(i);
      pa.setXYZ(i, x, yAt(x, z), z);
    }
    top.index.array.reverse();  // keep faces pointing up after the axis swap
    top.computeVertexNormals();
    const deck = new THREE.Mesh(top, groundMat);
    deck.receiveShadow = true;
    deck.castShadow = true;
    group.add(deck);
    // fascia
    const pos = [];
    const pts = b.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const y1 = yAt(x1, z1), y2 = yAt(x2, z2);
      pos.push(x1, y1, z1, x2, y2, z2, x2, y2 - 1.4, z2, x1, y1, z1, x2, y2 - 1.4, z2, x1, y1 - 1.4, z1);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.computeVertexNormals();
    const fascia = new THREE.Mesh(sg, side);
    side.side = THREE.DoubleSide;
    fascia.castShadow = true;
    group.add(fascia);
  }
  group.name = 'bridges';
  return group;
}

function makeDetailTexture() {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  // value noise, tileable, two octaves
  const rnd = mulberry(11);
  const lat = (s) => { const a = new Float32Array(s * s); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const L1 = lat(32), L2 = lat(128);
  const samp = (L, s, x, y) => {
    const fx = x * s / n, fy = y * s / n, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const g = (a, b) => L[((b % s) + s) % s * s + ((a % s) + s) % s];
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (g(i, j) * (1 - su) + g(i + 1, j) * su) * (1 - sv) + (g(i, j + 1) * (1 - su) + g(i + 1, j + 1) * su) * sv;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 0.55 * samp(L1, 32, x, y) + 0.45 * samp(L2, 128, x, y);
    const o = (y * n + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
