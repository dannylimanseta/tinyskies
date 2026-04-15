import {
  Group,
  InstancedMesh,
  Matrix4,
  Scene,
  ConeGeometry,
  SphereGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  MeshPhongMaterial,
  Quaternion,
  Vector3,
  DoubleSide,
} from "three";
import {
  cartesianFromSpherical,
  moveOnSphere,
  tangentFrame,
  randomSpawnQuaternionAndHeading,
} from "./SphericalMath";

const FLOCK_ALTITUDE = 0.55;
const FLOCK_SPEED = 0.58;
const FORMATION_HOLD_SEC = 2;
export const FLOCK_FORMATION_XP = 45;
export const BIRD_FLOCK_COUNT = 2;
const REWARD_COOLDOWN_SEC = 85;

const V_OFFSETS: [number, number][] = [
  [0, 0],
  [-0.13, -0.085],
  [-0.13, 0.085],
  [-0.26, -0.17],
  [-0.26, 0.17],
  [-0.39, -0.25],
  [-0.39, 0.25],
];
const DUCK_COUNT = V_OFFSETS.length;

const SLOT_BACK = 0.34;
const SLOT_LAT = 0;
const SLOT_DIST_MAX = 0.62;
const NEAR_ANY_DUCK_DIST = 0.48;
const ALT_MATCH = 0.24;
const HEADING_DOT_MIN = 0.62;

const WING_FLAP_SPEED = 8;
const WING_FLAP_AMP = 0.55;

/* ── Shared geometry (created once, reused across all flocks) ──── */

let _bodyGeo: SphereGeometry | null = null;
let _headGeo: SphereGeometry | null = null;
let _beakGeo: ConeGeometry | null = null;
let _tailGeo: ConeGeometry | null = null;
let _leftWingGeo: BufferGeometry | null = null;
let _rightWingGeo: BufferGeometry | null = null;

function getSharedGeometries() {
  if (!_bodyGeo) {
    _bodyGeo = new SphereGeometry(0.018, 8, 6);
    _bodyGeo.scale(1.5, 0.85, 0.95);
  }
  if (!_headGeo) {
    _headGeo = new SphereGeometry(0.011, 6, 5);
    _headGeo.scale(1.1, 0.9, 0.9);
  }
  if (!_beakGeo) {
    _beakGeo = new ConeGeometry(0.005, 0.016, 5);
    _beakGeo.rotateZ(-Math.PI / 2);
    _beakGeo.scale(1, 0.4, 0.8); // Flattened duck bill
  }
  if (!_tailGeo) {
    _tailGeo = new ConeGeometry(0.008, 0.02, 4);
    _tailGeo.rotateZ(Math.PI / 2);
    _tailGeo.scale(1, 0.3, 1);
  }
  if (!_leftWingGeo) {
    // Swept wing with two segments (4 vertices, 2 triangles)
    const verts = new Float32Array([
      0.01, 0, 0,          // root front
      -0.015, 0, 0,        // root back
      -0.005, 0, -0.035,   // mid joint
      -0.025, 0, -0.065    // wingtip
    ]);
    const indices = [
      0, 2, 1,
      1, 2, 3
    ];
    _leftWingGeo = new BufferGeometry();
    _leftWingGeo.setAttribute("position", new Float32BufferAttribute(verts, 3));
    _leftWingGeo.setIndex(indices);
    _leftWingGeo.computeVertexNormals();
  }
  if (!_rightWingGeo) {
    _rightWingGeo = _leftWingGeo.clone();
    const pa = _rightWingGeo.getAttribute("position") as Float32BufferAttribute;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, -pa.getZ(i));
    // Flip normals by reversing winding order
    const idx = _rightWingGeo.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1]!;
      idx[i + 1] = idx[i + 2]!;
      idx[i + 2] = tmp;
    }
    _rightWingGeo.computeVertexNormals();
  }
  return {
    body: _bodyGeo,
    head: _headGeo,
    beak: _beakGeo,
    tail: _tailGeo,
    leftWing: _leftWingGeo,
    rightWing: _rightWingGeo,
  };
}

