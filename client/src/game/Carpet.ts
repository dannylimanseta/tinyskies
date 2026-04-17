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
export const CARPET_HOVER_HEIGHT = 0.045;
/** Height above terrain when elevate is held. */
const BOOST_HEIGHT = 0.52;
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
  private capybara: { obj: Object3D; baseY: number; cx: number; cz: number } | null = null;
  private static readonly TASSEL_CURL_MAX = Math.PI / 2;
  private tasselCurl = 0;
  private timeUniform: IUniform<number> | null = null;
  private turnInputSmoothed = 0;
  /** 0 = low hover, 1 = boosted height — smoothed from the elevate input. */
  private elevateBlend = 0;
  /** Remaining time at `DIAMOND_BOOST_SPEED` after `speedBoost()` (diamond pickup). */
  private boostTimer = 0;

  /** Active upgrade multipliers; updated by Game.propagateUpgrades() after each pick. */
  upgrades = {
    maxSpeedMult: 1,
    boostSpeedMult: 1,
    boostDurationMult: 1,
    bankMult: 1,
  };

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
    const capy = this.group.getObjectByName("capybara");
    if (capy) {
      this.capybara = { obj: capy, baseY: capy.position.y, cx: capy.position.x, cz: capy.position.z };
    }
    this.timeUniform = this.group.userData.timeUniform ?? null;

    const spawn = randomSpawnQuaternionAndHeading(seed + spawnSalt);
    this.qPosition.copy(spawn.qPosition);
    this.heading = spawn.heading;

    const up = tangentFrame(this.qPosition).up;
    this.altitude =
      surfaceAltitudeAt(seed, terrainType, up.x, up.y, up.z) + CARPET_HOVER_HEIGHT;
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

    const effMaxSpeed = MAX_SPEED * this.upgrades.maxSpeedMult;
    const effBoostSpeed = Math.min(
      DIAMOND_BOOST_SPEED * this.upgrades.boostSpeedMult,
      ABSOLUTE_MAX_SPEED,
    );

    if (this.boostTimer > 0) {
      this.speed = effBoostSpeed;
    } else if (forward) {
      this.speed = Math.min(effMaxSpeed, this.speed + ACCEL * dt);
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
    const clearance = CARPET_HOVER_HEIGHT + (BOOST_HEIGHT - CARPET_HOVER_HEIGHT) * this.elevateBlend;
    const targetAlt = surfaceAlt + clearance;
    this.altitude += (targetAlt - this.altitude) * Math.min(1, ALTITUDE_LERP * dt);

    const hardFloor = surfaceAlt + CARPET_HOVER_HEIGHT;
    if (this.altitude < hardFloor) this.altitude = hardFloor;

    const altDelta = (this.altitude - this.prevAltitude) / Math.max(dt, 1e-4);
    this.prevAltitude = this.altitude;
    
    // Pitch up when climbing, level out when stable
    const climbRate = Math.max(-1, Math.min(1, altDelta * 1.5));
    const targetPitch = -CLIMB_PITCH_MAX * Math.max(0, climbRate);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 4.0 * dt);

    const targetBank = -this.turnInputSmoothed * MAX_BANK * 0.5;
    this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, BANK_RESPONSIVENESS * this.upgrades.bankMult * dt);

    const targetCurl = this.speedRatio * Carpet.TASSEL_CURL_MAX;
    this.tasselCurl += (targetCurl - this.tasselCurl) * Math.min(1, 3.0 * dt);
    const time = this.timeUniform?.value ?? 0;
    for (const t of this.tassels) {
      t.obj.rotation.x = -this.tasselCurl;
      t.obj.position.y = t.baseY + carpetWobbleY(t.cx, t.cz, time);
    }
    if (this.capybara) {
      this.capybara.obj.position.y = this.capybara.baseY + carpetWobbleY(this.capybara.cx, this.capybara.cz, time);
    }

    this.speed = Math.min(this.speed, ABSOLUTE_MAX_SPEED);

    this.applyMatrix();
  }

  /** Temporary surge from collecting a diamond (same idea as biplane `Plane.speedBoost`). */
  speedBoost() {
    this.boostTimer = DIAMOND_BOOST_DURATION_SEC * this.upgrades.boostDurationMult;
    const effBoostSpeed = Math.min(
      DIAMOND_BOOST_SPEED * this.upgrades.boostSpeedMult,
      ABSOLUTE_MAX_SPEED,
    );
    this.speed = effBoostSpeed;
  }

  teleportTo(qPosition: Quaternion, heading: number, altitude: number, speed = this.speed) {
    this.qPosition.copy(qPosition);
    this.heading = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.altitude = altitude;
    this.prevAltitude = altitude;
    this.speed = Math.min(speed, ABSOLUTE_MAX_SPEED);
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

  get speedRatio(): number {
    if (this.speed <= MIN_SPEED) return 0;
    const ms = MAX_SPEED * this.upgrades.maxSpeedMult;
    const bs = Math.min(
      DIAMOND_BOOST_SPEED * this.upgrades.boostSpeedMult,
      ABSOLUTE_MAX_SPEED,
    );
    const cruiseSpan = Math.max(1e-4, ms - MIN_SPEED);
    if (this.speed <= ms) {
      return (this.speed - MIN_SPEED) / cruiseSpan;
    }
    const boostSpan = Math.max(1e-4, bs - ms);
    return 1 + Math.min(1, (this.speed - ms) / boostSpan);
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
