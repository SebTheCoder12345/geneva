// swissBUILDINGS3D massing with a procedural Geneva facade until photo facades replace it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const UV_FLIPPED = true;

export async function loadBuildings(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const group = new THREE.Group();
  group.name = 'buildings';
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    // trimesh writes custom vertex attributes as _COLOR; accept either spelling
    const col = geo.getAttribute('_color') || geo.getAttribute('_COLOR') || geo.getAttribute('color');
    if (col) {
      // trimesh writes RGBA bytes without the normalized flag: convert to linear RGB floats
      const n = col.count, rgb = new Float32Array(n * 3), c = new THREE.Color();
      const scale = col.array instanceof Uint8Array && !col.normalized ? 1 / 255 : 1;
      for (let i = 0; i < n; i++) {
        c.setRGB(col.getX(i) * scale, col.getY(i) * scale, col.getZ(i) * scale, THREE.SRGBColorSpace);
        rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b;
      }
      geo.deleteAttribute('_color');
      geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    }
    geo.computeVertexNormals();
    // facade metres (u along wall, v up). trimesh flips V on export; undo it here.
    const uv = geo.getAttribute('uv');
    if (uv) {
      const a = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) { a[i * 2] = uv.getX(i); a[i * 2 + 1] = UV_FLIPPED ? 1 - uv.getY(i) : uv.getY(i); }
      geo.setAttribute('facadeUV', new THREE.BufferAttribute(a, 2));
    }
    const isRoof = /roof/i.test(o.name) || /roof/i.test(o.parent?.name || '');
    const mesh = new THREE.Mesh(geo, isRoof ? roofMaterial() : wallMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = isRoof ? 'roofs' : 'walls';
    group.add(mesh);
  });
  return group;
}

function wallMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 facadeUV; varying vec2 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facadeUV;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFacade;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          // facade metres: x along the wall, y above the building's lowest point
          vec2 f = vFacade;
          float ground = 4.4, storey = 3.25, bay = 2.75;
          float isGround = step(f.y, ground);
          float fy = isGround > 0.5 ? f.y : mod(f.y - ground, storey);
          float bx = mod(f.x, bay);
          float bayId = floor(f.x / bay), floorId = floor((f.y - ground) / storey);
          // upper floors: tall French windows; ground floor: shop fronts
          float wx0 = 0.75, wx1 = 2.0, wy0 = 0.85, wy1 = 2.75;
          float gx0 = 0.25, gx1 = 2.5, gy0 = 0.35, gy1 = 3.6;
          float x0 = mix(wx0, gx0, isGround), x1 = mix(wx1, gx1, isGround);
          float y0 = mix(wy0, gy0, isGround), y1 = mix(wy1, gy1, isGround);
          float inX = step(x0, bx) * step(bx, x1), inY = step(y0, fy) * step(fy, y1);
          float win = inX * inY;
          float frame = win * (1.0 - step(x0 + 0.08, bx) * step(bx, x1 - 0.08) * step(y0 + 0.08, fy) * step(fy, y1 - 0.08));
          // mullion in the middle of French windows
          float mull = win * (1.0 - isGround) * (1.0 - step(0.035, abs(bx - 0.5 * (x0 + x1))));
          // string course between floors and a darker plinth
          float course = (1.0 - isGround) * (1.0 - step(0.18, fy)) + step(abs(f.y - ground), 0.22);
          float plinth = 1.0 - step(0.6, f.y);
          vec3 stone = diffuseColor.rgb;
          stone *= 0.94 + 0.10 * h21(vec2(bayId, floorId));
          stone = mix(stone, stone * 0.86, course * 0.8);
          stone = mix(stone, stone * 0.7, plinth);
          float shut = step(0.55, h21(vec2(bayId * 3.1, floorId + 7.0))) * (1.0 - isGround);
          vec3 glass = mix(vec3(0.05, 0.06, 0.07), vec3(0.11, 0.10, 0.09), h21(vec2(bayId, floorId) + 3.0));
          glass = mix(glass, vec3(0.30, 0.31, 0.29), shut * 0.35);  // half-open blinds / curtains
          vec3 c = mix(stone, glass, win);
          c = mix(c, vec3(0.86, 0.85, 0.82), max(frame, mull));
          diffuseColor.rgb = c;
          roughnessFactor = mix(roughnessFactor, 0.08, win * (1.0 - max(frame, mull)));
        }`);
  };
  return m;
}

function roofMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x6b6e70, roughness: 0.7, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= 0.85 + 0.15 * vColor.r;`);
  };
  m.vertexColors = true;
  return m;
}
