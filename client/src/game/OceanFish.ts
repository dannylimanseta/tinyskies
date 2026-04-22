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
  seededRandom,
  tangentFrame,
} from "./SphericalMath";
import { isLand } from "./SimplexNoise";
import type { AudioManager } from "../audio/AudioManager";
import { createFishVisual, type FishVariant, type OceanFishVisual } from "./OceanFishMesh";
import { FishCatchVfx } from "./FishCatchVfx";
export type { FishVariant } from "./OceanFishMesh";
import { randomOceanQuaternion } from "./Boat";
import type { UpgradeState } from "./UpgradeManager";

export const FISH_COUNT = 240;
export const FISH_CATCH_XP = 15;
/** After this many catches in a session, mystery octopuses may appear (eternal flame reward, once per save). */
export const FISH_COUNT_BEFORE_MYSTERY_OCTOPUS = 12;
/** How many “octopus” shadows spawn at once; reeling in one makes the rest vanish. */
const MYSTERY_OCTOPUS_SPAWN_COUNT = 3;

/** Chord distance (world units) — same convention as SkyJellyfish. */
const FISH_CATCH_RADIUS = 0.55;
const FISH_CATCH_EXIT_RADIUS = 0.75;
const FISH_FILL_RATE = 1 / 2.0;
const FISH_DECAY_RATE = 0.6;
/** Normal cruising speed (world units/s along arc). */
const FISH_WANDER_SPEED = 0.17;
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

/** Schools move as units; fish stay in a small tangent blob so players must travel to find them. */
const NUM_SCHOOLS = 24;
const FISH_PER_SCHOOL = Math.ceil(FISH_COUNT / NUM_SCHOOLS);
/** Max tangent offset from school center (world units at globe surface). */
const SCHOOL_MAX_OFFSET = 0.82;
/** School centroid wander speed along the sphere (slightly slower than old solo fish). */
const SCHOOL_WANDER_SPEED = 0.11;

type FishStatus = "swimming" | "capturing" | "respawning";

interface SchoolState {
  centerQ: Quaternion;
  heading: number;
  phase: number;
}

interface Fish {
  posQ: Quaternion;
  heading: number;
  /** Heading at end of previous frame — for shadow wiggle from turn rate. */
  prevHeading: number;
  worldPos: Vector3;
  progress: number;
  status: FishStatus;
  phase: number;
  variant: FishVariant;
  visual: OceanFishVisual;
  respawnT: number;
  respawnMoved: boolean;
  /** Previous bar +Z in world space (degenerate billboard fallback). */
  prevBarZ: Vector3;
  /** Index into {@link OceanFish.schools} (swimming / respawn placement). */
  schoolId: number;
  /** Angle in the school's tangent plane for blob layout. */
  ringAngle: number;
  /** 0–1 scales how far from school center this fish sits. */
  spreadRad: number;
}

/** Module-level scratch vectors to avoid per-frame allocations. */
const _tmpV1 = new Vector3();
const _tmpV2 = new Vector3();
const _tmpV3 = new Vector3();
const _boatForward = new Vector3();
const _schoolCenterPos = new Vector3();
const _schoolFishNormal = new Vector3();
const _WORLD_UP = new Vector3(0, 1, 0);

function wrapAnglePi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
/** `RingGeometry` faces +Z in local space; we rotate so +Z aligns with globe surface normal. */
const RING_LOCAL_NORMAL = new Vector3(0, 0, 1);

export class OceanFish {
  readonly group = new Group();
  onCatch: ((variant: FishVariant) => void) | null = null;

