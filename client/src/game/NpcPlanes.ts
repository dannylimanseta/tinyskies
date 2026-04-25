import { Group, Scene, Vector3 } from "three";
import { createMonoplane } from "./BiplaneMesh";
import { moveOnSphere, tangentFrame, buildPlaneMatrix, seededRandom, cartesianFromSpherical } from "./SphericalMath";
import { Quaternion } from "three";
import type { PaintballSystem } from "./PaintballSystem";

const NPC_COUNT = 3;
const NPC_ALTITUDE = 0.52;
/** World-units/sec — same unit as Plane.speed. Plane cruise is 0.8, this is a leisurely pace. */
const NPC_SPEED = 0.55;
/** Max heading delta added per wander nudge (radians). */
const NPC_WANDER_HEADING_DELTA = 0.9;
/** Max turn rate while smoothly tracking targetHeading (radians/sec). */
const NPC_TURN_RATE = 0.6;
const NPC_WANDER_INTERVAL_MIN = 3; // seconds between heading nudges
const NPC_WANDER_INTERVAL_MAX = 8;
const WAVE_PROXIMITY = 0.55;       // world-space distance to trigger wave
const WAVE_COOLDOWN = 20;          // seconds between waves per NPC
const WAVE_MESSAGES = [
  "A friendly pilot waves!",
  "Another pilot tips their wings.",
  "A passing flyer gives you a nod.",
];

const NPC_COLORS = [0x4488ff, 0xff8844, 0x44cc88];

class NpcPlane {
  readonly group: Group;
  qPosition: Quaternion;
  heading: number;
  private speed = NPC_SPEED;
  private wanderTimer = 0;
  private wanderInterval: number;
  private readonly globeRadius: number;
  private waveCooldown = 0;
  private wobbleAmp = 0;
  private wobblePhase = 0;
  private wobbleBank = 0;
  private targetHeading: number;
  private headingTurnRate = 0; // radians/sec actually being turned this frame (for bank)
  private currentBank = 0;     // smoothed bank angle

  // Pre-allocated scratch
  private readonly _posScratch = new Vector3();

  constructor(globeRadius: number, seed: number) {
    this.globeRadius = globeRadius;

    const rnd = seededRandom(seed);
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.sin(phi) * Math.sin(theta);
    const nz = Math.cos(phi);
    const refUp = new Vector3(0, 1, 0);
    this.qPosition = new Quaternion().setFromUnitVectors(refUp, new Vector3(nx, ny, nz).normalize());
    this.heading = rnd() * Math.PI * 2;
    this.targetHeading = this.heading;
    this.wanderInterval = NPC_WANDER_INTERVAL_MIN + rnd() * (NPC_WANDER_INTERVAL_MAX - NPC_WANDER_INTERVAL_MIN);

    const colorIdx = Math.floor(rnd() * NPC_COLORS.length);
    this.group = createMonoplane(NPC_COLORS[colorIdx]);
    this.group.matrixAutoUpdate = false;
  }

  worldPosition(out: Vector3): Vector3 {
    return out.copy(cartesianFromSpherical(this.qPosition, NPC_ALTITUDE, this.globeRadius));
  }

  /** Returns wave message if the player is close enough and cooldown allows, else null. */
  checkWave(playerWorldPos: Vector3, dt: number): string | null {
    this.waveCooldown = Math.max(0, this.waveCooldown - dt);
    this._posScratch.copy(cartesianFromSpherical(this.qPosition, NPC_ALTITUDE, this.globeRadius));
    if (this.waveCooldown > 0) return null;
    if (playerWorldPos.distanceTo(this._posScratch) < WAVE_PROXIMITY) {
      this.waveCooldown = WAVE_COOLDOWN;
      return WAVE_MESSAGES[Math.floor(Math.random() * WAVE_MESSAGES.length)]!;
    }
    return null;
  }

  /** Tilt-wobble on paintball hit — same feel as RemotePlane. */
  triggerHitWobble() {
    this.wobbleAmp = 0.42;
    this.wobblePhase = 0;
  }

