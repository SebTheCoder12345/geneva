// The Jet d'Eau: ~500 l/s leaving the nozzle at ~200 km/h, rising to ~140 m.
// Each particle's path is closed-form (gravity + linear drag + wind), evaluated on the GPU,
// so the plume costs one draw call and no CPU work per frame.
import * as THREE from 'three';
import { mulberry } from './ground.js';

const G = 9.81;

export function createJet(world, sunDir, quality) {
  const L = world.meta.landmarks.jet_d_eau;
  const baseY = Math.max(world.terrainHeight(L.x, L.z), 0.5) + 0.6;
  const group = new THREE.Group();
  group.name = 'jet';

  const wind = new THREE.Vector3(1.6, 0, 0.9);  // light south-westerly, m/s (blows plume NE)
  group.add(makePlume(quality.jetParticles, L, baseY, wind, sunDir, 'core'));
  group.add(makePlume(Math.floor(quality.jetParticles * 0.6), L, baseY, wind, sunDir, 'spray'));
  return group;
}

function makePlume(count, L, baseY, wind, sunDir, kind) {
  const rnd = mulberry(kind === 'core' ? 3 : 9);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seed[i * 4] = rnd();      // phase in the cycle
    seed[i * 4 + 1] = rnd();  // spread angle
    seed[i * 4 + 2] = rnd();  // speed jitter
    seed[i * 4 + 3] = rnd();  // size jitter
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(L.x, 70, L.z), 200);

  const core = kind === 'core';
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 },
      origin: { value: new THREE.Vector3(L.x, baseY, L.z) },
      wind: { value: wind },
      sunDir: { value: sunDir },
      v0: { value: core ? 57.0 : 50.0 },
      drag: { value: core ? 0.05 : 0.22 },
      life: { value: core ? 11.5 : 9.0 },
      spread: { value: core ? 0.018 : 0.06 },
      sizeScale: { value: core ? 1.0 : 2.6 },
      opacity: { value: core ? 0.32 : 0.10 },
      pxScale: { value: 600 },
    }]),
    vertexShader: `
      #include <fog_pars_vertex>
      attribute vec4 seed;
      uniform float time, v0, drag, life, spread, sizeScale, pxScale;
      uniform vec3 origin, wind;
      varying float vAlpha;
      varying float vAge;
      void main() {
        float t = mod(time + seed.x * life, life);
        float k = drag * (0.7 + 0.6 * seed.z);
        float v = v0 * (0.93 + 0.09 * seed.z);
        float ang = seed.y * 6.2831853;
        float tilt = spread * sqrt(seed.y * 0.5 + seed.z * 0.5);
        vec3 dir = normalize(vec3(cos(ang) * tilt, 1.0, sin(ang) * tilt));
        float e = exp(-k * t);
        float vt = ${G.toFixed(2)} / k;  // terminal velocity
        vec3 p = origin;
        p.y += (v * dir.y + vt) / k * (1.0 - e) - vt * t;
        p.xz += dir.xz * v / k * (1.0 - e);
        // the plume is carried by the wind more as it slows near the top and on the way down
        p.xz += wind.xz * (t - (1.0 - e) / k);
        vAge = t / life;
        vAlpha = step(origin.y - 0.4, p.y);  // gone once back in the lake
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float size = (0.45 + 2.6 * vAge + 0.8 * seed.w) * sizeScale;
        gl_PointSize = size * pxScale / -mvPosition.z;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float opacity;
      uniform vec3 sunDir;
      varying float vAlpha;
      varying float vAge;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0 || vAlpha < 0.5) discard;
        float a = (1.0 - r2) * (1.0 - r2);
        // the column is dense and bright near the nozzle, thinning into spray higher up
        float fade = mix(1.0, 0.35, smoothstep(0.0, 0.9, vAge));
        vec3 col = mix(vec3(0.80, 0.84, 0.88), vec3(1.0, 0.99, 0.96), 0.6 + 0.4 * c.y * -1.0);
        gl_FragColor = vec4(col, a * opacity * fade);
        #include <fog_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = true;
  pts.onBeforeRender = (renderer) => {
    mat.uniforms.time.value = performance.now() / 1000;
    mat.uniforms.pxScale.value = renderer.getSize(_v2).y * renderer.getPixelRatio() * 0.6;
  };
  return pts;
}
const _v2 = new THREE.Vector2();
