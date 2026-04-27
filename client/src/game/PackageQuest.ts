import {
  Group,
  Mesh,
  BoxGeometry,
  ConeGeometry,
  PlaneGeometry,
  CylinderGeometry,
  MeshPhongMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Vector3,
  Quaternion,
  type Camera,
  type Scene,
} from "three";
import { type Landmark, type LandmarkRegistry } from "./Landmarks";
import { addRimLight } from "./RimLight";
import { surfaceDisplacementAt } from "./TerrainSurface";
import { generateQuestDialogue } from "./PackageDialogue";

/* ── Constants ──────────────────────────────────────────────────────── */

const SPAWN_DELAY_MIN = 2;
const SPAWN_DELAY_MAX = 4;
const FILL_RATE = 1 / 1.5;
const DECAY_RATE = 0.3;
const DELIVERY_XP = 50;
const PACKAGE_LIFT = 0.25;
const PACKAGE_BOB_AMP = 0.012;
/** Y rotation rad/s for the package in pickup / destination beams. */
const SPIN_SPEED = 2.35;
/** Scale multiplier for the box mesh in the gold / blue quest beams (larger, more visible). */
const BEAM_PACKAGE_SCALE = 1.75;
/** Local Y of the “drop here” arrow anchor above the ghost package; bob adds on top. */
const DEST_ARROW_BASE_Y = 0.07;
const DEST_ARROW_BOB_AMP = 0.02;
/** Bob frequency (Hz) for the drop arrow — keep low for a slow, gentle float. */
const DEST_ARROW_BOB_HZ = 0.85;
const MIN_PAIR_DOT = 0.85;
const MAX_PAIR_RETRIES = 20;
/** When offering multiple delivery quests, pickup villages must be at least this “far” apart (lower dot = farther on the globe). */
const MIN_ORIGIN_SEPARATION_DOTS = [0.4, 0.52, 0.62, 0.72, 0.85] as const;
const OFFER_COUNT = 3;
/** Package delivery runs per world / session (matches {@link OFFER_COUNT}). */
export const PACKAGE_DELIVERIES_PER_WORLD = OFFER_COUNT;

const STRING_LENGTH = 0.12;
const SWING_GRAVITY = 8.0;
const SWING_DAMPING = 2.5;
const SWING_INERTIA = 3.0;

const SPAWN_ANIM_DUR = 0.6;
const SPAWN_BOUNCE_LIFT = 0.15;
/** Globe arc length (world units) × this ≈ HUD metres (tuned for readable range on radius ~5). */
const WORLD_ARC_TO_METRES = 36;

const REF_UP = new Vector3(0, 1, 0);
const REF_Z = new Vector3(0, 0, 1);
const REF_X = new Vector3(1, 0, 0);
const _tmpV = new Vector3();
const _tmpV2 = new Vector3();
const _deliveryDir = new Vector3();

const enum QuestState {
  Spawning,
  Available,
  PickingUp,
  Carrying,
  Delivering,
}

interface OfferSlot {
  origin: Landmark | null;
  destination: Landmark | null;
  originBeam: Group;
  packageMesh: Group;
  originAnimT: number;
}

/* ── Beam shader ────────────────────────────────────────────────────── */

const beamVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const beamFrag = `
uniform float time;
uniform vec3 color;
varying vec2 vUv;
void main() {
  float grad = 1.0 - vUv.y;
  float pulse = sin(time * 2.0) * 0.15 + 0.85;
  float alpha = grad * grad * pulse * 0.6;
  gl_FragColor = vec4(color, alpha);
}
`;

/* ── Seeded RNG ─────────────────────────────────────────────────────── */

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  const c3 = c + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/* ── Package model builder ──────────────────────────────────────────── */