/* ── Local offsets in pivot space ───────────────────────────────── */

const HEAD_OFFSET = new Vector3(0.024, 0.012, 0);
const BEAK_OFFSET = new Vector3(0.038, 0.010, 0);
const TAIL_OFFSET = new Vector3(-0.022, 0.004, 0);
const LWING_OFFSET = new Vector3(0.004, 0.004, -0.008);
const RWING_OFFSET = new Vector3(0.004, 0.004, 0.008);
const PIVOT_QUAT = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
const X_AXIS = new Vector3(1, 0, 0);
const ONE_SCALE = new Vector3(1, 1, 1);

/* ── Class ──────────────────────────────────────────────────────── */

export class BirdFlock {
  readonly group = new Group();

  private globeRadius: number;
  private seed: number;
  private readonly flockIndex: number;
  private leaderQ = new Quaternion();
  private heading = 0;
  private formationHold = 0;
  private rewarded = false;
  private rewardCooldown = 0;
  private fadeDelay = 0;
  private fadeOut = 0;
  private fadeIn = 0;
  private static readonly FADE_DELAY_SEC = 5;
  private static readonly FADE_OUT_SEC = 2;
  private static readonly FADE_IN_SEC = 1;
  private spawnSalt = 0;
  private time = 0;

  private whiteMat: MeshPhongMaterial;
  private orangeMat: MeshPhongMaterial;
  private wingMat: MeshPhongMaterial;

  private bodyMesh: InstancedMesh;
  private headMesh: InstancedMesh;
  private beakMesh: InstancedMesh;
  private tailMesh: InstancedMesh;
  private leftWingMesh: InstancedMesh;
  private rightWingMesh: InstancedMesh;

  private flapPhases: number[] = [];
  private duckPositions: Vector3[] = [];

  private leaderPos = new Vector3();
  private slotPos = new Vector3();
  private dir = new Vector3();
  private right = new Vector3();
  private scratch = new Vector3();
  private birdOffset = new Vector3();

  private tmpMat = new Matrix4();
  private tmpTarget = new Vector3();
  private lookAtQuat = new Quaternion();
  private duckQuat = new Quaternion();
  private wingQuat = new Quaternion();
  private flapQuat = new Quaternion();
  private partWorldPos = new Vector3();

  constructor(scene: Scene, globeRadius: number, worldSeed: number, flockIndex: number) {
    this.globeRadius = globeRadius;
    this.seed = worldSeed;
    this.flockIndex = flockIndex;

    this.whiteMat = new MeshPhongMaterial({ color: 0xf0f0f0, emissive: 0x222222, flatShading: true, transparent: true });
    this.orangeMat = new MeshPhongMaterial({ color: 0xee8822, emissive: 0x331100, flatShading: true, transparent: true });
    this.wingMat = new MeshPhongMaterial({ color: 0xf0f0f0, emissive: 0x222222, flatShading: true, transparent: true, side: DoubleSide });

    const geo = getSharedGeometries();
    this.bodyMesh = new InstancedMesh(geo.body, this.whiteMat, DUCK_COUNT);
    this.headMesh = new InstancedMesh(geo.head, this.whiteMat, DUCK_COUNT);
    this.beakMesh = new InstancedMesh(geo.beak, this.orangeMat, DUCK_COUNT);
    this.tailMesh = new InstancedMesh(geo.tail, this.whiteMat, DUCK_COUNT);
    this.leftWingMesh = new InstancedMesh(geo.leftWing, this.wingMat, DUCK_COUNT);
    this.rightWingMesh = new InstancedMesh(geo.rightWing, this.wingMat, DUCK_COUNT);

    for (const m of [this.bodyMesh, this.headMesh, this.beakMesh, this.tailMesh, this.leftWingMesh, this.rightWingMesh]) {
      m.frustumCulled = false;
      this.group.add(m);
    }

    for (let i = 0; i < DUCK_COUNT; i++) {
      this.flapPhases.push(i * 0.7);
      this.duckPositions.push(new Vector3());
    }

    this.respawn(0);
    scene.add(this.group);
  }

