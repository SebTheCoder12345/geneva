// The Jet d'Eau: ~500 l/s leaving the nozzle at ~200 km/h, rising to ~140 m.
// Three layers: a dense white column (mesh), water droplets falling back (particles on closed-form
// ballistic paths with drag and wind, evaluated on the GPU) and a fine mist veil drifting
// downwind. All three are cheap: three draw calls and no per-frame CPU work.
import * as THREE from 'three';
import { mulberry } from './ground.js';

const G = 9.81;
const HEIGHT = 140;

export function createJet(world, sunDir, quality) {
  const L = world.meta.landmarks.jet_d_eau;
  const baseY = Math.max(world.terrainHeight(L.x, L.z), 0.5) + 0.6;
  const group = new THREE.Group();
  group.name = 'jet';
  const wind = new THREE.Vector3(1.6, 0, 0.9);  // light south-westerly, m/s (blows the plume NE)
  const origin = new THREE.Vector3(L.x, baseY, L.z);

  group.add(makeColumn(origin, wind, sunDir));
  const n = quality.jetParticles;
  group.add(makePlume(Math.floor(n * 0.6), origin, wind, sunDir, {
    seed: 3, v0: 57, drag: 0.05, life: 11.5, spread: 0.014, size: [0.5, 3.2], opacity: 0.4,
  }));
  group.add(makePlume(Math.floor(n * 0.4), origin, wind, sunDir, {
    seed: 9, v0: 60, drag: 0.11, life: 11, spread: 0.035, size: [1.0, 8.0], opacity: 0.08,
  }));
  group.add(makePlume(Math.floor(n * 0.12), origin, wind.clone().multiplyScalar(1.6), sunDir, {
    seed: 21, v0: 48, drag: 0.35, life: 16, spread: 0.1, size: [6.0, 22.0], opacity: 0.05,
  }));
  return group;
}

// The solid-looking lower part of the jet: water leaves the nozzle as a tight column.
function makeColumn(origin, wind, sunDir) {
  const h = HEIGHT * 0.92;
  const geo = new THREE.CylinderGeometry(0.9, 0.35, h, 20, 40, true).translate(0, h / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, sunDir: { value: sunDir }, wind: { value: wind }, height: { value: h },
    }]),
    vertexShader: `
      #include <fog_pars_vertex>
      uniform float time, height; uniform vec3 wind;
      varying float vH; varying vec3 vN; varying vec2 vUv; varying vec3 vWP;
      void main() {
        vec3 p = position;
        vH = p.y / height;
        // the column leans a little downwind near the top
        p.xz += wind.xz * pow(vH, 2.0) * 4.0;
        vN = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float time; uniform vec3 sunDir;
      varying float vH; varying vec3 vN; varying vec2 vUv; varying vec3 vWP;
      float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
      float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main() {
        vec3 V = normalize(cameraPosition - vWP);
        float rim = abs(dot(normalize(vN), V));          // thicker-looking in the middle
        // vertical streaks rushing upward
        float streak = n1(vUv.x * 60.0) * 0.6 + n1(vUv.x * 23.0 + 5.0) * 0.4;
        float flow = n1(vUv.y * 40.0 - time * 9.0 + vUv.x * 13.0);
        float a = mix(0.8, 0.0, smoothstep(0.12, 0.55, vH)) * pow(rim, 1.5) * (0.55 + 0.45 * streak * flow);
        float lit = 0.75 + 0.35 * max(dot(normalize(vN), sunDir), 0.0);
        vec3 col = vec3(0.98, 0.98, 0.96) * lit * 1.6;
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin);
  mesh.onBeforeRender = () => { mat.uniforms.time.value = performance.now() / 1000; };
  return mesh;
}

function makePlume(count, origin, wind, sunDir, o) {
  const rnd = mulberry(o.seed);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.boundingSphere = new THREE.Sphere(origin.clone().setY(70), 260);

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, origin: { value: origin }, wind: { value: wind }, sunDir: { value: sunDir },
      v0: { value: o.v0 }, drag: { value: o.drag }, life: { value: o.life }, spread: { value: o.spread },
      size0: { value: o.size[0] }, size1: { value: o.size[1] }, opacity: { value: o.opacity }, pxScale: { value: 600 },
    }]),
    vertexShader: `
      #include <fog_pars_vertex>
      attribute vec4 seed;
      uniform float time, v0, drag, life, spread, size0, size1, pxScale;
      uniform vec3 origin, wind;
      varying float vAlpha, vAge;
      void main() {
        float t = mod(time + seed.x * life, life);
        float k = drag * (0.7 + 0.6 * seed.z);
        float v = v0 * (0.82 + 0.2 * seed.z * seed.z);
        float ang = seed.y * 6.2831853;
        float tilt = spread * sqrt(seed.y * 0.5 + seed.z * 0.5);
        vec3 dir = normalize(vec3(cos(ang) * tilt, 1.0, sin(ang) * tilt));
        float e = exp(-k * t);
        float vt = ${G.toFixed(2)} / k;
        vec3 p = origin;
        p.y += (v * dir.y + vt) / k * (1.0 - e) - vt * t;
        p.xz += dir.xz * v / k * (1.0 - e);
        p.xz += wind.xz * (t - (1.0 - e) / k);
        vAge = t / life;
        vAlpha = step(origin.y - 0.4, p.y);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float size = mix(size0, size1, vAge) * (0.7 + 0.6 * seed.w);
        gl_PointSize = clamp(size * pxScale / -mvPosition.z, 1.0, 256.0);
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float opacity; uniform vec3 sunDir;
      varying float vAlpha, vAge;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0 || vAlpha < 0.5) discard;
        float a = (1.0 - r2) * (1.0 - r2);
        float fade = smoothstep(0.0, 0.04, vAge) * mix(1.0, 0.45, smoothstep(0.3, 1.0, vAge));
        // sunlit top-side brighter, shaded underside slightly blue-grey
        vec3 col = mix(vec3(0.78, 0.82, 0.86), vec3(1.0, 0.99, 0.96), 0.55 - 0.45 * c.y) * 1.45;
        gl_FragColor = vec4(col, a * opacity * fade);
        #include <fog_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.onBeforeRender = (renderer, scene, camera) => {
    mat.uniforms.time.value = performance.now() / 1000;
    const hpx = renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(_v2).y;
    mat.uniforms.pxScale.value = hpx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 60) / 2));
  };
  return pts;
}
const _v2 = new THREE.Vector2();
