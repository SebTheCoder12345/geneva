import * as THREE from 'three';
import { loadWorld } from './world.js';
import { createSky } from './sky.js';
import { createTerrain, createBridges } from './ground.js';
import { createLake, DETAIL_LAYER } from './lake.js';
import { createQuays } from './quays.js';
import { loadOuter } from './outer.js';
import { loadBuildings } from './buildings.js';
import { createTrees, loadTreeModel } from './trees.js';
import { createJet } from './jet.js';
import { Player } from './player.js';
import { loadGroundTextures, createGroundMaterial } from './groundMaterial.js';
import { loadCharacter } from './character.js';
import { createPost } from './post.js';

const BASE = 'assets/';
const params = new URLSearchParams(location.search);
const mobile = false;  // PC-only: built for desktop GPUs, mouse and keyboard
// ?q=medium for weaker PCs / laptops, ?q=low for software rendering
const QUALITY = {
  high: { pixelRatio: Math.min(devicePixelRatio, 1.25), shadowSize: 4096, shadowRange: 130, reflectionSize: 768,
          terrainStep: 2, leafCards: 50, jetParticles: 16000, midStep: 2, ao: true, bloom: true },
  medium: { pixelRatio: 1, shadowSize: 2048, shadowRange: 110, reflectionSize: 512,
            terrainStep: 2, leafCards: 40, jetParticles: 10000, midStep: 2, ao: false, bloom: true },
  low: { pixelRatio: 1, shadowSize: 1024, shadowRange: 90, reflectionSize: 256,
         terrainStep: 3, leafCards: 26, jetParticles: 5000, midStep: 2, ao: false, bloom: false },
}[params.get('q') || 'high'];

const bar = document.getElementById('bar');
const status = document.getElementById('status');
const go = document.getElementById('go');
const progress = (f, msg) => { bar.style.width = `${Math.round(f * 100)}%`; if (msg) status.textContent = `Loading ${msg}…`; };

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(QUALITY.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 120000);

async function boot() {
  const world = await loadWorld(BASE, progress);
  const sky = createSky(renderer, scene, QUALITY);

  progress(0.2, 'aerial photo');
  const texLoader = new THREE.TextureLoader();
  const [ortho, normals, mask, midMask, outer] = await Promise.all([
    texLoader.loadAsync(BASE + 'ortho.jpg'),
    texLoader.loadAsync(BASE + 'tex/waternormals.jpg'),
    texLoader.loadAsync(BASE + 'water.png'),
    texLoader.loadAsync(BASE + 'mid_water.png'),
    loadOuter(BASE, world, QUALITY),
  ]);
  ortho.colorSpace = THREE.SRGBColorSpace;
  ortho.anisotropy = renderer.capabilities.getMaxAnisotropy();

  progress(0.3, 'street surfaces');
  const groundTex = await loadGroundTextures(BASE, renderer);
  const groundMat = createGroundMaterial(world, ortho, groundTex);
  const terrainMat = createGroundMaterial(world, ortho, groundTex, { cutWater: true, waterMask: mask });
  const terrain = createTerrain(world, terrainMat, QUALITY);
  scene.add(terrain.mesh, outer.group);
  scene.add(createLake(world, normals, sky.sunDir, QUALITY, mask, midMask, outer.meta.mid));
  scene.add(createBridges(world, groundMat));
  scene.add(await createQuays(world, BASE, renderer));

  progress(0.45, 'buildings');
  try {
    scene.add(await loadBuildings(BASE + 'buildings.glb'));
  } catch (e) {
    console.warn('buildings not loaded', e);
  }

  progress(0.8, 'trees and the Jet d’Eau');
  let treeModel = null;
  try { treeModel = await loadTreeModel(BASE + 'trees/jacaranda_tree.glb'); } catch (e) { console.warn('tree model', e); }
  const trees = createTrees(world, QUALITY, treeModel);
  scene.add(trees.group);
  scene.add(createJet(world, sky.sunDir, QUALITY));

  progress(0.9, 'walker');
  const player = new Player(camera, world, canvas);
  try {
    const ch = await loadCharacter(BASE + 'char/xbot.glb');
    scene.add(ch.root);
    ch.root.traverse((o) => o.layers.set(DETAIL_LAYER));
    player.character = ch;
  } catch (e) {
    console.warn('character not loaded', e);
    player.thirdPerson = false;
  }
  const sp = world.meta.spawn, jet = world.meta.landmarks.jet_d_eau;
  player.spawn(sp.x, sp.z, jet.x, jet.z);
  if (params.has('cam')) {  // ?cam=x,y,z,yawDeg,pitchDeg  — fixed views for comparison shots
    const [x, y, z, yw, pt] = params.get('cam').split(',').map(Number);
    player.pos.set(x, y, z); player.yaw = THREE.MathUtils.degToRad(yw); player.pitch = THREE.MathUtils.degToRad(pt || 0);
    player.flying = true; player._apply();
  }

  // compile everything once so the first frames don't stutter
  sky.follow(player.pos);
  camera.layers.enable(DETAIL_LAYER);
  sky.sun.shadow.camera.layers.enable(DETAIL_LAYER);
  const post = await createPost(renderer, scene, camera, QUALITY);
  renderer.compile(scene, camera);
  post.render();

  progress(1);
  status.textContent = 'Ready.';
  go.disabled = false;
  go.textContent = 'ENTER';
  const enter = () => {
    document.getElementById('start').classList.add('hidden');
    document.getElementById('touchui').classList.add('on');
    player.active = true;
    if (!mobile) canvas.requestPointerLock?.();
  };
  go.addEventListener('click', enter);
  if (params.has('autostart')) enter();
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && !mobile && player.active) {
      // Esc: show the card again as a pause screen
      player.active = false;
      document.getElementById('start').classList.remove('hidden');
      go.textContent = 'RESUME';
    }
  });

  const placeEl = document.getElementById('place');
  const fpsEl = document.getElementById('fps');
  const clock = new THREE.Clock();
  let frames = 0, acc = 0;
  window.__geneva = { scene, camera, player, world, renderer, post };  // debugging / capture hooks
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    player.update(dt);
    sky.follow(player.pos);
    trees.update(camera.position);
    post.render();
    frames++; acc += dt;
    if (acc > 1) {
      fpsEl.textContent = params.has('fps') ? `${Math.round(frames / acc)} fps` : '';
      placeEl.textContent = placeName(player.pos);
      frames = 0; acc = 0;
    }
  });
}

// Rough place names by area, for orientation (world metres, origin at Pont du Mont-Blanc south end)
function placeName(p) {
  if (p.y > 60) return 'Above the Rade';
  if (p.x > 520 && p.z < -150) return 'Jetée des Eaux-Vives';
  if (p.x > 0 && p.z > 0 && p.x < 380) return 'Jardin Anglais';
  if (p.x > 380 && p.z > -150) return 'Quai Gustave-Ador';
  if (Math.abs(p.x) < 60 && p.z < 0 && p.z > -260) return 'Pont du Mont-Blanc';
  if (p.x < 60 && p.z < -260) return 'Quai du Mont-Blanc';
  if (p.x < -60 && p.z > -100) return 'Rues Basses';
  return 'Genève';
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  window.__geneva?.post?.setSize(innerWidth, innerHeight);
});

boot().catch((e) => {
  console.error(e);
  status.textContent = 'Could not load: ' + e.message;
});
