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

const SHOT_SPEED = 3.5;
/** Cooldown starts after the 3rd ball of a burst. */
const COOLDOWN_MS = 300;
const BALL_RADIUS = 0.016;
/** Tangent-arc max travel before fade-out. */
const RANGE_FACTOR = 0.36;
/** Radial (up) offset from carpet center to capybara muzzle (bodyH/2 + model.position.y). */
const MUZZLE_UP = 0.026;
/** Forward offset from carpet center to capybara snout along the tangent plane. */
const MUZZLE_FORWARD = 0.1;
/** Base spread between the three shots (radians) in the tangent plane. */
const TRIPLE_SPREAD = 0.018;
/** Additional random rotation per shot (radians). */
const ANGLE_JITTER = 0.008;
/** Delay between the three orbs in one burst. */
const BURST_SPACING_MS = 90;

const WHITE = 0xffffff;
const CORE_OPACITY = 0.75;
/** World-space diameter of the sprite glow halo. */
const GLOW_SIZE = 0.18;
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
  r0: number;
  rHat: Vector3;
  wHat: Vector3;
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
  r0: number;
  rHat: Vector3;
  w0: Vector3;
  /** Unix ms for shots 0,1,2. */
  atMs: [number, number, number];
  /** Next shot index to emit (0..3). */
  next: number;
  deltas: [number, number, number];
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
 * (simulates bloom without a post-processing pass) + a white ribbon trail.
 */
export class CapybaraFlameShots {
  private orbs: Orb[] = [];
  private lastBurstEndMs = -COOLDOWN_MS;
  private activeBurst: ActiveBurst | null = null;

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

    // Shift origin to the capybara's actual world position (above + forward of carpet center).
    const muzzle = o.clone()
      .addScaledVector(rHat, MUZZLE_UP)
      .addScaledVector(w0, MUZZLE_FORWARD);
    const r0 = Math.max(1e-4, muzzle.length());
    const rHatMuzzle = muzzle.clone().divideScalar(r0);

    const t0 = now;
    const j = () => (Math.random() * 2 - 1) * ANGLE_JITTER;
    this.activeBurst = {
      r0,
      rHat: rHatMuzzle,
      w0: w0.clone(),
      atMs: [t0, t0 + BURST_SPACING_MS, t0 + 2 * BURST_SPACING_MS],
      next: 0,
      deltas: [
        -TRIPLE_SPREAD + j(),
        j() * 0.15,
        TRIPLE_SPREAD + j(),
      ] as [number, number, number],
    };

    this.emitReadyBursts(performance.now());

    if (audio?.hasSFX("shoot_1")) {
      audio.playSFX("shoot_1", 0.28, 0.9 + Math.random() * 0.08);
    }
  }

  private emitReadyBursts(now: number) {
    const b = this.activeBurst;
    if (!b) return;
    const wTmp = new Vector3();
    while (b.next < 3 && now + 0.5 >= b.atMs[b.next]!) {
      wRotated(b.w0, b.rHat, b.deltas[b.next]!, wTmp);
      this.spawnOne(b.r0, b.rHat, wTmp);
      b.next += 1;
    }
    if (b.next >= 3) {
      this.lastBurstEndMs = performance.now();
      this.activeBurst = null;
    }
  }

  private spawnOne(r0: number, rHat: Vector3, wDir: Vector3) {
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

    group.position
      .copy(rHat)
      .multiplyScalar(r0);

    this.scene.add(group);

    this.orbs.push({
      r0,
      rHat: rHat.clone(),
      wHat: wDir.clone(),
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
      const theta = p.traveled / p.r0;
      const r = p.r0;
      p.group.position
        .copy(p.rHat)
        .multiplyScalar(r * Math.cos(theta))
        .addScaledVector(p.wHat, r * Math.sin(theta));

      const tr = p.traveled / p.maxRange;
      const fade = Math.max(0, 1 - Math.pow(Math.min(1, tr), 1.1));
      p.glowMat.opacity = fade * GLOW_OPACITY;
      p.coreMat.opacity = fade * CORE_OPACITY;

      if (p.traveled >= p.maxRange || fade <= 0.02) {
        this.removeOrb(p, i);
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
