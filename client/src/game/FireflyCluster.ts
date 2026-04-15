import {
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Vector3,
} from "three";
import {
  cartesianFromSpherical,
  quaternionFromSurfaceNormal,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";
import { isLand } from "./SimplexNoise";
import { surfaceAltitudeAt } from "./TerrainSurface";

export const FIREFLY_CLUSTER_COUNT = 6;
export const FIREFLY_XP = 15;

const FLIES_PER_CLUSTER = 32;
const HOVER_HEIGHT = 0.06;
const CLUSTER_SPREAD = 0.3;
const CLUSTER_SPREAD_Y = 0.12;
const FLY_THROUGH_DIST = 0.3;
const REWARD_COOLDOWN_SEC = 60;

/* ── Shader ─────────────────────────────────────────────────────── */

const fireflyVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 mvPos = modelViewMatrix * instancePos;

  float scaleX = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float scaleY = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));

  mvPos.xy += position.xy * vec2(scaleX, scaleY);
  gl_Position = projectionMatrix * mvPos;
}
`;

const fireflyFrag = /* glsl */ `
uniform float uNightWeight;
uniform float uTime;
varying vec2 vUv;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.5, d);
  float halo = 1.0 - smoothstep(0.0, 1.0, d);

  vec3 brightCore = vec3(1.0, 0.85, 0.3);
  vec3 warmOrange = vec3(1.0, 0.5, 0.05);
  vec3 col = mix(warmOrange, brightCore, core);

  float emissive = core * 0.8;
  col += vec3(emissive * 0.5, emissive * 0.25, emissive * 0.02);

  float glow = core + halo * 0.5;
  float alpha = glow * uNightWeight;

  gl_FragColor = vec4(col * 2.8, alpha);
}
`;

/* ── Per-firefly state ──────────────────────────────────────────── */

interface FireflyData {
  localOffset: Vector3;
  orbitPhase: number;
  orbitSpeed: number;
  orbitRadius: number;
  blinkPhase: number;
  blinkSpeed: number;
  pos: Vector3;
}

/* ── Class ──────────────────────────────────────────────────────── */

export class FireflyCluster {
  readonly group = new Group();

  private globeRadius: number;
  private seed: number;
  private terrainType: string;
  private material: ShaderMaterial;
  private geometry: PlaneGeometry;
  private instancedMesh: InstancedMesh;
  private flies: FireflyData[] = [];

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
  private static readonly FADE_OUT_SEC = 1.0;
  private static readonly FADE_IN_SEC = 1.5;

  private tmpMat = new Matrix4();
  private tmpPos = new Vector3();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();

  constructor(
    scene: Scene,
    globeRadius: number,
    worldSeed: number,
    terrainType: string,
    clusterIndex: number,
  ) {
    this.globeRadius = globeRadius;
    this.seed = worldSeed;
    this.terrainType = terrainType;

    this.geometry = new PlaneGeometry(0.02, 0.02);
    this.material = new ShaderMaterial({
      vertexShader: fireflyVert,
      fragmentShader: fireflyFrag,
      uniforms: {
        uNightWeight: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });

    this.instancedMesh = new InstancedMesh(this.geometry, this.material, FLIES_PER_CLUSTER);
    this.instancedMesh.frustumCulled = false;
    this.group.add(this.instancedMesh);

    this.spawnOnLand(worldSeed, clusterIndex);

    for (let i = 0; i < FLIES_PER_CLUSTER; i++) {
      const h = this.hashInt(worldSeed + clusterIndex * 713 + i * 5381);
      const localOffset = new Vector3(
        ((h & 0xff) / 255 - 0.5) * CLUSTER_SPREAD,
        ((h >> 8 & 0xff) / 255) * CLUSTER_SPREAD_Y,
        ((h >> 16 & 0xff) / 255 - 0.5) * CLUSTER_SPREAD,
      );
      const orbitPhase = ((h >> 4 & 0xff) / 255) * Math.PI * 2;
      const orbitSpeed = 0.8 + ((h >> 10 & 0xff) / 255) * 1.4;
      const orbitRadius = 0.01 + ((h >> 2 & 0xff) / 255) * 0.025;
      const blinkPhase = ((h >> 6 & 0xff) / 255) * Math.PI * 2;
      const blinkSpeed = 1.5 + ((h >> 14 & 0xff) / 255) * 3.0;

      this.flies.push({
        localOffset,
        orbitPhase,
        orbitSpeed,
        orbitRadius,
        blinkPhase,
        blinkSpeed,
        pos: new Vector3(),
      });
    }

    scene.add(this.group);
  }

  private hashInt(n: number): number {
    n = ((n >> 16) ^ n) * 0x45d9f3b;
    n = ((n >> 16) ^ n) * 0x45d9f3b;
    n = (n >> 16) ^ n;
    return n & 0xffffff;
  }

  private setClusterLocation(qPosition: Quaternion, surfAlt: number) {
    const frame = tangentFrame(qPosition);
    this.qPosition.copy(qPosition);
    this.up.copy(frame.up);
    this.north.copy(frame.north);
    this.east.copy(frame.east);
    this.clusterCenter.copy(
      cartesianFromSpherical(this.qPosition, surfAlt + HOVER_HEIGHT, this.globeRadius),
    );
  }

  private spawnOnLand(seed: number, index: number) {
    const MAX_ATTEMPTS = 20;
    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      const spawn = randomSpawnQuaternionAndHeading(seed + index * 419430467 + a * 104729);
      const frame = tangentFrame(spawn.qPosition);
      if (!isLand(this.seed, this.terrainType, frame.up.x, frame.up.y, frame.up.z)) {
        continue;
      }
      const surfAlt = surfaceAltitudeAt(
        this.seed,
        this.terrainType,
        frame.up.x,
        frame.up.y,
        frame.up.z,
      );
      this.setClusterLocation(spawn.qPosition, surfAlt);
      return;
    }

    for (let k = 0; k < 128; k++) {
      const y = 1 - (k / 127) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = k * 0.6180339887 * Math.PI * 2;
      const nx = Math.cos(theta) * r;
      const ny = y;
      const nz = Math.sin(theta) * r;
      if (!isLand(this.seed, this.terrainType, nx, ny, nz)) continue;

      const qPosition = quaternionFromSurfaceNormal(nx, ny, nz);
      const surfAlt = surfaceAltitudeAt(this.seed, this.terrainType, nx, ny, nz);
      this.setClusterLocation(qPosition, surfAlt);
      return;
    }

    const spawn = randomSpawnQuaternionAndHeading(seed + index * 419430467);
    const frame = tangentFrame(spawn.qPosition);
    const surfAlt = surfaceAltitudeAt(
      this.seed,
      this.terrainType,
      frame.up.x,
      frame.up.y,
      frame.up.z,
    );
    this.setClusterLocation(spawn.qPosition, surfAlt);
  }

  private respawn(seed: number, index: number) {
    this.spawnOnLand(seed, index);
    this.rewarded = false;
    this.cooldown = 0;
    this.fadeOut = 0;
    this.fadeIn = FireflyCluster.FADE_IN_SEC;
    this.group.visible = true;
  }

  update(
    dt: number,
    playerQ: Quaternion,
    playerAlt: number,
    nightWeight: number,
    clusterIndex: number,
  ): { justCollected: boolean } {
    this.time += dt;

    /* ── Visibility / fade ─────────────────────────────────────── */
    let opacity = nightWeight;

    if (this.fadeOut > 0) {
      this.fadeOut = Math.max(0, this.fadeOut - dt);
      opacity *= this.fadeOut / FireflyCluster.FADE_OUT_SEC;
    } else if (this.rewarded) {
      opacity = 0;
    }

    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt);
      opacity *= 1 - this.fadeIn / FireflyCluster.FADE_IN_SEC;
    }

    this.material.uniforms.uNightWeight.value = opacity;
    this.material.uniforms.uTime.value = this.time;
    this.group.visible = opacity > 0.01;

    /* ── Animate each firefly ──────────────────────────────────── */
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i]!;

      const angle = this.time * f.orbitSpeed + f.orbitPhase;
      const orbitX = Math.cos(angle) * f.orbitRadius;
      const orbitZ = Math.sin(angle) * f.orbitRadius;
      const bobY = Math.sin(this.time * 1.2 + f.blinkPhase) * 0.008;

      f.pos
        .copy(this.clusterCenter)
        .addScaledVector(this.north, f.localOffset.x + orbitX)
        .addScaledVector(this.up, f.localOffset.y + bobY)
        .addScaledVector(this.east, f.localOffset.z + orbitZ);

      const blink = Math.sin(this.time * f.blinkSpeed + f.blinkPhase);
      const scale = blink > 0.2 ? 0.6 + blink * 0.4 : 0.15;
      this.tmpScale.set(scale, scale, scale);

      this.tmpQuat.identity();
      this.tmpMat.compose(f.pos, this.tmpQuat, this.tmpScale);
      this.instancedMesh.setMatrixAt(i, this.tmpMat);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    /* ── Cooldown ──────────────────────────────────────────────── */
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        const newSeed = this.seed + clusterIndex * 834712963 + Math.floor(this.time * 100);
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
    for (const f of this.flies) {
      const d = playerPos.distanceTo(f.pos);
      if (d < minDist) minDist = d;
    }

    let justCollected = false;
    if (minDist < FLY_THROUGH_DIST) {
      this.rewarded = true;
      justCollected = true;
      this.cooldown = REWARD_COOLDOWN_SEC;
      this.fadeOut = FireflyCluster.FADE_OUT_SEC;
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
