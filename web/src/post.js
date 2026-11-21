// Post-processing for desktop.
// N8AO renders the scene once and derives ambient occlusion from that depth buffer at half
// resolution (the old GTAO pass re-rendered the whole scene for normals at full resolution).
// Then a little bloom on sun glints and the Jet d'Eau, tone mapping, and SMAA.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export async function createPost(renderer, scene, camera, quality) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, target);

  let aoPass = null;
  if (quality.ao) {
    try {
      const { N8AOPass } = await import('n8ao');
      aoPass = new N8AOPass(scene, camera, size.x, size.y);
      Object.assign(aoPass.configuration, {
        aoRadius: 2.0, distanceFalloff: 1.0, intensity: 2.2, halfRes: true, depthAwareUpsampling: true,
        aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10, gammaCorrection: false,
      });
      composer.addPass(aoPass);
    } catch (e) {
      console.warn('AO unavailable, continuing without it', e);
    }
  }
  if (!aoPass) composer.addPass(new RenderPass(scene, camera));
  if (quality.bloom) {
    // threshold above diffuse white: only specular glints and the sunlit spray bloom
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.16, 0.45, 1.5));
  }
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass(size.x, size.y));
  return {
    composer,
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
  };
}
