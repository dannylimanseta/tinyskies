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

import { PilotAvatar } from "./PilotAvatar";

const CRUISE_SPEED = 0.6;
const BRAKE_DECEL = 2.5;
const ACCEL = 1.8;
const MIN_SPEED = 0.28;
const MAX_SPEED = 0.78;
/** Diamond / ring collect burst — matches biplane `BOOST_DURATION_SEC`. */
const DIAMOND_BOOST_SPEED = 1.22;
const DIAMOND_BOOST_DURATION_SEC = 1.7;
const ABSOLUTE_MAX_SPEED = 1.45;
const MAX_BANK = Math.PI / 4;
const BANK_RESPONSIVENESS = 4;
/** Yaw input catch-up (1/s); matches plane. */
const TURN_INPUT_SMOOTH = 8;
/** Space (climb) ramps 0→1; matches plane. */
const ELEVATE_INPUT_SMOOTH = 6;

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
  /** Primary body fabric color (0xRRGGBB), synced to other players. */
  readonly hullColor: number;

  qPosition = new Quaternion();
  heading = 0;
  pitch = 0;
  altitude = 0;
  speed = 0;
  bankAngle = 0;
  rollAngle = 0;
  isRolling = false;
  /** Network fade 0–1 (moon cutscene); read by StateSync. */
  visibility?: number;

  private globeRadius: number;
  private seed: number;
  private terrainType: string;
  private prevAltitude = 0;
  private tassels: { obj: Object3D; baseY: number; cx: number; cz: number }[] = [];
  private static readonly TASSEL_CURL_MAX = Math.PI / 2;
  private tasselCurl = 0;
  private timeUniform: IUniform<number> | null = null;
  private turnInputSmoothed = 0;
  /** 0 = low hover, 1 = boosted height — smoothed from Space. */
  private elevateBlend = 0;
  /** Remaining time at `DIAMOND_BOOST_SPEED` after `speedBoost()` (diamond pickup). */
  private boostTimer = 0;

  private avatar: PilotAvatar;

  /** @param spawnSalt Per-session random start position/heading on the globe. */
  constructor(globeRadius: number, seed: number, terrainType: string, spawnSalt = 0, hullColor?: number) {
    this.globeRadius = globeRadius;
    this.seed = seed;
    this.terrainType = terrainType;
    const color = hullColor ?? 0x6b1d6e;
    this.hullColor = color;
    this.group = createCarpet(color);
    this.group.matrixAutoUpdate = false;
    for (let i = 0; i < 4; i++) {
      const t = this.group.getObjectByName(`tassel${i}`);
      if (t) this.tassels.push({ obj: t, baseY: t.position.y, cx: t.position.x, cz: t.position.z });
    }
    this.timeUniform = this.group.userData.timeUniform ?? null;

    this.avatar = new PilotAvatar();
    // Scale down to fit the carpet (PilotAvatar is ~1.92 units tall before its own 0.55 scale).
    // The carpet body is about 0.09 units long. Wait, s=0.025, bodyLen = s*3.6 = 0.09.
    // Let's scale the avatar to fit on the carpet.
    this.avatar.group.scale.setScalar(0.045);
    // Skateboard stance: face sideways
    this.avatar.group.rotation.y = Math.PI / 2;
    // Position on top of the carpet
    this.avatar.group.position.set(0, 0.005, 0);
    this.group.add(this.avatar.group);

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
    _paintball: boolean = false,
  ) {
    if (this.timeUniform) this.timeUniform.value += dt;

    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - dt);
    }

    if (this.boostTimer > 0) {
      this.speed = DIAMOND_BOOST_SPEED;
    } else if (forward) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (brake) {
      this.speed = Math.max(MIN_SPEED, this.speed - BRAKE_DECEL * dt);
    } else {
      this.speed = Math.max(MIN_SPEED, this.speed - 0.3 * dt);
    }

    this.turnInputSmoothed += (turnRate - this.turnInputSmoothed) * (1 - Math.exp(-TURN_INPUT_SMOOTH * dt));
    this.heading += this.turnInputSmoothed * dt;
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const arcAngle = (this.speed * dt) / this.globeRadius;
    this.qPosition = moveOnSphere(this.qPosition, this.heading, arcAngle);

    const up = tangentFrame(this.qPosition).up;
    const surfaceAlt = surfaceAltitudeAt(
      this.seed, this.terrainType, up.x, up.y, up.z,
    );
    const elevateTarget = elevate ? 1 : 0;
    this.elevateBlend += (elevateTarget - this.elevateBlend) * (1 - Math.exp(-ELEVATE_INPUT_SMOOTH * dt));
    const clearance = HOVER_HEIGHT + (BOOST_HEIGHT - HOVER_HEIGHT) * this.elevateBlend;
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

    const targetBank = -this.turnInputSmoothed * MAX_BANK * 0.5;
    this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, BANK_RESPONSIVENESS * dt);

    const targetCurl = this.speedRatio * Carpet.TASSEL_CURL_MAX;
    this.tasselCurl += (targetCurl - this.tasselCurl) * Math.min(1, 3.0 * dt);
    const time = this.timeUniform?.value ?? 0;
    for (const t of this.tassels) {
      t.obj.rotation.x = -this.tasselCurl;
      t.obj.position.y = t.baseY + carpetWobbleY(t.cx, t.cz, time);
    }

    // Avatar leans into the turn slightly, and maybe bobs.
    // We pass moveX=0, moveZ=0 so it stays idle, but we can manually tilt it.
    this.avatar.update(dt, 0, 0, 0, false);
    // Skateboard stance: facing sideways. Leaning forward/backward based on speed or turn.
    this.avatar.group.rotation.set(
      this.pitch * 0.5,
      Math.PI / 2,
      -this.bankAngle * 0.5
    );

    this.speed = Math.min(this.speed, ABSOLUTE_MAX_SPEED);

    this.applyMatrix();
  }

  /** Temporary surge from collecting a diamond (same idea as biplane `Plane.speedBoost`). */
  speedBoost() {
    this.boostTimer = DIAMOND_BOOST_DURATION_SEC;
    this.speed = Math.min(DIAMOND_BOOST_SPEED, ABSOLUTE_MAX_SPEED);
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

  get speedRatio(): number {
    if (this.speed <= MIN_SPEED) return 0;
    const cruiseSpan = MAX_SPEED - MIN_SPEED;
    if (this.speed <= MAX_SPEED) {
      return (this.speed - MIN_SPEED) / cruiseSpan;
    }
    const boostSpan = DIAMOND_BOOST_SPEED - MAX_SPEED;
    return 1 + Math.min(1, (this.speed - MAX_SPEED) / boostSpan);
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