function createPackageMesh(ghost = false): Group {
  const pkg = new Group();

  const boxGeo = new BoxGeometry(0.05, 0.04, 0.05);
  const boxMat = new MeshPhongMaterial({
    color: 0x8b6914,
    transparent: ghost,
    opacity: ghost ? 0.3 : 1,
  });
  // Fresnel edge read against sky / ground (intensity a bit lower on ghost for softer glow).
  addRimLight(boxMat, 0xffcc66, ghost ? 0.48 : 0.62, 2.4);
  const box = new Mesh(boxGeo, boxMat);
  pkg.add(box);

  if (!ghost) {
    const strapGeo = new BoxGeometry(0.056, 0.004, 0.008);
    const strapMat = new MeshPhongMaterial({ color: 0xf5deb3 });
    addRimLight(strapMat, 0xffffff, 0.45, 2.2);
    const strap1 = new Mesh(strapGeo, strapMat);
    strap1.position.y = 0.022;
    pkg.add(strap1);

    const strap2 = new Mesh(strapGeo, strapMat);
    strap2.position.y = 0.022;
    strap2.rotation.y = Math.PI / 2;
    pkg.add(strap2);
  }

  return pkg;
}

/** Down-pointing chevron (local −Y) for the destination beam, parented so +Y is “up” from the ground. */
function createDestinationDownArrow(): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({
    color: 0xf2fbff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const coneH = 0.048;
  const coneR = 0.024;
  const cone = new Mesh(new ConeGeometry(coneR, coneH, 12, 1, false), mat);
  // Default tip +Y; flip so the tip points toward local −Y (drop direction).
  cone.rotation.x = Math.PI;
  g.add(cone);
  return g;
}

/**
 * Same crossed vertical planes + shader as package pickup / delivery beams.
 * @param color — packed RGB (e.g. `0x88ccff` destination, `0xffd700` pickup).
 */
export function createPackageQuestBeamGroup(
  color: number,
  opts?: {
    /** When set, drives the pulse shader (e.g. globe-owned clock). */
    timeUniform?: { value: number };
    /** Plane height (default `0.8`). */
    height?: number;
    /** Plane width (default `0.06`). */
    width?: number;
  },
): Group {
  const grp = new Group();
  const timeU = opts?.timeUniform ?? { value: 0 };
  const h = opts?.height ?? 0.8;
  const w = opts?.width ?? 0.06;
  const beamMat = new ShaderMaterial({
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    uniforms: {
      time: timeU,
      color: { value: new Vector3(
        ((color >> 16) & 0xff) / 255,
        ((color >> 8) & 0xff) / 255,
        (color & 0xff) / 255,
      )},
    },
    transparent: true,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });

  const planeGeo = new PlaneGeometry(w, h);
  planeGeo.translate(0, h / 2, 0);

  const p1 = new Mesh(planeGeo, beamMat);
  grp.add(p1);
  const p2 = new Mesh(planeGeo.clone(), beamMat);
  p2.rotation.y = Math.PI / 2;
  grp.add(p2);

  return grp;
}

function createBeamGroup(color: number): Group {
  return createPackageQuestBeamGroup(color);
}

/* ── PackageQuestManager ────────────────────────────────────────────── */

export class PackageQuestManager {
  readonly group = new Group();
  moonProgress = 0;

  get isCarrying(): boolean {
    return this.state === QuestState.Carrying || this.state === QuestState.Delivering;
  }

  /** Completed village deliveries this session (0 … {@link PACKAGE_DELIVERIES_PER_WORLD}). */
  getCompletedDeliveryCount(): number {
    return this.questIndex;
  }

  private state = QuestState.Spawning;
  private spawnTimer = 0;
  private spawnDelay = 0;
  private progress = 0;
  private time = 0;
  private questIndex = 0;
  private rand: () => number;

  private origin: Landmark | null = null;
  private destination: Landmark | null = null;
  private lastDestination: Landmark | null = null;
  private villages: Landmark[] = [];

  private offerSlots: OfferSlot[] = [];
  private destBeam: Group;
  /** Root aligned to the destination village; child {@link ghostPackageContent} spins, {@link destDownArrow} bobs. */
  private ghostPackage: Group;
  private ghostPackageContent: Group;
  private destDownArrow: Group;
  private carryGroup: Group;
  private stringMesh: Mesh;

  private readonly _playerNormal = new Vector3();
  private _allowInteraction = true;
  private spinAngle = 0;

  private prevPlayerPos = new Vector3();
  private playerVel = new Vector3();
  private swingOffsetX = 0;
  private swingOffsetZ = 0;
  private swingVelX = 0;
  private swingVelZ = 0;

  private destAnimT = -1;

  onPickup: ((originName: string, destName: string, npcName: string, dialogue: string) => void) | null = null;

  /**
   * Great-circle distance along the globe from the player's surface position to the
   * delivery village (metres, rounded). Player direction uses radial from world origin.
   */
  getDeliverySurfaceDistanceMetres(playerWorldPos: Vector3): number | null {
    if (!this.destination) return null;
    if (this.state !== QuestState.Carrying && this.state !== QuestState.Delivering) return null;
    _deliveryDir.copy(playerWorldPos).normalize();
    const cos = Math.max(-1, Math.min(1, _deliveryDir.dot(this.destination.normal)));
    const arcWorld = this.globeRadius * Math.acos(cos);
    return Math.max(0, Math.round(arcWorld * WORLD_ARC_TO_METRES));
  }
  onDelivered:
    | ((
        destName: string,
        npcName: string,
        dialogue: string,
        xp: number,
        /** 0 = first quest completed, 1 = second, 2 = third, … */
        completedQuestIndex: number,
      ) => void)
    | null = null;
  onProgressChange: ((progress: number, phase: "pickup" | "deliver") => void) | null = null;

  constructor(
    scene: Scene,
    private globeRadius: number,
    private registry: LandmarkRegistry,
    private seed: number,
    private terrainType: string,
  ) {
    this.rand = seededRandom(seed * 4219);
    this.villages = registry.getByType("village");

    for (let i = 0; i < OFFER_COUNT; i++) {
      const slot: OfferSlot = {
        origin: null,
        destination: null,
        originBeam: createBeamGroup(0xffd700),
        packageMesh: createPackageMesh(false),
        originAnimT: -1,
      };
      this.offerSlots.push(slot);
      this.group.add(slot.originBeam);
      this.group.add(slot.packageMesh);
    }

    this.destBeam = createBeamGroup(0x88ccff);
    this.ghostPackage = new Group();
    this.ghostPackageContent = createPackageMesh(true);
    this.destDownArrow = createDestinationDownArrow();
    this.ghostPackage.add(this.ghostPackageContent);
    this.ghostPackage.add(this.destDownArrow);
    this.destDownArrow.position.y = DEST_ARROW_BASE_Y;

    this.carryGroup = new Group();
    const stringGeo = new CylinderGeometry(0.001, 0.001, STRING_LENGTH, 4);
    stringGeo.translate(0, -STRING_LENGTH / 2, 0);
    const stringMat = new MeshBasicMaterial({ color: 0xf5deb3 });
    this.stringMesh = new Mesh(stringGeo, stringMat);
    this.carryGroup.add(this.stringMesh);
    const carryPkg = createPackageMesh(false);
    carryPkg.position.y = -STRING_LENGTH;
    this.carryGroup.add(carryPkg);

    this.group.add(this.destBeam);
    this.group.add(this.ghostPackage);
    this.group.add(this.carryGroup);

    this.hideAll();
    scene.add(this.group);

    this.spawnDelay = SPAWN_DELAY_MIN + this.rand() * (SPAWN_DELAY_MAX - SPAWN_DELAY_MIN);
  }

  update(dt: number, playerQPosition: Quaternion, _camera: Camera, playerWorldPos?: Vector3, allowInteraction = true) {
    this.time += dt;

    this._playerNormal.copy(REF_UP).applyQuaternion(playerQPosition).normalize();
    this._allowInteraction = allowInteraction;

    this.updateBeamUniforms();

    switch (this.state) {
      case QuestState.Spawning:
        this.tickSpawning(dt);
        break;
      case QuestState.Available:
        this.tickAvailable();
        this.animatePackage(dt);
        break;
      case QuestState.PickingUp:
        this.tickPickingUp(dt);
        this.animatePackage(dt);
        break;
      case QuestState.Carrying:
        this.tickCarrying();
        this.animateGhost(dt);
        if (playerWorldPos) this.animateCarryPackage(dt, playerWorldPos);
        break;
      case QuestState.Delivering:
        this.tickDelivering(dt);
        this.animateGhost(dt);
        if (playerWorldPos) this.animateCarryPackage(dt, playerWorldPos);
        break;
    }
  }

  /* ── State tickers ───────────────────────────────────────────────── */

  private tickSpawning(dt: number) {
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnDelay) {
      this.origin = null;
      this.destination = null;
      if (!this.pickQuestOffers()) return;
      this.showAllOfferOrigins();
      this.state = QuestState.Available;
    }
  }

  private tickAvailable() {
    for (let i = 0; i < this.offerSlots.length; i++) {
      const slot = this.offerSlots[i]!;
      if (!slot.origin) continue;
      if (this.inVillageZone(slot.origin)) {
        this.origin = slot.origin;
        this.destination = slot.destination;
        for (let j = 0; j < this.offerSlots.length; j++) {
          if (i === j) continue;
          this.hideOfferSlot(j);
        }
        this.progress = 0;
        this.state = QuestState.PickingUp;
        return;
      }
    }
  }

  private tickPickingUp(dt: number) {
    if (this.inOriginZone()) {
      this.progress = Math.min(1, this.progress + FILL_RATE * dt);
    } else {
      this.progress = Math.max(0, this.progress - DECAY_RATE * dt);
    }

    this.onProgressChange?.(this.progress, "pickup");

    if (this.progress >= 1) {
      this.hideActiveOfferOrigin();
      this.showDestination();
      this.state = QuestState.Carrying;
      this.progress = 0;
      this.onProgressChange?.(0, "pickup");

      const dialogue = generateQuestDialogue(this.seed, this.questIndex, this.destination!.name, this.moonProgress);
      this.onPickup?.(this.origin!.name, this.destination!.name, dialogue.senderName, dialogue.pickupLine);
    } else if (this.progress <= 0) {
      this.state = QuestState.Available;
      this.onProgressChange?.(0, "pickup");
      this.showAllOfferOrigins();
    }
  }

  private tickCarrying() {
    if (this.inDestZone()) {
      this.progress = 0;
      this.state = QuestState.Delivering;
    }
  }

  private tickDelivering(dt: number) {
    if (this.inDestZone()) {
      this.progress = Math.min(1, this.progress + FILL_RATE * dt);
    } else {
      this.progress = Math.max(0, this.progress - DECAY_RATE * dt);
    }

    this.onProgressChange?.(this.progress, "deliver");

    if (this.progress >= 1) {
      this.hideAll();
      this.state = QuestState.Spawning;
      this.progress = 0;
      this.onProgressChange?.(0, "deliver");

      const dialogue = generateQuestDialogue(this.seed, this.questIndex, this.destination!.name, this.moonProgress);
      const completedQuestIndex = this.questIndex;
      this.onDelivered?.(
        this.destination!.name,
        dialogue.receiverName,
        dialogue.deliveryLine,
        DELIVERY_XP,
        completedQuestIndex,
      );

      this.lastDestination = this.destination;
      this.questIndex++;
      this.spawnTimer = 0;
      this.spawnDelay = SPAWN_DELAY_MIN + this.rand() * (SPAWN_DELAY_MAX - SPAWN_DELAY_MIN);
    } else if (this.progress <= 0) {
      this.state = QuestState.Carrying;
      this.onProgressChange?.(0, "deliver");
    }
  }

  /* ── Proximity helpers ───────────────────────────────────────────── */

  private inOriginZone(): boolean {
    if (!this.origin || !this._allowInteraction) return false;
    return this._playerNormal.dot(this.origin.normal) > this.origin.enterDot;
  }

  private inVillageZone(v: Landmark): boolean {
    if (!this._allowInteraction) return false;
    return this._playerNormal.dot(v.normal) > v.enterDot;
  }

  private inDestZone(): boolean {
    if (!this.destination || !this._allowInteraction) return false;
    return this._playerNormal.dot(this.destination.normal) > this.destination.enterDot;
  }

  /* ── Village pair selection ──────────────────────────────────────── */

  private clearOfferSlots() {
    for (const s of this.offerSlots) {
      s.origin = null;
      s.destination = null;
    }
  }

  private shuffleInPlace(a: Landmark[]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      const t = a[i]!;
      a[i] = a[j]!;
      a[j] = t;
    }
  }

  /**
   * Fills up to 3 (origin, destination) offers with pickup villages spread apart.
   * Falls back to a single best-effort pair if needed.
   */
  private pickQuestOffers(): boolean {
    if (this.villages.length < 2) return false;
    const eligible = this.villages.filter((v) => v !== this.lastDestination);
    if (eligible.length < 2) return false;

    this.clearOfferSlots();
    const nWanted = Math.min(OFFER_COUNT, Math.max(1, Math.floor(eligible.length / 2)));

    if (nWanted > 1) {
      for (const maxOriginDot of MIN_ORIGIN_SEPARATION_DOTS) {
        for (let t = 0; t < 100; t++) {
          if (this.tryBuildSeparatedOffers(eligible, nWanted, maxOriginDot)) return true;
        }
      }
    }

    return this.pickOneOfferFallback(eligible);
  }

  private tryBuildSeparatedOffers(
    eligible: Landmark[],
    nWanted: number,
    maxPairwiseOriginDot: number,
  ): boolean {
    if (nWanted < 2) return false;
    const pool = eligible.slice();
    for (let attempt = 0; attempt < 100; attempt++) {
      this.shuffleInPlace(pool);
      const origins: Landmark[] = [];
      for (const o of pool) {
        if (origins.length >= nWanted) break;
        if (origins.some((p) => p.normal.dot(o.normal) > maxPairwiseOriginDot)) continue;
        origins.push(o);
      }
      if (origins.length < nWanted) continue;

      const pairs: { o: Landmark; d: Landmark }[] = [];
      const usedD = new Set<Landmark>();
      let failed = false;
      for (const o of origins) {
        const prefer = eligible.filter(
          (v) => v !== o && o.normal.dot(v.normal) < MIN_PAIR_DOT && !usedD.has(v),
        );
        const anyOk = eligible.filter((v) => v !== o && o.normal.dot(v.normal) < MIN_PAIR_DOT);
        const pickFrom = prefer.length > 0 ? prefer : anyOk;
        if (pickFrom.length === 0) {
          failed = true;
          break;
        }
        const d = pickFrom[Math.floor(this.rand() * pickFrom.length)]!;
        usedD.add(d);
        pairs.push({ o, d });
      }
      if (failed) continue;
      this.clearOfferSlots();
      for (let i = 0; i < pairs.length; i++) {
        const slot = this.offerSlots[i]!;
        slot.origin = pairs[i]!.o;
        slot.destination = pairs[i]!.d;
      }
      return true;
    }
    return false;
  }

  private pickOneOfferFallback(eligible: Landmark[]): boolean {
    this.clearOfferSlots();
    let bestOrigin: Landmark | null = null;
    let bestDest: Landmark | null = null;
    for (let attempt = 0; attempt < MAX_PAIR_RETRIES; attempt++) {
      const oi = Math.floor(this.rand() * eligible.length);
      const o = eligible[oi]!;
      const others = eligible.filter((v) => v !== o);
      const di = Math.floor(this.rand() * others.length);
      const d = others[di]!;

      if (o.normal.dot(d.normal) < MIN_PAIR_DOT) {
        this.offerSlots[0]!.origin = o;
        this.offerSlots[0]!.destination = d;
        return true;
      }
      if (!bestOrigin) {
        bestOrigin = o;
        bestDest = d;
      }
    }
    if (bestOrigin && bestDest) {
      this.offerSlots[0]!.origin = bestOrigin;
      this.offerSlots[0]!.destination = bestDest;
      return true;
    }
    return false;
  }

  /* ── 3D positioning & animation ──────────────────────────────────── */

  private positionAtVillage(obj: Group, landmark: Landmark, lift: number) {
    const n = landmark.normal;
    const disp = surfaceDisplacementAt(this.seed, this.terrainType, n.x, n.y, n.z);
    const r = this.globeRadius + disp + lift;
    obj.position.set(n.x * r, n.y * r, n.z * r);
    obj.quaternion.setFromUnitVectors(REF_UP, n);
  }

  private animatePackage(dt: number) {
    this.spinAngle += SPIN_SPEED * dt;
    for (let si = 0; si < this.offerSlots.length; si++) {
      const slot = this.offerSlots[si]!;
      if (!slot.origin || !slot.originBeam.visible) continue;
      const n = slot.origin.normal;
      const disp = surfaceDisplacementAt(this.seed, this.terrainType, n.x, n.y, n.z);

      let spawnScale = 1;
      let spawnLift = 0;
      if (slot.originAnimT >= 0) {
        slot.originAnimT = Math.min(slot.originAnimT + dt, SPAWN_ANIM_DUR);
        const t = slot.originAnimT / SPAWN_ANIM_DUR;
        spawnScale = easeOutBack(t);
        spawnLift = SPAWN_BOUNCE_LIFT * (1 - t);
        if (slot.originAnimT >= SPAWN_ANIM_DUR) slot.originAnimT = -1;
      }

      const phase = this.time * 1.5 + si * 0.9;
      const bob = PACKAGE_LIFT + spawnLift + Math.sin(phase) * PACKAGE_BOB_AMP;
      const r = this.globeRadius + disp + bob;
      slot.packageMesh.position.set(n.x * r, n.y * r, n.z * r);

      slot.packageMesh.quaternion.setFromUnitVectors(REF_UP, n);
      slot.packageMesh.rotateY(this.spinAngle + si * 0.7);
      slot.packageMesh.scale.setScalar(spawnScale * BEAM_PACKAGE_SCALE);

      const beamBob = Math.sin(this.time * 0.8 + si * 0.2) * 0.015 + spawnLift;
      const br = this.globeRadius + disp + beamBob;
      slot.originBeam.position.set(n.x * br, n.y * br, n.z * br);
      slot.originBeam.scale.setScalar(spawnScale);
    }
  }

  private animateGhost(dt: number) {
    if (!this.destination) return;
    this.spinAngle += SPIN_SPEED * dt;
    const n = this.destination.normal;
    const disp = surfaceDisplacementAt(this.seed, this.terrainType, n.x, n.y, n.z);

    let spawnScale = 1;
    let spawnLift = 0;
    if (this.destAnimT >= 0) {
      this.destAnimT = Math.min(this.destAnimT + dt, SPAWN_ANIM_DUR);
      const t = this.destAnimT / SPAWN_ANIM_DUR;
      spawnScale = easeOutBack(t);
      spawnLift = SPAWN_BOUNCE_LIFT * (1 - t);
      if (this.destAnimT >= SPAWN_ANIM_DUR) this.destAnimT = -1;
    }

    const bob = PACKAGE_LIFT + spawnLift + Math.sin(this.time * 1.5 + 1.0) * PACKAGE_BOB_AMP;
    const r = this.globeRadius + disp + bob;
    this.ghostPackage.position.set(n.x * r, n.y * r, n.z * r);
    this.ghostPackage.quaternion.setFromUnitVectors(REF_UP, n);
    this.ghostPackageContent.rotation.set(0, this.spinAngle, 0);
    this.ghostPackage.scale.setScalar(spawnScale * BEAM_PACKAGE_SCALE);
    this.destDownArrow.position.y =
      DEST_ARROW_BASE_Y +
      Math.sin(this.time * (Math.PI * 2) * DEST_ARROW_BOB_HZ) * DEST_ARROW_BOB_AMP;

    const beamBob = Math.sin(this.time * 0.8 + 1.0) * 0.015 + spawnLift;
    const br = this.globeRadius + disp + beamBob;
    this.destBeam.position.set(n.x * br, n.y * br, n.z * br);
    this.destBeam.scale.setScalar(spawnScale);
  }

  private readonly _up = new Vector3();
  private readonly _right = new Vector3();
  private readonly _fwd = new Vector3();

  private animateCarryPackage(dt: number, playerWorldPos: Vector3) {
    this._up.copy(playerWorldPos).normalize();

    this._fwd.crossVectors(this._up, REF_Z);
    if (this._fwd.lengthSq() < 0.001) this._fwd.crossVectors(this._up, REF_X);
    this._fwd.normalize();
    this._right.crossVectors(this._up, this._fwd).normalize();

    if (this.prevPlayerPos.lengthSq() > 0) {
      const newVel = _tmpV.copy(playerWorldPos).sub(this.prevPlayerPos).divideScalar(Math.max(dt, 0.001));
      const accel = _tmpV2.copy(newVel).sub(this.playerVel);

      this.swingVelX += -accel.dot(this._right) * SWING_INERTIA;
      this.swingVelZ += -accel.dot(this._fwd) * SWING_INERTIA;

      this.playerVel.copy(newVel);
    }
    this.prevPlayerPos.copy(playerWorldPos);

    this.swingVelX += -this.swingOffsetX * SWING_GRAVITY * dt;
    this.swingVelZ += -this.swingOffsetZ * SWING_GRAVITY * dt;
    this.swingVelX *= 1 - SWING_DAMPING * dt;
    this.swingVelZ *= 1 - SWING_DAMPING * dt;

    this.swingOffsetX += this.swingVelX * dt;
    this.swingOffsetZ += this.swingVelZ * dt;

    const maxSwing = 0.4;
    this.swingOffsetX = Math.max(-maxSwing, Math.min(maxSwing, this.swingOffsetX));
    this.swingOffsetZ = Math.max(-maxSwing, Math.min(maxSwing, this.swingOffsetZ));

    this.carryGroup.position.copy(playerWorldPos);
    this.carryGroup.quaternion.setFromUnitVectors(REF_UP, this._up);
    this.carryGroup.rotateX(this.swingOffsetZ);
    this.carryGroup.rotateZ(-this.swingOffsetX);
  }

  private updateBeamUniforms() {
    for (const s of this.offerSlots) {
      s.originBeam.traverse((child) => {
        if ((child as Mesh).material instanceof ShaderMaterial) {
          ((child as Mesh).material as ShaderMaterial).uniforms.time.value = this.time;
        }
      });
    }
    this.destBeam.traverse((child) => {
      if ((child as Mesh).material instanceof ShaderMaterial) {
        ((child as Mesh).material as ShaderMaterial).uniforms.time.value = this.time;
      }
    });
  }

  /* ── Visibility helpers ──────────────────────────────────────────── */

  private showAllOfferOrigins() {
    for (const s of this.offerSlots) {
      if (s.origin) {
        s.originAnimT = 0;
        this.positionAtVillage(s.originBeam, s.origin, 0);
        s.originBeam.visible = true;
        s.packageMesh.visible = true;
      } else {
        s.originAnimT = -1;
        s.originBeam.visible = false;
        s.packageMesh.visible = false;
      }
    }
    this.destBeam.visible = false;
    this.ghostPackage.visible = false;
    this.carryGroup.visible = false;
  }

  private hideOfferSlot(i: number) {
    const s = this.offerSlots[i];
    if (!s) return;
    s.originBeam.visible = false;
    s.packageMesh.visible = false;
  }

  private hideActiveOfferOrigin() {
    const i = this.offerSlots.findIndex((s) => s.origin === this.origin);
    if (i >= 0) {
      this.offerSlots[i]!.originBeam.visible = false;
      this.offerSlots[i]!.packageMesh.visible = false;
    }
  }

  private showDestination() {
    if (!this.destination) return;
    for (const s of this.offerSlots) {
      s.originBeam.visible = false;
      s.packageMesh.visible = false;
    }
    this.positionAtVillage(this.destBeam, this.destination, 0);
    this.destBeam.visible = true;
    this.ghostPackage.visible = true;
    this.carryGroup.visible = true;
    this.destAnimT = 0;
    this.swingOffsetX = 0;
    this.swingOffsetZ = 0;
    this.swingVelX = 0;
    this.swingVelZ = 0;
    this.prevPlayerPos.set(0, 0, 0);
    this.playerVel.set(0, 0, 0);
  }

  private hideAll() {
    for (const s of this.offerSlots) {
      s.originBeam.visible = false;
      s.packageMesh.visible = false;
    }
    this.destBeam.visible = false;
    this.ghostPackage.visible = false;
    this.carryGroup.visible = false;
  }

  /* ── Cleanup ─────────────────────────────────────────────────────── */

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        const mat = (child as any).material;
        if (mat.dispose) mat.dispose();
      }
    });
  }
}
