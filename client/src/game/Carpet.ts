import {
  Group,
  Object3D,
  Quaternion,
  type IUniform,
  type Scene,
} from "three";
import type { Vehicle } from "@globefly/shared";
import {
  buildPlaneMatrix,
  moveOnSphere,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";
import { createCarpet, carpetWobbleY } from "./CarpetMesh";
import { surfaceAltitudeAt } from "./TerrainSurface";

const CRUISE_SPEED = 0.6;
const BRAKE_DECEL = 2.5;
const ACCEL = 1.8;
const MIN_SPEED = 0.28;
const MAX_SPEED = 0.78;
const MAX_BANK = Math.PI / 4;
const BANK_RESPONSIVENESS = 4;

/** Default hover clearance above terrain surface. */
const HOVER_HEIGHT = 0.08;
/** Height above terrain when Space (elevate) is held. */
const BOOST_HEIGHT = 0.45;
/** How fast altitude lerps toward the target (lower = slower climb = longer tilt). */
const ALTITUDE_LERP = 0.6;
/** Max nose-up tilt when climbing (~35 degrees). */
const CLIMB_PITCH_MAX = Math.PI / 5;
/** How aggressively altitude gap maps to pitch. */
const CLIMB_PITCH_GAIN = 40;

export class Carpet {
  readonly group: Group;
  readonly vehicle: Vehicle = "carpet";

  qPosition = new Quaternion();
  heading = 0;
  pitch = 0;
  altitude = 0;
  speed = 0;
  bankAngle = 0;
  rollAngle = 0;
  isRolling = false;

  private globeRadius: number;
  private seed: number;
  private terrainType: string;
  private prevAltitude = 0;
  private tassels: { obj: Object3D; baseY: number; cx: number; cz: number }[] = [];
  private static readonly TASSEL_CURL_MAX = Math.PI / 2;
  private tasselCurl = 0;
  private timeUniform: IUniform<number> | null = null;

  /** @param spawnSalt Per-session random start position/heading on the globe. */
  constructor(globeRadius: number, seed: number, terrainType: string, spawnSalt = 0) {
    this.globeRadius = globeRadius;
    this.seed = seed;
    this.terrainType = terrainType;
    this.group = createCarpet();
    this.group.matrixAutoUpdate = false;
    for (let i = 0; i < 4; i++) {
      const t = this.group.getObjectByName(`tassel${i}`);
      if (t) this.tassels.push({ obj: t, baseY: t.position.y, cx: t.position.x, cz: t.position.z });
    }
    this.timeUniform = this.group.userData.timeUniform ?? null;

    const spawn = randomSpawnQuaternionAndHeading(seed + spawnSalt);
    this.qPosition.copy(spawn.qPosition);
    this.heading = spawn.heading;

    const up = tangentFrame(this.qPosition).up;
    this.altitude =
      surfaceAltitudeAt(seed, terrainType, up.x, up.y, up.z) + HOVER_HEIGHT;
    this.prevAltitude = this.altitude;
    this.speed = MIN_SPEED;
    this.applyMatrix();
  }

  update(
    dt: number,
    turnRate: number,
    forward: boolean,
    brake: boolean,
    elevate: boolean = false,
    _barrelRoll: boolean = false,
  ) {
    if (this.timeUniform) this.timeUniform.value += dt;

    if (forward) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (brake) {
      this.speed = Math.max(MIN_SPEED, this.speed - BRAKE_DECEL * dt);
    } else {
      this.speed = Math.max(MIN_SPEED, this.speed - 0.3 * dt);
    }

    this.heading += turnRate * dt;
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const arcAngle = (this.speed * dt) / this.globeRadius;
    this.qPosition = moveOnSphere(this.qPosition, this.heading, arcAngle);

    const up = tangentFrame(this.qPosition).up;
    const surfaceAlt = surfaceAltitudeAt(
      this.seed, this.terrainType, up.x, up.y, up.z,
    );
    const clearance = elevate ? BOOST_HEIGHT : HOVER_HEIGHT;
    const targetAlt = surfaceAlt + clearance;
    this.altitude += (targetAlt - this.altitude) * Math.min(1, ALTITUDE_LERP * dt);

    const hardFloor = surfaceAlt + HOVER_HEIGHT;
    if (this.altitude < hardFloor) this.altitude = hardFloor;

    const altGap = targetAlt - this.altitude;
    const climbPitch = -Math.max(0, Math.min(CLIMB_PITCH_MAX, altGap * CLIMB_PITCH_GAIN));
    const altDelta = this.altitude - this.prevAltitude;
    const targetPitch = climbPitch - altDelta * 4;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 4.0 * dt);
    this.prevAltitude = this.altitude;

    const targetBank = -turnRate * MAX_BANK * 0.5;
    this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, BANK_RESPONSIVENESS * dt);

    const targetCurl = this.speedRatio * Carpet.TASSEL_CURL_MAX;
    this.tasselCurl += (targetCurl - this.tasselCurl) * Math.min(1, 3.0 * dt);
    const time = this.timeUniform?.value ?? 0;
    for (const t of this.tassels) {
      t.obj.rotation.x = -this.tasselCurl;
      t.obj.position.y = t.baseY + carpetWobbleY(t.cx, t.cz, time);
    }

    this.applyMatrix();
  }

  private applyMatrix() {
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

  get speedRatio(): number {
    return Math.max(0, (this.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
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
