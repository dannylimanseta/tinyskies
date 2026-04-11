import {
  Group,
  Quaternion,
  type Scene,
} from "three";
import type { Vehicle } from "@globefly/shared";
import { buildPlaneMatrix, moveOnSphere, randomSpawnQuaternionAndHeading, tangentFrame } from "./SphericalMath";
import { createBiplane } from "./BiplaneMesh";
import { surfaceAltitudeAt } from "./TerrainSurface";

const CRUISE_SPEED = 1.5;
const BRAKE_DECEL = 3.0;
const ACCEL = 2.5;
const MIN_SPEED = 0.3;
const MAX_SPEED = 0.8;
const BOOST_SPEED = 1.3;
/** Ring / collect speed boost duration. */
const BOOST_DURATION_SEC = 1.7;
const ALTITUDE = 0.55;
const HIGH_ALTITUDE = 1.35;
/** Minimum clearance above terrain when descending. */
const LOW_HOVER_HEIGHT = 0.08;
const ALTITUDE_SPEED = 0.75;
const MAX_BANK = Math.PI / 4;
const BANK_RESPONSIVENESS = 4;
/** Yaw input catch-up (1/s); higher = closer to raw keys. ~8 feels smooth but still responsive. */
const TURN_INPUT_SMOOTH = 8;
/** Climb hold (Space) ramps 0→1 instead of snapping. */
const ELEVATE_INPUT_SMOOTH = 6;
const ROLL_SPEED = 5.0;
const TWO_PI = Math.PI * 2;
const ROLL_ALT_AMPLITUDE = 0.05;
const ROLL_PITCH_AMPLITUDE = 0.02;
/** Upper end of `speedRatio` while at or below MAX_SPEED (before boost segment). */
const CRUISE_SPEED_RATIO_MAX = 0.167;

export class Plane {
  readonly group: Group;
  readonly vehicle: Vehicle = "plane";
  /** Primary hull color (0xRRGGBB), synced to other players. */
  readonly hullColor: number;

  qPosition = new Quaternion();
  heading = 0;
  pitch = 0;
  altitude = ALTITUDE;
  speed = 0;
  bankAngle = 0;
  isRolling = false;
  private rollProgress = 0;
  rollAngle = 0;
  private rollAltOffset = 0;
  private rollPitchOffset = 0;
  /** Remaining time at `BOOST_SPEED` after `speedBoost()`; 0 when not boosting. */
  private boostTimer = 0;
  /** Network fade 0–1 (moon cutscene); read by StateSync. */
  visibility?: number;
  /** Smoothed yaw command (matches keyboard / stick after lag). */
  private turnInputSmoothed = 0;
  /** -1 = descend, 0 = cruise, 1 = climb — smoothed so pitch/height ease in. */
  private elevateBlend = 0;
  private prevAltitude = ALTITUDE;

  private globeRadius: number;
  private seed: number;
  private terrainType: string;

  /** @param spawnSalt Per-session randomness (combine with world seed at call site). */
  constructor(globeRadius: number, spawnSalt: number, hullColor: number, seed = 42, terrainType = "default") {
    this.globeRadius = globeRadius;
    this.seed = seed;
    this.terrainType = terrainType;
    this.hullColor = hullColor;
    this.group = createBiplane(hullColor);
    this.group.matrixAutoUpdate = false;
    const spawn = randomSpawnQuaternionAndHeading(spawnSalt);
    this.qPosition.copy(spawn.qPosition);
    this.heading = spawn.heading;
    this.applyMatrix();
  }

