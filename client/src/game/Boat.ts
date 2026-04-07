import {
  Group,
  Quaternion,
  type Scene,
} from "three";
import type { Vehicle } from "@globefly/shared";
import { buildBoatMatrix, moveOnSphere, quaternionFromSurfaceNormal, tangentFrame } from "./SphericalMath";
import { createBoat } from "./BoatMesh";
import { isLand } from "./SimplexNoise";
import { surfaceAltitudeAt } from "./TerrainSurface";

/** Default cruise is deliberately slow; max speed stays modest. */
const CRUISE_SPEED = 0.22;
const BRAKE_DECEL = 0.85;
const ACCEL = 0.35;
const MAX_SPEED = 0.42;
const COAST_DECAY = 0.07;
const FREEBOARD = 0.015;
/** Yaw rate multiplier — higher = snappier turns. */
const TURN_SCALE = 0.92;

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Random orientation on ocean; falls back toward equator if needed. */
export function randomOceanQuaternion(
  seed: number,
  terrainType: string,
  maxAttempts = 120,
): Quaternion {
  const rnd = seededRandom(seed + 777);
  for (let i = 0; i < maxAttempts; i++) {
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.sin(phi) * Math.sin(theta);
    const nz = Math.cos(phi);
    if (!isLand(seed, terrainType, nx, ny, nz)) {
      return quaternionFromSurfaceNormal(nx, ny, nz);
    }
  }
  for (let k = 0; k < 96; k++) {
    const phi = (k / 96) * Math.PI;
    const theta = k * 0.6180339887 * Math.PI * 2;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.sin(phi) * Math.sin(theta);
    const nz = Math.cos(phi);
    if (!isLand(seed, terrainType, nx, ny, nz)) {
      return quaternionFromSurfaceNormal(nx, ny, nz);
    }
  }
  return new Quaternion();
}

const BOB_AMPLITUDE = 0.009;
const BOB_SPEED = 2.6;
const PITCH_BOB_AMP = 0.042;
const PITCH_BOB_SPEED = 2.1;
const ROLL_BOB_AMP = 0.05;
const ROLL_BOB_SPEED = 1.55;

export class Boat {
  readonly group: Group;
  readonly vehicle: Vehicle = "boat";

  qPosition = new Quaternion();
  heading = 0;
  pitch = 0;
  altitude = 0;
  baseAltitude = 0;
  speed = 0;
  bankAngle = 0;
  rollAngle = 0;
  isRolling = false;

  private globeRadius: number;
  private seed: number;
  private terrainType: string;
  private bobTime = Math.random() * Math.PI * 2;
  private bobOffset = 0;
  private bobPitch = 0;
  private bobRoll = 0;

  constructor(globeRadius: number, seed: number, terrainType: string, hullColor?: number) {
    this.globeRadius = globeRadius;
    this.seed = seed;
    this.terrainType = terrainType;
    this.group = createBoat(hullColor);
    this.group.matrixAutoUpdate = false;
    this.qPosition.copy(randomOceanQuaternion(seed, terrainType));
    const up = tangentFrame(this.qPosition).up;
    this.altitude =
      surfaceAltitudeAt(seed, terrainType, up.x, up.y, up.z) + FREEBOARD;
    this.speed = 0;
    this.applyMatrix();
  }

  update(
    dt: number,
    turnRate: number,
    forward: boolean,
    brake: boolean,
    _elevate: boolean = false,
    _barrelRoll: boolean = false,
  ) {
    if (forward) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (brake) {
      this.speed = Math.max(0, this.speed - BRAKE_DECEL * dt);
    } else {
      this.speed = Math.max(0, this.speed - COAST_DECAY * dt);
    }

    this.heading += turnRate * dt * TURN_SCALE;
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const arcAngle = (this.speed * dt) / this.globeRadius;
    const nextQ = moveOnSphere(this.qPosition, this.heading, arcAngle);
    const upNext = tangentFrame(nextQ).up;
    const nx = upNext.x;
    const ny = upNext.y;
    const nz = upNext.z;

    if (!isLand(this.seed, this.terrainType, nx, ny, nz)) {
      this.qPosition = nextQ;
    }

    const up = tangentFrame(this.qPosition).up;
    const baseAlt =
      surfaceAltitudeAt(this.seed, this.terrainType, up.x, up.y, up.z) + FREEBOARD;

    this.bobTime += dt;
    this.bobOffset = Math.sin(this.bobTime * BOB_SPEED) * BOB_AMPLITUDE;
    this.bobPitch = Math.sin(this.bobTime * PITCH_BOB_SPEED + 1.3) * PITCH_BOB_AMP;
    this.bobRoll = Math.sin(this.bobTime * ROLL_BOB_SPEED + 2.7) * ROLL_BOB_AMP;

    this.baseAltitude = baseAlt;
    this.altitude = baseAlt + this.bobOffset;
    this.pitch = this.bobPitch;
    this.bankAngle = this.bobRoll;
    this.applyMatrix();
  }

  applyMatrix() {
    const m = buildBoatMatrix(
      this.qPosition,
      this.heading,
      this.altitude,
      this.globeRadius,
      this.bobPitch,
      this.bobRoll,
    );
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
  }

  get speedRatio(): number {
    if (MAX_SPEED <= 0) return 0;
    return Math.max(0, Math.min(1, this.speed / MAX_SPEED));
  }

  addTo(scene: Scene) {
    scene.add(this.group);
  }

  dispose() {
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) (child as any).material.dispose();
    });
  }
}
