import {
  Camera,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Vehicle } from "@globefly/shared";
import {
  buildPlaneMatrix,
  cartesianFromSpherical,
  moveOnSphere,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";
import { createBiplane } from "./BiplaneMesh";
import { surfaceAltitudeAt } from "./TerrainSurface";

const CRUISE_SPEED = 1.725; // +15% from original 1.5
const BRAKE_DECEL = 3.0;
const ACCEL = 2.5;
const MIN_SPEED = 0.3;
const MAX_SPEED = 0.8;
const BOOST_SPEED = 1.3;
/** Ring / collect speed boost duration. */
const BOOST_DURATION_SEC = 1.7;
/** Full 360° rotations per boost; values above 1 spin faster. */
const BOOST_BARREL_ROLL_TURNS = 1.0;
/** Hard ceiling: arc-step = 2.0*0.05/5 = 0.02 rad/frame — well within safe limits. */
const ABSOLUTE_MAX_SPEED = 2.0;
const GREMLIN_SLOW_DURATION_SEC = 1.35;
const GREMLIN_SLOW_MULT = 0.58;
const GREMLIN_KING_SLOW_DURATION_SEC = 2.1;
const GREMLIN_KING_SLOW_MULT = 0.42;

/** HP from sky-gremlin paintballs (matches gremlin bar pill geometry). Base 10 + 30%. */
const PL_HP_MAX = 14;
const PL_HP_BAR_W = 0.135;
const PL_HP_BAR_H = 0.0145;
const PL_HP_BAR_D = 0.014;
const PL_HP_BAR_SEGMENTS = 16;
const PL_HP_BAR_CORNER_R = 0.0069;
const PL_HP_BAR_INSET = 0.0025;
const PL_HP_TWEEN_SPEED = 14;
const PL_HP_RADIAL_LIFT = 0.16;
const PL_HP_TRACK = 0x000000;
const PL_HP_FILL = 0xa8e0ff;
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
  /** Barrel roll around forward axis while boosting; synced for remotes. */
  rollAngle = 0;
  /** Remaining time at `BOOST_SPEED` after `speedBoost()`; 0 when not boosting. */
  private boostTimer = 0;
  /** Brief movement penalty after getting splatted by a sky gremlin. */
  private gremlinSlowTimer = 0;
  /** Stronger slow from the Gremlin King's paintballs (does not stack with gremlin slow — king takes priority). */
  private gremlinKingSlowTimer = 0;
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
    /** Max HP = round(PL_HP_MAX * this). */
    gremlinHpMaxMult: 1,
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

  /** Survive hits from sky gremlins; at 0 the Game ends the run. */
  private gremlinHealth: number;
  /** Tween 0–1 for the cockpit HP pill (matches gremlins’ fill animation). */
  private gremlinHpDisplay = 1;
  private readonly gremlinHpBarRoot: Group;
  private readonly gremlinHpFillMesh: Mesh;
  private readonly gremlinHpBarInnerW: number;
  private readonly _hpBarUp = new Vector3();
  private readonly _hpBarPos = new Vector3();
  private readonly _hpBarCamQ = new Quaternion();

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

    const trackGeo = new RoundedBoxGeometry(
      PL_HP_BAR_W,
      PL_HP_BAR_H,
      PL_HP_BAR_D,
      PL_HP_BAR_SEGMENTS,
      PL_HP_BAR_CORNER_R,
    );
    this.gremlinHpBarInnerW = PL_HP_BAR_W - 2 * PL_HP_BAR_INSET;
    const fillH = PL_HP_BAR_H * 0.6;
    const fillD = PL_HP_BAR_D * 0.45;
    const fillR = Math.min(PL_HP_BAR_CORNER_R * 0.55, fillH * 0.48, fillD * 0.45);
    const fillGeo = new RoundedBoxGeometry(1, fillH, fillD, PL_HP_BAR_SEGMENTS, fillR);
    const trackMat = new MeshBasicMaterial({
      color: PL_HP_TRACK,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const fillMat = new MeshBasicMaterial({
      color: PL_HP_FILL,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.gremlinHpBarRoot = new Group();
    this.gremlinHpBarRoot.visible = false;
    this.gremlinHpBarRoot.renderOrder = 5;
    const hpTrack = new Mesh(trackGeo, trackMat);
    hpTrack.position.z = 0.0001;
    const hpFill = new Mesh(fillGeo, fillMat);
    hpFill.position.z = 0.0002;
    this.gremlinHpFillMesh = hpFill;
    this.gremlinHpBarRoot.add(hpTrack);
    this.gremlinHpBarRoot.add(hpFill);
    this.gremlinHealth = this.getGremlinMaxHp();
  }

  getGremlinMaxHp(): number {
    return Math.max(1, Math.round(PL_HP_MAX * this.upgrades.gremlinHpMaxMult));
  }

  /**
   * After {@link gremlinHpMaxMult} changes, keep HP fraction stable when max increases
   * and clamp when it decreases.
   */
  reconcileGremlinMaxHpChange(previousMax: number) {
    const newMax = this.getGremlinMaxHp();
    if (newMax === previousMax) return;
    if (previousMax <= 0) {
      this.gremlinHealth = newMax;
      return;
    }
    this.gremlinHealth = Math.min(
      newMax,
      Math.max(0, Math.round((this.gremlinHealth * newMax) / previousMax)),
    );
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
    if (this.gremlinKingSlowTimer > 0) {
      this.gremlinKingSlowTimer = Math.max(0, this.gremlinKingSlowTimer - dt);
    }
    const gremlinSlowMult =
      this.gremlinKingSlowTimer > 0
        ? GREMLIN_KING_SLOW_MULT
        : this.gremlinSlowTimer > 0
          ? GREMLIN_SLOW_MULT
          : 1;
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
      const boostDur = BOOST_DURATION_SEC * this.upgrades.boostDurationMult;
      this.rollAngle +=
        ((Math.PI * 2 * BOOST_BARREL_ROLL_TURNS) / Math.max(boostDur, 0.08)) * dt;
    } else {
      this.rollAngle = 0;
      if (forward) {
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

    const targetBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, -this.turnInputSmoothed * MAX_BANK * 0.5));
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
    this.speed = Math.max(MIN_SPEED, this.speed * GREMLIN_SLOW_MULT);
  }

  applyGremlinKingSlow() {
    this.gremlinKingSlowTimer = GREMLIN_KING_SLOW_DURATION_SEC;
    this.gremlinSlowTimer = 0;
    this.speed = Math.max(MIN_SPEED, this.speed * GREMLIN_KING_SLOW_MULT);
  }

  /**
   * Gremlin paintball damage. Returns true the first time health reaches 0.
   * @param isKing - king shots deal more damage
   */
  applyGremlinPaintballDamage(isKing: boolean): boolean {
    if (this.gremlinHealth <= 0) return false;
    const dmg = isKing ? 2 : 1;
    this.gremlinHealth = Math.max(0, this.gremlinHealth - dmg);
    return this.gremlinHealth <= 0;
  }

  /** True while HP is below max; pick-ups can be skipped to avoid waste. */
  canHealFromGremlinPickups(): boolean {
    return this.gremlinHealth < this.getGremlinMaxHp();
  }

  /** Gremlin / heart pick-ups. Does nothing at full health. */
  healGremlinHealth(amount: number) {
    const cap = this.getGremlinMaxHp();
    if (amount <= 0 || this.gremlinHealth >= cap) return;
    this.gremlinHealth = Math.min(cap, this.gremlinHealth + Math.floor(amount));
  }

  /** World-space billboarding for the gremlin-damage bar (call each frame in flight). */
  updateGremlinDamageHpBar(dt: number, camera: Camera) {
    const maxH = this.getGremlinMaxHp();
    const target = this.gremlinHealth <= 0 ? 0 : this.gremlinHealth / maxH;
    this.gremlinHpDisplay += (target - this.gremlinHpDisplay) * Math.min(1, PL_HP_TWEEN_SPEED * dt);

    const innerW = this.gremlinHpBarInnerW;
    const r = Math.max(0, Math.min(1, this.gremlinHpDisplay));
    const show =
      this.gremlinHealth > 0 && (this.gremlinHealth < maxH || r < 0.998);
    this.gremlinHpBarRoot.visible = show;
    if (!show) return;

    const rw = Math.max(0.001, innerW * r);
    this.gremlinHpFillMesh.scale.set(rw, 1, 1);
    this.gremlinHpFillMesh.position.x = -innerW * 0.5 + rw * 0.5;

    this._hpBarPos.copy(
      cartesianFromSpherical(this.qPosition, this.altitude, this.globeRadius),
    );
    this._hpBarUp.copy(this._hpBarPos).normalize();
    this._hpBarPos.addScaledVector(this._hpBarUp, PL_HP_RADIAL_LIFT);
    this.gremlinHpBarRoot.position.copy(this._hpBarPos);
    camera.getWorldQuaternion(this._hpBarCamQ);
    this.gremlinHpBarRoot.quaternion.copy(this._hpBarCamQ);
  }

  speedBoost() {
    const effBoost = Math.min(BOOST_SPEED * this.upgrades.boostSpeedMult, ABSOLUTE_MAX_SPEED);
    this.boostTimer = BOOST_DURATION_SEC * this.upgrades.boostDurationMult;
    this.speed = effBoost;
    this.rollAngle = 0;
  }

  applyMatrix() {
    const m = buildPlaneMatrix(
      this.qPosition,
      this.heading,
      this.pitch,
      this.bankAngle + this.paintballWobbleBank + this.rollAngle,
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
    scene.add(this.gremlinHpBarRoot);
  }

  dispose() {
    this.gremlinHpBarRoot.removeFromParent();
    this.group.removeFromParent();
    this.gremlinHpBarRoot.traverse((child) => {
      const m = child as Mesh;
      m.geometry?.dispose();
      if (m.material) (m.material as MeshBasicMaterial).dispose();
    });
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) (child as any).material.dispose();
    });
  }
}
