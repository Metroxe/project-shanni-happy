// Deterministic game core for project-shanni-happy.
// Pure logic — no rendering, no DOM, no time source. step(state, input, dt) -> state.
//
// World units shared with the Three.js scene. The character walks the ground
// plane in 2D: x (left/right) and z (depth: -z = away from camera, +z = toward).
// y is height above the ground for jumps.

export const WORLD = { XMIN: -12, XMAX: 12, ZMIN: -12, ZMAX: 6 };

const SPEED  = 5.2;
const ACCEL  = 42;
const GRAV   = 30;
const JUMP_V = 9.0;
export const JOY_DUR = 1.6;
const PICK_R = 0.85;
const PLAYER_R = 0.42;          // player footprint for solid-prop collision

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (v, t, a) => (v < t ? Math.min(t, v + a) : v > t ? Math.max(t, v - a) : v);

// solid props: [{x, z, r}, ...] — circles the player is pushed out of
let COLLIDERS = [];
export function setColliders(list) { COLLIDERS = (list || []).map(c => ({ x: c.x, z: c.z, r: c.r })); }

export function setBounds(b) {
  if (!b) return;
  WORLD.XMIN = b.xmin; WORLD.XMAX = b.xmax; WORLD.ZMIN = b.zmin; WORLD.ZMAX = b.zmax;
}

export function initState(collectibles) {
  return {
    x: 0, z: 2, vx: 0, vz: 0, y: 0, vy: 0,
    onGround: true, facing: 1,
    walkPhase: 0, animClock: 0,
    mode: 'idle', joyT: 0, score: 0,
    collectibles: (collectibles || []).map(c => ({ id: c.id, x: c.x, z: c.z, kind: c.kind || 'flower', got: false })),
    justGot: -1, event: null,
  };
}

// input = { moveX: -1..1, moveZ: -1..1, jump: bool (edge), joy: bool (edge) }
export function step(s, input, dt) {
  s.animClock += dt; s.justGot = -1; s.event = null;
  dt = Math.min(dt, 0.05);

  if (s.mode === 'joy') {
    s.joyT += dt;
    if (s.joyT >= JOY_DUR) { s.mode = 'idle'; s.joyT = 0; }
    return s;
  }
  if (input.joy && s.onGround) { s.mode = 'joy'; s.joyT = 0; s.vx = 0; s.vz = 0; return s; }

  let mx = input.moveX || 0, mz = input.moveZ || 0;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  s.vx = approach(s.vx, mx * SPEED, ACCEL * dt);
  s.vz = approach(s.vz, mz * SPEED, ACCEL * dt);
  s.x = clamp(s.x + s.vx * dt, WORLD.XMIN, WORLD.XMAX);
  s.z = clamp(s.z + s.vz * dt, WORLD.ZMIN, WORLD.ZMAX);
  if (mx) s.facing = Math.sign(mx);

  // push out of solid props, then kill the velocity component heading into them (slide)
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    let dx = s.x - c.x, dz = s.z - c.z;
    const min = c.r + PLAYER_R;
    let d = Math.hypot(dx, dz);
    if (d < min) {
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }   // exactly overlapping: pick a direction
      const nx = dx / d, nz = dz / d;
      s.x = c.x + nx * min; s.z = c.z + nz * min;
      const into = s.vx * nx + s.vz * nz;
      if (into < 0) { s.vx -= into * nx; s.vz -= into * nz; }
    }
  }
  s.x = clamp(s.x, WORLD.XMIN, WORLD.XMAX);
  s.z = clamp(s.z, WORLD.ZMIN, WORLD.ZMAX);

  if (input.jump && s.onGround) { s.vy = JUMP_V; s.onGround = false; }
  if (!s.onGround) {
    s.y += s.vy * dt; s.vy -= GRAV * dt;
    if (s.y <= 0) { s.y = 0; s.vy = 0; s.onGround = true; }
  }

  const hsp = Math.hypot(s.vx, s.vz);
  s.walkPhase += (hsp / SPEED) * 9 * dt;
  s.mode = !s.onGround ? 'air' : (hsp > 0.3 ? 'walk' : 'idle');

  for (let i = 0; i < s.collectibles.length; i++) {
    const c = s.collectibles[i];
    if (c.got) continue;
    const dx = c.x - s.x, dz = c.z - s.z;
    if (dx * dx + dz * dz < PICK_R * PICK_R && s.y < 1.2) {
      c.got = true; s.justGot = i;
      s.mode = 'joy'; s.joyT = 0; s.vx = 0; s.vz = 0;
      // flowers are the base game (score + win); hamsters are a parallel quest
      // collection — picked up the same way, but they don't touch score/win.
      if (c.kind === 'hamster') {
        s.event = 'critter';
      } else {
        s.score++;
        s.event = s.collectibles.every(k => k.kind === 'hamster' || k.got) ? 'win' : 'collect';
      }
    }
  }
  return s;
}
