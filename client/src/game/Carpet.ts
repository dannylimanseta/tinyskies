import {
  Group,
  Object3D,
  Quaternion,
  Vector3,
  type IUniform,
  type Scene,
} from "three";
import type { Vehicle } from "@globefly/shared";
import {
  buildCarpetMatrixVoidPlane,
  buildPlaneMatrix,
  cartesianFromSpherical,
  moveOnSphere,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";
import { createCarpet, carpetWobbleY } from "./CarpetMesh";
import { isLand } from "./SimplexNoise";
import { surfaceAltitudeAt } from "./TerrainSurface";

const CRUISE_SPEED = 0.6;
const BRAKE_DECEL = 2.5;
const ACCEL = 1.8;
const MIN_SPEED = 0.28;
const MAX_SPEED = 0.78;
/** Diamond / ring collect burst — matches biplane `BOOST_DURATION_SEC`. */
const DIAMOND_BOOST_SPEED = 1.22;
const DIAMOND_BOOST_DURATION_SEC = 1.7;
/** Full barrel rolls (around forward) during one diamond boost. */
const CARPET_BOOST_BARREL_ROLL_TURNS = 1.0;
/** Roll completes in this fraction of boost duration (<1 = faster spin than spreading across full boost). */
const CARPET_BOOST_ROLL_DURATION_FRAC = 0.5;
const ABSOLUTE_MAX_SPEED = 1.45;
const MAX_BANK = Math.PI / 4;
const BANK_RESPONSIVENESS = 4;
/** Yaw input catch-up (1/s); matches plane. */
const TURN_INPUT_SMOOTH = 8;
/** Multiplier on steering input (yaw) so the carpet feels more responsive. */
const CARPET_TURN_MULT = 1.45;
/** Space (climb) ramps 0→1; matches plane. */
const ELEVATE_INPUT_SMOOTH = 6;

// ── Drift ─────────────────────────────────────────────────────────────────────
/** Minimum speed (normalised 0–MAX_SPEED) before a drift can engage. */
const DRIFT_MIN_SPEED = 0.52;
/** Turn-input magnitude required to break traction and start drifting. */
const DRIFT_TURN_THRESHOLD = 0.62;
/** Velocity-heading snaps toward facing at this rate while gripping normally. */
const TRACTION_NORMAL = 5.0;
/** Reduced traction while actively drifting. */
const TRACTION_DRIFT = 1.4;
/** Braking restores grip faster. */
const TRACTION_BRAKING = 8.0;
/** How strongly drifting adds to visual bank on top of the turn bank. */
const DRIFT_BANK_SCALE = 0.55;
/** Cap on the extra bank contributed by drift angle alone. */
const DRIFT_BANK_MAX = Math.PI / 5;

/** Default hover clearance above terrain surface. */
export const CARPET_HOVER_HEIGHT = 0.03;
/** Height above terrain when elevate is held. */
const BOOST_HEIGHT = 0.52;
/** How quickly the carpet rises to meet terrain or climb input. */
const ALTITUDE_RISE_LERP = 0.75;
/** How slowly the carpet settles back down after terrain drops away. */
const ALTITUDE_FALL_LERP = 0.38;
/** Extra temporary lift gained when riding off a sharp terrain drop. */
const CLIFF_GLIDE_GAIN = 0.7;
const CLIFF_GLIDE_MAX = 0.12;
const CLIFF_GLIDE_DECAY = 3.2;
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
  /** Barrel-roll stunt angle during diamond boost; synced like the biplane. */
  rollAngle = 0;
  isRolling = false;
  /** Network fade 0–1 (moon cutscene); read by StateSync. */
  visibility?: number;

  private globeRadius: number;
  private seed: number;
  private terrainType: string;
  private prevAltitude = 0;
  private prevSurfaceAltitude = 0;
  private cliffGlideBonus = 0;
  isOverWater = false;
  private tassels: { obj: Object3D; baseY: number; cx: number; cz: number }[] = [];
  private capybara: { obj: Object3D; baseY: number; cx: number; cz: number } | null = null;

  /** True once the capybara mesh has finished loading; used for capy-only actions (e.g. flame shots). */
  get hasCapybara() {
    return this.capybara != null;
  }
  private static readonly TASSEL_CURL_MAX = Math.PI / 2;
  private tasselCurl = 0;
  private timeUniform: IUniform<number> | null = null;
  private turnInputSmoothed = 0;
  /** 0 = low hover, 1 = boosted height — smoothed from the elevate input. */
  private elevateBlend = 0;
  /** Remaining time at `DIAMOND_BOOST_SPEED` after `speedBoost()` (diamond pickup). */
  private boostTimer = 0;

  // ── Drift state ────────────────────────────────────────────────────────────
  /** Actual travel direction on the sphere surface (may lag behind `heading`). */
  private velocityHeading = 0;
  /** Whether the carpet is currently in a drift state. */
  private drifting = false;

  /**
   * Cosmic void: fly on a fixed world tangent plane (flat floor) with u/v in north×east, not
   * great-circle movement on the globe. `qPosition` is frozen for the session until exit.
   */
  private voidPlaneActive = false;
  private readonly voidPlaneO = new Vector3();
  private readonly voidPlaneN = new Vector3();
  private readonly voidPlaneE = new Vector3();
  private readonly voidPlaneUp = new Vector3();
  private voidPlaneU = 0;
  private voidPlaneV = 0;
  private readonly _voidPosScratch = new Vector3();

  /** True while the player is in void flat-plane mode (enemies + carpet share the same “floor”). */
  get isVoidPlaneFlight() {
    return this.voidPlaneActive;
  }

  /** World position in the void plane: O + north*u + east*v. */
  getVoidPlaneWorldPos(out: Vector3) {
    return out
      .copy(this.voidPlaneO)
      .addScaledVector(this.voidPlaneN, this.voidPlaneU)
      .addScaledVector(this.voidPlaneE, this.voidPlaneV);
  }

  getVoidPlaneNorth() {
    return this.voidPlaneN;
  }
  getVoidPlaneEast() {
    return this.voidPlaneE;
  }
  getVoidPlaneUp() {
    return this.voidPlaneUp;
  }
  getVoidFlameTargetWorld(out: Vector3) {
    this.getVoidPlaneWorldPos(out);
    this._voidPosScratch
      .set(0, 0, 0)
      .addScaledVector(this.voidPlaneN, Math.cos(this.heading))
      .addScaledVector(this.voidPlaneE, Math.sin(this.heading))
      .normalize();
    return out.addScaledVector(this._voidPosScratch, 1.22);
  }

  /** Call once on cosmic void entry (before any `await` in the same frame) after `removeVoidEternalFlame`. */
  enterVoidPlaneFlight(globeRadius: number) {
    this.voidPlaneActive = true;
    this.voidPlaneU = 0;
    this.voidPlaneV = 0;
    const p = cartesianFromSpherical(this.qPosition, this.altitude, globeRadius);
    this.voidPlaneO.copy(p);
    const frame = tangentFrame(this.qPosition);
    this.voidPlaneN.copy(frame.north).normalize();
    this.voidPlaneE.copy(frame.east).normalize();
    this.voidPlaneUp.copy(this.voidPlaneN).cross(this.voidPlaneE).normalize();
    this.applyMatrix();
  }

  exitVoidPlaneFlight() {
    this.voidPlaneActive = false;
  }

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
    this.velocityHeading = spawn.heading;

    const up = tangentFrame(this.qPosition).up;
    const surfaceAlt = surfaceAltitudeAt(seed, terrainType, up.x, up.y, up.z);
    this.altitude = surfaceAlt + CARPET_HOVER_HEIGHT;
    this.prevAltitude = this.altitude;
    this.prevSurfaceAltitude = surfaceAlt;
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
    _descend: boolean = false,
    options?: { maintainSpeed?: boolean },
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
      const boostDur = DIAMOND_BOOST_DURATION_SEC * this.upgrades.boostDurationMult;
      const rollSpan = Math.max(
        boostDur * CARPET_BOOST_ROLL_DURATION_FRAC,
        0.08,
      );
      const rollTarget = Math.PI * 2 * CARPET_BOOST_BARREL_ROLL_TURNS;
      const next =
        this.rollAngle + ((Math.PI * 2 * CARPET_BOOST_BARREL_ROLL_TURNS) / rollSpan) * dt;
      this.rollAngle = Math.min(next, rollTarget);
    } else {
      this.rollAngle = 0;
      if (options?.maintainSpeed) {
        /* Inertial coast (e.g. full-screen transition): keep speed, still steer with turnRate. */
      } else if (forward) {
        this.speed = Math.min(effMaxSpeed, this.speed + ACCEL * dt);
      } else if (brake) {
        this.speed = Math.max(MIN_SPEED, this.speed - BRAKE_DECEL * dt);
      } else {
        this.speed = Math.max(MIN_SPEED, this.speed - 0.3 * dt);
      }
    }

    const turnTarget = turnRate * CARPET_TURN_MULT;
    this.turnInputSmoothed +=
      (turnTarget - this.turnInputSmoothed) * (1 - Math.exp(-TURN_INPUT_SMOOTH * dt));
    this.heading += this.turnInputSmoothed * dt;
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // ── Drift: decouple velocity heading from visual heading ────────────────
    if (!this.voidPlaneActive) {
      const speedFrac = this.speed / (MAX_SPEED * this.upgrades.maxSpeedMult);
      const sharpTurn = Math.abs(this.turnInputSmoothed) > DRIFT_TURN_THRESHOLD && speedFrac > DRIFT_MIN_SPEED / MAX_SPEED;
      if (sharpTurn && !brake) {
        this.drifting = true;
      } else if (speedFrac <= DRIFT_MIN_SPEED / MAX_SPEED || Math.abs(this.turnInputSmoothed) < 0.08) {
        this.drifting = false;
      }

      // Pull velocity heading toward facing heading with speed-based traction
      const traction = brake ? TRACTION_BRAKING : this.drifting ? TRACTION_DRIFT : TRACTION_NORMAL;
      let driftGap = this.heading - this.velocityHeading;
      // Wrap to [-π, π]
      driftGap = ((driftGap + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.velocityHeading += driftGap * Math.min(1, traction * dt);
      this.velocityHeading = ((this.velocityHeading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    } else {
      this.velocityHeading = this.heading;
      this.drifting = false;
    }

    if (this.voidPlaneActive) {
      this.voidPlaneU += Math.cos(this.heading) * this.speed * dt;
      this.voidPlaneV += Math.sin(this.heading) * this.speed * dt;
      this.isOverWater = false;
      this.pitch += (0 - this.pitch) * Math.min(1, 5.0 * dt);
    } else {
      const arcAngle = (this.speed * dt) / this.globeRadius;
      this.qPosition = moveOnSphere(this.qPosition, this.velocityHeading, arcAngle);

      const up = tangentFrame(this.qPosition).up;
      this.isOverWater = !isLand(this.seed, this.terrainType, up.x, up.y, up.z);
      const surfaceAlt = surfaceAltitudeAt(
        this.seed, this.terrainType, up.x, up.y, up.z,
      );
      const elevateTarget = elevate ? 1 : 0;
      this.elevateBlend += (elevateTarget - this.elevateBlend) * (1 - Math.exp(-ELEVATE_INPUT_SMOOTH * dt));
      const clearance = CARPET_HOVER_HEIGHT + (BOOST_HEIGHT - CARPET_HOVER_HEIGHT) * this.elevateBlend;
      const terrainDrop = Math.max(0, this.prevSurfaceAltitude - surfaceAlt);
      const glideTarget = Math.min(
        CLIFF_GLIDE_MAX,
        terrainDrop * CLIFF_GLIDE_GAIN * (0.35 + 0.65 * Math.min(1, this.speedRatio)),
      );
      if (glideTarget > this.cliffGlideBonus) {
        this.cliffGlideBonus = glideTarget;
      } else {
        this.cliffGlideBonus += (0 - this.cliffGlideBonus) * Math.min(1, CLIFF_GLIDE_DECAY * dt);
      }
      this.prevSurfaceAltitude = surfaceAlt;

      const targetAlt = surfaceAlt + clearance + this.cliffGlideBonus;
      const altitudeLerp = targetAlt >= this.altitude ? ALTITUDE_RISE_LERP : ALTITUDE_FALL_LERP;
      this.altitude += (targetAlt - this.altitude) * Math.min(1, altitudeLerp * dt);

      const hardFloor = surfaceAlt + CARPET_HOVER_HEIGHT;
      if (this.altitude < hardFloor) this.altitude = hardFloor;

      const altDelta = (this.altitude - this.prevAltitude) / Math.max(dt, 1e-4);
      this.prevAltitude = this.altitude;
      
      // Pitch up when climbing, level out when stable
      const climbRate = Math.max(-1, Math.min(1, altDelta * 1.5));
      const targetPitch = -CLIMB_PITCH_MAX * Math.max(0, climbRate);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, 4.0 * dt);
    }

    // Drift lean: extra bank in the direction of the skid
    let driftGapBank = this.heading - this.velocityHeading;
    driftGapBank = ((driftGapBank + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const driftBank = Math.max(-DRIFT_BANK_MAX, Math.min(DRIFT_BANK_MAX, driftGapBank * DRIFT_BANK_SCALE));

    const turnBank = -this.turnInputSmoothed * MAX_BANK * 0.5;
    const targetBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, turnBank + driftBank));
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
    this.rollAngle = 0;
  }

  teleportTo(qPosition: Quaternion, heading: number, altitude: number, speed = this.speed) {
    this.qPosition.copy(qPosition);
    this.heading = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.velocityHeading = this.heading;
    this.drifting = false;
    this.altitude = altitude;
    this.prevAltitude = altitude;
    const up = tangentFrame(this.qPosition).up;
    this.prevSurfaceAltitude = surfaceAltitudeAt(this.seed, this.terrainType, up.x, up.y, up.z);
    this.cliffGlideBonus = 0;
    this.speed = Math.min(speed, ABSOLUTE_MAX_SPEED);
    this.applyMatrix();
  }

  /** True while in an active skid (velocity heading lags behind facing). */
  get isDrifting(): boolean {
    return this.drifting;
  }

  /**
   * 0–1 magnitude of the current skid angle (angle between velocity heading and facing heading).
   * Reaches 1.0 at ±45°; useful for scaling VFX intensity.
   */
  get driftIntensity(): number {
    const gap = Math.atan2(
      Math.sin(this.heading - this.velocityHeading),
      Math.cos(this.heading - this.velocityHeading),
    );
    return Math.min(1, Math.abs(gap) / (Math.PI / 4));
  }

  applyMatrix() {
    if (this.voidPlaneActive) {
      this.getVoidPlaneWorldPos(this._voidPosScratch);
      const m = buildCarpetMatrixVoidPlane(
        this._voidPosScratch,
        this.voidPlaneN,
        this.voidPlaneE,
        this.voidPlaneUp,
        this.heading,
        this.pitch,
        this.bankAngle,
        this.rollAngle,
      );
      this.group.matrix.copy(m);
    } else {
      this.group.matrix.copy(
        buildPlaneMatrix(
          this.qPosition,
          this.heading,
          this.pitch,
          this.bankAngle + this.rollAngle,
          this.altitude,
          this.globeRadius,
        ),
      );
    }
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
    this.group.removeFromParent();
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) (child as any).material.dispose();
    });
  }
}
