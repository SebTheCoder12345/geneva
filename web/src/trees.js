// Street and park trees at their OSM positions, sized from the swisstopo canopy height model.
// Near the viewer: a full broadleaf model (Poly Haven, CC0, reduced in Blender), instanced.
// Further out: cheap leaf-card crowns.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mulberry } from './ground.js';

const NEAR_R = 55, NEAR_MAX = 45;
import { DETAIL_LAYER } from './lake.js';

export async function loadTreeModel(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const mat = o.material;
    // the source packs AO/roughness/metal in one map; the metal channel made leaves mirror the sky
    mat.metalnessMap = null; mat.metalness = 0;
    if (/leaves/i.test(mat.name)) {
      mat.side = THREE.DoubleSide;
      mat.roughnessMap = null; mat.roughness = 0.8;
      mat.color.setRGB(0.78, 0.95, 0.62);   // fresher mid-green, closer to plane-tree leaves
      mat.onBeforeCompile = (sh) => {
        // light coming through the leaves
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.10;`);
      };
    } else {
      mat.color.setRGB(1.25, 1.2, 1.05);    // paler bark, like plane trees
    }
    parts.push({ geo, mat });
  });
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  return { parts, height: size.y, width: Math.max(size.x, size.z) };
}

export function createTrees(world, quality, model) {
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
  if (!model) return { group: g, update() {} };

  // full models for the nearest trees, re-picked as the viewer moves
  const farTrunk = [], farCrown = [];
  for (let i = 0; i < n; i++) {
    trunks.getMatrixAt(i, m); farTrunk.push(m.clone());
    crowns.getMatrixAt(i, m); farCrown.push(m.clone());
  }
  const nearMeshes = model.parts.map(({ geo, mat }) => {
    const im = new THREE.InstancedMesh(geo, mat, NEAR_MAX);
    im.castShadow = true; im.receiveShadow = true; im.count = 0;
    im.frustumCulled = false;
    im.layers.set(DETAIL_LAYER);   // not drawn into the water reflection
    g.add(im);
    return im;
  });
  const nearMat = list.map(([x, , z, h, r], i) => {
    const y = world.terrainHeight(x, z);
    const sy = h / model.height;
    const sxz = THREE.MathUtils.clamp((Math.max(r, 3) * 2.2) / model.width, sy * 0.6, sy * 1.3);
    const rq = new THREE.Quaternion().setFromAxisAngle(up, (i * 2.3999) % (Math.PI * 2));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.1, z), rq, new THREE.Vector3(sxz, sy, sxz));
  });
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let lastX = Infinity, lastZ = Infinity;
  function update(cam) {
    if (Math.hypot(cam.x - lastX, cam.z - lastZ) < 4) return;
    lastX = cam.x; lastZ = cam.z;
    const near = [];
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(list[i][0] - cam.x, list[i][2] - cam.z);
      if (d < NEAR_R && cam.y < 80) near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    near.length = Math.min(near.length, NEAR_MAX);
    const isNear = new Set(near.map(([, i]) => i));
    for (let i = 0; i < n; i++) {
      trunks.setMatrixAt(i, isNear.has(i) ? zero : farTrunk[i]);
      crowns.setMatrixAt(i, isNear.has(i) ? zero : farCrown[i]);
    }
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
    for (const im of nearMeshes) {
      near.forEach(([, i], k) => im.setMatrixAt(k, nearMat[i]));
      im.count = near.length;
      im.instanceMatrix.needsUpdate = true;
    }
  }
  return { group: g, update };
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
