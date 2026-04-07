import {
  Group,
  Mesh,
  BoxGeometry,
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
const SPIN_SPEED = 1.2;
const MIN_PAIR_DOT = 0.85;
const MAX_PAIR_RETRIES = 20;

const STRING_LENGTH = 0.12;
const SWING_GRAVITY = 8.0;
const SWING_DAMPING = 2.5;
const SWING_INERTIA = 3.0;

const REF_UP = new Vector3(0, 1, 0);
const REF_Z = new Vector3(0, 0, 1);
const REF_X = new Vector3(1, 0, 0);
const _tmpV = new Vector3();
const _tmpV2 = new Vector3();

const enum QuestState {
  Spawning,
  Available,
  PickingUp,
  Carrying,
  Delivering,
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

/* ── Package model builder ──────────────────────────────────────────── */

function createPackageMesh(ghost = false): Group {
  const pkg = new Group();

  const boxGeo = new BoxGeometry(0.05, 0.04, 0.05);
  const boxMat = new MeshPhongMaterial({
    color: 0x8b6914,
    transparent: ghost,
    opacity: ghost ? 0.3 : 1,
  });
  const box = new Mesh(boxGeo, boxMat);
  pkg.add(box);

  if (!ghost) {
    const strapGeo = new BoxGeometry(0.056, 0.004, 0.008);
    const strapMat = new MeshPhongMaterial({ color: 0xf5deb3 });
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

function createBeamGroup(color: number): Group {
  const grp = new Group();
  const beamMat = new ShaderMaterial({
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    uniforms: {
      time: { value: 0 },
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

  const planeGeo = new PlaneGeometry(0.06, 0.8);
  planeGeo.translate(0, 0.4, 0);

  const p1 = new Mesh(planeGeo, beamMat);
  grp.add(p1);
  const p2 = new Mesh(planeGeo.clone(), beamMat);
  p2.rotation.y = Math.PI / 2;
  grp.add(p2);

  return grp;
}

/* ── PackageQuestManager ────────────────────────────────────────────── */

export class PackageQuestManager {
  readonly group = new Group();

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

  private originBeam: Group;
  private destBeam: Group;
  private packageMesh: Group;
  private ghostPackage: Group;
  private carryGroup: Group;
  private stringMesh: Mesh;

  private readonly _playerNormal = new Vector3();
  private spinAngle = 0;

  private prevPlayerPos = new Vector3();
  private playerVel = new Vector3();
  private swingOffsetX = 0;
  private swingOffsetZ = 0;
  private swingVelX = 0;
  private swingVelZ = 0;

  onPickup: ((originName: string, destName: string, npcName: string, dialogue: string) => void) | null = null;
  onDelivered: ((destName: string, npcName: string, dialogue: string, xp: number) => void) | null = null;
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

    this.originBeam = createBeamGroup(0xffd700);
    this.destBeam = createBeamGroup(0x88ccff);
    this.packageMesh = createPackageMesh(false);
    this.ghostPackage = createPackageMesh(true);

    this.carryGroup = new Group();
    const stringGeo = new CylinderGeometry(0.001, 0.001, STRING_LENGTH, 4);
    stringGeo.translate(0, -STRING_LENGTH / 2, 0);
    const stringMat = new MeshBasicMaterial({ color: 0xf5deb3 });
    this.stringMesh = new Mesh(stringGeo, stringMat);
    this.carryGroup.add(this.stringMesh);
    const carryPkg = createPackageMesh(false);
    carryPkg.position.y = -STRING_LENGTH;
    this.carryGroup.add(carryPkg);

    this.group.add(this.originBeam);
    this.group.add(this.destBeam);
    this.group.add(this.packageMesh);
    this.group.add(this.ghostPackage);
    this.group.add(this.carryGroup);

    this.hideAll();
    scene.add(this.group);

    this.spawnDelay = SPAWN_DELAY_MIN + this.rand() * (SPAWN_DELAY_MAX - SPAWN_DELAY_MIN);
  }

  update(dt: number, playerQPosition: Quaternion, _camera: Camera, playerWorldPos?: Vector3) {
    this.time += dt;

    this._playerNormal.copy(REF_UP).applyQuaternion(playerQPosition).normalize();

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
      if (!this.pickVillagePair()) return;
      this.showOrigin();
      this.state = QuestState.Available;
    }
  }

  private tickAvailable() {
    if (this.inOriginZone()) {
      this.progress = 0;
      this.state = QuestState.PickingUp;
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
      this.hideOrigin();
      this.showDestination();
      this.state = QuestState.Carrying;
      this.progress = 0;
      this.onProgressChange?.(0, "pickup");

      const dialogue = generateQuestDialogue(this.seed, this.questIndex, this.destination!.name);
      this.onPickup?.(this.origin!.name, this.destination!.name, dialogue.senderName, dialogue.pickupLine);
    } else if (this.progress <= 0) {
      this.state = QuestState.Available;
      this.onProgressChange?.(0, "pickup");
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

      const dialogue = generateQuestDialogue(this.seed, this.questIndex, this.destination!.name);
      this.onDelivered?.(this.destination!.name, dialogue.receiverName, dialogue.deliveryLine, DELIVERY_XP);

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
    if (!this.origin) return false;
    return this._playerNormal.dot(this.origin.normal) > this.origin.enterDot;
  }

  private inDestZone(): boolean {
    if (!this.destination) return false;
    return this._playerNormal.dot(this.destination.normal) > this.destination.enterDot;
  }

  /* ── Village pair selection ──────────────────────────────────────── */

  private pickVillagePair(): boolean {
    if (this.villages.length < 2) return false;

    const eligible = this.villages.filter((v) => v !== this.lastDestination);
    if (eligible.length < 2) return false;

    let bestOrigin: Landmark | null = null;
    let bestDest: Landmark | null = null;

    for (let attempt = 0; attempt < MAX_PAIR_RETRIES; attempt++) {
      const oi = Math.floor(this.rand() * eligible.length);
      const o = eligible[oi];

      const others = eligible.filter((v) => v !== o);
      const di = Math.floor(this.rand() * others.length);
      const d = others[di];

      if (o.normal.dot(d.normal) < MIN_PAIR_DOT) {
        this.origin = o;
        this.destination = d;
        return true;
      }

      if (!bestOrigin) {
        bestOrigin = o;
        bestDest = d;
      }
    }

    this.origin = bestOrigin;
    this.destination = bestDest;
    return bestOrigin !== null;
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
    if (!this.origin) return;
    const n = this.origin.normal;
    const disp = surfaceDisplacementAt(this.seed, this.terrainType, n.x, n.y, n.z);
    const bob = PACKAGE_LIFT + Math.sin(this.time * 1.5) * PACKAGE_BOB_AMP;
    const r = this.globeRadius + disp + bob;
    this.packageMesh.position.set(n.x * r, n.y * r, n.z * r);

    this.spinAngle += SPIN_SPEED * dt;
    this.packageMesh.quaternion.setFromUnitVectors(REF_UP, n);
    this.packageMesh.rotateY(this.spinAngle);

    const beamBob = Math.sin(this.time * 0.8) * 0.015;
    const br = this.globeRadius + disp + beamBob;
    this.originBeam.position.set(n.x * br, n.y * br, n.z * br);
  }

  private animateGhost(dt: number) {
    if (!this.destination) return;
    const n = this.destination.normal;
    const disp = surfaceDisplacementAt(this.seed, this.terrainType, n.x, n.y, n.z);
    const bob = PACKAGE_LIFT + Math.sin(this.time * 1.5 + 1.0) * PACKAGE_BOB_AMP;
    const r = this.globeRadius + disp + bob;
    this.ghostPackage.position.set(n.x * r, n.y * r, n.z * r);
    this.ghostPackage.quaternion.setFromUnitVectors(REF_UP, n);
    this.ghostPackage.rotateY(this.spinAngle);

    const beamBob = Math.sin(this.time * 0.8 + 1.0) * 0.015;
    const br = this.globeRadius + disp + beamBob;
    this.destBeam.position.set(n.x * br, n.y * br, n.z * br);
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
    this.originBeam.traverse((child) => {
      if ((child as Mesh).material instanceof ShaderMaterial) {
        ((child as Mesh).material as ShaderMaterial).uniforms.time.value = this.time;
      }
    });
    this.destBeam.traverse((child) => {
      if ((child as Mesh).material instanceof ShaderMaterial) {
        ((child as Mesh).material as ShaderMaterial).uniforms.time.value = this.time;
      }
    });
  }

  /* ── Visibility helpers ──────────────────────────────────────────── */

  private showOrigin() {
    if (!this.origin) return;
    this.positionAtVillage(this.originBeam, this.origin, 0);
    this.originBeam.visible = true;
    this.packageMesh.visible = true;
    this.destBeam.visible = false;
    this.ghostPackage.visible = false;
    this.carryGroup.visible = false;
  }

  private showDestination() {
    if (!this.destination) return;
    this.positionAtVillage(this.destBeam, this.destination, 0);
    this.destBeam.visible = true;
    this.ghostPackage.visible = true;
    this.originBeam.visible = false;
    this.packageMesh.visible = false;
    this.carryGroup.visible = true;
    this.swingOffsetX = 0;
    this.swingOffsetZ = 0;
    this.swingVelX = 0;
    this.swingVelZ = 0;
    this.prevPlayerPos.set(0, 0, 0);
    this.playerVel.set(0, 0, 0);
  }

  private hideOrigin() {
    this.originBeam.visible = false;
    this.packageMesh.visible = false;
  }

  private hideAll() {
    this.originBeam.visible = false;
    this.destBeam.visible = false;
    this.packageMesh.visible = false;
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
