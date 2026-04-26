import {
  Group,
  Mesh,
  OctahedronGeometry,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Quaternion,
  Vector3,
} from "three";
import {
  moveOnSphere,
  cartesianFromSpherical,
  quaternionFromSurfaceNormal,
} from "./SphericalMath";
import { isLand } from "./SimplexNoise";
import { surfaceAltitudeAt } from "./TerrainSurface";

/** Plane: air collectibles. Boat: ocean-surface. Carpet: land-surface. */
export type RingCollectMode = "plane" | "boat" | "carpet";

export interface RingManagerOptions {
  mode?: RingCollectMode;
  seed?: number;
  terrainType?: string;
}

const DIAMOND_COUNT_PLANE = 15;
/** Boat has a larger ocean play area — a few more pickups than air/land. */
const DIAMOND_COUNT_BOAT = 24;
const DIAMOND_COUNT_CARPET = 15;
const DIAMOND_SIZE = 0.09;

/** Same octahedron used for plane-mode world collectibles (race bonus diamonds reuse this). */
export function createPlaneCollectibleDiamondGeometry(): OctahedronGeometry {
  const geometry = new OctahedronGeometry(DIAMOND_SIZE, 0);
  geometry.scale(1, 1.5, 1);
  return geometry;
}
/** Boat diamonds use a smaller mesh than planes (same shape). */
const BOAT_DIAMOND_SCALE = 0.55;
const DIAMOND_XP = 10;
const COLLECTION_RADIUS = 0.3;
/** Carpet diamonds felt too easy to snag — tighter pickup than plane/boat. */
const CARPET_COLLECTION_RADIUS = 0.19;
const LOW_ALTITUDE = 0.55;
const HIGH_ALTITUDE_MIN = 0.9;
const HIGH_ALTITUDE_MAX = 1.35;
const HIGH_CHANCE = 0.35;
const RESPAWN_DELAY_MIN = 1.5;
const RESPAWN_DELAY_MAX = 2.5;
const MIN_SPACING = 1.5;
const MIN_PLAYER_SPAWN_DIST = 2.0;
const SPAWN_ANIM_DURATION = 0.5;
const SPIN_SPEED = 1.8;
/** Idle bob: slight lift + smaller wiggle along surface normal. */
const DIAMOND_BOB_LIFT = 0.012;
const DIAMOND_BOB_AMP = 0.017;

/** Height above true water surface so boat diamonds read clearly above the ocean. */
const BOAT_FLOAT_MIN = 0.062;
const BOAT_FLOAT_MAX = 0.118;

/** Height above terrain surface for carpet (land) diamonds. */
const CARPET_FLOAT_MIN = 0.10;
const CARPET_FLOAT_MAX = 0.18;

interface DiamondInstance {
  mesh: Mesh;
  qPosition: Quaternion;
  altitude: number;
  active: boolean;
  spawnTimer: number;
  spawnDuration: number;
  age: number;
  phaseOffset: number;
  spinAngle: number;
  upAxis: Vector3;
}

function randomPlaneAltitude(): number {
  if (Math.random() < HIGH_CHANCE) {
    return HIGH_ALTITUDE_MIN + Math.random() * (HIGH_ALTITUDE_MAX - HIGH_ALTITUDE_MIN);
  }
  return LOW_ALTITUDE;
}