  update(
    dt: number,
    turnRate: number,
    forward: boolean,
    brake: boolean,
    elevate: boolean = false,
    barrelRoll: boolean = false,
    descend: boolean = false,
  ) {
    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - dt);
    }

    if (this.boostTimer > 0) {
      this.speed = BOOST_SPEED;
    } else if (forward) {
      if (this.speed < MAX_SPEED) {
        this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
      } else {
        this.speed = Math.max(MAX_SPEED, this.speed - 0.13 * dt);
      }
    } else if (brake) {
      this.speed = Math.max(MIN_SPEED, this.speed - BRAKE_DECEL * dt);
    } else {
      this.speed = Math.max(MIN_SPEED, this.speed - 0.3 * dt);
    }

    this.turnInputSmoothed += (turnRate - this.turnInputSmoothed) * (1 - Math.exp(-TURN_INPUT_SMOOTH * dt));

    if (this.boostTimer <= 0) {
      const turnStrength = Math.abs(this.turnInputSmoothed);
      if (turnStrength > 0.1) {
        const turnDrag = turnStrength * 0.8 * dt;
        this.speed = Math.max(MIN_SPEED, this.speed - turnDrag);
      }
    }

    this.heading += this.turnInputSmoothed * dt;
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const elevateTarget = elevate ? 1 : descend ? -1 : 0;
    this.elevateBlend += (elevateTarget - this.elevateBlend) * (1 - Math.exp(-ELEVATE_INPUT_SMOOTH * dt));

    const up = tangentFrame(this.qPosition).up;
    const surfaceAlt = surfaceAltitudeAt(this.seed, this.terrainType, up.x, up.y, up.z);
    const lowAlt = surfaceAlt + LOW_HOVER_HEIGHT;

    let targetAlt: number;
    if (this.elevateBlend > 0) {
      targetAlt = ALTITUDE + (HIGH_ALTITUDE - ALTITUDE) * this.elevateBlend;
    } else {
      targetAlt = ALTITUDE + (ALTITUDE - lowAlt) * this.elevateBlend;
    }
    this.altitude += (targetAlt - this.altitude) * Math.min(1, ALTITUDE_SPEED * dt);

    const hardFloor = surfaceAlt + LOW_HOVER_HEIGHT;
    if (this.altitude < hardFloor) this.altitude = hardFloor;

    const altDelta = (this.altitude - this.prevAltitude) / Math.max(dt, 1e-4);
    this.prevAltitude = this.altitude;
    const climbRate = Math.max(-1, Math.min(1, altDelta * 2.5));
    const targetPitch = -0.3 * climbRate;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 3.0 * dt);

    const arcAngle = (this.speed * dt) / this.globeRadius;
    this.qPosition = moveOnSphere(this.qPosition, this.heading, arcAngle);

    const targetBank = -this.turnInputSmoothed * MAX_BANK * 0.5;
    this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, BANK_RESPONSIVENESS * dt);

    if (barrelRoll && !this.isRolling) {
      this.isRolling = true;
      this.rollProgress = 0;
    }

    if (this.isRolling) {
      this.rollProgress += ROLL_SPEED / TWO_PI * dt;
      if (this.rollProgress >= 1) {
        this.rollProgress = 0;
        this.rollAngle = 0;
        this.isRolling = false;
        this.rollAltOffset = 0;
        this.rollPitchOffset = 0;
      } else {
        const t = this.rollProgress;
        const eased = t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.rollAngle = eased * TWO_PI;
        this.rollAltOffset = Math.sin(this.rollAngle) * ROLL_ALT_AMPLITUDE;
        this.rollPitchOffset = Math.sin(this.rollAngle * 2) * ROLL_PITCH_AMPLITUDE;
      }
    } else {
      this.rollAltOffset += (0 - this.rollAltOffset) * Math.min(1, 8 * dt);
      this.rollPitchOffset += (0 - this.rollPitchOffset) * Math.min(1, 8 * dt);
    }

    this.applyMatrix();
  }

  speedBoost() {
    this.boostTimer = BOOST_DURATION_SEC;
    this.speed = BOOST_SPEED;
  }

  applyMatrix() {
    const m = buildPlaneMatrix(
      this.qPosition,
      this.heading,
      this.pitch + this.rollPitchOffset,
      this.bankAngle + this.rollAngle,
      this.altitude + this.rollAltOffset,
      this.globeRadius,
    );
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
  }

  get speedRatio(): number {
    if (this.speed <= MIN_SPEED) return 0;
    if (this.speed <= MAX_SPEED) {
      return CRUISE_SPEED_RATIO_MAX * ((this.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
    }
    const t = Math.min(1, (this.speed - MAX_SPEED) / (BOOST_SPEED - MAX_SPEED));
    const eased = t * (2 - t);
    return CRUISE_SPEED_RATIO_MAX + (1.0 - CRUISE_SPEED_RATIO_MAX) * eased;
  }

  /** Engine SFX: same loudness as full cruise when boosting (no extra volume from boost). */
  get engineSpeedRatio(): number {
    return Math.min(this.speedRatio, CRUISE_SPEED_RATIO_MAX);
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
