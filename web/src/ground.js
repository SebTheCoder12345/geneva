// Terrain (swissALTI3D heights, SWISSIMAGE colour), the lake and river, and bridge decks.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

export function createTerrain(world, mat, quality) {
  const step = quality.terrainStep;
  const g = world.g;
  const nx = Math.floor((g.w - 1) / step) + 1;
  const nz = Math.floor((g.h - 1) / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  let p = 0, q = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const gi = Math.min(i * step, g.w - 1), gj = Math.min(j * step, g.h - 1);
      const x = g.x0 + gi * g.cell, z = g.z0 + gj * g.cell;
      pos[p++] = x; pos[p++] = world.heights[gj * g.w + gi]; pos[p++] = z;
      uv[q++] = gi / (g.w - 1); uv[q++] = 1 - gj / (g.h - 1);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  return { mesh };
}

// midMask/midMeta: lake mask for the 16 x 14 km ring; beyond it the far terrain hides the water.
export function createWater(world, normalsTex, sunDir, quality, maskTex, midMask, midMeta) {
  normalsTex.wrapS = normalsTex.wrapT = THREE.RepeatWrapping;
  const water = new Water(new THREE.PlaneGeometry(20000, 20000), {
    textureWidth: quality.reflectionSize,
    textureHeight: quality.reflectionSize,
    waterNormals: normalsTex,
    sunDirection: sunDir.clone(),
    sunColor: 0xfff0d8,
    waterColor: 0x0f3d47,  // Léman: deep blue-green
    distortionScale: 1.6,
    fog: true,
    alpha: 1.0,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.0;
  water.material.uniforms.size.value = 3.2;
  const mu = world.maskUniforms();
  water.material.uniforms.gridOrigin = { value: mu.gridOrigin };
  water.material.uniforms.gridSize = { value: mu.gridSize };
  water.material.uniforms.waterMask = { value: maskTex };
  water.material.uniforms.midOrigin = { value: new THREE.Vector2(midMeta.x0, midMeta.z0) };
  water.material.uniforms.midSize = { value: new THREE.Vector2((midMeta.w - 1) * midMeta.cell, (midMeta.h - 1) * midMeta.cell) };
  water.material.uniforms.midMask = { value: midMask };
  water.material.fragmentShader = water.material.fragmentShader
    .replace('void main() {', `uniform vec2 gridOrigin; uniform vec2 gridSize; uniform sampler2D waterMask;
      uniform vec2 midOrigin; uniform vec2 midSize; uniform sampler2D midMask;
      void main() {
        vec2 mu = (worldPosition.xz - gridOrigin) / gridSize;
        vec2 mm = (worldPosition.xz - midOrigin) / midSize;
        bool inInner = all(greaterThan(mu, vec2(0.0))) && all(lessThan(mu, vec2(1.0)));
        bool inMid = all(greaterThan(mm, vec2(0.0))) && all(lessThan(mm, vec2(1.0)));
        if (inInner) { if (texture2D(waterMask, vec2(mu.x, 1.0 - mu.y)).r < 0.5) discard; }
        else if (inMid) { if (texture2D(midMask, vec2(mm.x, 1.0 - mm.y)).r < 0.5) discard; }
        else discard;  // beyond the mid ring the far terrain draws the (curved) lake`);
  water.name = 'water';
  return water;
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
