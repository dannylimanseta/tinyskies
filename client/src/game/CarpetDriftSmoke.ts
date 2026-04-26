/**
 * Soft dust/smoke puffs emitted from the carpet's side edges while drifting.
 * Uses additive-blended rounded quads so they glow slightly and fade quickly.
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

const POOL_SIZE = 120;
const LIFETIME_MIN = 0.35;
const LIFETIME_MAX = 0.70;
/** Particles emitted per second while drifting. */
const EMIT_RATE = 28;
/** Side offset so puffs come from the carpet's left / right edges. */
const SIDE_OFFSET = 0.055;
/** Upward speed so dust lifts off slightly then fades. */
const UP_SPEED = 0.06;
/** Outward (side) spread speed. */
const OUT_SPEED = 0.12;

const smokeVert = `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (180.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const smokeFrag = `
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float r = dot(uv, uv) * 4.0;
  float alpha = smoothstep(1.0, 0.0, r) * vAlpha;
  if (alpha < 0.005) discard;
  // Warm sandy dust tint
  gl_FragColor = vec4(0.88, 0.80, 0.64, alpha);
}
`;

interface SmokeParticle {
  alive: boolean;
  age: number;
  lifetime: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  startAlpha: number;
}

class SmokePool {
  private pool: SmokeParticle[];
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private sizeAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly material: ShaderMaterial;
  readonly points: Points;
  private nextSlot = 0;

  constructor() {
    this.pool = Array.from({ length: POOL_SIZE }, () => ({
      alive: false, age: 0, lifetime: 1,
      px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
      startAlpha: 0,
    }));

    this.posAttr  = new BufferAttribute(new Float32Array(POOL_SIZE * 3), 3);
    this.alphaAttr = new BufferAttribute(new Float32Array(POOL_SIZE),    1);
    this.sizeAttr  = new BufferAttribute(new Float32Array(POOL_SIZE),    1);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("aAlpha",   this.alphaAttr);
    this.geometry.setAttribute("aSize",    this.sizeAttr);

    this.material = new ShaderMaterial({
      vertexShader: smokeVert,
      fragmentShader: smokeFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit(origin: Vector3, up: Vector3, right: Vector3, side: -1 | 1, driftIntensity: number) {
    const p = this.pool[this.nextSlot]!;
    this.nextSlot = (this.nextSlot + 1) % POOL_SIZE;

    p.alive = true;
    p.age   = 0;
    p.lifetime = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);

    const jUp   = UP_SPEED  * (0.5 + Math.random());
    const jOut  = OUT_SPEED * (0.5 + Math.random()) * side;
    const jBack = -Math.random() * 0.02;

    const spread = 0.025;
    p.px = origin.x + right.x * SIDE_OFFSET * side + (Math.random() - 0.5) * spread;
    p.py = origin.y + right.y * SIDE_OFFSET * side + (Math.random() - 0.5) * spread;
    p.pz = origin.z + right.z * SIDE_OFFSET * side + (Math.random() - 0.5) * spread;

    p.vx = up.x * jUp + right.x * jOut + up.x * jBack;
    p.vy = up.y * jUp + right.y * jOut + up.y * jBack;
    p.vz = up.z * jUp + right.z * jOut + up.z * jBack;

    p.startAlpha = 0.18 + driftIntensity * 0.22;
  }

  update(dt: number) {
    const positions = this.posAttr.array as Float32Array;
    const alphas    = this.alphaAttr.array as Float32Array;
    const sizes     = this.sizeAttr.array as Float32Array;

    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i]!;
      if (!p.alive) { alphas[i] = 0; sizes[i] = 0; continue; }

      p.age += dt;
      if (p.age >= p.lifetime) { p.alive = false; alphas[i] = 0; sizes[i] = 0; continue; }

      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;

      positions[i * 3]     = p.px;
      positions[i * 3 + 1] = p.py;
      positions[i * 3 + 2] = p.pz;

      const t = p.age / p.lifetime;
      alphas[i] = p.startAlpha * (1 - t) * (1 - t);
      // Puffs expand as they age
      sizes[i] = 0.06 + t * 0.18;
    }

    this.posAttr.needsUpdate  = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate  = true;
  }

  reset() {
    for (const p of this.pool) { p.alive = false; }
    (this.alphaAttr.array as Float32Array).fill(0);
    (this.sizeAttr.array as Float32Array).fill(0);
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate  = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class CarpetDriftSmoke {
  readonly group = new Group();
  private smoke: SmokePool;
  private emitAccum = 0;

  constructor() {
    this.smoke = new SmokePool();
    this.group.add(this.smoke.points);
  }

  update(
    dt: number,
    qPosition: Quaternion,
    heading: number,
    altitude: number,
    globeRadius: number,
    isDrifting: boolean,
    /** 0–1 drift angle magnitude, used to scale opacity. */
    driftIntensity: number,
  ) {
    this.smoke.update(dt);

    if (!isDrifting || driftIntensity < 0.05) {
      this.emitAccum = 0;
      return;
    }

    this.emitAccum += EMIT_RATE * driftIntensity * dt;
    const count = Math.floor(this.emitAccum);
    if (count < 1) return;
    this.emitAccum -= count;

    const frame = tangentFrame(qPosition);
    const up = frame.up;
    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(heading))
      .addScaledVector(frame.east, Math.sin(heading))
      .normalize();
    const right = new Vector3().crossVectors(forward, up).normalize();
    const origin = cartesianFromSpherical(qPosition, altitude * 0.98, globeRadius);

    for (let i = 0; i < count; i++) {
      this.smoke.emit(origin, up, right, -1, driftIntensity);
      this.smoke.emit(origin, up, right,  1, driftIntensity);
    }
  }

  reset() {
    this.emitAccum = 0;
    this.smoke.reset();
  }

  dispose() {
    this.smoke.dispose();
  }
}
