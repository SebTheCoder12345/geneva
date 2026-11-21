// Sky, sun, image-based lighting and atmospheric haze.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Late-afternoon summer light over the Rade: sun in the south-west, behind a viewer in the
// Jardin Anglais looking out at the Jet d'Eau.
export const SUN = { elevationDeg: 34, azimuthDeg: 232 };  // azimuth from north, clockwise

export function sunDirection() {
  const el = THREE.MathUtils.degToRad(SUN.elevationDeg);
  const az = THREE.MathUtils.degToRad(SUN.azimuthDeg);
  // north = -Z, east = +X
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export function createSky(renderer, scene, quality) {
  const sky = new Sky();
  sky.scale.setScalar(100000);
  const u = sky.material.uniforms;
  u.turbidity.value = 2.6;
  u.rayleigh.value = 1.25;
  u.mieCoefficient.value = 0.003;
  u.mieDirectionalG.value = 0.82;
  const sunDir = sunDirection();
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // Environment map from the sky only (no buildings): soft, consistent IBL.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms.turbidity, { value: u.turbidity.value });
  envSky.material.uniforms.rayleigh.value = u.rayleigh.value;
  envSky.material.uniforms.mieCoefficient.value = u.mieCoefficient.value;
  envSky.material.uniforms.mieDirectionalG.value = u.mieDirectionalG.value;
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(envSky);
  // a darker ground hemisphere so reflections are not lit from below by sky
  const ground = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x4a4c48, side: THREE.BackSide }));
  envScene.add(ground);
  const env = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.7;

  const sun = new THREE.DirectionalLight(0xffeccf, 6.0);
  sun.position.copy(sunDir).multiplyScalar(400);
  sun.castShadow = true;
  const s = quality.shadowSize;
  sun.shadow.mapSize.set(s, s);
  const r = quality.shadowRange;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xc9d6e0, 0x6b6556, 0.4);
  scene.add(hemi);

  scene.fog = new THREE.FogExp2(0xa9bccb, 0.00007);

  // Keep the shadow frustum centred on the viewer, snapped to texels to avoid shimmer.
  const texel = (2 * r) / s;
  function follow(p) {
    const fx = Math.round(p.x / texel) * texel, fz = Math.round(p.z / texel) * texel;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx, 0, fz).addScaledVector(sunDir, 600);
    sun.target.updateMatrixWorld();
  }
  return { sky, sun, sunDir, follow };
}