export const holoVert = `
varying vec3 vWorldPos;
varying vec3 vNorm;
varying vec3 vViewDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNorm = normalize(normalMatrix * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const holoFrag = `
uniform float time;
uniform float phaseOffset;
uniform float spawnScale;

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

  float glint = 0.85 + 0.15 * sin(facetAngle * 30.0 + time * 5.0);
  float pulse = 0.8 + 0.2 * sin(time * 2.5 + phaseOffset);

  vec3 col = mix(rainbow, vec3(1.0), fresnel * 0.2) * (0.8 + fresnel * 0.6) * glint * pulse;

  float alpha = (0.2 + fresnel * 0.4) * pulse * glint * spawnScale;

  gl_FragColor = vec4(col, alpha);
}
`;

export type CollectCallback = (xp: number, worldPos: Vector3, tier: number) => void;

const _q = new Quaternion();
const _qAlign = new Quaternion();
const _Y = new Vector3(0, 1, 0);

export class RingManager {
  readonly group = new Group();
  private diamonds: DiamondInstance[] = [];
  private geometry!: OctahedronGeometry;
  private globeRadius: number;
  private time = 0;
  private pendingRespawns: { timer: number; delay: number }[] = [];
  /** When false (e.g. boat mode), diamonds are hidden and logic does not run. */
  private consumerActive = true;
  private readonly mode: RingCollectMode;
  private readonly seed: number;
  private readonly terrainType: string;

  onCollect: CollectCallback | null = null;

  /** Upgrade multipliers pushed by Game.propagateUpgrades(). */
  upgrades = {
    diamondXpMult: 1,
    /**
     * Multiplier applied to diamond XP gated on vehicle speed (Wake Rider).
     * Game.ts sets this each tick based on local boat speedRatio.
     */
    highSpeedMult: 1,
  };

  setConsumerActive(active: boolean) {
    this.consumerActive = active;
    this.group.visible = active;
  }

  constructor(globeRadius: number, options?: RingManagerOptions) {
    this.globeRadius = globeRadius;
    this.mode = options?.mode ?? "plane";
    this.seed = options?.seed ?? 0;
    this.terrainType = options?.terrainType ?? "default";

    if (this.mode === "plane") {
      this.geometry = createPlaneCollectibleDiamondGeometry();
    } else {
      const baseSize = DIAMOND_SIZE * BOAT_DIAMOND_SCALE;
      this.geometry = new OctahedronGeometry(baseSize, 0);
      this.geometry.scale(1, 1.5, 1);
    }

    const initialCount =
      this.mode === "boat"
        ? DIAMOND_COUNT_BOAT
        : this.mode === "carpet"
          ? DIAMOND_COUNT_CARPET
          : DIAMOND_COUNT_PLANE;
    for (let i = 0; i < initialCount; i++) {
      this.diamonds.push(this.createDiamond());
    }
  }

  private createDiamond(): DiamondInstance {
    const mat = new ShaderMaterial({
      vertexShader: holoVert,
      fragmentShader: holoFrag,
      uniforms: {
        time: { value: 0 },
        phaseOffset: { value: Math.random() * Math.PI * 2 },
        spawnScale: { value: 0 },
      },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });

    const mesh = new Mesh(this.geometry, mat);
    mesh.frustumCulled = false;

    const qPos = this.randomSpherePosition();
    const altitude = this.altitudeForDiamond(qPos);
    const phaseOffset = Math.random() * Math.PI * 2;
    const worldPos = cartesianFromSpherical(qPos, altitude, this.globeRadius);
    const upAxis = worldPos.clone().normalize();

    mesh.position.copy(worldPos);
    mesh.scale.setScalar(0);

    this.group.add(mesh);

    return {
      mesh,
      qPosition: qPos,
      altitude,
      active: true,
      spawnTimer: 0,
      spawnDuration: SPAWN_ANIM_DURATION,
      age: 0,
      phaseOffset,
      spinAngle: Math.random() * Math.PI * 2,
      upAxis,
    };
  }

  private altitudeForDiamond(q: Quaternion): number {
    if (this.mode === "plane") {
      return randomPlaneAltitude();
    }
    const p = cartesianFromSpherical(q, 0, this.globeRadius).normalize();
    const surfAlt = surfaceAltitudeAt(this.seed, this.terrainType, p.x, p.y, p.z);
    if (this.mode === "carpet") {
      return surfAlt + CARPET_FLOAT_MIN + Math.random() * (CARPET_FLOAT_MAX - CARPET_FLOAT_MIN);
    }
    return surfAlt + BOAT_FLOAT_MIN + Math.random() * (BOAT_FLOAT_MAX - BOAT_FLOAT_MIN);
  }

  private needsTerrainFilter(): boolean {
    return this.mode === "boat" || this.mode === "carpet";
  }

  private randomSpherePosition(avoidPlayerQ?: Quaternion): Quaternion {
    const maxAttempts = this.needsTerrainFilter() ? 100 : 50;
    const altSample = this.needsTerrainFilter() ? 0 : LOW_ALTITUDE;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const q = new Quaternion();
      const randomHeading = Math.random() * Math.PI * 2;
      const randomArc = 0.3 + Math.random() * 2.5;
      const moved = moveOnSphere(q, randomHeading, randomArc);

      const secondHeading = Math.random() * Math.PI * 2;
      const secondArc = Math.random() * 1.5;
      const finalQ = moveOnSphere(moved, secondHeading, secondArc);

      if (this.needsTerrainFilter()) {
        const surf = cartesianFromSpherical(finalQ, 0, this.globeRadius).normalize();
        const land = isLand(this.seed, this.terrainType, surf.x, surf.y, surf.z);
        if (this.mode === "boat" && land) continue;
        if (this.mode === "carpet" && !land) continue;
      }

      const candidate = cartesianFromSpherical(finalQ, altSample, this.globeRadius);

      let tooClose = false;
      for (const d of this.diamonds) {
        if (!d.active) continue;
        const existing = cartesianFromSpherical(d.qPosition, altSample, this.globeRadius);
        if (candidate.distanceTo(existing) < MIN_SPACING) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose && avoidPlayerQ) {
        const playerPos = cartesianFromSpherical(avoidPlayerQ, altSample, this.globeRadius);
        if (candidate.distanceTo(playerPos) < MIN_PLAYER_SPAWN_DIST) {
          tooClose = true;
        }
      }

      if (!tooClose) return finalQ;
    }

    if (this.needsTerrainFilter()) {
      for (let k = 0; k < 200; k++) {
        const q = new Quaternion();
        const h = Math.random() * Math.PI * 2;
        const a = 0.5 + Math.random() * 2.0;
        const finalQ = moveOnSphere(q, h, a);
        const surf = cartesianFromSpherical(finalQ, 0, this.globeRadius).normalize();
        const land = isLand(this.seed, this.terrainType, surf.x, surf.y, surf.z);
        if (this.mode === "boat" && land) continue;
        if (this.mode === "carpet" && !land) continue;

        const candidate = cartesianFromSpherical(finalQ, altSample, this.globeRadius);
        let tooClose = false;
        for (const d of this.diamonds) {
          if (!d.active) continue;
          const existing = cartesianFromSpherical(d.qPosition, altSample, this.globeRadius);
          if (candidate.distanceTo(existing) < MIN_SPACING) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose && avoidPlayerQ) {
          const playerPos = cartesianFromSpherical(avoidPlayerQ, altSample, this.globeRadius);
          if (candidate.distanceTo(playerPos) < MIN_PLAYER_SPAWN_DIST) tooClose = true;
        }
        if (!tooClose) return finalQ;
      }
    }

    if (this.mode === "boat") {
      return this.lastResortOceanQuaternion();
    }
    if (this.mode === "carpet") {
      return this.lastResortLandQuaternion();
    }

    const fallbackQ = new Quaternion();
    const h = Math.random() * Math.PI * 2;
    const a = 0.5 + Math.random() * 2.0;
    return moveOnSphere(fallbackQ, h, a);
  }

  /** Deterministic ocean point when random placement fails (same idea as boat spawn). */
  private lastResortOceanQuaternion(): Quaternion {
    const q = new Quaternion();
    for (let k = 0; k < 96; k++) {
      const phi = (k / 96) * Math.PI;
      const theta = k * 0.6180339887 * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      if (!isLand(this.seed, this.terrainType, nx, ny, nz)) {
        return quaternionFromSurfaceNormal(nx, ny, nz);
      }
    }
    return q;
  }

  /** Deterministic land point when random placement fails. */
  private lastResortLandQuaternion(): Quaternion {
    const q = new Quaternion();
    for (let k = 0; k < 96; k++) {
      const phi = (k / 96) * Math.PI;
      const theta = k * 0.6180339887 * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      if (isLand(this.seed, this.terrainType, nx, ny, nz)) {
        return quaternionFromSurfaceNormal(nx, ny, nz);
      }
    }
    return q;
  }

  update(dt: number, planeQ: Quaternion, planeAltitude: number) {
    if (!this.consumerActive) return;

    this.time += dt;

    const planePos = cartesianFromSpherical(planeQ, planeAltitude, this.globeRadius);

    for (const d of this.diamonds) {
      if (!d.active) continue;

      d.age += dt;
      d.spawnTimer += dt;
      const spawnProgress = Math.min(1, d.spawnTimer / d.spawnDuration);
      const easeOut = 1 - Math.pow(1 - spawnProgress, 3);
      const overshoot = spawnProgress < 1 ? 1 + 0.15 * Math.sin(spawnProgress * Math.PI) : 1;
      const scale = easeOut * overshoot;

      d.mesh.scale.setScalar(scale);

      const bob =
        DIAMOND_BOB_LIFT +
        Math.sin(this.time * 1.5 + d.phaseOffset) * DIAMOND_BOB_AMP;
      const worldPos = cartesianFromSpherical(d.qPosition, d.altitude, this.globeRadius);
      d.mesh.position.copy(worldPos).addScaledVector(d.upAxis, bob);

      d.spinAngle += SPIN_SPEED * dt;
      _qAlign.setFromUnitVectors(_Y, d.upAxis);
      _q.setFromAxisAngle(_Y, d.spinAngle);
      d.mesh.quaternion.copy(_qAlign).multiply(_q);

      const mat = d.mesh.material as ShaderMaterial;
      mat.uniforms.time.value = this.time;
      mat.uniforms.spawnScale.value = easeOut;

      if (spawnProgress >= 1.0) {
        const dist = planePos.distanceTo(worldPos);
        const effRadius =
          this.mode === "carpet" ? CARPET_COLLECTION_RADIUS : COLLECTION_RADIUS;

        if (dist < effRadius) {
          this.collectDiamond(d, worldPos);
        }
      }
    }

    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      this.pendingRespawns[i].timer += dt;
      if (this.pendingRespawns[i].timer >= this.pendingRespawns[i].delay) {
        this.respawnDiamond(planeQ);
        this.pendingRespawns.splice(i, 1);
      }
    }
  }

  private collectDiamond(d: DiamondInstance, worldPos: Vector3) {
    d.active = false;
    d.mesh.visible = false;

    const xp = Math.round(
      DIAMOND_XP * this.upgrades.diamondXpMult * this.upgrades.highSpeedMult,
    );

    this.onCollect?.(xp, worldPos, 0);

    const delay = RESPAWN_DELAY_MIN + Math.random() * (RESPAWN_DELAY_MAX - RESPAWN_DELAY_MIN);
    this.pendingRespawns.push({ timer: 0, delay });
  }

  private respawnDiamond(avoidPlayerQ: Quaternion) {
    const inactiveIdx = this.diamonds.findIndex((d) => !d.active);
    if (inactiveIdx === -1) return;

    const d = this.diamonds[inactiveIdx];

    d.qPosition = this.randomSpherePosition(avoidPlayerQ);
    d.altitude = this.altitudeForDiamond(d.qPosition);
    d.active = true;
    d.spawnTimer = 0;
    d.age = 0;
    d.phaseOffset = Math.random() * Math.PI * 2;
    d.spinAngle = Math.random() * Math.PI * 2;
    d.mesh.visible = true;

    const worldPos = cartesianFromSpherical(d.qPosition, d.altitude, this.globeRadius);
    d.upAxis.copy(worldPos).normalize();
    d.mesh.position.copy(worldPos);
    d.mesh.scale.setScalar(0);

    const mat = d.mesh.material as ShaderMaterial;
    mat.uniforms.phaseOffset.value = d.phaseOffset;
    mat.uniforms.spawnScale.value = 0;
  }

  /** Spawn `count` additional bonus diamonds into the scene immediately. */
  spawnBonusDiamonds(count: number) {
    for (let i = 0; i < count; i++) {
      this.diamonds.push(this.createDiamond());
    }
  }

  dispose() {
    for (const d of this.diamonds) {
      (d.mesh.material as ShaderMaterial).dispose();
      this.group.remove(d.mesh);
    }
    this.geometry.dispose();
    this.diamonds.length = 0;
  }
}
