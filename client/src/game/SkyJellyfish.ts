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
export const JELLY_CAPTURE_XP = 30;

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
/** World-space lag toward orbit slot (lower = more lag through turns). */
const JELLY_FOLLOW_POS_RATE = 3.4;
/** Rotation lag toward blended target (lower = less coupled to carpet). */
const JELLY_FOLLOW_ORIENT_RATE = 1.25;
/** Mix globe-radial “up” against carpet-aligned frame (0 = rigid carpet). */
const JELLY_FOLLOW_GLOBE_UP_BLEND = 0.28;
/** Snap time for "entering orbit" after capture completes. */
const JELLY_CAPTURE_HANDOFF_SEC = 1.2;
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
  new Vector3(-0.08, 0.02,  0.02),   // left wing, slightly behind
  new Vector3( 0.08, 0.02,  0.02),   // right wing, slightly behind
  new Vector3(-0.14, 0.06,  0.12),   // left-back, trailing more
  new Vector3( 0.14, 0.06,  0.12),   // right-back, trailing more
  new Vector3( 0.00, 0.08,  0.00),   // above-center
  new Vector3( 0.00, 0.03,  0.22),   // center-back, trailing furthest
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
  /** Previous scene position for velocity (tendril flow). */
  prevScenePos: Vector3;
  /** Smoothed world velocity for tendril shader (reduces jitter). */
  smoothedFlowVel: Vector3;
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
        prevScenePos: new Vector3(),
        smoothedFlowVel: new Vector3(),
      };
      this.positionInWorld(jelly, 0);
      jelly.prevScenePos.copy(jelly.visual.group.position);
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
      j.prevScenePos.copy(_tmpTarget);
      j.smoothedFlowVel.set(0, 0, 0);
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

          // Quadratic Bezier arc: jelly glides gracefully up-and-in rather than
          // moving in a straight line. Control point is lifted in the globe-radial
          // (outward) direction from the midpoint.
          _bezierCtrl.copy(j.handoffStart).lerp(j.handoffEnd, 0.5);
          _bezierDir.copy(j.handoffStart).normalize(); // outward-radial from globe center
          _bezierCtrl.addScaledVector(_bezierDir, 0.3); // lift control point outward

          const s1 = 1 - smooth;
          // Q(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
          _tmpV.set(0, 0, 0)
            .addScaledVector(j.handoffStart, s1 * s1)
            .addScaledVector(_bezierCtrl, 2 * s1 * smooth)
            .addScaledVector(j.handoffEnd, smooth * smooth);

          // Overlay a small swimming oscillation along the travel direction so
          // it looks like the jelly is actively propelling itself over.
          _pathDir.copy(j.handoffEnd).sub(j.handoffStart);
          const pathLen = _pathDir.length();
          if (pathLen > 1e-4) {
            _pathDir.multiplyScalar(1 / pathLen);
            const swim = Math.sin(j.handoffT * Math.PI * 2 * 0.75) * 0.015 * (1 - t);
            _tmpV.addScaledVector(_pathDir, swim);
          }

          const posAlpha = 1 - Math.exp(-JELLY_FOLLOW_POS_RATE * dt);
          j.followPos.lerp(_tmpV, posAlpha);
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
          const posAlpha = 1 - Math.exp(-JELLY_FOLLOW_POS_RATE * dt);
          j.followPos.lerp(_tmpTarget, posAlpha);
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

      // Tendril motion: bend opposite smoothed travel (world velocity → mesh-local per ribbon).
      _tmpV.copy(j.visual.group.position).sub(j.prevScenePos).multiplyScalar(1 / Math.max(dt, 1e-4));
      j.prevScenePos.copy(j.visual.group.position);
      j.smoothedFlowVel.lerp(_tmpV, 1 - Math.exp(-12 * dt));
      const maxFlow = 5.0;
      if (j.smoothedFlowVel.lengthSq() > maxFlow * maxFlow) {
        j.smoothedFlowVel.multiplyScalar(maxFlow / j.smoothedFlowVel.length());
      }
      j.visual.updateTendrilFlow(j.smoothedFlowVel);
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

    // Small gentle bob in the carpet's local up/right.
    const bob  = Math.sin(this.time * 2.2 + j.bobPhase)       * 0.020;
    const sway = Math.sin(this.time * 1.4 + j.bobPhase * 1.7) * 0.018;
    _orbitLocalScratch.y += bob;
    _orbitLocalScratch.x += sway;

    // Swimming impulse in forward direction, synchronized with the bell shader's
    // pulse frequency (0.75 Hz). Burst forward on the power stroke, drift back
    // gently on the glide — net displacement is ~zero per cycle.
    const swimCycle = this.time * 0.75 * Math.PI * 2 + j.bobPhase;
    const swim = Math.sin(swimCycle) * 0.012;
    _orbitLocalScratch.z -= swim; // -Z is forward in carpet-local space

    out.copy(_orbitLocalScratch).applyMatrix4(carpetMatrix);
  }

  private orientFollower(j: Jelly, carpetMatrix: Matrix4, dt: number) {
    // Carpet-aligned base (same basis as before).
    _forwardScratch.setFromMatrixColumn(carpetMatrix, 2).normalize().negate();
    _upScratch.setFromMatrixColumn(carpetMatrix, 1).normalize();
    _rightScratch.crossVectors(_forwardScratch, _upScratch).normalize();

    _mat4.makeBasis(_rightScratch, _forwardScratch, _upScratch);
    _followQ.setFromRotationMatrix(_mat4);

    const tilt = Math.sin(this.time * 2.5 + j.bobPhase) * 0.25;
    const nod = Math.sin(this.time * 1.8 + j.bobPhase * 1.3) * 0.15;

    _tiltQ.setFromAxisAngle(_forwardScratch, tilt);
    _followQ.premultiply(_tiltQ);
    _tiltQ.setFromAxisAngle(_rightScratch, nod);
    _followQ.premultiply(_tiltQ);

    const driftRoll = Math.sin(this.time * 0.42 + j.bobPhase * 2.71) * 0.22;
    const driftPitch = Math.sin(this.time * 0.31 + j.bobPhase * 1.57) * 0.16;
    _tiltQ.setFromAxisAngle(_forwardScratch, driftRoll);
    _followQ.multiply(_tiltQ);
    _tiltQ.setFromAxisAngle(_rightScratch, driftPitch);
    _followQ.multiply(_tiltQ);

    // Partly toward globe-radial up so the jellyfish does not bank exactly with the carpet.
    _tmpV2.copy(j.visual.group.position);
    if (_tmpV2.lengthSq() < 1e-10) {
      _qBlend.copy(_followQ);
    } else {
      _tmpV2.normalize();
      _qGlobe.setFromUnitVectors(JELLY_LOCAL_UP, _tmpV2);
      const spin = Math.sin(this.time * 0.28 + j.bobPhase * 1.9) * Math.PI * 0.35;
      _tiltQ.setFromAxisAngle(_tmpV2, spin);
      _qGlobe.multiply(_tiltQ);
      _qBlend.copy(_followQ).slerp(_qGlobe, JELLY_FOLLOW_GLOBE_UP_BLEND);
    }

    j.visual.group.quaternion.slerp(_qBlend, 1 - Math.exp(-JELLY_FOLLOW_ORIENT_RATE * dt));
  }
}

const _forwardScratch  = new Vector3();
const _rightScratch    = new Vector3();
const _upScratch       = new Vector3();
const _orbitLocalScratch = new Vector3();
const _bezierCtrl      = new Vector3();
const _bezierDir       = new Vector3();
const _pathDir         = new Vector3();
const _followQ  = new Quaternion();
const _qGlobe   = new Quaternion();
const _qBlend   = new Quaternion();
const _tiltQ    = new Quaternion();
const _mat4     = new Matrix4();
const JELLY_LOCAL_UP = new Vector3(0, 1, 0);