  update(dt: number) {
    // Wander: pick a new target heading on a timer
    this.wanderTimer += dt;
    if (this.wanderTimer >= this.wanderInterval) {
      this.wanderTimer = 0;
      this.targetHeading += (Math.random() - 0.5) * 2 * NPC_WANDER_HEADING_DELTA;
      this.wanderInterval = NPC_WANDER_INTERVAL_MIN + Math.random() * (NPC_WANDER_INTERVAL_MAX - NPC_WANDER_INTERVAL_MIN);
    }

    // Smoothly steer heading toward targetHeading at NPC_TURN_RATE rad/s
    let diff = this.targetHeading - this.heading;
    // Wrap diff to [-π, π] so we always take the short way around
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    const maxStep = NPC_TURN_RATE * dt;
    const step = Math.max(-maxStep, Math.min(maxStep, diff));
    this.heading += step;
    this.headingTurnRate = step / Math.max(dt, 1e-6); // actual rad/s this frame

    // Wobble decay from paintball hit
    if (this.wobbleAmp > 0.002) {
      this.wobblePhase += dt * 19;
      this.wobbleBank = Math.sin(this.wobblePhase) * this.wobbleAmp;
      this.wobbleAmp *= Math.exp(-4.2 * dt);
    } else {
      this.wobbleAmp = 0;
      this.wobbleBank = 0;
    }

    // Move along sphere
    const arc = (this.speed * dt) / this.globeRadius;
    this.qPosition = moveOnSphere(this.qPosition, this.heading, arc);

    // Tween bank toward target — exponential ease so roll-in and roll-out are gradual
    const targetBank = Math.max(-0.45, Math.min(0.45, this.headingTurnRate * 0.55));
    this.currentBank += (targetBank - this.currentBank) * (1 - Math.exp(-4.5 * dt));
    const bank = this.currentBank + this.wobbleBank;
    this.group.matrix.copy(
      buildPlaneMatrix(this.qPosition, this.heading, 0, bank, NPC_ALTITUDE, this.globeRadius),
    );
    this.group.matrixWorldNeedsUpdate = true;

    // Spin propeller
    const prop = this.group.userData.propeller as Group | undefined;
    if (prop) prop.rotation.z -= (this.speed * 15 + 10) * dt;
  }

  dispose() {
    this.group.traverse((obj) => {
      const m = obj as any;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mat: any) => mat.dispose());
        else m.material.dispose();
      }
    });
  }
}

export class NpcPlanes {
  private readonly planes: NpcPlane[] = [];
  private readonly scene: Scene;
  private readonly playerPosScratch = new Vector3();

  constructor(scene: Scene, globeRadius: number, seed: number) {
    this.scene = scene;
    for (let i = 0; i < NPC_COUNT; i++) {
      const npc = new NpcPlane(globeRadius, seed + i * 97531 + 112233);
      this.scene.add(npc.group);
      this.planes.push(npc);
    }
  }

  /**
   * Call every flying frame.
   * - playerWorldPos: current world position of the local player
   * - onWave: callback fired when an NPC wants to wave
   * - paintballSystem: optional — registers a hit listener so NPC groups receive decals + wobble
   */
  update(
    dt: number,
    playerWorldPos: Vector3,
    onWave: (message: string) => void,
  ) {
    for (const npc of this.planes) {
      npc.update(dt);
      const msg = npc.checkWave(playerWorldPos, dt);
      if (msg) onWave(msg);
    }
  }

  /**
   * Register a projectile step listener so NPCs receive paintball decals + tilt-wobble.
   * Returns an unsubscribe handle — call it in dispose().
   */
  registerPaintballListener(paintballSystem: PaintballSystem): () => void {
    const npcGroups = this.planes.map((n) => ({ group: n.group, npc: n }));
    const _segDir = new Vector3();
    const _toCenter = new Vector3();
    const HIT_R_SQ = 0.22 * 0.22;

    return paintballSystem.addProjectileStepListener((step) => {
      const segDir = _segDir.subVectors(step.currentPosition, step.previousPosition);
      const segLen = segDir.length();
      if (segLen < 1e-6) return;
      segDir.divideScalar(segLen);

      for (const { group, npc } of npcGroups) {
        group.updateMatrixWorld(true);
        const center = new Vector3().setFromMatrixPosition(group.matrixWorld);
        const toCenter = _toCenter.subVectors(center, step.previousPosition);
        const t = Math.max(0, Math.min(segLen, toCenter.dot(segDir)));
        const closest = new Vector3().copy(step.previousPosition).addScaledVector(segDir, t);
        if (closest.distanceToSquared(center) < HIT_R_SQ) {
          const splatSeed = (Math.random() * 0xffffffff) >>> 0;
          paintballSystem.playImpactAtGroup(group, step.color, true, splatSeed, step.splatterScale ?? 1);
          npc.triggerHitWobble();
          step.consume();
          break;
        }
      }
    });
  }

  setVisible(visible: boolean) {
    for (const npc of this.planes) npc.group.visible = visible;
  }

  dispose() {
    for (const npc of this.planes) {
      this.scene.remove(npc.group);
      npc.dispose();
    }
    this.planes.length = 0;
  }
}
