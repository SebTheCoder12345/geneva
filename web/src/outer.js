// Surroundings: a 16 x 14 km mid ring (swisstopo) and a 100 km far ring (Copernicus) so the
// lake runs to the horizon and the Salève, Jura and Alps stand where they should.
import * as THREE from 'three';

const EARTH_R = 6371000, REFRACTION = 0.13;

export async function loadOuter(base, world, quality) {
  const meta = await (await fetch(base + 'outer.json')).json();
  const enc = meta.encoding;
  const [midBuf, farBuf, midOrtho] = await Promise.all([
    fetch(base + 'mid.bin').then(r => r.arrayBuffer()),
    fetch(base + 'far.bin').then(r => r.arrayBuffer()),
    new THREE.TextureLoader().loadAsync(base + 'mid_ortho.jpg'),
  ]);
  midOrtho.colorSpace = THREE.SRGBColorSpace;
  const decode = (buf) => {
    const u = new Uint16Array(buf), h = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) h[i] = enc.base_m + u[i] * enc.scale - enc.lake_level_m;
    return h;
  };
  const g = world.g;
  const inner = [g.x0 + 4, g.z0 + 4, g.x0 + g.w * g.cell - 4, g.z0 + g.h * g.cell - 4];

  const mid = gridMesh(meta.mid, decode(midBuf), {
    step: quality.midStep, hole: inner, drop: 1.0, uv: true,
  });
  const midMat = new THREE.MeshStandardMaterial({ map: midOrtho, roughness: 0.95 });
  hazeMaterial(midMat);
  const midMesh = new THREE.Mesh(mid, midMat);
  midMesh.receiveShadow = false;
  midMesh.name = 'mid';

  const m = meta.mid;
  const midBox = [m.x0 + m.cell * 2, m.z0 + m.cell * 2, m.x0 + (m.w - 3) * m.cell, m.z0 + (m.h - 3) * m.cell];
  const far = gridMesh(meta.far, decode(farBuf), { step: quality.midStep, hole: midBox, drop: 4.0, colors: true, curvature: true });
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  hazeMaterial(farMat);
  const farMesh = new THREE.Mesh(far, farMat);
  farMesh.name = 'far';

  const group = new THREE.Group();
  group.add(midMesh, farMesh);
  return { group, meta };
}

function gridMesh(m, H, opt) {
  const s = opt.step || 1;
  const nx = Math.floor((m.w - 1) / s) + 1, nz = Math.floor((m.h - 1) / s) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const uv = opt.uv ? new Float32Array(nx * nz * 2) : null;
  const col = opt.colors ? new Float32Array(nx * nz * 3) : null;
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const gi = i * s, gj = j * s, k = j * nx + i;
    const x = m.x0 + gi * m.cell, z = m.z0 + gj * m.cell;
    let y = H[gj * m.w + gi] - opt.drop;
    const elevation = y;
    if (opt.colors && elevation < -2) y = -0.4;  // far lake surface, drawn by this mesh
    if (opt.curvature) y -= (x * x + z * z) / (2 * EARTH_R) * (1 - REFRACTION);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    if (uv) { uv[k * 2] = gi / (m.w - 1); uv[k * 2 + 1] = 1 - gj / (m.h - 1); }
    if (col) {
      const a = elevation + 372;  // metres above sea level
      if (a < 380) c.setRGB(0.10, 0.18, 0.22);
      else if (a < 900) c.setRGB(0.20, 0.24, 0.14);       // farmland and forest
      else if (a < 1700) c.setRGB(0.15, 0.20, 0.12);      // forested slopes (Salève, Jura)
      else if (a < 2600) c.setRGB(0.36, 0.35, 0.32);      // rock and alpine meadow
      else c.setRGB(0.92, 0.94, 0.97);                    // snow and glaciers
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  const idx = [];
  const inHole = (k) => {
    const x = pos[k * 3], z = pos[k * 3 + 2], h = opt.hole;
    return x > h[0] && x < h[2] && z > h[1] && z < h[3];
  };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
    if (inHole(a) && inHole(b) && inHole(cc) && inHole(d)) continue;
    idx.push(a, cc, b, b, cc, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Aerial perspective for distant land: blue-grey haze that grows with distance, independent of
// the near-field fog so the Alps can still read faintly at 70 km.
export const HAZE = { color: new THREE.Color(0x9fb3c6), distance: 22000 };
export function hazeMaterial(mat) {
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.hazeColor = { value: HAZE.color };
    sh.uniforms.hazeDist = { value: HAZE.distance };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec3 hazeColor; uniform float hazeDist;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float d = length(vWP - cameraPosition);
        float hz = 1.0 - exp(-d / hazeDist);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, clamp(hz, 0.0, 0.92));`);
  };
}
