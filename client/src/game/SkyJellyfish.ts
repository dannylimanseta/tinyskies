import {
  Group,
  MathUtils,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import {
  cartesianFromSpherical,
  moveOnSphere,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";
import { surfaceAltitudeAt } from "./TerrainSurface";
import {
  createJellyfish,
  createJellyfishGeoms,
  disposeJellyfishGeoms,
  JellyfishGeomCache,
  JellyfishVisual,
} from "./SkyJellyfishMesh";

/**
 * Sky Jellyfish manager — carpet-only.
 *
 * Responsibilities:
 * - Seeded placement of 6 uniquely coloured jellies on the globe.
 * - Per-frame animation: drift in place (world), capture progress fill/decay,
 *   exponential-damped orbit around the carpet (following).
 * - Exposes capture progress for the HUD ring and fires {@link onCapture}
 *   when a jelly is fully captured.
 */

export const JELLY_COUNT = 6;
export const JELLY_CAPTURE_XP = 180;

/** Radius where capture starts filling (world units; globe radius ~5). */
const JELLY_CAPTURE_RADIUS = 0.65;
/** Radius where capture is abandoned (hysteresis so it doesn't flicker). */
const JELLY_CAPTURE_EXIT_RADIUS = 0.85;
/** Fill rate per second — matches {@link ../game/CarpetLandmarkSelfieQuest}. */
const JELLY_FILL_RATE = 1 / 1.5;
const JELLY_DECAY_RATE = 0.3;
/** Altitude above surface for in-world jellies. */
const JELLY_SPAWN_ALTITUDE = 0.35;
/** Drift amplitude around the spawn anchor (world units). */
const JELLY_DRIFT_RADIUS = 0.15;
/** Mesh scale — jellies are small compared to the ~5 unit globe radius. */
const JELLY_SCALE_WORLD = 0.15;
const JELLY_SCALE_FOLLOW = 0.075;
/** Follow damping rate (higher = tighter). */
const JELLY_FOLLOW_DAMPING = 1.5;
/** Snap time for "entering orbit" after capture completes. */
const JELLY_CAPTURE_HANDOFF_SEC = 0.6;
/** Reset fade duration (moon impact). */
const JELLY_RESET_FADE_SEC = 0.9;

/** 6 distinct bioluminescent colors. */
export const JELLY_COLORS = [
  "#ff4fb0", // neon pink
  "#2fe4d5", // cyan
  "#ffc257", // amber
  "#8a6dff", // violet
  "#ff5a42", // crimson
  "#7dff82", // lime
] as const;

/**
 * Orbit slots in carpet-local space — all much closer to the carpet than before,
 * arranged as a tight "wingman pod" flying beside / just above / behind it.
 * buildPlaneMatrix uses makeBasis(right, up, -forward) so local +Z is actually
 * the world-space BACKWARD direction. Therefore: -Z = in front of the carpet,
 * +Z = behind, +X = carpet's right, +Y = up.
 */
const JELLY_FOLLOW_OFFSETS: readonly Vector3[] = [
  new Vector3(-0.08, 0.02, -0.02),   // left wing, slightly ahead
  new Vector3( 0.08, 0.02, -0.02),   // right wing, slightly ahead
  new Vector3(-0.12, 0.05,  0.04),   // left-back, slightly high
  new Vector3( 0.12, 0.05,  0.04),   // right-back, slightly high
  new Vector3( 0.00, 0.08, -0.04),   // above-center, leading
  new Vector3( 0.00, 0.03,  0.08),   // center-back, trailing
];

type JellyStatus = "world" | "capturing" | "handoff" | "following" | "fading";

interface Jelly {
  colorIndex: number;
  visual: JellyfishVisual;
  status: JellyStatus;
  /** World-mode anchor for drift. */
  anchorQ: Quaternion;
  /** Current world quaternion while in-world (for drift). */
  posQ: Quaternion;
  /** Cached world position (scene space). */
  worldPos: Vector3;
  /** Cached follow position (scene space). Updated during "following". */
  followPos: Vector3;
  /** Orbit slot index assigned on capture. */
  orbitSlot: number;
  /** 0..1 capture progress. */
  progress: number;
  /** 0..1 alpha for fade/reset transitions. */
  opacity: number;
  /** Drift phase seed. */
  driftPhase: number;
  /** Handoff timer (capture -> follow). */
  handoffT: number;
  /** Start/end positions for the capture handoff lerp. */
  handoffStart: Vector3;
  handoffEnd: Vector3;
  /** Bob phase for orbit slot. */
  bobPhase: number;
}

const _tmpV = new Vector3();
const _tmpV2 = new Vector3();
const _tmpTarget = new Vector3();

export class SkyJellyfish {
  readonly group = new Group();
  /** Fires when a jelly's capture fills to 1. */
  onCapture: ((colorIndex: number) => void) | null = null;

  private jellies: Jelly[] = [];
  private geoms: JellyfishGeomCache;
  private time = 0;
  /** The single currently-capturing jelly index, or -1 if none. */
  private capturingIndex = -1;
  private disposed = false;
  /** How many orbit slots have been used — drives next assignment. */
  private orbitSlotsUsed = 0;

  constructor(
    private globeRadius: number,
    worldSeed: number,
    sessionSalt: number,
    private terrainType: string,
  ) {
    this.geoms = createJellyfishGeoms();

    for (let i = 0; i < JELLY_COUNT; i++) {
      const visual = createJellyfish(this.geoms, JELLY_COLORS[i]!, i * 1.17);
      visual.group.scale.setScalar(JELLY_SCALE_WORLD);
      this.group.add(visual.group);

      // Deterministic spawn seed per run, per jelly index.
      const seed = worldSeed + sessionSalt * 7919 + i * 982451653 + 5;
      const spawn = randomSpawnQuaternionAndHeading(seed);

      const jelly: Jelly = {
        colorIndex: i,
        visual,
        status: "world",
        anchorQ: spawn.qPosition.clone(),
        posQ: spawn.qPosition.clone(),
        worldPos: new Vector3(),
        followPos: new Vector3(),
        orbitSlot: -1,
        progress: 0,
        opacity: 1,
        driftPhase: (i * 2.41) % (Math.PI * 2),
        handoffT: 0,
        handoffStart: new Vector3(),
        handoffEnd: new Vector3(),
        bobPhase: i * 0.87,
      };
      this.positionInWorld(jelly, 0);
      this.jellies.push(jelly);
    }
  }

  /** Current in-progress capture progress, or `null` if nobody is capturing. */
  getCaptureProgress(): number {
    if (this.capturingIndex < 0) return 0;
    return this.jellies[this.capturingIndex]?.progress ?? 0;
  }

  /** Number captured (including those fading out after moon impact). */
  getCollectedCount(): number {
    let n = 0;
    for (const j of this.jellies) {
      if (j.status === "handoff" || j.status === "following") n++;
    }
    return n;
  }

  /** Snap all following jellies to their orbit slot immediately. Used after teleport. */
  snapFollowers(carpetMatrix: Matrix4) {
    for (const j of this.jellies) {
      if (j.status !== "following") continue;
      this.computeOrbitTarget(j, carpetMatrix, _tmpTarget);
      j.followPos.copy(_tmpTarget);
      j.visual.group.position.copy(_tmpTarget);
      this.orientFollower(j, carpetMatrix, 1000); // large dt to snap instantly
    }
  }

  /**
   * Per-frame update.
   * @param dt seconds
   * @param carpetMatrix world matrix of the carpet
   * @param playerWorldPos scene-space position of the player (used for capture proximity)
   * @param allowCapture pass false during cinematics — visuals animate but no capture
   * @param blockCapture pass true when another UI (selfie) should take priority
   */
  update(
    dt: number,
    carpetMatrix: Matrix4,
    playerWorldPos: Vector3,
    allowCapture: boolean,
    blockCapture: boolean,
  ) {
    if (this.disposed) return;
    this.time += dt;

    const captureEnabled = allowCapture && !blockCapture;

    // If we are currently capturing, check if still in range / blocked.
    let activeCapturing = this.capturingIndex;
    if (activeCapturing >= 0) {
      const j = this.jellies[activeCapturing]!;
      if (!captureEnabled || j.status !== "capturing") {
        this.capturingIndex = -1;
        activeCapturing = -1;
      } else {
        const dist = j.worldPos.distanceTo(playerWorldPos);
        if (dist > JELLY_CAPTURE_EXIT_RADIUS) {
          this.capturingIndex = -1;
          activeCapturing = -1;
        }
      }
    }

    // If nobody capturing, pick the closest world-state jelly within radius.
    if (captureEnabled && activeCapturing < 0) {
      let bestIdx = -1;
      let bestDist = JELLY_CAPTURE_RADIUS;
      for (let i = 0; i < this.jellies.length; i++) {
        const j = this.jellies[i]!;
        if (j.status !== "world") continue;
        const d = j.worldPos.distanceTo(playerWorldPos);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const j = this.jellies[bestIdx]!;
        j.status = "capturing";
        this.capturingIndex = bestIdx;
        activeCapturing = bestIdx;
      }
    }

    // Tick all jellies
    for (let i = 0; i < this.jellies.length; i++) {
      const j = this.jellies[i]!;
      j.visual.setTime(this.time);

      switch (j.status) {
        case "world":
          this.positionInWorld(j, dt);
          break;

        case "capturing": {
          this.positionInWorld(j, dt);
          const dist = j.worldPos.distanceTo(playerWorldPos);
          if (dist < JELLY_CAPTURE_RADIUS && captureEnabled && i === activeCapturing) {
            j.progress = Math.min(1, j.progress + JELLY_FILL_RATE * dt);
            if (j.progress >= 1) {
              this.beginHandoff(j);
              if (this.capturingIndex === i) this.capturingIndex = -1;
              this.onCapture?.(j.colorIndex);
            }
          } else {
            j.progress = Math.max(0, j.progress - JELLY_DECAY_RATE * dt);
            if (j.progress <= 0 && dist > JELLY_CAPTURE_EXIT_RADIUS) {
              j.status = "world";
              if (this.capturingIndex === i) this.capturingIndex = -1;
            }
          }
          break;
        }

        case "handoff": {
          j.handoffT += dt;
          const t = MathUtils.clamp(j.handoffT / JELLY_CAPTURE_HANDOFF_SEC, 0, 1);
          const smooth = t * t * (3 - 2 * t);
          this.computeOrbitTarget(j, carpetMatrix, _tmpTarget);
          j.handoffEnd.copy(_tmpTarget);
          _tmpV.copy(j.handoffStart).lerp(j.handoffEnd, smooth);
          j.followPos.copy(_tmpV);
          j.visual.group.position.copy(j.followPos);
          j.visual.group.scale.setScalar(MathUtils.lerp(JELLY_SCALE_WORLD, JELLY_SCALE_FOLLOW, smooth));
          this.orientFollower(j, carpetMatrix, dt);
          if (t >= 1) {
            j.status = "following";
          }
          break;
        }

        case "following": {
          this.computeOrbitTarget(j, carpetMatrix, _tmpTarget);
          // Directly copy the target position so it never falls behind during speed boosts.
          // The target position itself already includes smooth bobbing and swaying.
          j.followPos.copy(_tmpTarget);
          j.visual.group.position.copy(j.followPos);
          j.visual.group.scale.setScalar(JELLY_SCALE_FOLLOW);
          this.orientFollower(j, carpetMatrix, dt);
          break;
        }

        case "fading": {
          j.opacity = Math.max(0, j.opacity - dt / JELLY_RESET_FADE_SEC);
          j.visual.setOpacity(j.opacity);
          if (j.opacity <= 0) {
            j.visual.group.visible = false;
          }
          break;
        }
      }
    }
  }

  /** Called on moon impact; fades captured jellies and hides world ones. */
  reset() {
    for (const j of this.jellies) {
      if (j.status === "following" || j.status === "handoff") {
        j.status = "fading";
      } else if (j.status === "world" || j.status === "capturing") {
        j.visual.group.visible = false;
        j.status = "fading";
        j.opacity = 0;
      }
      if (this.capturingIndex >= 0) this.capturingIndex = -1;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const j of this.jellies) {
      j.visual.dispose();
    }
    disposeJellyfishGeoms(this.geoms);
    this.group.parent?.remove(this.group);
    this.jellies = [];
  }

  /* ------------------------------------------------------------------ */

  private positionInWorld(j: Jelly, dt: number) {
    // Gentle drift in the tangent plane at the anchor.
    const driftPhase = this.time * 0.35 + j.driftPhase;
    const heading = driftPhase;
    const arc = (Math.sin(driftPhase * 0.6) * JELLY_DRIFT_RADIUS) / this.globeRadius;
    // Build a pose offset from anchor using moveOnSphere each frame (not integrating).
    j.posQ.copy(moveOnSphere(j.anchorQ, heading, arc));

    const frame = tangentFrame(j.posQ);
    const alt = JELLY_SPAWN_ALTITUDE + Math.sin(this.time * 0.9 + j.driftPhase) * 0.05;
    const pos = cartesianFromSpherical(j.posQ, alt, this.globeRadius);
    j.worldPos.copy(pos);
    j.visual.group.position.copy(pos);

    // Orient the bell so +Y faces away from globe center (tendrils hang down).
    const up = frame.up;
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up);
    // Add a slow spin around the up axis for life.
    const spinQ = new Quaternion().setFromAxisAngle(up, this.time * 0.15 + j.driftPhase);
    q.multiply(spinQ);
    j.visual.group.quaternion.copy(q);

    void dt;
  }

  private beginHandoff(j: Jelly) {
    j.handoffStart.copy(j.worldPos);
    j.handoffEnd.copy(j.worldPos); // will be overwritten each frame with the live target
    j.handoffT = 0;
    j.status = "handoff";
    j.progress = 1;
    j.orbitSlot = this.orbitSlotsUsed % JELLY_FOLLOW_OFFSETS.length;
    this.orbitSlotsUsed += 1;
  }

  private computeOrbitTarget(j: Jelly, carpetMatrix: Matrix4, out: Vector3) {
    const offset = JELLY_FOLLOW_OFFSETS[j.orbitSlot % JELLY_FOLLOW_OFFSETS.length]!;
    _orbitLocalScratch.copy(offset);
    // Bob in the carpet's local up/right directions so the motion reads as
    // "swimming" relative to the carpet (not the world) — holds shape in turns.
    // Reduced amplitude so they float around less.
    const bob = Math.sin(this.time * 1.9 + j.bobPhase) * 0.025;
    const sway = Math.sin(this.time * 1.3 + j.bobPhase * 1.7) * 0.015;
    _orbitLocalScratch.y += bob;
    _orbitLocalScratch.x += sway;
    out.copy(_orbitLocalScratch).applyMatrix4(carpetMatrix);
  }

  private orientFollower(j: Jelly, carpetMatrix: Matrix4, dt: number) {
    // Build a full right-handed rotation matrix locked to the carpet's orientation
    // so the jelly perfectly banks and turns with the carpet.
    // We want the jelly's local +Y (bell top) to point Forward (-Z of carpet).
    // We want the jelly's local +Z (front) to point Up (+Y of carpet).
    // Thus local +X MUST be cross(Y, Z) = cross(Forward, Up) to be right-handed.
    _forwardScratch.setFromMatrixColumn(carpetMatrix, 2).normalize().negate(); // Carpet Forward
    _upScratch.setFromMatrixColumn(carpetMatrix, 1).normalize();               // Carpet Up
    _rightScratch.crossVectors(_forwardScratch, _upScratch).normalize();       // Right-handed X

    _mat4.makeBasis(_rightScratch, _forwardScratch, _upScratch);
    const q = _followQ.setFromRotationMatrix(_mat4);

    // Tilt/roll around the forward axis so the jelly rocks side to side like
    // it's steering. Uses the same forward vector as the rotation axis.
    const tilt = Math.sin(this.time * 2.5 + j.bobPhase) * 0.15;
    // A smaller pitch nod around the right axis so it also bobs head-down/up.
    const nod = Math.sin(this.time * 1.8 + j.bobPhase * 1.3) * 0.1;

    _tiltQ.setFromAxisAngle(_forwardScratch, tilt);
    q.premultiply(_tiltQ);
    _tiltQ.setFromAxisAngle(_rightScratch, nod);
    q.premultiply(_tiltQ);

    // Smoothly slerp to the target orientation. A higher rate (5.0) makes it
    // track turns much better while still keeping a tiny bit of organic lag.
    j.visual.group.quaternion.slerp(q, 1 - Math.exp(-5.0 * dt));
  }
}

const _forwardScratch = new Vector3();
const _rightScratch = new Vector3();
const _upScratch = new Vector3();
const _orbitLocalScratch = new Vector3();
const _followQ = new Quaternion();
const _tiltQ = new Quaternion();
const _mat4 = new Matrix4();
const JELLY_LOCAL_UP = new Vector3(0, 1, 0);
