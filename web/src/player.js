// First-person walking and free flight, with keyboard/mouse and touch controls.
import * as THREE from 'three';

const EYE = 1.68;
const WALK = 1.6, RUN = 5.0, FLY = 22, FLY_FAST = 90;

export class Player {
  constructor(camera, world, dom) {
    this.camera = camera;
    this.world = world;
    this.dom = dom;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.flying = false;
    this.vy = 0;
    this.keys = new Set();
    this.move = new THREE.Vector2();  // touch stick, x = strafe, y = forward
    this.vert = 0;                    // touch up/down in flight
    this.active = false;
    this._bindKeys();
    this._bindMouse();
    this._bindTouch();
  }

  spawn(x, z, faceX, faceZ) {
    const p = this._findWalkable(x, z);
    this.pos.set(p.x, p.y + EYE, p.z);
    this.yaw = Math.atan2(-(faceX - p.x), -(faceZ - p.z));
    this.pitch = 0.06;
    this._apply();
  }

  _findWalkable(x, z) {
    for (let r = 0; r < 120; r += 2) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r;
        const y = this.world.groundAt(px, pz);
        if (y !== null) return { x: px, y, z: pz };
        if (r === 0) break;
      }
    }
    return { x, y: this.world.floorAt(x, z), z };
  }

  setFlying(on) {
    this.flying = on;
    document.getElementById('touchui')?.classList.toggle('flying', on);
    if (!on) {
      // land on whatever is below, or the nearest walkable spot
      const p = this._findWalkable(this.pos.x, this.pos.z);
      this.pos.set(p.x, p.y + EYE, p.z);
    }
  }

  _bindKeys() {
    addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.setFlying(!this.flying);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  _bindMouse() {
    this.dom.addEventListener('click', () => {
      if (this.active && !matchMedia('(pointer: coarse)').matches) this.dom.requestPointerLock?.();
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.5, 1.5);
    });
  }

  _bindTouch() {
    const stick = document.getElementById('stick'), nub = document.getElementById('nub');
    let stickId = null, lookId = null, lx = 0, ly = 0, cx = 0, cy = 0;
    const R = 50;
    const start = (e) => {
      if (!this.active) return;
      for (const t of e.changedTouches) {
        if (t.target.closest?.('button')) continue;
        if (t.clientX < innerWidth * 0.45 && stickId === null) {
          stickId = t.identifier;
          const r = stick.getBoundingClientRect();
          cx = r.left + r.width / 2; cy = r.top + r.height / 2;
          moveStick(t);
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    };
    const moveStick = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.set(dx / R, -dy / R);
    };
    const mv = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) moveStick(t);
        if (t.identifier === lookId) {
          this.yaw -= (t.clientX - lx) * 0.005;
          this.pitch = THREE.MathUtils.clamp(this.pitch - (t.clientY - ly) * 0.005, -1.5, 1.5);
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.move.set(0, 0); nub.style.transform = ''; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    addEventListener('touchstart', start, { passive: false });
    addEventListener('touchmove', mv, { passive: false });
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
    const hold = (id, v) => {
      const b = document.getElementById(id);
      b?.addEventListener('touchstart', (e) => { this.vert = v; e.preventDefault(); }, { passive: false });
      b?.addEventListener('touchend', () => { this.vert = 0; });
    };
    document.getElementById('flyBtn')?.addEventListener('touchstart', (e) => {
      this.setFlying(!this.flying); e.preventDefault();
    }, { passive: false });
    hold('upBtn', 1);
    hold('downBtn', -1);
  }

  update(dt) {
    if (!this.active) return;
    dt = Math.min(dt, 0.1);
    const k = this.keys;
    let fwd = this.move.y, side = this.move.x, up = this.vert;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) side += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) side -= 1;
    if (k.has('Space') || k.has('KeyE')) up += 1;
    if (k.has('KeyC') || k.has('KeyQ')) up -= 1;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    const len = Math.hypot(fwd, side);
    if (len > 1) { fwd /= len; side /= len; }

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    if (this.flying) {
      const sp = fast ? FLY_FAST : FLY;
      const cp = Math.cos(this.pitch), spch = Math.sin(this.pitch);
      this.pos.x += (-sy * cp * fwd + cy * side) * sp * dt;
      this.pos.z += (-cy * cp * fwd - sy * side) * sp * dt;
      this.pos.y += (spch * fwd + up) * sp * dt;
      this.pos.y = Math.max(this.pos.y, this.world.floorAt(this.pos.x, this.pos.z) + 1.2);
      this.pos.y = Math.min(this.pos.y, 1500);
    } else {
      // a stick pushed fully runs; keyboard runs with Shift
      const stickRun = Math.hypot(this.move.x, this.move.y) > 0.92;
      const sp = (fast || stickRun) ? RUN : WALK;
      const dx = (-sy * fwd + cy * side) * sp * dt;
      const dz = (-cy * fwd - sy * side) * sp * dt;
      const foot = this.pos.y - EYE;
      // slide along obstacles: try each axis on its own
      const tryMove = (nx, nz) => {
        const g = this.world.groundAt(nx, nz, foot);
        if (g === null || g - foot > 0.6) return false;  // wall, water, or a step too high
        this.pos.x = nx; this.pos.z = nz; return true;
      };
      if (dx || dz) {
        if (!tryMove(this.pos.x + dx, this.pos.z + dz)) {
          tryMove(this.pos.x + dx, this.pos.z) || tryMove(this.pos.x, this.pos.z + dz);
        }
      }
      const g = this.world.groundAt(this.pos.x, this.pos.z, foot) ?? foot;
      // smooth steps up, fall down steps
      const target = g + EYE;
      if (this.pos.y > target + 0.05) {
        this.vy -= 9.81 * dt;
        this.pos.y = Math.max(target, this.pos.y + this.vy * dt);
        if (this.pos.y === target) this.vy = 0;
      } else {
        this.vy = 0;
        this.pos.y += (target - this.pos.y) * Math.min(1, dt * 12);
      }
      // subtle head bob when walking
      this._bob = (this._bob || 0) + dt * sp * Math.min(len, 1) * 1.9;
    }
    this._apply();
  }

  _apply() {
    const bob = this.flying ? 0 : Math.sin(this._bob || 0) * 0.025;
    this.camera.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
