import {
  Group,
  Quaternion,
  type Scene,
} from "three";
import { buildPlaneMatrix, moveOnSphere } from "./SphericalMath";
import { createBiplane } from "./BiplaneMesh";

const CRUISE_SPEED = 1.5;
const BRAKE_DECEL = 3.0;
const ACCEL = 2.5;
const MIN_SPEED = 0.5;
const MAX_SPEED = 1.5;
const ALTITUDE = 0.4;
const HIGH_ALTITUDE = 1.2;
const ALTITUDE_SPEED = 0.75;
const MAX_BANK = Math.PI / 4;
const BANK_RESPONSIVENESS = 4;

export class Plane {
  readonly group: Group;

  qPosition = new Quaternion();
  heading = 0;
  pitch = 0;
  altitude = ALTITUDE;
  speed = 0;
  bankAngle = 0;

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
  ) {
    if (forward) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (brake) {
      this.speed = Math.max(MIN_SPEED, this.speed - BRAKE_DECEL * dt);
    } else {
      this.speed = Math.max(MIN_SPEED, this.speed - 0.3 * dt);
    }

    this.heading += turnRate * dt;
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const targetAlt = elevate ? HIGH_ALTITUDE : ALTITUDE;
    this.altitude += (targetAlt - this.altitude) * Math.min(1, ALTITUDE_SPEED * dt);
    this.pitch = 0;

    const arcAngle = (this.speed * dt) / this.globeRadius;
    this.qPosition = moveOnSphere(this.qPosition, this.heading, arcAngle);

    const targetBank = -turnRate * MAX_BANK * 0.5;
    this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, BANK_RESPONSIVENESS * dt);

    this.applyMatrix();
  }

  applyMatrix() {
    const m = buildPlaneMatrix(
      this.qPosition,
      this.heading,
      this.pitch,
      this.bankAngle,
      this.altitude,
      this.globeRadius,
    );
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
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
