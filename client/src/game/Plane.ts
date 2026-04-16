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
/** Hard ceiling: arc-step = 2.0*0.05/5 = 0.02 rad/frame — well within safe limits. */
const ABSOLUTE_MAX_SPEED = 2.0;
const GREMLIN_SLOW_DURATION_SEC = 1.6;
const GREMLIN_SLOW_MULT = 0.45;
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
  /** Kept at 0; still synced for PlayerState compatibility. */
  rollAngle = 0;
  /** Remaining time at `BOOST_SPEED` after `speedBoost()`; 0 when not boosting. */
  private boostTimer = 0;
  /** Brief movement penalty after getting splatted by a sky gremlin. */
  private gremlinSlowTimer = 0;
  /** Network fade 0–1 (moon cutscene); read by StateSync. */
  visibility?: number;

  /** Active upgrade multipliers; updated by Game.propagateUpgrades() after each pick. */
  upgrades = {
    maxSpeedMult: 1,
    boostSpeedMult: 1,
    boostDurationMult: 1,
    altSpeedMult: 1,
    bankMult: 1,
    brakeDecelMult: 1,
  };

  /** Smoothed yaw command (matches keyboard / stick after lag). */
  private turnInputSmoothed = 0;
  /** -1 = descend, 0 = cruise, 1 = climb — smoothed so pitch/height ease in. */
  private elevateBlend = 0;
  private prevAltitude = ALTITUDE;

  /** Damped sin — paintball hit rolls the mesh left/right briefly (visual only). */
  private paintballWobbleAmp = 0;
  private paintballWobblePhase = 0;
  private paintballWobbleBank = 0;

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
    _paintball: boolean = false,
    descend: boolean = false,
  ) {
    // Compute effective values once so all references below stay consistent.
    if (this.gremlinSlowTimer > 0) {
      this.gremlinSlowTimer = Math.max(0, this.gremlinSlowTimer - dt);
    }
    const gremlinSlowMult = this.gremlinSlowTimer > 0 ? GREMLIN_SLOW_MULT : 1;
    const effMaxSpeed = MAX_SPEED * this.upgrades.maxSpeedMult * gremlinSlowMult;
    const effBoostSpeed = Math.min(
      BOOST_SPEED * this.upgrades.boostSpeedMult * gremlinSlowMult,
      ABSOLUTE_MAX_SPEED,
    );
    const effBrakeDecel = BRAKE_DECEL * this.upgrades.brakeDecelMult;
    const effAltSpeed = ALTITUDE_SPEED * this.upgrades.altSpeedMult;
    const effBankResp = BANK_RESPONSIVENESS * this.upgrades.bankMult;
    const effAccel = ACCEL * gremlinSlowMult;

    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - dt);
    }

    if (this.boostTimer > 0) {
      this.speed = effBoostSpeed;
    } else if (forward) {
      if (this.speed < effMaxSpeed) {
        this.speed = Math.min(effMaxSpeed, this.speed + effAccel * dt);
      } else {
        this.speed = Math.max(effMaxSpeed, this.speed - 0.13 * dt);
      }
    } else if (brake) {
      this.speed = Math.max(MIN_SPEED, this.speed - effBrakeDecel * dt);
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
    this.altitude += (targetAlt - this.altitude) * Math.min(1, effAltSpeed * dt);

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
    this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, effBankResp * dt);

    if (this.group.userData.propeller) {
      this.group.userData.propeller.rotation.z -= (this.speed * 15 + 10) * dt;
    }

    // Hard speed ceiling — prevents physics/NaN issues from stacked upgrades.
    this.speed = Math.min(this.speed, ABSOLUTE_MAX_SPEED);

    if (this.paintballWobbleAmp > 0.002) {
      this.paintballWobblePhase += dt * 19;
      this.paintballWobbleBank =
        Math.sin(this.paintballWobblePhase) * this.paintballWobbleAmp;
      this.paintballWobbleAmp *= Math.exp(-4.2 * dt);
    } else {
      this.paintballWobbleAmp = 0;
      this.paintballWobbleBank = 0;
    }

    this.applyMatrix();
  }

  /** Called when this plane is struck by a paintball (local client). */
  triggerPaintballHitWobble() {
    this.paintballWobbleAmp = 0.42;
    this.paintballWobblePhase = 0;
  }

  applyGremlinSlow() {
    this.gremlinSlowTimer = GREMLIN_SLOW_DURATION_SEC;
    this.speed = Math.max(MIN_SPEED, this.speed * 0.45);
  }

  speedBoost() {
    const effBoost = Math.min(BOOST_SPEED * this.upgrades.boostSpeedMult, ABSOLUTE_MAX_SPEED);
    this.boostTimer = BOOST_DURATION_SEC * this.upgrades.boostDurationMult;
    this.speed = effBoost;
  }

  applyMatrix() {
    const m = buildPlaneMatrix(
      this.qPosition,
      this.heading,
      this.pitch,
      this.bankAngle + this.paintballWobbleBank,
      this.altitude,
      this.globeRadius,
    );
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
  }

  get speedRatio(): number {
    const ms = MAX_SPEED * this.upgrades.maxSpeedMult;
    const bs = Math.min(BOOST_SPEED * this.upgrades.boostSpeedMult, ABSOLUTE_MAX_SPEED);
    if (this.speed <= MIN_SPEED) return 0;
    if (this.speed <= ms) {
      return CRUISE_SPEED_RATIO_MAX * ((this.speed - MIN_SPEED) / (ms - MIN_SPEED));
    }
    const t = Math.min(1, (this.speed - ms) / (bs - ms));
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
