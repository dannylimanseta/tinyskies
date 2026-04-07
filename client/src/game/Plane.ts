import {
  Group,
  Quaternion,
  type Scene,
} from "three";
import type { Vehicle } from "@globefly/shared";
import { buildPlaneMatrix, moveOnSphere } from "./SphericalMath";
import { createBiplane } from "./BiplaneMesh";

const CRUISE_SPEED = 1.5;
const BRAKE_DECEL = 3.0;
const ACCEL = 2.5;
const MIN_SPEED = 0.5;
const MAX_SPEED = 1.2;
const BOOST_SPEED = 1.65;
const ALTITUDE = 0.55;
const HIGH_ALTITUDE = 1.35;
const ALTITUDE_SPEED = 0.75;
const MAX_BANK = Math.PI / 4;
const BANK_RESPONSIVENESS = 4;
const ROLL_SPEED = 5.0;
const TWO_PI = Math.PI * 2;
const ROLL_ALT_AMPLITUDE = 0.05;
const ROLL_PITCH_AMPLITUDE = 0.02;

export class Plane {
  readonly group: Group;
  readonly vehicle: Vehicle = "plane";

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

  private globeRadius: number;

  constructor(globeRadius: number) {
    this.globeRadius = globeRadius;
    this.group = createBiplane(0xff4444);
    this.group.matrixAutoUpdate = false;
    this.applyMatrix();
  }

  update(
    dt: number,
    turnRate: number,
    forward: boolean,
    brake: boolean,
    elevate: boolean = false,
    barrelRoll: boolean = false,
  ) {
    if (forward) {
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

    const turnStrength = Math.abs(turnRate);
    if (turnStrength > 0.1) {
      const turnDrag = turnStrength * 0.8 * dt;
      this.speed = Math.max(MIN_SPEED, this.speed - turnDrag);
    }

    this.heading += turnRate * dt;
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const targetAlt = elevate ? HIGH_ALTITUDE : ALTITUDE;
    this.altitude += (targetAlt - this.altitude) * Math.min(1, ALTITUDE_SPEED * dt);
    const targetPitch = elevate ? -0.3 : 0;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 3.0 * dt);

    const arcAngle = (this.speed * dt) / this.globeRadius;
    this.qPosition = moveOnSphere(this.qPosition, this.heading, arcAngle);

    const targetBank = -turnRate * MAX_BANK * 0.5;
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
      return 0.167 * ((this.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
    }
    const t = Math.min(1, (this.speed - MAX_SPEED) / (BOOST_SPEED - MAX_SPEED));
    const eased = t * (2 - t);
    return 0.167 + 0.833 * eased;
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
