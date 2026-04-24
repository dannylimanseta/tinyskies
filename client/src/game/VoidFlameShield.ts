import {
  AdditiveBlending,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";
import type { AudioManager } from "../audio/AudioManager";
import { holoVert } from "./Rings";

const SHIELD_MAX_HP = 12;
const COLLISION_RADIUS = 0.17;
const HIT_BOOST_SMOOTH = 11;
/** ~60% slower white hit / pulse than 12.0 (longer, calmer flash). */
const HIT_FLASH_DECAY = 4.8;
/** Subtle “breath” when HP is 1 or 2 (same logic as uLowHpPulse < 3 in JS). */
const LOW_HP_PULSE_HZ = 3.6;
/** Scales shader time + mesh spin; ~40% speed = ~60% slower anim than unscaled. */
const SHIELD_TIME_SCALE = 0.4;

/**
 * Holo look aligned with `Rings` diamonds, plus rim lighting, shimmer scan,
 * HP-based opacity fade, `uHitFlash` / `uLowHpPulse` for impact and critical state.
 */
const holoFragVoidShield = `
uniform float time;
uniform float phaseOffset;
uniform float spawnScale;
uniform float uHitFlash;
uniform float uLowHpPulse;
uniform float uHpRatio;

varying vec3 vWorldPos;
varying vec3 vNorm;
varying vec3 vViewDir;

vec3 hueShift(float h) {
  vec3 k = mod(vec3(h * 6.0, h * 6.0 + 4.0, h * 6.0 + 2.0), 6.0);
  return clamp(min(k, 4.0 - k), 0.0, 1.0);
}

void main() {
  float fresnel = 1.0 - abs(dot(vViewDir, vNorm));
  fresnel = pow(fresnel, 1.0);

  float facetAngle = dot(vNorm, vec3(0.577, 0.577, 0.577));
  float hue = fract(fresnel * 1.2 + facetAngle * 0.4 + time * 0.15 + phaseOffset * 0.16);
  vec3 rainbow = hueShift(hue);

  float glint = 0.88 + 0.12 * sin(facetAngle * 28.0 + time * 4.0);
  float pulse = 0.86 + 0.14 * sin(time * 2.2 + phaseOffset);

  vec3 cool = vec3(0.45, 0.9, 1.0);
  vec3 base = mix(rainbow, cool, 0.76) * (0.64 + fresnel * 0.44) * glint * pulse;
  base *= 0.82;

  // Shimmer: two crossing scan lines that loop across the surface
  float sh1 = sin(vWorldPos.x * 9.0 + time * 2.4 + vWorldPos.y * 5.0) * 0.5 + 0.5;
  float sh2 = sin(vWorldPos.z * 7.0 - time * 1.8 + vWorldPos.y * 3.5) * 0.5 + 0.5;
  float shimmer = pow(sh1 * sh2, 5.0) * 0.55;
  vec3 shimmerCol = vec3(0.55, 0.88, 1.0) * shimmer;

  vec3 col = mix(base, vec3(1.0), fresnel * 0.28);
  col = mix(col, vec3(1.0), uHitFlash * 0.92);
  col += shimmerCol;

  float a = (0.24 + fresnel * 0.45) * pulse * glint * spawnScale * 0.92;
  a *= uLowHpPulse;
  // Fade shield visibility as HP drains (never fully invisible until hp=0 handled in JS)
  a *= (0.35 + 0.65 * uHpRatio);
  a = min(1.0, a);

  gl_FragColor = vec4(col, a);
}
`;

export class VoidFlameShield {
  readonly group = new Group();
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private hitPoints = SHIELD_MAX_HP;
  private hitBoost = 1;
  private hitFlash = 0;
  private shaderTime = 0;
  private readonly phaseOffset: number;

  constructor(
    private readonly audio: AudioManager | null,
    private readonly shieldHitSfxId: string,
    private readonly shieldHitSfxVolume: number,
  ) {
    this.phaseOffset = Math.random() * Math.PI * 2;
    const geo = new IcosahedronGeometry(1, 2);
    this.mat = new ShaderMaterial({
      vertexShader: holoVert,
      fragmentShader: holoFragVoidShield,
      uniforms: {
        time: { value: 0 },
        phaseOffset: { value: this.phaseOffset },
        spawnScale: { value: 1 },
        uHitFlash: { value: 0 },
        uLowHpPulse: { value: 1 },
        uHpRatio: { value: 1 },
      },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.renderOrder = 121;
    this.group.add(this.mesh);
    this.group.scale.setScalar(COLLISION_RADIUS);
  }

  canBlock(): boolean {
    return this.hitPoints > 0;
  }

  getHitPoints(): number {
    return this.hitPoints;
  }

  getMaxHitPoints(): number {
    return SHIELD_MAX_HP;
  }

  /** Restore up to `amount` HP, capped at max. */
  heal(amount: number) {
    this.hitPoints = Math.min(SHIELD_MAX_HP, this.hitPoints + amount);
  }

  /** Instantly drain the shield to 0 HP (debug use). */
  deplete() {
    this.hitPoints = 0;
  }

  getCollisionRadius(): number {
    return COLLISION_RADIUS;
  }

  getWorldPosition(out: Vector3) {
    this.group.updateMatrixWorld(true);
    return this.group.getWorldPosition(out);
  }

  registerMothImpact() {
    if (this.hitPoints <= 0) return;
    this.hitPoints -= 1;
    this.hitBoost = 1.55;
    this.hitFlash = 1;
    this.audio?.playSFX(this.shieldHitSfxId, this.shieldHitSfxVolume);
  }

  update(dt: number) {
    this.mesh.visible = this.hitPoints > 0.01;
    this.shaderTime += dt * SHIELD_TIME_SCALE;
    this.mat.uniforms.time.value = this.shaderTime;
    this.hitBoost += (1 - this.hitBoost) * (1 - Math.exp(-HIT_BOOST_SMOOTH * dt));
    if (this.hitBoost < 1.0005) this.hitBoost = 1;
    this.mat.uniforms.spawnScale.value = this.hitBoost;

    if (this.hitFlash > 0.001) {
      this.hitFlash *= Math.exp(-HIT_FLASH_DECAY * dt);
      if (this.hitFlash < 0.01) this.hitFlash = 0;
    } else {
      this.hitFlash = 0;
    }
    (this.mat.uniforms.uHitFlash as { value: number }).value = this.hitFlash;

    // HP 1 or 2: breathing fade; 3+ full opacity when visible
    let pulse = 1;
    if (this.hitPoints > 0 && this.hitPoints < 3) {
      pulse = 0.22 + 0.78 * (0.5 + 0.5 * Math.sin(
        this.shaderTime * (Math.PI * 2) * LOW_HP_PULSE_HZ + this.phaseOffset,
      ));
    }
    (this.mat.uniforms.uLowHpPulse as { value: number }).value = pulse;
    (this.mat.uniforms.uHpRatio as { value: number }).value =
      SHIELD_MAX_HP > 0 ? this.hitPoints / SHIELD_MAX_HP : 0;

    this.mesh.rotation.y += dt * 0.55 * SHIELD_TIME_SCALE;
    this.mesh.rotation.x += dt * 0.12 * SHIELD_TIME_SCALE;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.group.clear();
  }
}
