// Stone quay walls along the shoreline: a vertical face from the quay top down below the
// waterline, with a coping stone along the top edge. Lines come from the water-mask contour
// (build_world.py); the side facing the water is found by sampling the mask.
import * as THREE from 'three';

const BOTTOM = -2.5, COPING_W = 0.45, COPING_H = 0.12, TILE = 2.0;

export async function createQuays(world, base, renderer) {
  const tl = new THREE.TextureLoader();
  const [diff, nr] = await Promise.all([tl.loadAsync(base + 'quay/stone_diff.jpg'), tl.loadAsync(base + 'quay/stone_nr.jpg')]);
  diff.colorSpace = THREE.SRGBColorSpace;
  for (const t of [diff, nr]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  // standard normal-map path (the strip's blue channel holds roughness; as a normal z it only
  // softens the bumps slightly)
  const wallMat = new THREE.MeshStandardMaterial({
    map: diff, normalMap: nr, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.9, color: 0xffffff, side: THREE.DoubleSide,
  });
  const copeMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.8, map: diff, side: THREE.DoubleSide });

  const wall = { pos: [], uv: [] }, cope = { pos: [], uv: [] };
  const quad = (o, a, b, c, d, ua, ub, va, vb) => {
    o.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    o.uv.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
  };
  for (const line of world.meta.quays || []) {
    let u = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, z1, t1] = line[i], [x2, z2, t2] = line[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (t1 === null || t2 === null || len < 0.01) { u += len; continue; }
      // outward normal = toward the water
      let nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      if (world._cell(world.water, mx + nx * 1.5, mz + nz * 1.5) !== 1) { nx = -nx; nz = -nz; }
      // face toward the water: winding so the front face looks outward
      const A = [x1, t1, z1], B = [x2, t2, z2], C = [x2, BOTTOM, z2], D = [x1, BOTTOM, z1];
      const u0 = u / TILE, u1 = (u + len) / TILE;
      quad(wall, A, B, C, D, u0, u1, t1 / TILE, BOTTOM / TILE);
      // coping: slightly proud of the wall, sitting on the quay top
      const ox = nx * 0.06, oz = nz * 0.06, ix = -nx * COPING_W, iz = -nz * COPING_W;
      const a = [x1 + ox, t1 + COPING_H, z1 + oz], b = [x2 + ox, t2 + COPING_H, z2 + oz];
      const c = [x2 + ix, t2 + COPING_H, z2 + iz], d = [x1 + ix, t1 + COPING_H, z1 + iz];
      const a2 = [x1 + ox, t1 - 0.05, z1 + oz], b2 = [x2 + ox, t2 - 0.05, z2 + oz];
      quad(cope, a, b, c, d, u0, u1, 0, 0.25);
      quad(cope, a2, b2, b, a, u0, u1, 0, 0.06);
      u += len;
    }
  }
  const mk = (o, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const group = new THREE.Group();
  group.name = 'quays';
  group.add(mk(wall, wallMat), mk(cope, copeMat));
  return group;
}
