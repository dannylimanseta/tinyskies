/**
 * Rustling leaf particles when the magic carpet flies over land.
 * Curved leaf-shaped points that flutter upward and drift away.
 */
import {
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  NormalBlending,
  Vector3,
  Quaternion,
  Group,
} from "three";
import { cartesianFromSpherical, tangentFrame } from "./SphericalMath";
import { isLand } from "./SimplexNoise";

const POOL_SIZE = 300;
const PARTICLE_LIFETIME_MIN = 1.0;
const PARTICLE_LIFETIME_MAX = 2.5;
const EMIT_PER_FRAME = 0.25;
const LEAF_UP_SPEED = 0.14;
const LEAF_OUT_SPEED = 0.14;
const GRAVITY = 0.04;
const FLUTTER_FREQ = 8.0;
const FLUTTER_AMP = 0.015;

const leafVert = `
attribute float aAlpha;
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
varying float vAlpha;
varying float vPhase;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vPhase = aPhase;
  vColor = aColor;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (200.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const leafFrag = `
varying float vAlpha;
varying float vPhase;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float angle = vPhase;
  float c = cos(angle), s = sin(angle);
  vec2 ruv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

  float curve = 0.15 * ruv.y * ruv.y;
  vec2 cruv = vec2(ruv.x - curve, ruv.y);

  float ny = cruv.y / 0.38;
  if (abs(ny) > 1.0) discard;
  float bulge = sqrt(1.0 - ny * ny) * (1.0 - 0.3 * ny);
  float w = 0.14 * bulge;
  float leaf = smoothstep(w, w - 0.02, abs(cruv.x));
  if (leaf < 0.1) discard;

  float vein = smoothstep(0.012, 0.0, abs(cruv.x));
  vec3 col = vColor * (1.0 + vein * 0.15);
  gl_FragColor = vec4(col, leaf * vAlpha);
}
`;

const LEAF_COLORS = [
  [0.50, 0.78, 0.40],
  [0.58, 0.80, 0.38],
  [0.65, 0.76, 0.35],
  [0.72, 0.70, 0.32],
  [0.78, 0.65, 0.35],
  [0.62, 0.82, 0.42],
  [0.55, 0.72, 0.38],
];

interface LeafParticle {
  alive: boolean;
  age: number;
  lifetime: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  phase: number;
  phaseSpeed: number;
  flutterOffset: number;
  upX: number; upY: number; upZ: number;
}

class LeafParticles {
  private pool: LeafParticle[] = [];
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private sizeAttr: BufferAttribute;
  private phaseAttr: BufferAttribute;
  private colorAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly material: ShaderMaterial;
  readonly points: Points;
  private nextSlot = 0;

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        alive: false, age: 0, lifetime: 1,
        px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
        phase: 0, phaseSpeed: 0, flutterOffset: 0,
        upX: 0, upY: 1, upZ: 0,
      });
    }

    this.posAttr = new BufferAttribute(new Float32Array(POOL_SIZE * 3), 3);
    this.alphaAttr = new BufferAttribute(new Float32Array(POOL_SIZE), 1);
    this.sizeAttr = new BufferAttribute(new Float32Array(POOL_SIZE), 1);
    this.phaseAttr = new BufferAttribute(new Float32Array(POOL_SIZE), 1);
    this.colorAttr = new BufferAttribute(new Float32Array(POOL_SIZE * 3), 3);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("aAlpha", this.alphaAttr);
    this.geometry.setAttribute("aSize", this.sizeAttr);
    this.geometry.setAttribute("aPhase", this.phaseAttr);
    this.geometry.setAttribute("aColor", this.colorAttr);

    this.material = new ShaderMaterial({
      vertexShader: leafVert,
      fragmentShader: leafFrag,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit(origin: Vector3, up: Vector3, right: Vector3, forward: Vector3, speed: number) {
    const count = Math.ceil(EMIT_PER_FRAME * Math.min(1, speed * 1.5));
    const colors = this.colorAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const p = this.pool[this.nextSlot];
      const idx = this.nextSlot;
      this.nextSlot = (this.nextSlot + 1) % POOL_SIZE;

      p.alive = true;
      p.age = 0;
      p.lifetime = PARTICLE_LIFETIME_MIN + Math.random() * (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN);

      const jitterUp = (0.5 + Math.random() * 1.0) * LEAF_UP_SPEED;
      const jitterSide = (Math.random() - 0.5) * 2.0 * LEAF_OUT_SPEED;
      const jitterBack = -Math.random() * 0.03;

      const spread = 0.05;
      p.px = origin.x + (Math.random() - 0.5) * spread + forward.x * (Math.random() - 0.5) * 0.06;
      p.py = origin.y + (Math.random() - 0.5) * spread + forward.y * (Math.random() - 0.5) * 0.06;
      p.pz = origin.z + (Math.random() - 0.5) * spread + forward.z * (Math.random() - 0.5) * 0.06;

      p.vx = up.x * jitterUp + right.x * jitterSide + forward.x * jitterBack;
      p.vy = up.y * jitterUp + right.y * jitterSide + forward.y * jitterBack;
      p.vz = up.z * jitterUp + right.z * jitterSide + forward.z * jitterBack;

      p.phase = Math.random() * Math.PI * 2;
      p.phaseSpeed = (2 + Math.random() * 4) * (Math.random() < 0.5 ? 1 : -1);
      p.flutterOffset = Math.random() * Math.PI * 2;
      p.upX = up.x; p.upY = up.y; p.upZ = up.z;

      const col = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)];
      colors[idx * 3] = col[0];
      colors[idx * 3 + 1] = col[1];
      colors[idx * 3 + 2] = col[2];
    }
    this.colorAttr.needsUpdate = true;
  }

  update(dt: number, landAlpha: number) {
    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const sizes = this.sizeAttr.array as Float32Array;
    const phases = this.phaseAttr.array as Float32Array;

    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.alive) {
        alphas[i] = 0;
        sizes[i] = 0;
        continue;
      }

      p.age += dt;
      if (p.age >= p.lifetime) {
        p.alive = false;
        alphas[i] = 0;
        sizes[i] = 0;
        continue;
      }

      p.vx -= p.upX * GRAVITY * dt;
      p.vy -= p.upY * GRAVITY * dt;
      p.vz -= p.upZ * GRAVITY * dt;

      const flutter = Math.sin(p.age * FLUTTER_FREQ + p.flutterOffset) * FLUTTER_AMP * dt;
      p.vx += (Math.random() - 0.5) * flutter;
      p.vy += (Math.random() - 0.5) * flutter;
      p.vz += (Math.random() - 0.5) * flutter;

      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;

      p.phase += p.phaseSpeed * dt;

      const t = p.age / p.lifetime;
      positions[i * 3] = p.px;
      positions[i * 3 + 1] = p.py;
      positions[i * 3 + 2] = p.pz;
      alphas[i] = landAlpha;
      const scale = t < 0.3 ? t / 0.3 : 1.0 - (t - 0.3) / 0.7;
      sizes[i] = scale * 0.14;
      phases[i] = p.phase;
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
  }

  reset() {
    for (const p of this.pool) {
      p.alive = false;
      p.age = 0;
      p.lifetime = 1;
      p.px = 0;
      p.py = 0;
      p.pz = 0;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.phase = 0;
      p.phaseSpeed = 0;
      p.flutterOffset = 0;
      p.upX = 0;
      p.upY = 1;
      p.upZ = 0;
    }
    (this.posAttr.array as Float32Array).fill(0);
    (this.alphaAttr.array as Float32Array).fill(0);
    (this.sizeAttr.array as Float32Array).fill(0);
    (this.phaseAttr.array as Float32Array).fill(0);
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class CarpetLeaves {
  readonly group = new Group();
  private leaves: LeafParticles;
  private landAlpha = 0;

  constructor() {
    this.leaves = new LeafParticles();
    this.group.add(this.leaves.points);
  }

  update(
    dt: number,
    qPosition: Quaternion,
    heading: number,
    globeRadius: number,
    speed: number,
    altitude: number,
    seed: number,
    terrainType: string,
  ) {
    const frame = tangentFrame(qPosition);
    const up = frame.up;
    const overLand = isLand(seed, terrainType, up.x, up.y, up.z);

    const speedFade = Math.min(1, Math.max(0, (speed - 0.5) / 0.3));
    const target = overLand && speed > 0.5 ? speedFade : 0;
    this.landAlpha += (target - this.landAlpha) * 0.08;

    this.leaves.update(dt, this.landAlpha);

    if (this.landAlpha < 0.01) return;

    const spawnAlt = altitude * 0.7;
    const surfacePos = cartesianFromSpherical(qPosition, spawnAlt, globeRadius);

    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(heading))
      .addScaledVector(frame.east, Math.sin(heading))
      .normalize();

    const right = new Vector3().crossVectors(forward, up).normalize();

    this.leaves.emit(surfacePos, up, right, forward, speed);
  }

  reset() {
    this.landAlpha = 0;
    this.leaves.reset();
  }

  dispose() {
    this.leaves.dispose();
  }
}