  private respawn(salt: number) {
    this.spawnSalt = salt;
    const spawn = randomSpawnQuaternionAndHeading(
      this.seed + this.flockIndex * 982451653 + salt * 7919,
    );
    this.leaderQ.copy(spawn.qPosition);
    this.heading = spawn.heading;
    this.formationHold = 0;
    this.rewarded = false;
    this.fadeDelay = 0;
    this.fadeOut = 0;
    this.fadeIn = BirdFlock.FADE_IN_SEC;
    this.group.visible = true;
    this.setOpacity(0);
  }

  private setOpacity(opacity: number) {
    this.whiteMat.opacity = opacity;
    this.orangeMat.opacity = opacity;
    this.wingMat.opacity = opacity;
  }

  private setInstanceMatrix(
    mesh: InstancedMesh,
    index: number,
    pos: Vector3,
    quat: Quaternion,
  ) {
    this.tmpMat.compose(pos, quat, ONE_SCALE);
    mesh.setMatrixAt(index, this.tmpMat);
  }

  update(
    dt: number,
    playerQ: Quaternion,
    playerAlt: number,
    playerHeading: number,
  ): { progress: number; justCompleted: boolean; flockActive: boolean } {
    this.time += dt;

    /* ── Fade ──────────────────────────────────────────────────── */
    let opacity = 1;
    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt);
      opacity = 1 - this.fadeIn / BirdFlock.FADE_IN_SEC;
    }
    if (this.fadeDelay > 0) {
      this.fadeDelay = Math.max(0, this.fadeDelay - dt);
      if (this.fadeDelay <= 0) this.fadeOut = BirdFlock.FADE_OUT_SEC;
    }
    if (this.fadeOut > 0) {
      this.fadeOut = Math.max(0, this.fadeOut - dt);
      opacity *= this.fadeOut / BirdFlock.FADE_OUT_SEC;
      if (this.fadeOut <= 0) this.group.visible = false;
    }
    this.setOpacity(opacity);

    /* ── Move leader ───────────────────────────────────────────── */
    const arc = (FLOCK_SPEED * dt) / this.globeRadius;
    this.leaderQ.copy(moveOnSphere(this.leaderQ, this.heading, arc));

    const frame = tangentFrame(this.leaderQ);
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);
    this.dir.copy(frame.north).multiplyScalar(cosH).addScaledVector(frame.east, sinH).normalize();
    this.right.copy(frame.north).multiplyScalar(-sinH).addScaledVector(frame.east, cosH).normalize();

    this.leaderPos.copy(cartesianFromSpherical(this.leaderQ, FLOCK_ALTITUDE, this.globeRadius));
    const up = this.scratch.copy(this.leaderPos).normalize();

    /* ── Compute orientation quaternion for ducks ──────────────── */
    this.tmpTarget.copy(this.leaderPos).add(this.dir);
    this.tmpMat.lookAt(this.tmpTarget, this.leaderPos, up);
    this.lookAtQuat.setFromRotationMatrix(this.tmpMat);

    /* ── Position each duck instance ───────────────────────────── */
    const playerPos = cartesianFromSpherical(playerQ, playerAlt, this.globeRadius);
    let minDistToAnyDuck = Infinity;

    for (let i = 0; i < DUCK_COUNT; i++) {
      const [back, lat] = V_OFFSETS[i]!;
      this.birdOffset.copy(this.dir).multiplyScalar(back).addScaledVector(this.right, lat);
      const duckPos = this.duckPositions[i]!;
      duckPos.copy(this.leaderPos).add(this.birdOffset);

      minDistToAnyDuck = Math.min(minDistToAnyDuck, playerPos.distanceTo(duckPos));

      this.duckQuat.copy(this.lookAtQuat).multiply(PIVOT_QUAT);

      this.setInstanceMatrix(this.bodyMesh, i, duckPos, this.duckQuat);

      this.partWorldPos.copy(HEAD_OFFSET).applyQuaternion(this.duckQuat).add(duckPos);
      this.setInstanceMatrix(this.headMesh, i, this.partWorldPos, this.duckQuat);

      this.partWorldPos.copy(BEAK_OFFSET).applyQuaternion(this.duckQuat).add(duckPos);
      this.setInstanceMatrix(this.beakMesh, i, this.partWorldPos, this.duckQuat);

      this.partWorldPos.copy(TAIL_OFFSET).applyQuaternion(this.duckQuat).add(duckPos);
      this.setInstanceMatrix(this.tailMesh, i, this.partWorldPos, this.duckQuat);

      const flap = Math.sin(this.time * WING_FLAP_SPEED + this.flapPhases[i]!) * WING_FLAP_AMP;

      this.flapQuat.setFromAxisAngle(X_AXIS, flap);
      this.wingQuat.copy(this.duckQuat).multiply(this.flapQuat);
      this.partWorldPos.copy(LWING_OFFSET).applyQuaternion(this.duckQuat).add(duckPos);
      this.setInstanceMatrix(this.leftWingMesh, i, this.partWorldPos, this.wingQuat);

      this.flapQuat.setFromAxisAngle(X_AXIS, -flap);
      this.wingQuat.copy(this.duckQuat).multiply(this.flapQuat);
      this.partWorldPos.copy(RWING_OFFSET).applyQuaternion(this.duckQuat).add(duckPos);
      this.setInstanceMatrix(this.rightWingMesh, i, this.partWorldPos, this.wingQuat);
    }

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    this.beakMesh.instanceMatrix.needsUpdate = true;
    this.tailMesh.instanceMatrix.needsUpdate = true;
    this.leftWingMesh.instanceMatrix.needsUpdate = true;
    this.rightWingMesh.instanceMatrix.needsUpdate = true;

    /* ── Formation slot ────────────────────────────────────────── */
    this.slotPos.copy(this.leaderPos).addScaledVector(this.dir, -SLOT_BACK).addScaledVector(this.right, SLOT_LAT);

    if (this.rewardCooldown > 0) {
      this.rewardCooldown -= dt;
      if (this.rewardCooldown <= 0) this.respawn((this.spawnSalt + 1) * 1103515245);
      return { progress: 0, justCompleted: false, flockActive: true };
    }

    const distToSlot = playerPos.distanceTo(this.slotPos);
    const posOk = distToSlot < SLOT_DIST_MAX || minDistToAnyDuck < NEAR_ANY_DUCK_DIST;
    const altOk = Math.abs(playerAlt - FLOCK_ALTITUDE) < ALT_MATCH;

    const pFrame = tangentFrame(playerQ);
    const pFwd = this.scratch
      .copy(pFrame.north)
      .multiplyScalar(Math.cos(playerHeading))
      .addScaledVector(pFrame.east, Math.sin(playerHeading))
      .normalize();
    const headOk = pFwd.dot(this.dir) > HEADING_DOT_MIN;

    const inFormation = posOk && altOk && headOk;
    if (inFormation) {
      this.formationHold += dt;
    } else {
      this.formationHold = 0;
    }

    const progress = Math.min(1, this.formationHold / FORMATION_HOLD_SEC);

    let justCompleted = false;
    if (progress >= 1 && !this.rewarded) {
      this.rewarded = true;
      justCompleted = true;
      this.rewardCooldown = REWARD_COOLDOWN_SEC;
      this.fadeDelay = BirdFlock.FADE_DELAY_SEC;
    }

    return { progress: this.rewarded ? 0 : progress, justCompleted, flockActive: true };
  }

  dispose() {
    this.whiteMat.dispose();
    this.orangeMat.dispose();
    this.wingMat.dispose();
    this.bodyMesh.dispose();
    this.headMesh.dispose();
    this.beakMesh.dispose();
    this.leftWingMesh.dispose();
    this.rightWingMesh.dispose();
    this.group.removeFromParent();
  }
}
