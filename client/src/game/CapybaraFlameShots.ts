import {
  AdditiveBlending,
  Mesh,
  MeshBasicMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import type { AudioManager } from "../audio/AudioManager";
import type { Carpet } from "./Carpet";
import { paintballRayFromPlaneState } from "./SphericalMath";

const FLAME_SPEED = 6.2;
const COOLDOWN_MS = 200;
const BALL_RADIUS = 0.021;
/** Tangent-arc max travel before fade-out (shorter than paintball). */
const RANGE_FACTOR = 0.36;

type Orb = {
  r0: number;
  rHat: Vector3;
  wHat: Vector3;
  traveled: number;
  maxRange: number;
  speed: number;
  mesh: Mesh;
  mat: MeshBasicMaterial;
};

/**
 * Local-only decorative fire orbs for the capybara-on-carpet; no networking or plane hits.
 */
export class CapybaraFlameShots {
  private orbs: Orb[] = [];
  private lastFireMs = 0;

  constructor(
    private readonly scene: Scene,
    private globeRadius: number,
  ) {}

  setGlobeRadius(r: number) {
    this.globeRadius = r;
  }

  tryFire(carpet: Carpet, audio: AudioManager | null) {
    if (!carpet.hasCapybara) return;

    const now = performance.now();
    if (now - this.lastFireMs < COOLDOWN_MS) return;
    this.lastFireMs = now;

    const ray = paintballRayFromPlaneState(
      carpet.qPosition,
      carpet.heading,
      carpet.pitch,
      carpet.altitude,
      this.globeRadius,
    );
    const o = ray.origin;
    const r0 = Math.max(1e-4, o.length());
    const rHat = o.clone().divideScalar(r0);
    let wHat = ray.direction.clone();
    wHat.sub(rHat.clone().multiplyScalar(wHat.dot(rHat)));
    if (wHat.lengthSq() < 1e-8) return;
    wHat.normalize();

    const mat = new MeshBasicMaterial({
      color: 0xff8833,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const geo = new SphereGeometry(BALL_RADIUS, 8, 8);
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 300;
    const theta0 = 0;
    const r = r0;
    mesh.position
      .copy(rHat)
      .multiplyScalar(r * Math.cos(theta0))
      .addScaledVector(wHat, r * Math.sin(theta0));
    this.scene.add(mesh);

    this.orbs.push({
      r0,
      rHat,
      wHat,
      traveled: 0,
      maxRange: this.globeRadius * RANGE_FACTOR,
      speed: FLAME_SPEED,
      mesh,
      mat,
    });

    if (audio?.hasSFX("shoot_1")) {
      audio.playSFX("shoot_1", 0.28, 0.9 + Math.random() * 0.08);
    }
  }

  update(dt: number) {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const p = this.orbs[i]!;
      const step = p.speed * dt;
      p.traveled += step;
      const theta = p.traveled / p.r0;
      const r = p.r0;
      p.mesh.position
        .copy(p.rHat)
        .multiplyScalar(r * Math.cos(theta))
        .addScaledVector(p.wHat, r * Math.sin(theta));

      const tr = p.traveled / p.maxRange;
      const fade = Math.max(0, 1 - Math.pow(Math.min(1, tr), 1.1));
      p.mat.opacity = fade * 0.95;

      if (p.traveled >= p.maxRange || fade <= 0.02) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mat.dispose();
        this.orbs.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const p of this.orbs) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mat.dispose();
    }
    this.orbs.length = 0;
  }
}
