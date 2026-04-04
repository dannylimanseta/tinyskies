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
} from "./SphericalMath";

const DIAMOND_COUNT = 15;
const DIAMOND_SIZE = 0.09;
const DIAMOND_XP = 10;
const DIAMOND_COLOR: [number, number, number] = [0.2, 1.0, 0.8];
const COLLECTION_RADIUS = 0.3;
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

const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5200, 6600, 8200];

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

function randomAltitude(): number {
  if (Math.random() < HIGH_CHANCE) {
    return HIGH_ALTITUDE_MIN + Math.random() * (HIGH_ALTITUDE_MAX - HIGH_ALTITUDE_MIN);
  }
  return LOW_ALTITUDE;
}

const holoVert = `
varying vec3 vWorldPos;
varying vec3 vNorm;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNorm = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const holoFrag = `
uniform vec3 baseColor;
uniform float time;
uniform float phaseOffset;
uniform float spawnScale;

varying vec3 vWorldPos;
varying vec3 vNorm;

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = 1.0 - abs(dot(viewDir, vNorm));
  fresnel = pow(fresnel, 1.2);

  float pulse = 0.75 + 0.25 * sin(time * 2.5 + phaseOffset);

  float facetGlint = 0.9 + 0.1 * sin(dot(vNorm, vec3(1.0, 2.0, 0.5)) * 20.0 + time * 4.0);

  vec3 holoShift = baseColor + vec3(fresnel * 0.4, fresnel * 0.15, fresnel * 0.25);

  float alpha = (0.3 + fresnel * 0.55) * pulse * facetGlint * spawnScale;
  vec3 col = holoShift * (1.0 + fresnel * 1.0) * pulse * facetGlint;

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

  sessionXP = 0;
  level = 1;
  onCollect: CollectCallback | null = null;
  onLevelUp: ((level: number) => void) | null = null;

  setConsumerActive(active: boolean) {
    this.consumerActive = active;
    this.group.visible = active;
  }

  constructor(globeRadius: number) {
    this.globeRadius = globeRadius;

    this.geometry = new OctahedronGeometry(DIAMOND_SIZE, 0);
    this.geometry.scale(1, 1.5, 1);

    for (let i = 0; i < DIAMOND_COUNT; i++) {
      this.diamonds.push(this.createDiamond());
    }
  }

  private createDiamond(): DiamondInstance {
    const mat = new ShaderMaterial({
      vertexShader: holoVert,
      fragmentShader: holoFrag,
      uniforms: {
        baseColor: { value: DIAMOND_COLOR },
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
    const altitude = randomAltitude();
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

  private randomSpherePosition(avoidPlayerQ?: Quaternion): Quaternion {
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const q = new Quaternion();
      const randomHeading = Math.random() * Math.PI * 2;
      const randomArc = 0.3 + Math.random() * 2.5;
      const moved = moveOnSphere(q, randomHeading, randomArc);

      const secondHeading = Math.random() * Math.PI * 2;
      const secondArc = Math.random() * 1.5;
      const finalQ = moveOnSphere(moved, secondHeading, secondArc);

      const candidate = cartesianFromSpherical(finalQ, LOW_ALTITUDE, this.globeRadius);

      let tooClose = false;
      for (const d of this.diamonds) {
        if (!d.active) continue;
        const existing = cartesianFromSpherical(d.qPosition, LOW_ALTITUDE, this.globeRadius);
        if (candidate.distanceTo(existing) < MIN_SPACING) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose && avoidPlayerQ) {
        const playerPos = cartesianFromSpherical(avoidPlayerQ, LOW_ALTITUDE, this.globeRadius);
        if (candidate.distanceTo(playerPos) < MIN_PLAYER_SPAWN_DIST) {
          tooClose = true;
        }
      }

      if (!tooClose) return finalQ;
    }

    const fallbackQ = new Quaternion();
    const h = Math.random() * Math.PI * 2;
    const a = 0.5 + Math.random() * 2.0;
    return moveOnSphere(fallbackQ, h, a);
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

      const bob = Math.sin(this.time * 1.5 + d.phaseOffset) * 0.03;
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

        if (dist < COLLECTION_RADIUS) {
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

    const prevLevel = this.level;
    this.sessionXP += DIAMOND_XP;
    this.level = this.computeLevel();

    if (this.onCollect) {
      this.onCollect(DIAMOND_XP, worldPos, 0);
    }

    if (this.level > prevLevel && this.onLevelUp) {
      this.onLevelUp(this.level);
    }

    const delay = RESPAWN_DELAY_MIN + Math.random() * (RESPAWN_DELAY_MAX - RESPAWN_DELAY_MIN);
    this.pendingRespawns.push({ timer: 0, delay });
  }

  private respawnDiamond(avoidPlayerQ: Quaternion) {
    const inactiveIdx = this.diamonds.findIndex((d) => !d.active);
    if (inactiveIdx === -1) return;

    const d = this.diamonds[inactiveIdx];

    d.qPosition = this.randomSpherePosition(avoidPlayerQ);
    d.altitude = randomAltitude();
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

  private computeLevel(): number {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.sessionXP >= LEVEL_THRESHOLDS[i]) return i + 1;
    }
    return 1;
  }

  getXP() {
    return this.sessionXP;
  }

  getLevel() {
    return this.level;
  }

  getXPForNextLevel(): number {
    const idx = this.level;
    if (idx < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[idx];
    return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + (idx - LEVEL_THRESHOLDS.length + 1) * 2000;
  }

  getXPForCurrentLevel(): number {
    const idx = this.level - 1;
    if (idx >= 0 && idx < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[idx];
    return 0;
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
