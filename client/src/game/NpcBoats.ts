import { Group, Scene, Vector3, Quaternion } from "three";
import { createSmallBoat } from "./BoatMesh";
import { moveOnSphere, buildBoatMatrix, seededRandom, cartesianFromSpherical, tangentFrame } from "./SphericalMath";
import { randomOceanQuaternion } from "./Boat";
import { isLand } from "./SimplexNoise";

const NPC_COUNT = 16;
const NPC_ALTITUDE = 0.0; // slightly above ocean surface
/** World-units/sec — Boat cruise is 0.22, NPC boats are leisurely. */
const NPC_SPEED = 0.14;
/** Max heading change per wander nudge (radians). */
const NPC_WANDER_HEADING_DELTA = 0.8;
/** Max turn rate (radians/sec) during normal wandering. */
const NPC_TURN_RATE = 0.35;
/** Faster turn rate used while escaping land. */
const NPC_ESCAPE_TURN_RATE = 1.8;
/** Seconds to hold the escape heading before allowing new wander nudges. */
const NPC_LAND_ESCAPE_COOLDOWN = 3.5;
const NPC_WANDER_INTERVAL_MIN = 4;
const NPC_WANDER_INTERVAL_MAX = 12;
const WAVE_PROXIMITY = 0.45;
const WAVE_COOLDOWN = 20;
const BOB_SPEED = 2.6;
const BOB_AMP = 0.008;

const WAVE_MESSAGES = [
  "A small boat waves at you!",
  "A fisherman gives you a friendly nod.",
  "Someone on a dinghy waves hello.",
  "A passing sailor tips their hat.",
];

const NPC_COLORS = [0x5588cc, 0xcc5544, 0x44aa66, 0xbb8833];

class NpcBoat {
  readonly group: Group;
  qPosition: Quaternion;
  heading: number;
  private targetHeading: number;
  private wanderTimer = 0;
  private wanderInterval: number;
  private readonly globeRadius: number;
  /** World terrain seed — used for isLand and ocean-spawn checks. */
  private readonly worldSeed: number;
  private readonly terrainType: string;
  private waveCooldown = 0;
  private bobTime: number;
  private currentRoll = 0;
  /** Counts down after a land collision — suppresses wander nudges and uses faster turn rate. */
  private landEscapeCooldown = 0;

  private readonly _posScratch = new Vector3();

  /**
   * @param worldSeed  The actual world/terrain seed (same one used for Globe, Boat, etc.)
   * @param npcSeed    Per-NPC random seed for heading / bobTime / colour variation.
   */
  constructor(globeRadius: number, worldSeed: number, npcSeed: number, terrainType: string) {
    this.globeRadius = globeRadius;
    this.worldSeed = worldSeed;
    this.terrainType = terrainType;

    const rnd = seededRandom(npcSeed);
    // Use the WORLD seed for ocean-spawn so we find real ocean tiles.
    this.qPosition = randomOceanQuaternion(worldSeed, terrainType, npcSeed);
    this.heading = rnd() * Math.PI * 2;
    this.targetHeading = this.heading;
    this.bobTime = rnd() * Math.PI * 2;
    this.wanderInterval = NPC_WANDER_INTERVAL_MIN + rnd() * (NPC_WANDER_INTERVAL_MAX - NPC_WANDER_INTERVAL_MIN);

    const colorIdx = Math.floor(rnd() * NPC_COLORS.length);
    this.group = createSmallBoat(NPC_COLORS[colorIdx]);
    this.group.matrixAutoUpdate = false;
  }

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

  update(dt: number) {
    // Tick escape cooldown
    if (this.landEscapeCooldown > 0) {
      this.landEscapeCooldown = Math.max(0, this.landEscapeCooldown - dt);
    }

    // Wander: only nudge heading when not escaping land
    if (this.landEscapeCooldown <= 0) {
      this.wanderTimer += dt;
      if (this.wanderTimer >= this.wanderInterval) {
        this.wanderTimer = 0;
        this.targetHeading += (Math.random() - 0.5) * 2 * NPC_WANDER_HEADING_DELTA;
        this.wanderInterval = NPC_WANDER_INTERVAL_MIN + Math.random() * (NPC_WANDER_INTERVAL_MAX - NPC_WANDER_INTERVAL_MIN);
      }
    }

    // Smooth heading toward target — faster when escaping land
    const turnRate = this.landEscapeCooldown > 0 ? NPC_ESCAPE_TURN_RATE : NPC_TURN_RATE;
    let diff = this.targetHeading - this.heading;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    const maxStep = turnRate * dt;
    const step = Math.max(-maxStep, Math.min(maxStep, diff));
    this.heading += step;
    const actualTurnRate = step / Math.max(dt, 1e-6);

    // Move along sphere — check land ahead; snap to escape heading if blocked
    const arc = (NPC_SPEED * dt) / this.globeRadius;
    const nextQ = moveOnSphere(this.qPosition, this.heading, arc);
    const nextUp = tangentFrame(nextQ).up;
    if (isLand(this.worldSeed, this.terrainType, nextUp.x, nextUp.y, nextUp.z)) {
      if (this.landEscapeCooldown <= 0) {
        // Snap both heading and target to the away direction immediately,
        // then hold for the escape cooldown so we don't oscillate.
        const escapeHeading = this.heading + Math.PI + (Math.random() - 0.5) * 1.0;
        this.heading = escapeHeading;
        this.targetHeading = escapeHeading;
        this.landEscapeCooldown = NPC_LAND_ESCAPE_COOLDOWN;
        this.wanderTimer = 0;
      }
      // Don't move this frame — let the new heading take effect next frame
    } else {
      this.qPosition = nextQ;
    }

    // Bob on waves
    this.bobTime += dt;
    const bob = Math.sin(this.bobTime * BOB_SPEED) * BOB_AMP;
    const pitch = Math.sin(this.bobTime * BOB_SPEED * 0.8 + 1.1) * 0.04;

    // Smooth roll from turning
    const targetRoll = Math.max(-0.18, Math.min(0.18, actualTurnRate * 0.3));
    this.currentRoll += (targetRoll - this.currentRoll) * (1 - Math.exp(-4.0 * dt));

    this.group.matrix.copy(
      buildBoatMatrix(this.qPosition, this.heading, NPC_ALTITUDE + bob, this.globeRadius, pitch, this.currentRoll),
    );
    this.group.matrixWorldNeedsUpdate = true;
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

export class NpcBoats {
  private readonly boats: NpcBoat[] = [];
  private readonly scene: Scene;

  constructor(scene: Scene, globeRadius: number, seed: number, terrainType: string) {
    this.scene = scene;
    for (let i = 0; i < NPC_COUNT; i++) {
      const npcSeed = seed + i * 73891 + 554433;
      const npc = new NpcBoat(globeRadius, seed, npcSeed, terrainType);
      this.scene.add(npc.group);
      this.boats.push(npc);
    }
  }

  update(dt: number, playerWorldPos: Vector3, onWave: (message: string) => void) {
    for (const boat of this.boats) {
      boat.update(dt);
      const msg = boat.checkWave(playerWorldPos, dt);
      if (msg) onWave(msg);
    }
  }

  setVisible(visible: boolean) {
    for (const boat of this.boats) boat.group.visible = visible;
  }

  dispose() {
    for (const boat of this.boats) {
      this.scene.remove(boat.group);
      boat.dispose();
    }
    this.boats.length = 0;
  }
}
