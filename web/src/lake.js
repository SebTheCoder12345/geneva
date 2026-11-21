// Lake Geneva surface: planar reflection + physically based Fresnel (water F0 = 0.02), a deep
// blue-green body colour and a sharp sun glint. Based on three.js' Water example, with:
//  - the reflection pass skipping shadow-map updates (they are already current for this frame)
//  - the reflection camera seeing only layer 0 (near-detail trees and the walker are on layer 1)
//  - lake/river masks so the plane only shows where there is water
import * as THREE from 'three';

export const DETAIL_LAYER = 1;

export function createLake(world, normalsTex, sunDir, quality, maskTex, midMask, midMeta) {
  normalsTex.wrapS = normalsTex.wrapT = THREE.RepeatWrapping;
  const size = quality.reflectionSize;
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType });
  const mirrorCamera = new THREE.PerspectiveCamera();
  mirrorCamera.layers.set(0);
  const textureMatrix = new THREE.Matrix4();
  const mu = world.maskUniforms();

  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      mirrorSampler: { value: null }, normalSampler: { value: null }, time: { value: 0 },
      textureMatrix: { value: new THREE.Matrix4() }, eye: { value: new THREE.Vector3() },
      sunDirection: { value: sunDir.clone() }, sunColor: { value: new THREE.Color(1.0, 0.94, 0.84) },
      deepColor: { value: new THREE.Color().setRGB(0.012, 0.055, 0.07) },
      shallowColor: { value: new THREE.Color().setRGB(0.03, 0.11, 0.11) },
      gridOrigin: { value: mu.gridOrigin }, gridSize: { value: mu.gridSize }, waterMask: { value: null },
      midOrigin: { value: new THREE.Vector2(midMeta.x0, midMeta.z0) },
      midSize: { value: new THREE.Vector2((midMeta.w - 1) * midMeta.cell, (midMeta.h - 1) * midMeta.cell) },
      midMask: { value: null },
    }]),
    vertexShader: `
      uniform mat4 textureMatrix;
      uniform float time;
      varying vec4 mirrorCoord;
      varying vec4 worldPosition;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        mirrorCoord = modelMatrix * vec4(position, 1.0);
        worldPosition = mirrorCoord.xyzw;
        mirrorCoord = textureMatrix * mirrorCoord;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D mirrorSampler, normalSampler, waterMask, midMask;
      uniform float time;
      uniform vec3 sunColor, sunDirection, eye, deepColor, shallowColor;
      uniform vec2 gridOrigin, gridSize, midOrigin, midSize;
      varying vec4 mirrorCoord;
      varying vec4 worldPosition;
      #include <common>
      #include <fog_pars_fragment>
      vec4 getNoise(vec2 uv) {
        vec2 uv0 = (uv / 103.0) + vec2(time / 17.0, time / 29.0);
        vec2 uv1 = uv / 107.0 - vec2(time / -19.0, time / 31.0);
        vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(time / 101.0, time / 97.0);
        vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(time / 109.0, time / -113.0);
        return texture2D(normalSampler, uv0) + texture2D(normalSampler, uv1) +
               texture2D(normalSampler, uv2) + texture2D(normalSampler, uv3) - 2.0;
      }
      void main() {
        vec2 mu = (worldPosition.xz - gridOrigin) / gridSize;
        vec2 mm = (worldPosition.xz - midOrigin) / midSize;
        bool inInner = all(greaterThan(mu, vec2(0.0))) && all(lessThan(mu, vec2(1.0)));
        bool inMid = all(greaterThan(mm, vec2(0.0))) && all(lessThan(mm, vec2(1.0)));
        if (inInner) { if (texture2D(waterMask, vec2(mu.x, 1.0 - mu.y)).r < 0.5) discard; }
        else if (inMid) { if (texture2D(midMask, vec2(mm.x, 1.0 - mm.y)).r < 0.5) discard; }
        else discard;

        vec3 toEye = eye - worldPosition.xyz;
        float dist = length(toEye);
        vec3 V = toEye / dist;
        // small wind ripples: scale up the normal map, calm them with distance to avoid aliasing
        vec4 noise = getNoise(worldPosition.xz * 3.0);
        float calm = mix(1.0, 0.35, smoothstep(50.0, 1500.0, dist));
        vec3 N = normalize(vec3(noise.x * 0.55 * calm, 1.0, noise.z * 0.55 * calm));

        vec2 distortion = N.xz * (0.0008 + 1.2 / (dist + 30.0)) * 4.0;
        vec3 refl = texture2D(mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion).rgb;

        float cosT = clamp(dot(V, N), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        // body colour: light scattered back out of the water column, brighter in sunlight
        float sunUp = clamp(sunDirection.y, 0.0, 1.0);
        vec3 body = mix(shallowColor, deepColor, smoothstep(5.0, 60.0, dist)) * (0.55 + 0.9 * sunUp);
        vec3 H = normalize(sunDirection + V);
        float spec = pow(max(dot(N, H), 0.0), 420.0) * 9.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.12;
        vec3 col = mix(body, refl, F) + sunColor * spec;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.mirrorSampler.value = rt.texture;
  mat.uniforms.normalSampler.value = normalsTex;
  mat.uniforms.waterMask.value = maskTex;
  mat.uniforms.midMask.value = midMask;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'lake';

  const mirrorPlane = new THREE.Plane(), normal = new THREE.Vector3(), mirrorPos = new THREE.Vector3();
  const camPos = new THREE.Vector3(), rot = new THREE.Matrix4(), lookAt = new THREE.Vector3();
  const clip = new THREE.Vector4(), view = new THREE.Vector3(), target = new THREE.Vector3(), q = new THREE.Vector4();

  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (camera === mirrorCamera) return;
    mat.uniforms.time.value = performance.now() / 1000 * 0.6;
    mat.uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld);
    mirrorPos.setFromMatrixPosition(mesh.matrixWorld);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    rot.extractRotation(mesh.matrixWorld);
    normal.set(0, 0, 1).applyMatrix4(rot);
    view.subVectors(mirrorPos, camPos);
    if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(mirrorPos);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(mirrorPos, lookAt).reflect(normal).negate().add(mirrorPos);
    mirrorCamera.position.copy(view);
    mirrorCamera.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    mirrorCamera.lookAt(target);
    mirrorCamera.far = camera.far;
    mirrorCamera.updateMatrixWorld();
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
    mat.uniforms.textureMatrix.value.copy(textureMatrix);
    // oblique near plane = the water plane
    mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(mirrorCamera.matrixWorldInverse);
    clip.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
    const pm = mirrorCamera.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1; pm[14] = clip.w;

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    mesh.visible = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, mirrorCamera);
    renderer.shadowMap.autoUpdate = prevShadow;
    mesh.visible = true;
    renderer.setRenderTarget(prevTarget);
  };
  return mesh;
}
