import {
  CanvasTexture,
  DoubleSide,
  Group,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
  cartesianFromSpherical,
  moveOnSphere,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";
import { isLand } from "./SimplexNoise";
import { createFishVisual, type OceanFishVisual } from "./OceanFishMesh";
import { randomOceanQuaternion } from "./Boat";

export const FISH_COUNT = 90;
export const FISH_CATCH_XP = 15;

/** Chord distance (world units) — same convention as SkyJellyfish. */
const FISH_CATCH_RADIUS = 0.55;
const FISH_CATCH_EXIT_RADIUS = 0.75;
const FISH_FILL_RATE = 1 / 2.0;
const FISH_DECAY_RATE = 0.6;
/** Normal cruising speed (world units/s along arc). */
const FISH_WANDER_SPEED = 0.20;
const FISH_TURN_RATE = 0.8;
/** Max additional flee turn rate (rad/s) at full progress. */
const FISH_FLEE_TURN_RATE = 3.5;
/** Speed multiplier added on top of base speed at full progress (so speed → base * (1 + mult)). */
const FISH_FLEE_SPEED_MULT = 2.2;
const FISH_SHADOW_ALT = 0.005;
/** Lifted above the ocean so the ring is not occluded; stays above tangent sag (~0.03 at globe r=5). */
const RING_ALT = 0.055;
/** Shift the ring astern along the water (tangent), relative to boat heading, to reduce parallax mismatch with the chase camera. World units at shell radius. */
const RING_PARALLAX_BACK_OFFSET = 0.048;
/** Outer radius of ring mesh as a fraction of {@link FISH_CATCH_RADIUS}. */
const RING_OUTER_FRAC = 1.02;
/**
 * Radial stroke thickness of the dotted ring (world units).
 * Originally ~5.5% of catch radius; reduced by 70% ⇒ 30% of that (~1.65% of radius).
 */
const RING_BAND = FISH_CATCH_RADIUS * 0.1 * 0.38;
/** Screen-space / world fat-line: width in world units (see LineMaterial `worldUnits`). */
const FISH_LINE_WIDTH = 0.005;
const LINE_ALT = 0.04;
const RESPAWN_MIN_CHORD_FROM_BOAT = 2.0;
const RESPAWN_FADE_OUT_SEC = 0.2;
const RESPAWN_FADE_IN_SEC = 0.2;
const LOOKAHEAD_ARC = 0.15;
const SPAWN_ATTEMPTS = 80;
const LINE_SEGS = 12;

type FishStatus = "swimming" | "capturing" | "respawning";

interface Fish {
  posQ: Quaternion;
  heading: number;
  worldPos: Vector3;
  progress: number;
  status: FishStatus;
  phase: number;
  visual: OceanFishVisual;
  respawnT: number;
  respawnMoved: boolean;
  /** Previous bar +Z in world space (degenerate billboard fallback). */
  prevBarZ: Vector3;
}

/** Module-level scratch vectors to avoid per-frame allocations. */
const _tmpV1 = new Vector3();
const _tmpV2 = new Vector3();
const _tmpV3 = new Vector3();
/** `RingGeometry` faces +Z in local space; we rotate so +Z aligns with globe surface normal. */
const RING_LOCAL_NORMAL = new Vector3(0, 0, 1);

export class OceanFish {
  readonly group = new Group();
  onCatch: (() => void) | null = null;

  private fish: Fish[] = [];
  private time = 0;
  private capturingIndex = -1;
  private catchCount = 0;
  private respawnSalt = 0;
  private disposed = false;

  // Dashed fishing range ring — a flat RingGeometry disc oriented tangent to the globe
  // at the boat's position, textured with a dashed pattern. Using a textured mesh
  // (rather than LineBasicMaterial) avoids the 1-pixel line-width clamp that makes
  // thin GL lines nearly invisible on modern GPUs.
  private ringGeometry: RingGeometry;
  private ringMesh: Mesh;
  private ringTexture: CanvasTexture;
  private ringMat: MeshBasicMaterial;

  // Geodesic fishing line (fat lines — LineBasicMaterial width is 1px on most GPUs)
  private lineGeometry: LineGeometry;
  private linePositions: Float32Array;
  private fishLine: Line2;
  private fishLineMat: LineMaterial;
  /** After first {@link LineGeometry#setPositions}; avoid reallocating fat-line buffers every frame. */
  private fishLineGpuReady = false;

  private readonly globeRadius: number;
  private readonly seed: number;
  private readonly terrainType: string;

  constructor(
    globeRadius: number,
    worldSeed: number,
    sessionSalt: number,
    terrainType: string,
  ) {
    this.globeRadius = globeRadius;
    this.seed = worldSeed;
    this.terrainType = terrainType;

    // ── Dashed fishing-range ring (textured disc) ────────────────
    // Canvas with a ring of radial dashes painted around the circumference.
    const ringCanvas = document.createElement("canvas");
    ringCanvas.width = 512;
    ringCanvas.height = 512;
    const rctx = ringCanvas.getContext("2d")!;
    rctx.clearRect(0, 0, 512, 512);
    const cxR = 256;
    const cyR = 256;
    const outerR = 250;
    const worldOuter = FISH_CATCH_RADIUS * RING_OUTER_FRAC;
    const texBand = outerR * (RING_BAND / worldOuter);
    const innerR = outerR - texBand;
    const midR = (outerR + innerR) * 0.5;
    const N_DASHES = 36;
    rctx.translate(cxR, cyR);
    rctx.strokeStyle = "rgba(255,255,255,0.95)";
    rctx.lineCap = "round";
    rctx.lineWidth = texBand;
    for (let i = 0; i < N_DASHES; i++) {
      const a0 = (i / N_DASHES) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / N_DASHES * 0.34; // 34% fill, 66% gap
      rctx.beginPath();
      rctx.arc(0, 0, midR, a0, a1);
      rctx.stroke();
    }
    this.ringTexture = new CanvasTexture(ringCanvas);
    this.ringTexture.colorSpace = SRGBColorSpace;
    this.ringTexture.anisotropy = 4;
    this.ringTexture.needsUpdate = true;

    // A RingGeometry whose inner/outer radii span the dashed band (slightly wider
    // than the actual texture band so there is padding and no aliasing at the edge).
    const ringOuter = worldOuter;
    const ringInner = ringOuter - RING_BAND;
    this.ringGeometry = new RingGeometry(ringInner, ringOuter, 64, 1);
    this.ringMat = new MeshBasicMaterial({
      map: this.ringTexture,
      transparent: true,
      opacity: 0.1,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.ringMesh = new Mesh(this.ringGeometry, this.ringMat);
    this.ringMesh.renderOrder = 6;
    this.ringMesh.visible = false;
    this.group.add(this.ringMesh);

    // ── Geodesic fishing line (fat line shader, world-space width) ─
    this.linePositions = new Float32Array((LINE_SEGS + 1) * 3);
    this.lineGeometry = new LineGeometry();
    this.fishLineMat = new LineMaterial({
      color: 0xddeeff,
      worldUnits: true,
      linewidth: FISH_LINE_WIDTH,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    // Needed for screen-space aspect in the fat-line shader (updated via setFishingLineResolution).
    this.fishLineMat.resolution.set(
      typeof window !== "undefined" ? window.innerWidth : 1024,
      typeof window !== "undefined" ? window.innerHeight : 768,
    );
    this.fishLine = new Line2(this.lineGeometry, this.fishLineMat);
    this.fishLine.renderOrder = 15;
    this.fishLine.visible = false;
    // Do not call computeLineDistances() here — no instanceStart until setPositions(); would throw
    // and/or hard-fail boat startup.
    this.group.add(this.fishLine);

    // ── Fish pool ────────────────────────────────────────────────
    for (let i = 0; i < FISH_COUNT; i++) {
      const visual = createFishVisual();
      this.group.add(visual.group);

      const seed = worldSeed + sessionSalt * 7919 + i * 982451653 + 901;
      const posQ =
        this.pickOceanQuaternion(seed, null) ??
        randomOceanQuaternion(worldSeed, terrainType, sessionSalt + i * 17);
      const spawn = randomSpawnQuaternionAndHeading(seed + 3);
      const fish: Fish = {
        posQ: posQ.clone(),
        heading: spawn.heading + i * 0.31,
        worldPos: new Vector3(),
        progress: 0,
        status: "swimming",
        phase: (i * 2.17) % (Math.PI * 2),
        visual,
        respawnT: 0,
        respawnMoved: false,
        prevBarZ: new Vector3(0, 0, 1),
      };
      this.fish.push(fish);
    }
  }

  getCaptureProgress(): number {
    if (this.capturingIndex < 0) return 0;
    return this.fish[this.capturingIndex]?.progress ?? 0;
  }

  getCatchCount(): number {
    return this.catchCount;
  }

  update(
    dt: number,
    boatQPos: Quaternion,
    _boatMatrix: Matrix4,
    boatWorldPos: Vector3,
    cameraPos: Vector3,
    /** Boat yaw on the sphere (radians), 0 = north in {@link tangentFrame}. */
    boatHeading: number,
    dayWeight: number,
    nightWeight: number,
    allowCapture: boolean,
  ) {
    if (this.disposed) return;
    this.time += dt;

    const boatRadial = _tmpV2.copy(boatWorldPos).normalize();
    const captureEnabled = allowCapture;

    // Pre-compute world positions (used for range checks before movement)
    for (const f of this.fish) {
      f.worldPos.copy(cartesianFromSpherical(f.posQ, FISH_SHADOW_ALT, this.globeRadius));
    }

    // Validate or clear current capture
    let activeCapturing = this.capturingIndex;
    if (activeCapturing >= 0) {
      const f = this.fish[activeCapturing]!;
      if (!captureEnabled || f.status !== "capturing") {
        this.capturingIndex = -1;
        activeCapturing = -1;
      } else {
        const dist = f.worldPos.distanceTo(boatWorldPos);
        if (dist > FISH_CATCH_EXIT_RADIUS) {
          this.capturingIndex = -1;
          activeCapturing = -1;
        }
      }
    }

    // Pick a new capture target if none
    if (captureEnabled && activeCapturing < 0) {
      let bestIdx = -1;
      let bestDist = FISH_CATCH_RADIUS;
      for (let i = 0; i < this.fish.length; i++) {
        const f = this.fish[i]!;
        if (f.status !== "swimming") continue;
        const d = f.worldPos.distanceTo(boatWorldPos);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        this.fish[bestIdx]!.status = "capturing";
        this.capturingIndex = bestIdx;
        activeCapturing = bestIdx;
      }
    }

    const boatOnLand = isLand(
      this.seed,
      this.terrainType,
      boatRadial.x,
      boatRadial.y,
      boatRadial.z,
    );

    // Geodesic ring half-angle
    const gamma = 2 * Math.asin(Math.min(1, FISH_CATCH_RADIUS / (2 * this.globeRadius)));

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i]!;

      // ── Respawning ──
      if (f.status === "respawning") {
        f.respawnT += dt;
        if (f.respawnT < RESPAWN_FADE_OUT_SEC) {
          f.visual.setOpacityFade(1 - f.respawnT / RESPAWN_FADE_OUT_SEC);
        } else {
          if (!f.respawnMoved) {
            f.respawnMoved = true;
            const q =
              this.pickOceanQuaternion(this.seed + this.respawnSalt++, boatWorldPos) ??
              randomOceanQuaternion(this.seed, this.terrainType, this.respawnSalt + i * 31);
            f.posQ.copy(q);
            f.heading = randomSpawnQuaternionAndHeading(this.seed + i * 9973 + this.respawnSalt).heading;
            f.progress = 0;
            f.visual.setProgress(0);
            f.visual.setOpacityFade(0);
          }
          if (f.respawnT < RESPAWN_FADE_OUT_SEC + RESPAWN_FADE_IN_SEC) {
            const t = (f.respawnT - RESPAWN_FADE_OUT_SEC) / RESPAWN_FADE_IN_SEC;
            f.visual.setOpacityFade(Math.min(1, t));
          } else {
            f.status = "swimming";
            f.respawnMoved = false;
            f.respawnT = 0;
            f.visual.setOpacityFade(1);
          }
        }
        this.applyFishTransform(f, boatRadial, cameraPos, dayWeight, nightWeight);
        continue;
      }

      // ── Swimming ──
      if (f.status === "swimming") {
        const turn =
          (Math.sin(this.time * 0.7 + f.phase) * 0.4 +
            Math.sin(this.time * 0.23 + f.phase * 1.7) * 0.2) *
          FISH_TURN_RATE;
        f.heading += turn * dt;

        const qAhead = moveOnSphere(f.posQ, f.heading, LOOKAHEAD_ARC / this.globeRadius);
        const ahead = cartesianFromSpherical(qAhead, 0, 1);
        if (isLand(this.seed, this.terrainType, ahead.x, ahead.y, ahead.z)) {
          f.heading += (Math.PI / 2) * (i % 2 === 0 ? 1 : -1) + Math.sin(this.time + f.phase) * 0.4;
        }

        f.posQ = moveOnSphere(f.posQ, f.heading, (FISH_WANDER_SPEED * dt) / this.globeRadius);
      }

      // ── Capturing — flee + progress ──
      else if (f.status === "capturing") {
        const frame = tangentFrame(f.posQ);

        // Base wander turn (faster, more erratic when hooked)
        const turnFreqMult = 1 + f.progress * 1.5;
        const baseTurn =
          (Math.sin(this.time * 0.9 * turnFreqMult + f.phase) * 0.5 +
            Math.sin(this.time * 0.37 * turnFreqMult + f.phase * 1.9) * 0.3) *
          FISH_TURN_RATE;
        f.heading += baseTurn * dt;

        // Flee: steer away from the boat, urgency scales with progress
        if (f.progress > 0.05) {
          _tmpV1.subVectors(f.worldPos, boatWorldPos);
          const projUp = frame.up.dot(_tmpV1);
          _tmpV1.addScaledVector(frame.up, -projUp);
          if (_tmpV1.lengthSq() > 1e-8) {
            _tmpV1.normalize();
            const fleeH = Math.atan2(frame.east.dot(_tmpV1), frame.north.dot(_tmpV1));
            let diff = fleeH - f.heading;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            f.heading += diff * FISH_FLEE_TURN_RATE * f.progress * dt;
          }
        }

        // Land avoidance still applies when fleeing
        const qAhead = moveOnSphere(f.posQ, f.heading, LOOKAHEAD_ARC / this.globeRadius);
        const ahead = cartesianFromSpherical(qAhead, 0, 1);
        if (isLand(this.seed, this.terrainType, ahead.x, ahead.y, ahead.z)) {
          f.heading += (Math.PI / 2) * (i % 2 === 0 ? 1 : -1);
        }

        // Move — faster as the fish struggles more
        const speed = FISH_WANDER_SPEED * (1 + FISH_FLEE_SPEED_MULT * f.progress);
        f.posQ = moveOnSphere(f.posQ, f.heading, (speed * dt) / this.globeRadius);

        // Post-movement position for capture check
        const wp = cartesianFromSpherical(f.posQ, FISH_SHADOW_ALT, this.globeRadius);
        const dist = wp.distanceTo(boatWorldPos);
        if (dist < FISH_CATCH_RADIUS && captureEnabled && i === activeCapturing) {
          f.progress = Math.min(1, f.progress + FISH_FILL_RATE * dt);
          if (f.progress >= 1) {
            this.catchCount += 1;
            this.onCatch?.();
            f.status = "respawning";
            f.respawnT = 0;
            f.respawnMoved = false;
            f.progress = 0;
            f.visual.setProgress(0);
            if (this.capturingIndex === i) this.capturingIndex = -1;
          }
        } else {
          f.progress = Math.max(0, f.progress - FISH_DECAY_RATE * dt);
          if (f.progress <= 0 && dist > FISH_CATCH_EXIT_RADIUS) {
            f.status = "swimming";
            if (this.capturingIndex === i) this.capturingIndex = -1;
          }
        }
      }

      this.applyFishTransform(f, boatRadial, cameraPos, dayWeight, nightWeight);
    }

    // ── Dotted range ring ────────────────────────────────────────
    if (!boatOnLand) {
      this.updateRing(boatQPos, boatWorldPos, boatHeading);
      this.ringMesh.visible = true;
    } else {
      this.ringMesh.visible = false;
    }

    // ── Fishing line ─────────────────────────────────────────────
    if (activeCapturing >= 0) {
      const capFish = this.fish[activeCapturing]!;
      const prog = capFish.progress;
      if (prog > 0.001) {
        this.updateFishLine(boatWorldPos, capFish.worldPos, prog);
        this.fishLine.visible = true;
      } else {
        this.fishLine.visible = false;
      }
    } else {
      // Fade out line when no longer capturing
      const prevOpacity = this.fishLineMat.opacity;
      if (prevOpacity > 0.005) {
        this.fishLineMat.opacity = Math.max(0, prevOpacity - dt * 4);
        this.fishLine.visible = true;
      } else {
        this.fishLineMat.opacity = 0;
        this.fishLine.visible = false;
      }
    }
  }

  private shadowAlpha(dayWeight: number, nightWeight: number): number {
    const eveningWeight = Math.max(0, 1 - dayWeight - nightWeight);
    return 0.62 * dayWeight + 0.58 * eveningWeight + 0.78 * nightWeight;
  }

  private pickOceanQuaternion(salt: number, boatWorldPos: Vector3 | null): Quaternion | null {
    for (let a = 0; a < SPAWN_ATTEMPTS; a++) {
      const s = randomSpawnQuaternionAndHeading(salt + a * 104729);
      const u = cartesianFromSpherical(s.qPosition, 0, 1);
      if (!isLand(this.seed, this.terrainType, u.x, u.y, u.z)) {
        if (boatWorldPos) {
          const p = cartesianFromSpherical(s.qPosition, FISH_SHADOW_ALT, this.globeRadius);
          if (p.distanceTo(boatWorldPos) < RESPAWN_MIN_CHORD_FROM_BOAT) continue;
        }
        return s.qPosition.clone();
      }
    }
    return null;
  }

  private applyFishTransform(
    f: Fish,
    boatRadial: Vector3,
    cameraPos: Vector3,
    dayWeight: number,
    nightWeight: number,
  ) {
    const frame = tangentFrame(f.posQ);
    f.worldPos.copy(cartesianFromSpherical(f.posQ, FISH_SHADOW_ALT, this.globeRadius));
    f.visual.group.position.copy(f.worldPos);

    const headingDir = _tmpV3
      .set(0, 0, 0)
      .addScaledVector(frame.north, Math.cos(f.heading))
      .addScaledVector(frame.east, Math.sin(f.heading))
      .normalize();

    const zShadow = new Vector3().crossVectors(headingDir, frame.up).normalize();
    const m = new Matrix4().makeBasis(headingDir, frame.up, zShadow);
    f.visual.shadowGroup.quaternion.setFromRotationMatrix(m);

    const radialUp = frame.up;
    if (radialUp.dot(boatRadial) <= -0.1) {
      f.visual.group.visible = false;
      return;
    }
    f.visual.group.visible = true;

    // Billboard the bar around the radial-up axis toward the camera
    const toCam = new Vector3().subVectors(cameraPos, f.worldPos);
    let inPlane = toCam.clone();
    inPlane.addScaledVector(radialUp, -radialUp.dot(inPlane));
    if (inPlane.lengthSq() < 1e-8) {
      inPlane.copy(f.prevBarZ);
    } else {
      inPlane.normalize();
    }
    f.prevBarZ.copy(inPlane);

    const xAxis = new Vector3().crossVectors(radialUp, inPlane).normalize();
    const mBar = new Matrix4().makeBasis(xAxis, radialUp, inPlane.clone());
    f.visual.barGroup.quaternion.setFromRotationMatrix(mBar);
    f.visual.barGroup.position.copy(radialUp).multiplyScalar(0.08);

    const alpha = this.shadowAlpha(dayWeight, nightWeight);
    f.visual.setProgress(f.status === "capturing" ? f.progress : 0);
    if (f.status !== "respawning") {
      f.visual.setOpacityFade(1);
    }
    f.visual.setShadowOpacity(alpha);
    const eveningWeight = Math.max(0, 1 - dayWeight - nightWeight);
    f.visual.setNightGlow(nightWeight, eveningWeight);
  }

  /**
   * Positions and orients the fishing-range ring disc.
   *
   * `RingGeometry` lies in local XY with normals +Z. We must align local +Z with
   * the globe outward normal at the boat. Do **not** use {@link Matrix4.makeBasis}
   * with (east, north, up): in {@link tangentFrame}, `north = east × up`, so
   * `east × north = −up` — the system is left-handed if Z = +up, and
   * `setFromRotationMatrix` then yields a bad / randomly twisting orientation.
   * {@link Quaternion.setFromUnitVectors} maps local +Z to `frame.up` correctly.
   */
  private updateRing(boatQPos: Quaternion, boatWorldPos: Vector3, boatHeading: number) {
    const frame = tangentFrame(boatQPos);
    this.ringMesh.quaternion.setFromUnitVectors(RING_LOCAL_NORMAL, frame.up);

    // Tangent "astern": opposite to forward = −(north·cos(heading) + east·sin(heading))
    _tmpV3
      .copy(frame.north)
      .multiplyScalar(Math.cos(boatHeading))
      .addScaledVector(frame.east, Math.sin(boatHeading))
      .multiplyScalar(-RING_PARALLAX_BACK_OFFSET);

    const h =
      boatWorldPos.length() + RING_ALT + (this.globeRadius - boatWorldPos.length());
    this.ringMesh.position
      .copy(boatWorldPos)
      .add(_tmpV3)
      .normalize()
      .multiplyScalar(h);
  }

  /**
   * Draws a geodesic arc from `boatPos` to `fishPos` along the sphere surface,
   * lifted by `LINE_ALT`. Opacity fades in with `progress`.
   */
  private updateFishLine(boatPos: Vector3, fishPos: Vector3, progress: number) {
    const r = this.globeRadius + LINE_ALT;
    _tmpV1.copy(boatPos).normalize();
    _tmpV2.copy(fishPos).normalize();

    for (let j = 0; j <= LINE_SEGS; j++) {
      const t = j / LINE_SEGS;
      _tmpV3.copy(_tmpV1).lerp(_tmpV2, t).normalize().multiplyScalar(r);
      const o = j * 3;
      this.linePositions[o] = _tmpV3.x;
      this.linePositions[o + 1] = _tmpV3.y;
      this.linePositions[o + 2] = _tmpV3.z;
    }

    const geom = this.lineGeometry;

    if (!this.fishLineGpuReady) {
      geom.setPositions(this.linePositions);
      this.fishLine.computeLineDistances();
      this.fishLineGpuReady = true;
    } else {
      const posStart = geom.attributes.instanceStart as InterleavedBufferAttribute;
      const posBuf = posStart.data.array as Float32Array;
      for (let seg = 0; seg < LINE_SEGS; seg++) {
        const o = seg * 3;
        const b = seg * 6;
        posBuf.set(this.linePositions.subarray(o, o + 6), b);
      }
      posStart.data.needsUpdate = true;

      const iStart = geom.attributes.instanceStart as InterleavedBufferAttribute;
      const iEnd = geom.attributes.instanceEnd as InterleavedBufferAttribute;
      const dArr = (geom.attributes.instanceDistanceStart as InterleavedBufferAttribute).data
        .array as Float32Array;
      let cum = 0;
      for (let i = 0; i < LINE_SEGS; i++) {
        _tmpV1.fromBufferAttribute(iStart, i);
        _tmpV2.fromBufferAttribute(iEnd, i);
        const segLen = _tmpV1.distanceTo(_tmpV2);
        dArr[i * 2] = cum;
        cum += segLen;
        dArr[i * 2 + 1] = cum;
      }
      (geom.attributes.instanceDistanceStart as InterleavedBufferAttribute).data.needsUpdate = true;
    }

    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    this.fishLineMat.opacity = progress * 0.75;
  }

  /** Fat-line shader needs viewport size; call from game resize handler. */
  setFishingLineResolution(width: number, height: number) {
    this.fishLineMat.resolution.set(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const f of this.fish) {
      f.visual.dispose();
    }
    this.fish = [];
    this.ringGeometry.dispose();
    this.ringMat.dispose();
    this.ringTexture.dispose();
    this.lineGeometry.dispose();
    this.fishLineMat.dispose();
    this.group.parent?.remove(this.group);
  }
}
