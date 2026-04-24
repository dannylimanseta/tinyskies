import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { AudioManager } from "../audio/AudioManager";
import type { Carpet } from "./Carpet";
import { paintballRayFromPlaneState } from "./SphericalMath";

/** 40% slower than the original 3.5. */
const SHOT_SPEED = 2.1;
/** Cooldown after each burst completes. */
const COOLDOWN_MS = 300;
const SHOTS_PER_BURST = 1;
export const CAPYBARA_BALL_RADIUS = 0.0104;
const BALL_RADIUS = CAPYBARA_BALL_RADIUS;
/** Linear (world) max travel from muzzle before fade-out. */
const RANGE_FACTOR = 0.36;
/** Radial (up) offset from carpet center to capybara muzzle (bodyH/2 + model.position.y). */
const MUZZLE_UP = 0.026;
/** Forward offset from carpet center to capybara snout along the tangent plane. */
const MUZZLE_FORWARD = 0.1;
/** Optional yaw jitter on the single shot (radians). */
const ANGLE_JITTER = 0.008;
/** Delay after shot 0 before shot 1, etc. (only used if SHOTS_PER_BURST > 1). */
const BURST_SPACING_MS = 90;

const WHITE = 0xffffff;
const CORE_OPACITY = 0.75;
/** World-space diameter of the sprite glow halo. */
const GLOW_SIZE = 0.09;
/** Peak opacity of the glow sprite (additive, so actual brightness is higher). */
const GLOW_OPACITY = 0.9;

/** Shared radial-gradient texture — created once, reused for every orb. */
let glowTexCache: CanvasTexture | null = null;
function getGlowTexture(): CanvasTexture {
  if (glowTexCache) return glowTexCache;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.00, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.15, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.40, "rgba(200,220,255,0.45)");
  grad.addColorStop(0.70, "rgba(180,210,255,0.12)");
  grad.addColorStop(1.00, "rgba(180,210,255,0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  glowTexCache = tex;
  return tex;
}

type Orb = {
  /** Muzzle world position. */
  start: Vector3;
  /** Initial tangent direction (unit); straight-line motion in world space. */
  dir: Vector3;
  traveled: number;
  maxRange: number;
  speed: number;
  group: Group;
  core: Mesh;
  coreMat: MeshBasicMaterial;
  glowSprite: Sprite;
  glowMat: SpriteMaterial;
};

type ActiveBurst = {
  muzzle: Vector3;
  w0: Vector3;
  /** Axis for yaw jitter: world radial (sphere) or void plane up. */
  rotAxis: Vector3;
  atMs: number[];
  next: number;
  deltas: number[];
};

/**
 * Rotate `wBase` (unit, tangent) around `rHat` (radial) by `delta` radians, staying in the tangent plane.
 */
function wRotated(
  wBase: Vector3,
  rHat: Vector3,
  delta: number,
  out: Vector3,
): void {
  const c = new Vector3().crossVectors(rHat, wBase);
  if (c.lengthSq() < 1e-10) {
    out.copy(wBase);
    return;
  }
  c.normalize();
  out
    .copy(wBase)
    .multiplyScalar(Math.cos(delta))
    .addScaledVector(c, Math.sin(delta))
    .normalize();
}

/**
 * Local-only projectiles for the capybara-on-carpet.
 * Each orb is a small white core sphere + a camera-facing radial-gradient sprite glow
 * (simulates bloom without a post-processing pass), moving in a straight line in world space.
 */
export class CapybaraFlameShots {
  private orbs: Orb[] = [];
  private lastBurstEndMs = -COOLDOWN_MS;
  private activeBurst: ActiveBurst | null = null;
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _c = new Vector3();

  constructor(
    private readonly scene: Scene,
    private globeRadius: number,
  ) {}

  setGlobeRadius(r: number) {
    this.globeRadius = r;
  }

