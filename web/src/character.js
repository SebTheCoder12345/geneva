// The walker: a rigged body with idle / walk / run blended by speed.
// Stand-in mannequin (three.js examples, Mixamo); to be replaced by a scanned Geneva-style person.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WALK_ANIM_SPEED = 1.35;  // m/s the walk clip was authored at
const RUN_ANIM_SPEED = 4.2;

export async function loadCharacter(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;  // skinned bounds are unreliable
      // a muted, slightly rough finish reads better in daylight than the stock shiny one
      if (o.material) {
        o.material = o.material.clone();
        o.material.roughness = 0.7;
        o.material.metalness = 0.0;
        // neutral clothing tones instead of the stock pink: dark jacket/trousers, grey joints
        o.material.color.set(/joint/i.test(o.material.name) ? 0x8a8a86 : 0x2e3440);
      }
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const clip = (n) => gltf.animations.find((a) => a.name === n);
  const actions = {
    idle: mixer.clipAction(clip('idle')),
    walk: mixer.clipAction(clip('walk')),
    run: mixer.clipAction(clip('run')),
  };
  for (const a of Object.values(actions)) { a.play(); a.setEffectiveWeight(0); }
  actions.idle.setEffectiveWeight(1);
  return new Character(root, mixer, actions);
}

class Character {
  constructor(root, mixer, actions) {
    this.root = root;
    this.mixer = mixer;
    this.actions = actions;
    this.heading = 0;
    this.speed = 0;
    this.w = { idle: 1, walk: 0, run: 0 };
  }

  update(dt, feet, moveX, moveZ, visible) {
    this.root.visible = visible;
    this.root.position.copy(feet);
    const sp = Math.hypot(moveX, moveZ) / Math.max(dt, 1e-4);
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    if (sp > 0.2) {
      const target = Math.atan2(moveX, moveZ);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 10);
    }
    this.root.rotation.y = this.heading;

    // blend weights from speed
    const s = this.speed;
    const tIdle = THREE.MathUtils.clamp(1 - s / 0.8, 0, 1);
    const tRun = THREE.MathUtils.clamp((s - 2.2) / 1.8, 0, 1);
    const tWalk = Math.max(0, 1 - tIdle - tRun);
    const k = Math.min(1, dt * 10);
    for (const [n, t] of [['idle', tIdle], ['walk', tWalk], ['run', tRun]]) {
      this.w[n] += (t - this.w[n]) * k;
      this.actions[n].setEffectiveWeight(this.w[n]);
    }
    this.actions.walk.timeScale = THREE.MathUtils.clamp(s / WALK_ANIM_SPEED, 0.5, 1.6);
    this.actions.run.timeScale = THREE.MathUtils.clamp(s / RUN_ANIM_SPEED, 0.7, 1.4);
    this.mixer.update(dt);
  }
}