  private fish: Fish[] = [];
  private time = 0;
  /** Fish indices currently on the line (max {@link fishMaxConcurrent}). */
  private activeCaptures: number[] = [];
  private catchCount = 0;
  private fishCatchRadiusMult = 1;
  private fishFillRateMult = 1;
  private fishMaxConcurrent = 1;
  private respawnSalt = 0;
  private disposed = false;
  /** Session flag: set once when {@link spawnMysteryOctopus} runs (only one prize per run). */
  private mysteryOctopusOffered = false;
  /** Set when any mystery octopus is reeled in; other octopuses are removed that frame. */
  private mysteryOctopusCleanupAfterCatch = false;

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
  private linePositionsB: Float32Array;
  private lineGeometryB: LineGeometry;
  private fishLineB: Line2;
  private fishLineMatB: LineMaterial;
  private fishLineGpuReadyB = false;

  private readonly globeRadius: number;
  private readonly seed: number;
  private readonly terrainType: string;
  private readonly catchVfx: FishCatchVfx;

  private schools: SchoolState[] = [];

  constructor(
    globeRadius: number,
    worldSeed: number,
    sessionSalt: number,
    terrainType: string,
    audioManager: AudioManager | null = null,
  ) {
    this.globeRadius = globeRadius;
    this.seed = worldSeed;
    this.terrainType = terrainType;
    this.catchVfx = new FishCatchVfx(audioManager);

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

    this.linePositionsB = new Float32Array((LINE_SEGS + 1) * 3);
    this.lineGeometryB = new LineGeometry();
    this.fishLineMatB = new LineMaterial({
      color: 0xcce8ff,
      worldUnits: true,
      linewidth: FISH_LINE_WIDTH,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.fishLineMatB.resolution.set(
      typeof window !== "undefined" ? window.innerWidth : 1024,
      typeof window !== "undefined" ? window.innerHeight : 768,
    );
    this.fishLineB = new Line2(this.lineGeometryB, this.fishLineMatB);
    this.fishLineB.renderOrder = 14;
    this.fishLineB.visible = false;
    this.group.add(this.fishLineB);

    // ── School centroids (fish cluster around these as they move) ─
    for (let s = 0; s < NUM_SCHOOLS; s++) {
      const schSeed = worldSeed + sessionSalt * 7919 + s * 10007;
      const q =
        this.pickOceanQuaternion(schSeed, null) ??
        randomOceanQuaternion(worldSeed, terrainType, sessionSalt + s * 17);
      const spawn = randomSpawnQuaternionAndHeading(schSeed + 3);
      this.schools.push({
        centerQ: q.clone(),
        heading: spawn.heading + s * 0.19,
        phase: (s * 2.31) % (Math.PI * 2),
      });
    }

    // ── Fish pool ────────────────────────────────────────────────
    for (let i = 0; i < FISH_COUNT; i++) {
      const variant: FishVariant = i % 5 === 0 ? "large" : "normal";
      const visual = createFishVisual(variant);
      this.group.add(visual.group);

      const seed = worldSeed + sessionSalt * 7919 + i * 982451653 + 901;
      const rnd = seededRandom(seed);
      const schoolId = Math.min(NUM_SCHOOLS - 1, Math.floor(i / FISH_PER_SCHOOL));
      const ringAngle = rnd() * Math.PI * 2;
      const spreadRad = 0.1 + 0.9 * rnd();
      const spawn = randomSpawnQuaternionAndHeading(seed + 3);
      const h0 = spawn.heading + i * 0.31;
      const fish: Fish = {
        posQ: new Quaternion(),
        heading: h0,
        prevHeading: h0,
        worldPos: new Vector3(),
        progress: 0,
        status: "swimming",
        phase: (i * 2.17) % (Math.PI * 2),
        variant,
        visual,
        respawnT: 0,
        respawnMoved: false,
        prevBarZ: new Vector3(0, 0, 1),
        schoolId,
        ringAngle,
        spreadRad,
      };
      this.computeFishQFromSchoolInto(fish, fish.posQ);
      this.fish.push(fish);
    }
  }

  /** Called from Game when upgrade state changes. */
  setTuningFromUpgrades(s: UpgradeState) {
    this.fishCatchRadiusMult = Math.max(0.5, Math.min(2.5, s.fishCatchRadiusMult));
    this.fishFillRateMult = Math.max(0.5, Math.min(2.5, s.fishFillRateMult));
    this.fishMaxConcurrent = Math.max(1, Math.min(2, Math.floor(s.fishMaxConcurrent)));
    this.ringMesh.scale.setScalar(this.fishCatchRadiusMult);
  }

  getCaptureProgress(): number {
    let best = 0;
    for (const idx of this.activeCaptures) {
      best = Math.max(best, this.fish[idx]?.progress ?? 0);
    }
    return best;
  }

  getCatchCount(): number {
    return this.catchCount;
  }

  /**
   * Spawns several large octopus shadows (normal swim speed, slow reel). Catching
   * one removes the rest for that encounter.
   */
  spawnMysteryOctopus(boatWorldPos: Vector3) {
    if (this.disposed || this.mysteryOctopusOffered) return;

    const rnd = seededRandom(this.seed + this.respawnSalt * 10009 + 7777);
    const schoolIds = this.pickMysterySchools(boatWorldPos, MYSTERY_OCTOPUS_SPAWN_COUNT, rnd);
    this.spawnMysteryOctopusCluster(boatWorldPos, schoolIds, rnd);
  }

  private spawnMysteryOctopusCluster(
    boatWorldPos: Vector3,
    schoolIds: number[],
    rnd: () => number,
  ) {
    for (let n = 0; n < MYSTERY_OCTOPUS_SPAWN_COUNT; n++) {
      const visual = createFishVisual("octopus");
      this.group.add(visual.group);

      const schoolId = schoolIds[n] ?? this.pickSchoolForMysteryCreature(boatWorldPos, rnd);
      const ringAngle = (rnd() + n * 0.31) * Math.PI * 2;
      const spreadRad = 0.12 + 0.88 * rnd();

      const h0 = this.schools[schoolId]!.heading + rnd() * 0.4 + n * 0.17;
      const fish: Fish = {
        posQ: new Quaternion(),
        heading: h0,
        prevHeading: h0,
        worldPos: new Vector3(),
        progress: 0,
        status: "swimming",
        phase: 9.11 + n * 0.77,
        variant: "octopus",
        visual,
        respawnT: 0,
        respawnMoved: false,
        prevBarZ: new Vector3(0, 0, 1),
        schoolId,
        ringAngle,
        spreadRad,
      };
      this.computeFishQFromSchoolInto(fish, fish.posQ);
      this.fish.push(fish);
    }
    this.mysteryOctopusOffered = true;
  }

  private removeActiveCapture(idx: number) {
    const j = this.activeCaptures.indexOf(idx);
    if (j >= 0) this.activeCaptures.splice(j, 1);
  }

  private updateSchools(dt: number) {
    for (let s = 0; s < this.schools.length; s++) {
      const sch = this.schools[s]!;
      const turn =
        (Math.sin(this.time * 0.52 + sch.phase) * 0.38 +
          Math.sin(this.time * 0.2 + sch.phase * 1.4) * 0.22) *
        FISH_TURN_RATE *
        0.55;
      sch.heading += turn * dt;

      const qAhead = moveOnSphere(sch.centerQ, sch.heading, LOOKAHEAD_ARC / this.globeRadius);
      const ahead = cartesianFromSpherical(qAhead, 0, 1);
      if (isLand(this.seed, this.terrainType, ahead.x, ahead.y, ahead.z)) {
        sch.heading +=
          (Math.PI / 2) * (s % 2 === 0 ? 1 : -1) + Math.sin(this.time + sch.phase) * 0.32;
      }

      sch.centerQ.copy(
        moveOnSphere(sch.centerQ, sch.heading, (SCHOOL_WANDER_SPEED * dt) / this.globeRadius),
      );
    }
  }

  /** Places `out` on the globe near school `f.schoolId` (tangent-plane blob). */
  private computeFishQFromSchoolInto(f: Fish, out: Quaternion): Quaternion {
    const sch = this.schools[f.schoolId]!;
    const frame = tangentFrame(sch.centerQ);
    const wobble =
      Math.sin(this.time * 1.85 + f.phase) * 0.09 +
      Math.sin(this.time * 0.62 + f.phase * 1.3) * 0.05;
    const angle = f.ringAngle + wobble;
    const d = f.spreadRad * SCHOOL_MAX_OFFSET;
    _schoolCenterPos.copy(cartesianFromSpherical(sch.centerQ, 0, this.globeRadius));
    _tmpV1
      .copy(frame.north)
      .multiplyScalar(Math.cos(angle) * d)
      .addScaledVector(frame.east, Math.sin(angle) * d);
    _schoolFishNormal.copy(_schoolCenterPos).add(_tmpV1).normalize();
    return out.setFromUnitVectors(_WORLD_UP, _schoolFishNormal);
  }

  /**
   * Recomputes the fish's ringAngle and spreadRad relative to its current school
   * so it doesn't teleport when transitioning from capturing back to swimming.
   */
  private recomputeSchoolOffset(f: Fish) {
    const sch = this.schools[f.schoolId]!;
    const frame = tangentFrame(sch.centerQ);
    const fPos = cartesianFromSpherical(f.posQ, 0, this.globeRadius);
    const sPos = cartesianFromSpherical(sch.centerQ, 0, this.globeRadius);
    _tmpV1.subVectors(fPos, sPos);
    const x = frame.north.dot(_tmpV1);
    const y = frame.east.dot(_tmpV1);
    f.ringAngle = Math.atan2(y, x);
    f.spreadRad = Math.sqrt(x * x + y * y) / SCHOOL_MAX_OFFSET;
  }

  /** Prefer respawning into a school far from the boat so schools stay explorable. */
  private pickSchoolForRespawn(boatWorldPos: Vector3): number {
    let bestS = 0;
    let bestDist = -1;
    for (let s = 0; s < this.schools.length; s++) {
      const p = cartesianFromSpherical(this.schools[s]!.centerQ, FISH_SHADOW_ALT, this.globeRadius);
      const chord = p.distanceTo(boatWorldPos);
      if (chord > bestDist) {
        bestDist = chord;
        bestS = s;
      }
    }
    return bestS;
  }

  /**
   * Mystery octopus: place in a school a moderate distance from the boat so it is findable
   * (farthest school can be on the other side of the globe).
   */
  private pickSchoolForMysteryCreature(boatWorldPos: Vector3, rnd: () => number): number {
    const cands = this.getMysterySchoolCandidates(boatWorldPos);
    if (cands.length > 0) {
      return cands[Math.floor(rnd() * cands.length)]!;
    }
    return this.pickSchoolForRespawn(boatWorldPos);
  }

  private getMysterySchoolCandidates(boatWorldPos: Vector3): number[] {
    const minD = 0.65;
    const maxD = 2.15;
    const out: number[] = [];
    for (let s = 0; s < this.schools.length; s++) {
      const p = cartesianFromSpherical(this.schools[s]!.centerQ, FISH_SHADOW_ALT, this.globeRadius);
      const chord = p.distanceTo(boatWorldPos);
      if (chord >= minD && chord <= maxD) {
        out.push(s);
      }
    }
    return out;
  }

  /**
   * Prefer unique schools in the “moderate range” band; add other schools, then
   * duplicate picks only if the world is too small.
   */
  private pickMysterySchools(boatWorldPos: Vector3, count: number, rnd: () => number): number[] {
    const ring = this.getMysterySchoolCandidates(boatWorldPos);
    const shuffled = [...ring];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const r = Math.floor(rnd() * (i + 1));
      const a = shuffled[i]!;
      shuffled[i] = shuffled[r]!;
      shuffled[r] = a;
    }
    const out: number[] = [];
    const used = new Set<number>();
    for (const s of shuffled) {
      if (out.length >= count) break;
      if (used.has(s)) continue;
      used.add(s);
      out.push(s);
    }
    for (let s = 0; s < this.schools.length && out.length < count; s++) {
      if (used.has(s)) continue;
      used.add(s);
      out.push(s);
    }
    while (out.length < count) {
      out.push(Math.floor(rnd() * this.schools.length));
    }
    return out.slice(0, count);
  }

  /** Remove every mystery-octopus fish (caught or not). */
  private removeAllMysteryOctopuses() {
    for (let j = this.fish.length - 1; j >= 0; j--) {
      if (this.fish[j]!.variant !== "octopus") continue;
      const f = this.fish[j]!;
      this.group.remove(f.visual.group);
      f.visual.dispose();
      this.fish.splice(j, 1);
      for (let k = 0; k < this.activeCaptures.length; k++) {
        const idx = this.activeCaptures[k]!;
        if (idx === j) {
          this.activeCaptures.splice(k, 1);
          k--;
        } else if (idx > j) {
          this.activeCaptures[k] = idx - 1;
        }
      }
    }
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

    this.updateSchools(dt);
    for (const f of this.fish) {
      if (f.status === "swimming") {
        this.computeFishQFromSchoolInto(f, f.posQ);
        const sch = this.schools[f.schoolId]!;
        f.heading =
          sch.heading +
          Math.sin(this.time * 1.15 + f.phase) * 0.2 +
          Math.sin(this.time * 0.41 + f.phase * 1.7) * 0.09;
      }
    }

    const boatRadial = _tmpV2.copy(boatWorldPos).normalize();
    const captureEnabled = allowCapture;

    const boatFrame = tangentFrame(boatQPos);
    _boatForward
      .copy(boatFrame.north)
      .multiplyScalar(Math.cos(boatHeading))
      .addScaledVector(boatFrame.east, Math.sin(boatHeading));
    
    // Shift landing spot slightly astern (backwards) so it lands on the deck, not the bow
    const boatTargetPos = boatWorldPos.clone().addScaledVector(_boatForward, -0.18);

    // Pre-compute world positions (used for range checks before movement)
    for (const f of this.fish) {
      f.worldPos.copy(cartesianFromSpherical(f.posQ, FISH_SHADOW_ALT, this.globeRadius));
    }

    const effCatchR = FISH_CATCH_RADIUS * this.fishCatchRadiusMult;
    const effExitR = FISH_CATCH_EXIT_RADIUS * this.fishCatchRadiusMult;
    const effFill = FISH_FILL_RATE * this.fishFillRateMult;

    this.activeCaptures = this.activeCaptures.filter((idx) => {
      const f = this.fish[idx];
      if (!f || !captureEnabled || f.status !== "capturing") return false;
      const dist = f.worldPos.distanceTo(boatWorldPos);
      return dist <= effExitR;
    });

    while (captureEnabled && this.activeCaptures.length < this.fishMaxConcurrent) {
      let bestIdx = -1;
      let bestDist = effCatchR;
      for (let i = 0; i < this.fish.length; i++) {
        if (this.activeCaptures.includes(i)) continue;
        const f = this.fish[i]!;
        if (f.status !== "swimming") continue;
        const d = f.worldPos.distanceTo(boatWorldPos);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      this.fish[bestIdx]!.status = "capturing";
      this.activeCaptures.push(bestIdx);
    }

    const boatOnLand = isLand(
      this.seed,
      this.terrainType,
      boatRadial.x,
      boatRadial.y,
      boatRadial.z,
    );

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
            const rnd = seededRandom(this.seed + this.respawnSalt++ + i * 9973);
            f.schoolId = this.pickSchoolForRespawn(boatWorldPos);
            f.ringAngle = rnd() * Math.PI * 2;
            f.spreadRad = 0.12 + 0.88 * rnd();
            this.computeFishQFromSchoolInto(f, f.posQ);
            f.heading = this.schools[f.schoolId]!.heading + (rnd() - 0.5) * 0.38;
            f.prevHeading = f.heading;
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

      // ── Swimming: position comes from school centroid (see top of update) ──

      // ── Capturing — flee + progress ──
      if (f.status === "capturing") {
        const speedMult =
          f.variant === "octopus" ? 1.0 : f.variant === "large" ? 0.9 : 1.0;
        const fillMult =
          f.variant === "octopus"
            ? 1 / 2.4
            : f.variant === "large"
              ? 1 / 1.5
              : 1.0;
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
        const speed = FISH_WANDER_SPEED * speedMult * (1 + FISH_FLEE_SPEED_MULT * f.progress);
        f.posQ = moveOnSphere(f.posQ, f.heading, (speed * dt) / this.globeRadius);

        // Post-movement position for capture check
        const wp = cartesianFromSpherical(f.posQ, FISH_SHADOW_ALT, this.globeRadius);
        const dist = wp.distanceTo(boatWorldPos);
        if (dist < effCatchR && captureEnabled && this.activeCaptures.includes(i)) {
          f.progress = Math.min(1, f.progress + effFill * fillMult * dt);
          if (f.progress >= 1) {
            this.catchCount += 1;
            this.catchVfx.spawn(this.group.parent, wp.clone(), boatTargetPos, f.variant);
            this.onCatch?.(f.variant);
            this.removeActiveCapture(i);
            if (f.variant === "octopus") {
              this.mysteryOctopusCleanupAfterCatch = true;
            } else {
              f.status = "respawning";
              f.respawnT = 0;
              f.respawnMoved = false;
              f.progress = 0;
              f.visual.setProgress(0);
            }
          }
        } else {
          f.progress = Math.max(0, f.progress - FISH_DECAY_RATE * dt);
          if (f.progress <= 0 && dist > effExitR) {
            f.status = "swimming";
            this.recomputeSchoolOffset(f);
            this.removeActiveCapture(i);
          }
        }
      }

      this.applyFishTransform(f, boatRadial, cameraPos, dayWeight, nightWeight);
    }

    if (this.mysteryOctopusCleanupAfterCatch) {
      this.mysteryOctopusCleanupAfterCatch = false;
      this.removeAllMysteryOctopuses();
    }

    // ── Dotted range ring ────────────────────────────────────────
    if (!boatOnLand) {
      this.updateRing(boatQPos, boatWorldPos, boatHeading);
      this.ringMesh.visible = true;
    } else {
      this.ringMesh.visible = false;
    }

    // ── Fishing line(s) ─────────────────────────────────────────
    const cap0 = this.activeCaptures[0];
    const cap1 = this.activeCaptures[1];
    const fish0 = cap0 !== undefined ? this.fish[cap0] : undefined;
    const fish1 = cap1 !== undefined ? this.fish[cap1] : undefined;
    const show0 = fish0 && fish0.progress > 0.001;
    const show1 = fish1 && fish1.progress > 0.001;

    if (show0) {
      this.fishLineGpuReady = this.updateFishLineGeometry(
        this.linePositions,
        this.lineGeometry,
        this.fishLine,
        this.fishLineMat,
        this.fishLineGpuReady,
        boatWorldPos,
        fish0.worldPos,
        fish0.progress,
      );
      this.fishLine.visible = true;
    } else {
      this.fadeFishLine(this.fishLineMat, this.fishLine, dt);
    }

    if (this.fishMaxConcurrent >= 2) {
      if (show1) {
        this.fishLineGpuReadyB = this.updateFishLineGeometry(
          this.linePositionsB,
          this.lineGeometryB,
          this.fishLineB,
          this.fishLineMatB,
          this.fishLineGpuReadyB,
          boatWorldPos,
          fish1!.worldPos,
          fish1!.progress,
        );
        this.fishLineB.visible = true;
      } else {
        this.fadeFishLine(this.fishLineMatB, this.fishLineB, dt);
      }
    } else {
      this.fishLineMatB.opacity = 0;
      this.fishLineB.visible = false;
    }

    this.catchVfx.update(dt, boatTargetPos);
  }

  private fadeFishLine(mat: LineMaterial, line: Line2, dt: number) {
    const prevOpacity = mat.opacity;
    if (prevOpacity > 0.005) {
      mat.opacity = Math.max(0, prevOpacity - dt * 4);
      line.visible = true;
    } else {
      mat.opacity = 0;
      line.visible = false;
    }
  }

  private shadowAlpha(dayWeight: number, nightWeight: number): number {
    const eveningWeight = Math.max(0, 1 - dayWeight - nightWeight);
    return 0.3 * dayWeight + 0.9 * eveningWeight + 0.9 * nightWeight;
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
      f.prevHeading = f.heading;
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
    f.visual.barGroup.position.copy(radialUp).multiplyScalar(0.04);

    const alpha = this.shadowAlpha(dayWeight, nightWeight);
    f.visual.setProgress(f.status === "capturing" ? f.progress : 0);
    if (f.status !== "respawning") {
      f.visual.setOpacityFade(1);
    }
    f.visual.setShadowOpacity(alpha);
    const eveningWeight = Math.max(0, 1 - dayWeight - nightWeight);
    f.visual.setNightGlow(nightWeight, eveningWeight);

    const turnDelta = wrapAnglePi(f.heading - f.prevHeading);
    const wiggle =
      Math.sin(this.time * 2.8 + f.phase) * 0.35 +
      Math.sin(this.time * 1.2 + f.phase * 1.43) * 0.15 +
      Math.max(-0.45, Math.min(0.45, turnDelta * 8.0));
    f.visual.setShadowWiggle(wiggle);
    f.visual.setTime(this.time + f.phase);
    f.prevHeading = f.heading;
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
   * @returns true once GPU buffers are initialized (always true after first successful call).
   */
  private updateFishLineGeometry(
    linePositions: Float32Array,
    geom: LineGeometry,
    line: Line2,
    mat: LineMaterial,
    gpuReady: boolean,
    boatPos: Vector3,
    fishPos: Vector3,
    progress: number,
  ): boolean {
    const r = this.globeRadius + LINE_ALT;
    _tmpV1.copy(boatPos).normalize();
    _tmpV2.copy(fishPos).normalize();

    for (let j = 0; j <= LINE_SEGS; j++) {
      const t = j / LINE_SEGS;
      _tmpV3.copy(_tmpV1).lerp(_tmpV2, t).normalize().multiplyScalar(r);
      const o = j * 3;
      linePositions[o] = _tmpV3.x;
      linePositions[o + 1] = _tmpV3.y;
      linePositions[o + 2] = _tmpV3.z;
    }

    if (!gpuReady) {
      geom.setPositions(linePositions);
      line.computeLineDistances();
    } else {
      const posStart = geom.attributes.instanceStart as InterleavedBufferAttribute;
      const posBuf = posStart.data.array as Float32Array;
      for (let seg = 0; seg < LINE_SEGS; seg++) {
        const o = seg * 3;
        const b = seg * 6;
        posBuf.set(linePositions.subarray(o, o + 6), b);
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

    mat.opacity = progress * 0.75;
    return true;
  }

  /** Fat-line shader needs viewport size; call from game resize handler. */
  setFishingLineResolution(width: number, height: number) {
    this.fishLineMat.resolution.set(width, height);
    this.fishLineMatB.resolution.set(width, height);
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
    this.lineGeometryB.dispose();
    this.fishLineMat.dispose();
    this.fishLineMatB.dispose();
    this.catchVfx.dispose();
    this.group.parent?.remove(this.group);
  }
}
