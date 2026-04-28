import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Scene,
  ShaderMaterial,
  AdditiveBlending,
  Vector3,
} from "three";
import {
  cartesianFromSpherical,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";

export const LANTERN_CLUSTER_COUNT = 5;
export const LANTERN_XP = 30;

const CLUSTER_ALTITUDE = 0.55;
const CLUSTER_SPREAD = 0.4;
const SWAY_SPEED = 0.35;
const SWAY_AMP = 0.018;
const BOB_SPEED = 0.6;
const BOB_AMP = 0.012;
const FLY_THROUGH_DIST = 0.32;
const REWARD_COOLDOWN_SEC = 80;
const MIN_LANTERNS = 12;
const MAX_LANTERNS = 16;

/* ── Shader ─────────────────────────────────────────────────────── */

const lanternVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 worldPos = instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * worldPos;
}
`;

const lanternFrag = /* glsl */ `
uniform float uNightWeight;
uniform float uFlicker;
varying vec2 vUv;

void main() {
  float d = distance(vUv, vec2(0.5));

  vec3 brightCore = vec3(1.0, 0.45, 0.2);
  vec3 warmRed = vec3(0.9, 0.15, 0.05);
  vec3 deepRed = vec3(0.6, 0.05, 0.02);

  float t = smoothstep(0.0, 0.55, d);
  vec3 col = mix(brightCore, warmRed, t);
  col = mix(col, deepRed, smoothstep(0.35, 0.7, d));

  float emissive = (1.0 - smoothstep(0.0, 0.45, d)) * 0.7;
  col += vec3(emissive * 0.4, emissive * 0.1, emissive * 0.02);

  float flicker = 0.95 + 0.05 * uFlicker;
  float alpha = flicker * uNightWeight;

  gl_FragColor = vec4(col * 2.0, alpha);
}
`;

/* ── Per-lantern state ──────────────────────────────────────────── */

interface LanternData {
  localOffset: Vector3;
  phase: number;
  bobPhase: number;
  driftSpeed: number;
  driftOffset: number;
  pos: Vector3;
}

/* ── Class ──────────────────────────────────────────────────────── */

export class FloatingLanterns {
  readonly group = new Group();
  readonly lanternCount: number;

  private globeRadius: number;
  private material: ShaderMaterial;
  private geometry: BoxGeometry;
  private instancedMesh: InstancedMesh;
  private lanterns: LanternData[] = [];

  private qPosition = new Quaternion();
  private clusterCenter = new Vector3();
  private up = new Vector3();
  private north = new Vector3();
  private east = new Vector3();

  private rewarded = false;
  private cooldown = 0;
  private fadeOut = 0;
  private fadeIn = 0;
  private time = 0;
  private static readonly FADE_OUT_SEC = 0.35;
  private static readonly FADE_IN_SEC = 0.3;

  private tmpMat = new Matrix4();
  private tmpPos = new Vector3();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3(1, 1, 1);
  private lookTarget = new Vector3();

  constructor(scene: Scene, globeRadius: number, worldSeed: number, clusterIndex: number) {
    this.globeRadius = globeRadius;

    const seedVal = worldSeed + clusterIndex * 834712963;
    const countHash = this.hashInt(seedVal ^ 0x1a2b3c4d);
    this.lanternCount = MIN_LANTERNS + (((countHash & 0xff) >>> 0) % (MAX_LANTERNS - MIN_LANTERNS + 1));

    this.geometry = new BoxGeometry(0.022, 0.055, 0.022);
    this.material = new ShaderMaterial({
      vertexShader: lanternVert,
      fragmentShader: lanternFrag,
      uniforms: {
        uNightWeight: { value: 0 },
        uFlicker: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.instancedMesh = new InstancedMesh(this.geometry, this.material, this.lanternCount);
    this.instancedMesh.frustumCulled = false;
    this.group.add(this.instancedMesh);

    this.placeOnGlobe(seedVal, clusterIndex);

    for (let i = 0; i < this.lanternCount; i++) {
      const hash = this.hashInt(seedVal + i * 7919);
      const localOffset = new Vector3(
        ((hash & 0xff) / 255 - 0.5) * CLUSTER_SPREAD,
        ((hash >> 8 & 0xff) / 255) * CLUSTER_SPREAD * 0.5,
        ((hash >> 16 & 0xff) / 255 - 0.5) * CLUSTER_SPREAD,
      );
      const phase = ((hash >> 4 & 0xff) / 255) * Math.PI * 2;
      const bobPhase = ((hash >> 12 & 0xff) / 255) * Math.PI * 2;
      const driftHash = this.hashInt(seedVal + i * 3571);
      const driftSpeed = (0.06 + ((driftHash & 0xff) / 255) * 0.12) * this.globeRadius;

      this.lanterns.push({ localOffset, phase, bobPhase, driftSpeed, driftOffset: 0, pos: new Vector3() });
    }

    scene.add(this.group);
  }

  private hashInt(n: number): number {
    n = ((n >> 16) ^ n) * 0x45d9f3b;
    n = ((n >> 16) ^ n) * 0x45d9f3b;
    n = (n >> 16) ^ n;
    return n & 0xffffff;
  }

  private placeOnGlobe(seed: number, index: number) {
    const spawn = randomSpawnQuaternionAndHeading(seed + index * 419430467);
    this.qPosition.copy(spawn.qPosition);

    const frame = tangentFrame(this.qPosition);
    this.up.copy(frame.up);
    this.north.copy(frame.north);
    this.east.copy(frame.east);

    this.clusterCenter.copy(
      cartesianFromSpherical(this.qPosition, CLUSTER_ALTITUDE, this.globeRadius),
    );
  }

  private respawn(seed: number, index: number) {
    this.placeOnGlobe(seed, index);
    this.rewarded = false;
    this.cooldown = 0;
    this.fadeOut = 0;
    this.fadeIn = FloatingLanterns.FADE_IN_SEC;
    for (const l of this.lanterns) l.driftOffset = 0;
    this.group.visible = true;
  }

  update(
    dt: number,
    playerQ: Quaternion,
    playerAlt: number,
    nightWeight: number,
    clusterIndex: number,
    worldSeed: number,
  ): { justCollected: boolean } {
    this.time += dt;

    /* ── Visibility / fade ─────────────────────────────────────── */
    const sharpNight = nightWeight * nightWeight * (3 - 2 * nightWeight);
    let opacity = sharpNight;

    if (this.fadeOut > 0) {
      this.fadeOut = Math.max(0, this.fadeOut - dt);
      opacity *= this.fadeOut / FloatingLanterns.FADE_OUT_SEC;
    } else if (this.rewarded) {
      opacity = 0;
    }

    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt);
      opacity *= 1 - this.fadeIn / FloatingLanterns.FADE_IN_SEC;
    }

    const flicker = Math.sin(this.time * 5.3) * 0.5 + Math.sin(this.time * 8.7) * 0.3 + 0.5;
    this.material.uniforms.uNightWeight.value = opacity;
    this.material.uniforms.uFlicker.value = flicker;
    this.group.visible = opacity > 0.01;

    /* ── Position each lantern instance with smooth bob & sway ── */
    for (let i = 0; i < this.lanterns.length; i++) {
      const l = this.lanterns[i]!;

      if (this.rewarded) {
        l.driftOffset += l.driftSpeed * dt;
      }

      const bob = Math.sin(this.time * BOB_SPEED + l.bobPhase) * BOB_AMP;
      const swayX = Math.sin(this.time * SWAY_SPEED + l.phase) * SWAY_AMP;
      const swayZ = Math.cos(this.time * SWAY_SPEED * 0.7 + l.phase * 1.3) * SWAY_AMP;

      l.pos
        .copy(this.clusterCenter)
        .addScaledVector(this.north, l.localOffset.x + swayX)
        .addScaledVector(this.up, l.localOffset.y + bob + l.driftOffset)
        .addScaledVector(this.east, l.localOffset.z + swayZ);

      this.lookTarget.copy(l.pos).add(this.north);
      this.tmpMat.lookAt(l.pos, this.lookTarget, this.up);
      this.tmpQuat.setFromRotationMatrix(this.tmpMat);

      this.tmpMat.compose(l.pos, this.tmpQuat, this.tmpScale);
      this.instancedMesh.setMatrixAt(i, this.tmpMat);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    /* ── Cooldown ──────────────────────────────────────────────── */
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        const newSeed = worldSeed + clusterIndex * 834712963 + Math.floor(this.time * 100);
        this.respawn(newSeed, clusterIndex);
      }
      return { justCollected: false };
    }

    if (this.rewarded) return { justCollected: false };
    if (nightWeight < 0.15) return { justCollected: false };

    /* ── Fly-through detection ─────────────────────────────────── */
    const playerPos = this.tmpPos.copy(
      cartesianFromSpherical(playerQ, playerAlt, this.globeRadius),
    );

    let minDist = Infinity;
    for (const l of this.lanterns) {
      const d = playerPos.distanceTo(l.pos);
      if (d < minDist) minDist = d;
    }

    let justCollected = false;
    if (minDist < FLY_THROUGH_DIST) {
      this.rewarded = true;
      justCollected = true;
      this.cooldown = REWARD_COOLDOWN_SEC;
      this.fadeOut = FloatingLanterns.FADE_OUT_SEC;
    }

    return { justCollected };
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.instancedMesh.dispose();
    this.group.removeFromParent();
  }
}
