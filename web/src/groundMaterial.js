// Ground material shared by the terrain and the bridge decks.
// Six tiled PBR surfaces (Poly Haven, CC0) placed by an OSM-derived class map, road paint picked
// out of the 10 cm aerial photo, and the aerial photo itself taking over with distance.
import * as THREE from 'three';

// order matches tools/build_ground.py: asphalt, sidewalk, grass, gravel, setts, stone slabs
const TILE_M = [3.0, 2.35, 2.0, 2.1, 2.0, 2.0];
const LAYERS = 6;

export async function loadGroundTextures(base, renderer) {
  const load = (u) => new THREE.TextureLoader().loadAsync(base + u);
  const [albedo, nr, classA, classB, marks] = await Promise.all([
    loadArray(base + 'ground/albedo.jpg', true, renderer),
    loadArray(base + 'ground/normal_rough.jpg', false, renderer),
    load('ground/classA.png'), load('ground/classB.png'), load('ground/marks.png'),
  ]);
  for (const t of [classA, classB, marks]) {
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.anisotropy = 8;
  }
  return { albedo, nr, classA, classB, marks };
}

async function loadArray(url, srgb, renderer) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const size = img.width;
  const c = document.createElement('canvas');
  c.width = size; c.height = size * LAYERS;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = new Uint8Array(ctx.getImageData(0, 0, size, size * LAYERS).data.buffer);
  const t = new THREE.DataArrayTexture(data, size, size, LAYERS);
  t.format = THREE.RGBAFormat;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.needsUpdate = true;
  return t;
}

export function createGroundMaterial(world, ortho, tex) {
  const mu = world.maskUniforms();
  const mat = new THREE.MeshStandardMaterial({ map: ortho, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      gridOrigin: { value: mu.gridOrigin }, gridSize: { value: mu.gridSize },
      classA: { value: tex.classA }, classB: { value: tex.classB }, marks: { value: tex.marks },
      albedoArr: { value: tex.albedo }, nrArr: { value: tex.nr },
      tileM: { value: TILE_M },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform vec2 gridOrigin; uniform vec2 gridSize;
        uniform sampler2D classA, classB, marks;
        uniform sampler2DArray albedoArr, nrArr;
        uniform float tileM[${LAYERS}];
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <map_fragment>', `
        vec2 gUV = (vWPos.xz - gridOrigin) / gridSize;
        vec2 cUV = vec2(gUV.x, 1.0 - gUV.y);
        vec3 photo = texture2D(map, cUV).rgb;   // sRGB-decoded by three
        vec3 wa = texture2D(classA, cUV).rgb, wb = texture2D(classB, cUV).rgb;
        float w[${LAYERS}];
        w[0] = wa.r; w[1] = wa.g; w[2] = wa.b; w[3] = wb.r; w[4] = wb.g; w[5] = wb.b;
        float wsum = 0.0;
        for (int i = 0; i < ${LAYERS}; i++) wsum += w[i];
        float dist = length(vWPos - cameraPosition);
        // two de-correlated samples per surface, mixed by a slow noise, to hide tiling
        float n1 = gNoise(vWPos.xz * 0.11);
        float mixT = smoothstep(0.35, 0.65, n1);
        vec2 p2 = mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz + vec2(17.3, 5.1);
        vec3 gAlb = vec3(0.0); vec2 gN = vec2(0.0); float gRough = 0.0;
        for (int i = 0; i < ${LAYERS}; i++) {
          float wi = w[i] / max(wsum, 1e-3);
          if (wi < 0.01) continue;
          vec2 u1 = vWPos.xz / tileM[i], u2 = p2 / (tileM[i] * 1.37);
          vec3 a = mix(texture(albedoArr, vec3(u1, float(i))).rgb, texture(albedoArr, vec3(u2, float(i))).rgb, mixT);
          vec3 nr = mix(texture(nrArr, vec3(u1, float(i))).rgb, texture(nrArr, vec3(u2, float(i))).rgb, mixT);
          if (i == 2) {
            // lawns: keep the texture's detail, take the colour from the aerial photo
            float l = dot(a, vec3(0.3, 0.59, 0.11));
            a = photo * (l / 0.26) * 0.95;
          }
          gAlb += a * wi; gN += (nr.xy * 2.0 - 1.0) * wi; gRough += nr.z * wi;
        }
        // grime and patching: slow luminance variation
        float grime = 0.88 + 0.2 * gNoise(vWPos.xz * 0.35) * gNoise(vWPos.xz * 0.05 + 3.0);
        gAlb *= grime;
        // road paint from the aerial photo (0.2 m)
        vec3 mk = texture2D(marks, cUV).rgb;
        float white = smoothstep(0.25, 0.6, mk.r), yellow = smoothstep(0.25, 0.6, mk.g);
        gAlb = mix(gAlb, vec3(0.78, 0.78, 0.75), white * 0.9);
        gAlb = mix(gAlb, vec3(0.80, 0.62, 0.12), yellow * 0.9);
        gRough = mix(gRough, 0.6, max(white, yellow));
        gN *= 1.0 - 0.7 * max(white, yellow);
        // far away the aerial photo is the better picture of the ground
        float far = smoothstep(120.0, 600.0, dist);
        gAlb = mix(gAlb, photo, far);
        gN *= 1.0 - far;
        vec4 diffuseColor_ = vec4(gAlb, 1.0);
        diffuseColor.rgb *= diffuseColor_.rgb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(gRough, 0.95, far);')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 nw = normalize(vWNrm + vec3(gN.x, 0.0, gN.y) * 1.2);
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`);
  };
  return mat;
}
