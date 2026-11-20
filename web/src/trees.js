// Street and park trees at their OSM positions, sized from the swisstopo canopy height model.
// Stand-in until Blender-made London plane / horse chestnut models replace it.
import * as THREE from 'three';
import { mulberry } from './ground.js';

export function createTrees(world, quality) {
  const list = world.meta.trees;  // [x, y, z, height, crownRadius, genus]
  const rnd = mulberry(5);
  const leafTex = makeLeafTexture();

  // trunk: tapered cylinder, unit height (scaled per instance)
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.17, 1, 7, 1, true).translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b8574, roughness: 0.95 });
  // crown: a cloud of leaf cards inside a unit sphere
  const crownGeo = makeCrownGeometry(quality.leafCards, rnd);
  const crownMat = new THREE.MeshStandardMaterial({
    map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0,
  });
  // soften the lighting through the leaves (cheap translucency)
  crownMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.12;`);
  };

  const n = list.length;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const [x, , z, h, r] = list[i];
    const y = world.terrainHeight(x, z);
    const crownR = Math.max(2.2, Math.min(r, h * 0.45));
    const trunkH = h * 0.55;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m.compose(p.set(x, y - 0.2, z), q, s.set(1 + h / 30, trunkH, 1 + h / 30));
    trunks.setMatrixAt(i, m);
    m.compose(p.set(x, y + h - crownR * 0.95, z), q, s.set(crownR, crownR * 0.9, crownR));
    crowns.setMatrixAt(i, m);
    col.setHSL(0.24 + rnd() * 0.05, 0.38 + rnd() * 0.15, 0.27 + rnd() * 0.08);
    crowns.setColorAt(i, col);
  }
  for (const im of [trunks, crowns]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
  }
  crowns.instanceColor.needsUpdate = true;
  const g = new THREE.Group();
  g.name = 'trees';
  g.add(trunks, crowns);
  return g;
}

function makeCrownGeometry(count, rnd) {
  const positions = [], uvs = [], normals = [], index = [];
  const v = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // point in sphere, biased to the shell so the crown has a readable silhouette
    do { v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (v.lengthSq() > 1);
    v.normalize().multiplyScalar(0.55 + 0.45 * Math.cbrt(rnd()));
    nrm.copy(v).normalize();
    const size = 0.55 + rnd() * 0.35;
    // card facing roughly outward with random roll
    const t = new THREE.Vector3().crossVectors(nrm, Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const b = new THREE.Vector3().crossVectors(nrm, t).normalize();
    const roll = rnd() * Math.PI * 2;
    const tt = t.clone().multiplyScalar(Math.cos(roll)).addScaledVector(b, Math.sin(roll)).multiplyScalar(size);
    const bb = new THREE.Vector3().crossVectors(nrm, tt).normalize().multiplyScalar(size);
    const base = positions.length / 3;
    for (const [a, c, u, w] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      positions.push(v.x + tt.x * a + bb.x * c, v.y + tt.y * a + bb.y * c, v.z + tt.z * a + bb.z * c);
      normals.push(nrm.x, nrm.y, nrm.z);  // sphere normals: soft, rounded crown shading
      uvs.push(u, w);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

function makeLeafTexture() {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const rnd = mulberry(23);
  ctx.clearRect(0, 0, n, n);
  // a cluster of maple-like leaves (plane trees dominate the quays)
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * n * 0.4;
    const x = n / 2 + Math.cos(a) * r, y = n / 2 + Math.sin(a) * r;
    const s = n * (0.05 + rnd() * 0.04);
    const l = 70 + rnd() * 90;
    ctx.fillStyle = `rgb(${l * 0.85 | 0},${l | 0},${l * 0.55 | 0})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI * 2);
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2;
      const rr = s * (k % 2 ? 0.55 : 1.0);
      ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
