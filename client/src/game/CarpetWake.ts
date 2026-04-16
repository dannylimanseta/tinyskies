/**
 * Water splash particles when the magic carpet flies over ocean.
 * Emits at the water surface directly below the carpet, fades when over land.
 */
import {
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  AdditiveBlending,
  Vector3,
  Quaternion,
  Group,
} from "three";
import { cartesianFromSpherical, tangentFrame } from "./SphericalMath";
import { isLand } from "./SimplexNoise";

const SPREAD_ANGLE = 0.25;

const POOL_SIZE = 400;
const PARTICLE_LIFETIME_MIN = 0.8;
const PARTICLE_LIFETIME_MAX = 2.0;
const EMIT_PER_FRAME = 6;
const SPLASH_UP_SPEED = 0.12;
const SPLASH_OUT_SPEED = 0.18;
const GRAVITY = 0.22;

const splashVert = `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (40.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const splashFrag = `
uniform float uGlobalAlpha;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float soft = 1.0 - d * d;
  gl_FragColor = vec4(0.92, 0.97, 1.0, soft * vAlpha * uGlobalAlpha);
}
`;

interface Particle {
  alive: boolean;
  age: number;
  lifetime: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
}

class SplashParticles {
  private pool: Particle[] = [];
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private sizeAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly material: ShaderMaterial;
  readonly points: Points;
  private nextSlot = 0;

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({ alive: false, age: 0, lifetime: 1, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 });
    }

    this.posAttr = new BufferAttribute(new Float32Array(POOL_SIZE * 3), 3);
    this.alphaAttr = new BufferAttribute(new Float32Array(POOL_SIZE), 1);
    this.sizeAttr = new BufferAttribute(new Float32Array(POOL_SIZE), 1);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("aAlpha", this.alphaAttr);
    this.geometry.setAttribute("aSize", this.sizeAttr);

    this.material = new ShaderMaterial({
      vertexShader: splashVert,
      fragmentShader: splashFrag,
      uniforms: { uGlobalAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit(origin: Vector3, up: Vector3, outward: Vector3, speed: number) {
    const count = Math.ceil(EMIT_PER_FRAME * Math.min(1, speed * 1.2));
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.nextSlot];
      this.nextSlot = (this.nextSlot + 1) % POOL_SIZE;

      p.alive = true;
      p.age = 0;
      p.lifetime = PARTICLE_LIFETIME_MIN + Math.random() * (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN);

      const jitterOut = (0.5 + Math.random() * 1.0) * SPLASH_OUT_SPEED;
      const jitterUp = (0.4 + Math.random() * 1.0) * SPLASH_UP_SPEED;
      const jitterBack = (Math.random() - 0.5) * 0.03;

      p.px = origin.x + (Math.random() - 0.5) * 0.006;
      p.py = origin.y + (Math.random() - 0.5) * 0.006;
      p.pz = origin.z + (Math.random() - 0.5) * 0.006;

      p.vx = outward.x * jitterOut + up.x * jitterUp + (Math.random() - 0.5) * jitterBack;
      p.vy = outward.y * jitterOut + up.y * jitterUp + (Math.random() - 0.5) * jitterBack;
      p.vz = outward.z * jitterOut + up.z * jitterUp + (Math.random() - 0.5) * jitterBack;
    }
  }

  update(dt: number, globalAlpha: number, up: Vector3) {
    this.material.uniforms.uGlobalAlpha.value = globalAlpha;

    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const sizes = this.sizeAttr.array as Float32Array;
    const gx = -up.x * GRAVITY * dt;
    const gy = -up.y * GRAVITY * dt;
    const gz = -up.z * GRAVITY * dt;

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

      p.vx += gx;
      p.vy += gy;
      p.vz += gz;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;

      const t = p.age / p.lifetime;
      const fadeIn = Math.min(1, p.age / 0.15);
      positions[i * 3] = p.px;
      positions[i * 3 + 1] = p.py;
      positions[i * 3 + 2] = p.pz;
      alphas[i] = fadeIn * (1 - t) * (1 - t) * 0.4;
      sizes[i] = (1 - t * 0.5) * 0.12;
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
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
    }
    (this.posAttr.array as Float32Array).fill(0);
    (this.alphaAttr.array as Float32Array).fill(0);
    (this.sizeAttr.array as Float32Array).fill(0);
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class CarpetWake {
  readonly group = new Group();
  private splash: SplashParticles;
  private waterAlpha = 0;

  constructor() {
    this.splash = new SplashParticles();
    this.group.add(this.splash.points);
  }

  update(
    dt: number,
    qPosition: Quaternion,
    heading: number,
    globeRadius: number,
    speed: number,
    elevating: boolean,
    seed: number,
    terrainType: string,
    _camera: unknown,
  ) {
    const frame = tangentFrame(qPosition);
    const up = frame.up;
    const overWater = !isLand(seed, terrainType, up.x, up.y, up.z);

    const speedFade = Math.min(1, Math.max(0, (speed - 0.5) / 0.4));
    const target = overWater && speed > 0.5 && !elevating ? speedFade : 0;
    this.waterAlpha += (target - this.waterAlpha) * 0.08;

    this.splash.update(dt, this.waterAlpha, up);

    if (this.waterAlpha < 0.01) return;

    const surfacePos = cartesianFromSpherical(qPosition, 0.001, globeRadius);

    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(heading))
      .addScaledVector(frame.east, Math.sin(heading))
      .normalize();

    const right = new Vector3().crossVectors(forward, up).normalize();

    const leftDir = forward.clone().multiplyScalar(1000)
      .addScaledVector(right, -SPREAD_ANGLE).normalize();
    const rightDir = forward.clone().multiplyScalar(1000)
      .addScaledVector(right, SPREAD_ANGLE).normalize();

    const offset = 0.008;
    const leftPos = surfacePos.clone().addScaledVector(leftDir, offset).addScaledVector(right, -0.008);
    const rightPos = surfacePos.clone().addScaledVector(rightDir, offset).addScaledVector(right, 0.008);

    this.splash.emit(leftPos, up, right.clone().multiplyScalar(-1), speed);
    this.splash.emit(rightPos, up, right, speed);
  }

  reset() {
    this.waterAlpha = 0;
    this.splash.material.uniforms.uGlobalAlpha.value = 0;
    this.splash.reset();
  }

  dispose() {
    this.splash.dispose();
  }
}