  tryFire(carpet: Carpet, audio: AudioManager | null) {
    if (!carpet.hasCapybara) return;
    if (this.activeBurst) return;

    const now = performance.now();
    if (now - this.lastBurstEndMs < COOLDOWN_MS) return;

    const t0 = now;
    const j = () => (Math.random() * 2 - 1) * ANGLE_JITTER;
    const atMs: number[] = [];
    const deltas: number[] = [];
    for (let s = 0; s < SHOTS_PER_BURST; s++) {
      atMs.push(t0 + s * BURST_SPACING_MS);
      deltas.push(j());
    }

    if (carpet.isVoidPlaneFlight) {
      carpet.getVoidPlaneWorldPos(this._a);
      this._b
        .set(0, 0, 0)
        .addScaledVector(carpet.getVoidPlaneNorth(), Math.cos(carpet.heading))
        .addScaledVector(carpet.getVoidPlaneEast(), Math.sin(carpet.heading))
        .normalize();
      const muzzle = this._c
        .copy(this._a)
        .addScaledVector(carpet.getVoidPlaneUp(), MUZZLE_UP)
        .addScaledVector(this._b, MUZZLE_FORWARD);
      this.activeBurst = {
        muzzle: muzzle.clone(),
        w0: this._b.clone(),
        rotAxis: carpet.getVoidPlaneUp().clone(),
        atMs,
        next: 0,
        deltas,
      };
    } else {
      const ray = paintballRayFromPlaneState(
        carpet.qPosition,
        carpet.heading,
        carpet.pitch,
        carpet.altitude,
        this.globeRadius,
      );
      const o = ray.origin;
      const baseR = Math.max(1e-4, o.length());
      const rHat = o.clone().divideScalar(baseR);
      const w0 = ray.direction.clone();
      w0.sub(rHat.clone().multiplyScalar(w0.dot(rHat)));
      if (w0.lengthSq() < 1e-8) return;
      w0.normalize();

      const muzzle = o
        .clone()
        .addScaledVector(rHat, MUZZLE_UP)
        .addScaledVector(w0, MUZZLE_FORWARD);
      const r0 = Math.max(1e-4, muzzle.length());
      const rHatMuzzle = muzzle.clone().divideScalar(r0);
      this.activeBurst = {
        muzzle: muzzle.clone(),
        w0: w0.clone(),
        rotAxis: rHatMuzzle,
        atMs,
        next: 0,
        deltas,
      };
    }

    this.emitReadyBursts(performance.now());

    if (audio?.hasSFX("shoot_2")) {
      audio.playSFX("shoot_2", 0.28, 0.9 + Math.random() * 0.08);
    }
  }

  private emitReadyBursts(now: number) {
    const b = this.activeBurst;
    if (!b) return;
    const wTmp = new Vector3();
    while (b.next < b.atMs.length && now + 0.5 >= b.atMs[b.next]!) {
      wRotated(b.w0, b.rotAxis, b.deltas[b.next] ?? 0, wTmp);
      this.spawnOne(b.muzzle, wTmp);
      b.next += 1;
    }
    if (b.next >= b.atMs.length) {
      this.lastBurstEndMs = performance.now();
      this.activeBurst = null;
    }
  }

  private spawnOne(muzzle: Vector3, wDir: Vector3) {
    const group = new Group();
    group.renderOrder = 300;

    // Sprite glow — camera-facing radial gradient, simulates bloom.
    const glowMat = new SpriteMaterial({
      map: getGlowTexture(),
      color: WHITE,
      transparent: true,
      opacity: GLOW_OPACITY,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const glowSprite = new Sprite(glowMat);
    glowSprite.scale.setScalar(GLOW_SIZE);
    glowSprite.renderOrder = 299;
    group.add(glowSprite);

    // Tight core sphere.
    const coreMat = new MeshBasicMaterial({
      color: WHITE,
      transparent: true,
      opacity: CORE_OPACITY,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const coreGeo = new SphereGeometry(BALL_RADIUS, 12, 12);
    const core = new Mesh(coreGeo, coreMat);
    group.add(core);

    const start = muzzle.clone();
    group.position.copy(start);

    this.scene.add(group);

    this.orbs.push({
      start,
      dir: wDir.clone(),
      traveled: 0,
      maxRange: this.globeRadius * RANGE_FACTOR,
      speed: SHOT_SPEED,
      group,
      core,
      coreMat,
      glowSprite,
      glowMat,
    });
  }

  update(dt: number, _cameraPos: Vector3) {
    this.emitReadyBursts(performance.now());

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const p = this.orbs[i]!;
      const step = p.speed * dt;
      p.traveled += step;
      p.group.position.copy(p.start).addScaledVector(p.dir, p.traveled);

      const tr = p.traveled / p.maxRange;
      const fade = Math.max(0, 1 - Math.pow(Math.min(1, tr), 1.1));
      p.glowMat.opacity = fade * GLOW_OPACITY;
      p.coreMat.opacity = fade * CORE_OPACITY;

      if (p.traveled >= p.maxRange || fade <= 0.02) {
        this.removeOrb(p, i);
      }
    }
  }

  /**
   * For each target sphere, if any orb is within (orb radius + target radius) the `onHit` callback runs
   * and the orb is removed. Useful for void moths and similar (run after `update`).
   */
  testSphereHits(
    targets: { position: Vector3; hitRadius: number; onHit: () => void }[],
  ) {
    if (targets.length === 0) return;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const p = this.orbs[i]!;
      const op = p.group.position;
      for (const t of targets) {
        if (t.position.distanceTo(op) < BALL_RADIUS + t.hitRadius) {
          t.onHit();
          this.removeOrb(p, i);
          break;
        }
      }
    }
  }

  private removeOrb(p: Orb, index: number) {
    this.scene.remove(p.group);
    p.glowMat.dispose();
    p.core.geometry.dispose();
    p.coreMat.dispose();
    this.orbs.splice(index, 1);
  }

  dispose() {
    this.activeBurst = null;
    while (this.orbs.length > 0) {
      const p = this.orbs.pop()!;
      this.scene.remove(p.group);
      p.glowMat.dispose();
      p.core.geometry.dispose();
      p.coreMat.dispose();
    }
  }
}
