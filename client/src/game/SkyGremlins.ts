import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import { PAINTBALL_COLOR_PALETTE } from "@globefly/shared";
import type { Plane } from "./Plane";
import type { PaintballSystem, ProjectileStepInfo } from "./PaintballSystem";
import {
  cartesianFromSpherical,
  lerpAngle,
  moveOnSphere,
  randomSpawnQuaternionAndHeading,
  seededRandom,
  tangentFrame,
} from "./SphericalMath";
import { surfaceAltitudeAt } from "./TerrainSurface";
import { addRimLight } from "./RimLight";

const GREMLIN_COUNT = 5;
export const SKY_GREMLIN_XP = 20;

const GREMLIN_SHOOTER_PREFIX = "gremlin:";
const GREMLIN_SURFACE_CLEARANCE = 0.2;
const GREMLIN_ALTITUDE_MIN = 0.52;
const GREMLIN_ALTITUDE_MAX = 0.65;
const GREMLIN_CRUISE_SPEED = 0.34;
const GREMLIN_CHASE_SPEED = 0.5;
const GREMLIN_BOB_SPEED = 2.8;
const GREMLIN_BOB_AMP = 0.045;
const GREMLIN_FLAP_SPEED = 11.5;
const GREMLIN_FLAP_AMP = 0.72;
const GREMLIN_DETECT_RANGE = 2.25;
const GREMLIN_STANDOFF_IDEAL = 1.15;
const GREMLIN_STANDOFF_MIN = 0.92;
const GREMLIN_STANDOFF_MAX = 1.45;
const GREMLIN_ORBIT_WEIGHT = 0.92;
const GREMLIN_RETREAT_WEIGHT = 1.25;
const GREMLIN_FIRE_RANGE = 1.6;
const GREMLIN_FIRE_DOT = 0.32;
const GREMLIN_FIRE_COOLDOWN_MIN = 1.35;
const GREMLIN_FIRE_COOLDOWN_MAX = 2.15;
const GREMLIN_RESPAWN_MIN_SEC = 6.5;
const GREMLIN_RESPAWN_MAX_SEC = 9.5;
const GREMLIN_HIT_RADIUS = 0.16;
const PLAYER_HIT_RADIUS = 0.22;
const GREMLIN_FALL_SEC = 0.8;
const GREMLIN_FALL_SPEED = 0.95;
const GREMLIN_SHOT_SPEED = 5.7;
const GREMLIN_MUZZLE_FORWARD = 0.12;
const GREMLIN_MUZZLE_UP = -0.01;
const GREMLIN_AIM_SIDE_SPREAD = 0.24;

type GremlinMode = "alive" | "falling" | "respawning";

type GremlinState = {
  readonly index: number;
  readonly id: string;
  readonly root: Group;
  readonly rig: Group;
  readonly leftWingPivot: Group;
  readonly rightWingPivot: Group;
  readonly leftWingMidPivot: Group;
  readonly rightWingMidPivot: Group;
  readonly random: () => number;
  orbitSign: number;
  paintColor: number;
  qPosition: Quaternion;
  heading: number;
  altitude: number;
  baseAltitude: number;
  flapPhase: number;
  bobPhase: number;
  turnPhase: number;
  fireCooldown: number;
  aimTimer: number;
  health: number;
  hitWobbleAmp: number;
  hitWobblePhase: number;
  respawnSalt: number;
  respawnTimer: number;
  downTimer: number;
  worldPosition: Vector3;
  mode: GremlinMode;
};

export class SkyGremlins {
  readonly group = new Group();

  private readonly bodyMaterial = new MeshPhongMaterial({
    color: 0x4a7c3b,
    emissive: 0x11220c,
    flatShading: true,
  });
  private readonly bellyMaterial = new MeshPhongMaterial({
    color: 0x68a355,
    emissive: 0x183311,
    flatShading: true,
  });
  private readonly wingMaterial = new MeshPhongMaterial({
    color: 0x2d1b38,
    emissive: 0x110818,
    flatShading: true,
    side: DoubleSide,
  });
  private readonly eyeMaterial = new MeshPhongMaterial({
    color: 0xffcc00,
    emissive: 0xff4400,
    flatShading: true,
  });
  private readonly gearMaterial = new MeshPhongMaterial({
    color: 0x333333,
    emissive: 0x111111,
    flatShading: true,
  });
  private readonly toothMaterial = new MeshPhongMaterial({
    color: 0xffffff,
    emissive: 0x444444,
    flatShading: true,
  });

  private readonly bodyGeo = new SphereGeometry(0.06, 8, 8);
  private readonly headGeo = new SphereGeometry(0.045, 8, 8);
  private readonly snoutGeo = new ConeGeometry(0.015, 0.04, 5);
  private readonly earGeo = new ConeGeometry(0.015, 0.08, 4);
  private readonly limbGeo = new CylinderGeometry(0.008, 0.006, 0.05, 5);
  private readonly eyeGeo = new SphereGeometry(0.008, 4, 4);
  private readonly gunGeo = new CylinderGeometry(0.012, 0.015, 0.06, 6);
  private readonly browGeo = new CylinderGeometry(0.006, 0.006, 0.04, 4);
  private readonly toothGeo = new ConeGeometry(0.004, 0.01, 3);
  private readonly tailGeo = new ConeGeometry(0.012, 0.08, 4);
  private readonly backpackGeo = new BoxGeometry(0.06, 0.06, 0.04);
  private readonly goggleGeo = new CylinderGeometry(0.012, 0.012, 0.006, 8);

  private readonly innerLeftWingGeo: BufferGeometry;
  private readonly outerLeftWingGeo: BufferGeometry;
  private readonly innerRightWingGeo: BufferGeometry;
  private readonly outerRightWingGeo: BufferGeometry;

  private readonly gremlins: GremlinState[] = [];
  private readonly worldPosScratch = new Vector3();
  private readonly toPlayerScratch = new Vector3();
  private readonly tangentScratch = new Vector3();
  private readonly orbitScratch = new Vector3();
  private readonly forwardScratch = new Vector3();
  private readonly rightScratch = new Vector3();
  private readonly correctedUpScratch = new Vector3();
  private readonly muzzleScratch = new Vector3();
  private readonly directionScratch = new Vector3();
  private readonly tmpMatrix = new Matrix4();
  private readonly currentPlayerWorldPos = new Vector3();
  private currentPlayer: Plane | null = null;
  private readonly removeProjectileStepListener: () => void;
  private time = 0;
  private suspended = true;

  constructor(
    private readonly scene: Scene,
    private readonly globeRadius: number,
    private readonly seed: number,
    private readonly terrainType: string,
    private readonly paintballSystem: PaintballSystem,
    private readonly getLocalShooterId: () => string | undefined,
    private readonly onHit: (worldPosition: Vector3) => void,
    private readonly onShotDown: (worldPosition: Vector3) => void,
  ) {
    this.group.visible = false;
    this.scene.add(this.group);

    addRimLight(this.bodyMaterial, 0xa2ef7b, 0.45, 2.8);
    addRimLight(this.bellyMaterial, 0xa2ef7b, 0.5, 2.8);
    addRimLight(this.wingMaterial, 0xe2a0ff, 0.35, 3.2);
    addRimLight(this.gearMaterial, 0x888888, 0.4, 3.0);
    addRimLight(this.toothMaterial, 0xffffff, 0.5, 2.5);

    const ilVerts = new Float32Array([
      0, 0, 0.02,
      -0.08, 0, 0.04,
      -0.07, 0, -0.04,
      0, 0, -0.06,
    ]);
    const ilIndices = [0, 1, 2, 0, 2, 3];
    this.innerLeftWingGeo = new BufferGeometry();
    this.innerLeftWingGeo.setAttribute("position", new BufferAttribute(ilVerts, 3));
    this.innerLeftWingGeo.setIndex(ilIndices);
    this.innerLeftWingGeo.computeVertexNormals();

    const irVerts = new Float32Array(ilVerts.length);
    for (let i = 0; i < ilVerts.length; i += 3) {
      irVerts[i] = -ilVerts[i];
      irVerts[i + 1] = ilVerts[i + 1];
      irVerts[i + 2] = ilVerts[i + 2];
    }
    const irIndices = [0, 2, 1, 0, 3, 2];
    this.innerRightWingGeo = new BufferGeometry();
    this.innerRightWingGeo.setAttribute("position", new BufferAttribute(irVerts, 3));
    this.innerRightWingGeo.setIndex(irIndices);
    this.innerRightWingGeo.computeVertexNormals();

    const olVerts = new Float32Array([
      0, 0, 0,
      -0.12, 0, 0.02,
      -0.10, 0, -0.06,
      -0.04, 0, -0.10,
      0.01, 0, -0.08,
    ]);
    const olIndices = [0, 1, 2, 0, 2, 3, 0, 3, 4];
    this.outerLeftWingGeo = new BufferGeometry();
    this.outerLeftWingGeo.setAttribute("position", new BufferAttribute(olVerts, 3));
    this.outerLeftWingGeo.setIndex(olIndices);
    this.outerLeftWingGeo.computeVertexNormals();

    const orVerts = new Float32Array(olVerts.length);
    for (let i = 0; i < olVerts.length; i += 3) {
      orVerts[i] = -olVerts[i];
      orVerts[i + 1] = olVerts[i + 1];
      orVerts[i + 2] = olVerts[i + 2];
    }
    const orIndices = [0, 2, 1, 0, 3, 2, 0, 4, 3];
    this.outerRightWingGeo = new BufferGeometry();
    this.outerRightWingGeo.setAttribute("position", new BufferAttribute(orVerts, 3));
    this.outerRightWingGeo.setIndex(orIndices);
    this.outerRightWingGeo.computeVertexNormals();

    for (let i = 0; i < GREMLIN_COUNT; i++) {
      const gremlin = this.createGremlin(i);
      this.gremlins.push(gremlin);
      this.group.add(gremlin.root);
      this.respawnGremlin(gremlin, true);
    }

    this.removeProjectileStepListener = this.paintballSystem.addProjectileStepListener((info) => {
      this.handleProjectileStep(info);
    });
  }

  setSuspended(suspended: boolean) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    this.group.visible = !suspended;
    if (suspended) {
      this.paintballSystem.clearProjectilesByShooterPrefix(GREMLIN_SHOOTER_PREFIX);
    }
  }

  update(dt: number, player: Plane) {
    this.currentPlayer = player;
    this.currentPlayerWorldPos.copy(
      cartesianFromSpherical(player.qPosition, player.altitude, this.globeRadius),
    );
    if (this.suspended) return;

    this.time += dt;
    for (const gremlin of this.gremlins) {
      if (gremlin.mode === "respawning") {
        gremlin.respawnTimer = Math.max(0, gremlin.respawnTimer - dt);
        if (gremlin.respawnTimer <= 0) {
          this.respawnGremlin(gremlin, false);
        }
        continue;
      }
      if (gremlin.mode === "falling") {
        this.updateFallingGremlin(gremlin, dt);
        continue;
      }
      this.updateAliveGremlin(gremlin, dt, player);
    }
  }

  dispose() {
    this.removeProjectileStepListener();
    this.paintballSystem.clearProjectilesByShooterPrefix(GREMLIN_SHOOTER_PREFIX);
    this.scene.remove(this.group);
    this.bodyGeo.dispose();
    this.headGeo.dispose();
    this.snoutGeo.dispose();
    this.earGeo.dispose();
    this.limbGeo.dispose();
    this.eyeGeo.dispose();
    this.gunGeo.dispose();
    this.browGeo.dispose();
    this.toothGeo.dispose();
    this.tailGeo.dispose();
    this.backpackGeo.dispose();
    this.goggleGeo.dispose();
    this.innerLeftWingGeo.dispose();
    this.outerLeftWingGeo.dispose();
    this.innerRightWingGeo.dispose();
    this.outerRightWingGeo.dispose();
    this.bodyMaterial.dispose();
    this.bellyMaterial.dispose();
    this.wingMaterial.dispose();
    this.eyeMaterial.dispose();
    this.gearMaterial.dispose();
    this.toothMaterial.dispose();
  }

  private createGremlin(index: number): GremlinState {
    const root = new Group();
    root.matrixAutoUpdate = false;

    const rig = new Group();
    rig.scale.set(0.7, 0.7, 0.7);
    root.add(rig);

    const body = new Mesh(this.bodyGeo, this.bodyMaterial);
    body.scale.set(1.0, 1.2, 0.9);
    body.rotation.x = 0.3;
    body.castShadow = true;
    rig.add(body);

    const head = new Mesh(this.headGeo, this.bodyMaterial);
    head.position.set(0, 0.06, 0.05);
    head.scale.set(1.2, 0.9, 1.1);
    head.rotation.x = -0.2;
    head.castShadow = true;
    rig.add(head);

    const brow = new Mesh(this.browGeo, this.bodyMaterial);
    brow.position.set(0, 0.08, 0.085);
    brow.rotation.z = Math.PI / 2;
    brow.rotation.x = 0.2;
    brow.castShadow = true;
    rig.add(brow);

    const snout = new Mesh(this.snoutGeo, this.bodyMaterial);
    snout.position.set(0, 0.05, 0.1);
    snout.rotation.x = Math.PI / 2;
    snout.castShadow = true;
    rig.add(snout);

    const leftTooth = new Mesh(this.toothGeo, this.toothMaterial);
    leftTooth.position.set(-0.006, 0.04, 0.105);
    leftTooth.rotation.x = Math.PI;
    leftTooth.castShadow = true;
    rig.add(leftTooth);

    const rightTooth = new Mesh(this.toothGeo, this.toothMaterial);
    rightTooth.position.set(0.006, 0.04, 0.105);
    rightTooth.rotation.x = Math.PI;
    rightTooth.castShadow = true;
    rig.add(rightTooth);

    const leftEar = new Mesh(this.earGeo, this.bellyMaterial);
    leftEar.position.set(-0.045, 0.07, 0.03);
    leftEar.rotation.set(-0.2, -0.4, 1.2);
    leftEar.castShadow = true;
    rig.add(leftEar);

    const rightEar = new Mesh(this.earGeo, this.bellyMaterial);
    rightEar.position.set(0.045, 0.07, 0.03);
    rightEar.rotation.set(-0.2, 0.4, -1.2);
    rightEar.castShadow = true;
    rig.add(rightEar);

    const leftEye = new Mesh(this.eyeGeo, this.eyeMaterial);
    leftEye.position.set(-0.02, 0.07, 0.085);
    leftEye.scale.set(1.5, 0.8, 0.8);
    leftEye.rotation.z = -0.3;
    rig.add(leftEye);

    const rightEye = new Mesh(this.eyeGeo, this.eyeMaterial);
    rightEye.position.set(0.02, 0.07, 0.085);
    rightEye.scale.set(1.5, 0.8, 0.8);
    rightEye.rotation.z = 0.3;
    rig.add(rightEye);

    const leftArm = new Mesh(this.limbGeo, this.bodyMaterial);
    leftArm.position.set(-0.04, 0.01, 0.04);
    leftArm.rotation.set(-1.0, 0.3, 0.4);
    leftArm.castShadow = true;
    rig.add(leftArm);

    const rightArm = new Mesh(this.limbGeo, this.bodyMaterial);
    rightArm.position.set(0.04, 0.01, 0.04);
    rightArm.rotation.set(-1.0, -0.3, -0.4);
    rightArm.castShadow = true;
    rig.add(rightArm);

    const gun = new Mesh(this.gunGeo, this.gearMaterial);
    gun.position.set(0, -0.01, 0.08);
    gun.rotation.x = Math.PI / 2;
    gun.castShadow = true;
    rig.add(gun);

    const leftLeg = new Mesh(this.limbGeo, this.bodyMaterial);
    leftLeg.position.set(-0.03, -0.06, -0.02);
    leftLeg.rotation.set(0.2, 0, 0.2);
    leftLeg.castShadow = true;
    rig.add(leftLeg);

    const rightLeg = new Mesh(this.limbGeo, this.bodyMaterial);
    rightLeg.position.set(0.03, -0.06, -0.02);
    rightLeg.rotation.set(0.2, 0, -0.2);
    rightLeg.castShadow = true;
    rig.add(rightLeg);

    const leftWingPivot = new Group();
    leftWingPivot.position.set(-0.03, 0.04, -0.04);
    rig.add(leftWingPivot);

    const innerLeftWing = new Mesh(this.innerLeftWingGeo, this.wingMaterial);
    innerLeftWing.castShadow = true;
    leftWingPivot.add(innerLeftWing);

    const leftWingMidPivot = new Group();
    leftWingMidPivot.position.set(-0.08, 0, 0.04);
    leftWingPivot.add(leftWingMidPivot);

    const outerLeftWing = new Mesh(this.outerLeftWingGeo, this.wingMaterial);
    outerLeftWing.castShadow = true;
    leftWingMidPivot.add(outerLeftWing);

    const rightWingPivot = new Group();
    rightWingPivot.position.set(0.03, 0.04, -0.04);
    rig.add(rightWingPivot);

    const innerRightWing = new Mesh(this.innerRightWingGeo, this.wingMaterial);
    innerRightWing.castShadow = true;
    rightWingPivot.add(innerRightWing);

    const rightWingMidPivot = new Group();
    rightWingMidPivot.position.set(0.08, 0, 0.04);
    rightWingPivot.add(rightWingMidPivot);

    const outerRightWing = new Mesh(this.outerRightWingGeo, this.wingMaterial);
    outerRightWing.castShadow = true;
    rightWingMidPivot.add(outerRightWing);

    const random = seededRandom(this.seed + index * 104729 + 17);
    return {
      index,
      id: `${GREMLIN_SHOOTER_PREFIX}${index}`,
      root,
      rig,
      leftWingPivot,
      rightWingPivot,
      leftWingMidPivot,
      rightWingMidPivot,
      random,
      orbitSign: random() < 0.5 ? -1 : 1,
      paintColor:
        PAINTBALL_COLOR_PALETTE[
          Math.floor(random() * PAINTBALL_COLOR_PALETTE.length)
        ]!,
      qPosition: new Quaternion(),
      heading: 0,
      altitude: GREMLIN_ALTITUDE_MIN,
      baseAltitude: GREMLIN_ALTITUDE_MIN,
      flapPhase: random() * Math.PI * 2,
      bobPhase: random() * Math.PI * 2,
      turnPhase: random() * Math.PI * 2,
      fireCooldown: GREMLIN_FIRE_COOLDOWN_MIN,
      aimTimer: 0,
      health: 3,
      hitWobbleAmp: 0,
      hitWobblePhase: 0,
      respawnSalt: 0,
      respawnTimer: 0,
      downTimer: 0,
      worldPosition: new Vector3(),
      mode: "respawning",
    };
  }

  private respawnGremlin(gremlin: GremlinState, initial: boolean) {
    const spawn = randomSpawnQuaternionAndHeading(
      this.seed + gremlin.index * 982451653 + gremlin.respawnSalt * 7919,
    );
    gremlin.respawnSalt += 1;
    gremlin.qPosition.copy(spawn.qPosition);
    gremlin.heading = spawn.heading;

    const frame = tangentFrame(gremlin.qPosition);
    const surfaceAlt = surfaceAltitudeAt(
      this.seed,
      this.terrainType,
      frame.up.x,
      frame.up.y,
      frame.up.z,
    );
    gremlin.baseAltitude = Math.min(
      GREMLIN_ALTITUDE_MAX,
      Math.max(
        GREMLIN_ALTITUDE_MIN,
        surfaceAlt + GREMLIN_SURFACE_CLEARANCE + gremlin.random() * 0.18,
      ),
    );
    gremlin.altitude = gremlin.baseAltitude;
    gremlin.fireCooldown =
      (initial ? 0.5 : GREMLIN_FIRE_COOLDOWN_MIN) +
      gremlin.random() * (GREMLIN_FIRE_COOLDOWN_MAX - GREMLIN_FIRE_COOLDOWN_MIN);
    gremlin.aimTimer = 0;
    gremlin.health = 3;
    gremlin.hitWobbleAmp = 0;
    gremlin.hitWobblePhase = 0;
    gremlin.mode = "alive";
    gremlin.downTimer = 0;
    gremlin.root.visible = true;
    gremlin.rig.position.set(0, 0, 0);
    gremlin.rig.rotation.set(0, 0, 0);
    gremlin.rig.scale.setScalar(0.7);
    this.updateGremlinTransform(gremlin, 0);
  }

  private updateAliveGremlin(gremlin: GremlinState, dt: number, player: Plane) {
    gremlin.fireCooldown = Math.max(0, gremlin.fireCooldown - dt);

    this.worldPosScratch.copy(
      cartesianFromSpherical(gremlin.qPosition, gremlin.altitude, this.globeRadius),
    );
    this.toPlayerScratch.subVectors(this.currentPlayerWorldPos, this.worldPosScratch);
    const distanceToPlayer = this.toPlayerScratch.length();

    const frame = tangentFrame(gremlin.qPosition);
    const up = frame.up;
    this.tangentScratch.copy(this.toPlayerScratch);
    this.tangentScratch.addScaledVector(up, -this.tangentScratch.dot(up));
    let moveSpeed = GREMLIN_CRUISE_SPEED;
    let moveHeading = gremlin.heading;

    if (
      distanceToPlayer < GREMLIN_DETECT_RANGE &&
      this.tangentScratch.lengthSq() > 1e-5
    ) {
      this.tangentScratch.normalize();
      this.orbitScratch
        .crossVectors(up, this.tangentScratch)
        .normalize()
        .multiplyScalar(gremlin.orbitSign);

      let approachWeight = 0;
      let orbitWeight = GREMLIN_ORBIT_WEIGHT;
      if (distanceToPlayer < GREMLIN_STANDOFF_MIN) {
        approachWeight = -GREMLIN_RETREAT_WEIGHT;
        orbitWeight = 0.38;
        moveSpeed = GREMLIN_CHASE_SPEED * 1.08;
      } else if (distanceToPlayer > GREMLIN_STANDOFF_MAX) {
        approachWeight = 0.9;
        orbitWeight = 0.56;
        moveSpeed = GREMLIN_CHASE_SPEED;
      } else {
        const halfBand = Math.max(
          0.08,
          (GREMLIN_STANDOFF_MAX - GREMLIN_STANDOFF_MIN) * 0.5,
        );
        approachWeight =
          ((distanceToPlayer - GREMLIN_STANDOFF_IDEAL) / halfBand) * 0.28;
        moveSpeed = GREMLIN_CRUISE_SPEED * 1.08;
      }

      this.directionScratch
        .copy(this.orbitScratch)
        .multiplyScalar(orbitWeight)
        .addScaledVector(this.tangentScratch, approachWeight);
      if (this.directionScratch.lengthSq() < 1e-5) {
        this.directionScratch.copy(this.orbitScratch);
      }
      this.directionScratch.normalize();

      moveHeading = Math.atan2(
        this.directionScratch.dot(frame.east),
        this.directionScratch.dot(frame.north),
      );

      const targetHeading =
        Math.atan2(
          this.tangentScratch.dot(frame.east),
          this.tangentScratch.dot(frame.north),
        ) +
        Math.sin(this.time * 0.9 + gremlin.turnPhase) * 0.2;
      gremlin.heading = lerpAngle(
        gremlin.heading,
        targetHeading,
        Math.min(1, 3.6 * dt),
      );
      const chaseAlt =
        player.altitude +
        Math.sin(this.time * 1.7 + gremlin.bobPhase) * 0.12 +
        Math.cos(gremlin.turnPhase) * 0.06;
      gremlin.baseAltitude = Math.max(
        GREMLIN_ALTITUDE_MIN,
        Math.min(GREMLIN_ALTITUDE_MAX, chaseAlt),
      );
    } else {
      gremlin.heading += Math.sin(this.time * 0.7 + gremlin.turnPhase) * 0.55 * dt;
      gremlin.baseAltitude += Math.sin(this.time * 0.35 + gremlin.bobPhase) * 0.012 * dt;
      gremlin.baseAltitude = Math.max(
        GREMLIN_ALTITUDE_MIN,
        Math.min(GREMLIN_ALTITUDE_MAX, gremlin.baseAltitude),
      );
      moveHeading = gremlin.heading;
    }

    const targetAltitude =
      gremlin.baseAltitude + Math.sin(this.time * GREMLIN_BOB_SPEED + gremlin.bobPhase) * GREMLIN_BOB_AMP;
    gremlin.altitude += (targetAltitude - gremlin.altitude) * Math.min(1, 2.8 * dt);

    gremlin.qPosition.copy(
      moveOnSphere(
        gremlin.qPosition,
        moveHeading,
        (moveSpeed * dt) /
          this.globeRadius,
      ),
    );

    const movedFrame = tangentFrame(gremlin.qPosition);
    const surfaceAlt = surfaceAltitudeAt(
      this.seed,
      this.terrainType,
      movedFrame.up.x,
      movedFrame.up.y,
      movedFrame.up.z,
    );
    const minAltitude = surfaceAlt + GREMLIN_SURFACE_CLEARANCE;
    if (gremlin.altitude < minAltitude) {
      gremlin.altitude = minAltitude;
    }

    this.updateGremlinTransform(gremlin, dt);

    this.directionScratch
      .copy(this.currentPlayerWorldPos)
      .sub(gremlin.worldPosition);
    const fireDistance = this.directionScratch.length();
    if (
      fireDistance <= GREMLIN_FIRE_RANGE &&
      fireDistance > 1e-4 &&
      gremlin.fireCooldown <= 0
    ) {
      this.directionScratch.divideScalar(fireDistance);
      this.forwardFromHeading(gremlin.qPosition, gremlin.heading, this.forwardScratch);
      if (this.forwardScratch.dot(this.directionScratch) >= GREMLIN_FIRE_DOT) {
        gremlin.aimTimer += dt;
        if (gremlin.aimTimer >= 0.2) {
          gremlin.aimTimer = 0;
          this.rightScratch.crossVectors(this.directionScratch, movedFrame.up);
          if (this.rightScratch.lengthSq() < 1e-5) {
            this.rightScratch.copy(movedFrame.east);
          } else {
            this.rightScratch.normalize();
          }
          this.directionScratch
            .addScaledVector(
              this.rightScratch,
              (gremlin.random() - 0.5) * GREMLIN_AIM_SIDE_SPREAD,
            )
            .normalize();
          this.muzzleScratch
            .copy(gremlin.worldPosition)
            .addScaledVector(this.forwardScratch, GREMLIN_MUZZLE_FORWARD)
            .addScaledVector(movedFrame.up, GREMLIN_MUZZLE_UP);
          this.paintballSystem.spawnLocalProjectile({
            shooterId: gremlin.id,
            origin: this.muzzleScratch,
            direction: this.directionScratch,
            color: gremlin.paintColor,
            speed: GREMLIN_SHOT_SPEED,
          });
          gremlin.fireCooldown =
            GREMLIN_FIRE_COOLDOWN_MIN +
            gremlin.random() * (GREMLIN_FIRE_COOLDOWN_MAX - GREMLIN_FIRE_COOLDOWN_MIN);
        }
      } else {
        gremlin.aimTimer = 0;
      }
    } else {
      gremlin.aimTimer = 0;
    }
  }

  private updateFallingGremlin(gremlin: GremlinState, dt: number) {
    gremlin.downTimer = Math.max(0, gremlin.downTimer - dt);
    
    if (gremlin.downTimer < 0.2) {
      gremlin.rig.scale.setScalar(0.7 * (gremlin.downTimer / 0.2));
    }

    const frame = tangentFrame(gremlin.qPosition);
    const surfaceAlt = surfaceAltitudeAt(
      this.seed,
      this.terrainType,
      frame.up.x,
      frame.up.y,
      frame.up.z,
    );
    gremlin.altitude = Math.max(
      surfaceAlt + GREMLIN_SURFACE_CLEARANCE * 0.55,
      gremlin.altitude - GREMLIN_FALL_SPEED * dt,
    );
    gremlin.heading += 3.6 * dt;
    this.updateGremlinTransform(gremlin, dt);
    gremlin.rig.rotation.x += dt * 11.5;
    gremlin.rig.rotation.z += dt * 9.5;
    gremlin.leftWingPivot.rotation.z *= 0.86;
    gremlin.rightWingPivot.rotation.z *= 0.86;
    gremlin.leftWingMidPivot.rotation.z *= 0.86;
    gremlin.rightWingMidPivot.rotation.z *= 0.86;

    if (gremlin.downTimer <= 0) {
      gremlin.mode = "respawning";
      gremlin.respawnTimer =
        GREMLIN_RESPAWN_MIN_SEC +
        gremlin.random() * (GREMLIN_RESPAWN_MAX_SEC - GREMLIN_RESPAWN_MIN_SEC);
      gremlin.root.visible = false;
    }
  }

  private updateGremlinTransform(gremlin: GremlinState, bankScale: number) {
    this.forwardFromHeading(gremlin.qPosition, gremlin.heading, this.forwardScratch);
    gremlin.worldPosition.copy(
      cartesianFromSpherical(gremlin.qPosition, gremlin.altitude, this.globeRadius),
    );
    this.correctedUpScratch.copy(gremlin.worldPosition).normalize();
    this.rightScratch
      .crossVectors(this.forwardScratch, this.correctedUpScratch)
      .normalize();
    this.correctedUpScratch
      .crossVectors(this.rightScratch, this.forwardScratch)
      .normalize();

    this.tmpMatrix.makeBasis(
      this.rightScratch,
      this.correctedUpScratch,
      this.forwardScratch,
    );
    this.tmpMatrix.setPosition(gremlin.worldPosition);
    gremlin.root.matrix.copy(this.tmpMatrix);
    gremlin.root.matrixWorldNeedsUpdate = true;

    let hitBank = 0;
    if (gremlin.hitWobbleAmp > 0.002) {
      gremlin.hitWobblePhase += bankScale * 25; // using bankScale as dt here
      hitBank = Math.sin(gremlin.hitWobblePhase) * gremlin.hitWobbleAmp;
      gremlin.hitWobbleAmp *= Math.exp(-5 * bankScale);
    } else {
      gremlin.hitWobbleAmp = 0;
    }

    if (gremlin.mode === "alive") {
      const flap = Math.sin(this.time * GREMLIN_FLAP_SPEED + gremlin.flapPhase) * GREMLIN_FLAP_AMP;
      const midFlap = Math.sin(this.time * GREMLIN_FLAP_SPEED + gremlin.flapPhase - 1.2) * GREMLIN_FLAP_AMP * 0.8;
      gremlin.leftWingPivot.rotation.z = flap;
      gremlin.rightWingPivot.rotation.z = -flap;
      gremlin.leftWingMidPivot.rotation.z = midFlap;
      gremlin.rightWingMidPivot.rotation.z = -midFlap;
      gremlin.rig.position.y =
        Math.sin(this.time * GREMLIN_BOB_SPEED + gremlin.bobPhase) * 0.022;
      const lean = Math.sin(this.time * 1.4 + gremlin.turnPhase) * 0.08;
      gremlin.rig.rotation.set(0.06 + bankScale * 0.18, 0, lean + hitBank);
      return;
    }

    gremlin.rig.position.y = 0;
    gremlin.rig.rotation.z = hitBank;
  }

  private handleProjectileStep(info: ProjectileStepInfo) {
    if (this.suspended) return;

    if (info.shooterId.startsWith(GREMLIN_SHOOTER_PREFIX)) {
      if (!this.currentPlayer) return;
      if (
        !this.segmentHitsSphere(
          info.previousPosition,
          info.currentPosition,
          this.currentPlayerWorldPos,
          PLAYER_HIT_RADIUS,
        )
      ) {
        return;
      }
      info.consume();
      this.paintballSystem.triggerLocalPlayerHit(this.currentPlayer.group, info.color);
      this.currentPlayer.applyGremlinSlow();
      return;
    }

    const localId = this.getLocalShooterId();
    const isLocalShot =
      info.shooterId === (localId ?? "local") ||
      (!localId && info.shooterId === "local");
    if (!isLocalShot) return;

    for (const gremlin of this.gremlins) {
      if (gremlin.mode !== "alive") continue;
      if (
        !this.segmentHitsSphere(
          info.previousPosition,
          info.currentPosition,
          gremlin.worldPosition,
          GREMLIN_HIT_RADIUS,
        )
      ) {
        continue;
      }
      info.consume();
      this.paintballSystem.playImpactAtGroup(gremlin.root, info.color, false);
      
      gremlin.health--;
      if (gremlin.health <= 0) {
        gremlin.mode = "falling";
        gremlin.downTimer = GREMLIN_FALL_SEC;
        this.onShotDown(gremlin.worldPosition.clone());
      } else {
        gremlin.hitWobbleAmp = 0.45;
        gremlin.hitWobblePhase = 0;
        this.onHit(gremlin.worldPosition.clone());
      }
    }
  }

  private segmentHitsSphere(
    start: Vector3,
    end: Vector3,
    center: Vector3,
    radius: number,
  ): boolean {
    this.directionScratch.subVectors(end, start);
    const segLenSq = this.directionScratch.lengthSq();
    if (segLenSq < 1e-8) {
      return start.distanceToSquared(center) <= radius * radius;
    }
    const t = Math.max(
      0,
      Math.min(1, this.toPlayerScratch.subVectors(center, start).dot(this.directionScratch) / segLenSq),
    );
    this.muzzleScratch.copy(start).addScaledVector(this.directionScratch, t);
    return this.muzzleScratch.distanceToSquared(center) <= radius * radius;
  }

  private forwardFromHeading(qPosition: Quaternion, heading: number, out: Vector3) {
    const frame = tangentFrame(qPosition);
    out
      .copy(frame.north)
      .multiplyScalar(Math.cos(heading))
      .addScaledVector(frame.east, Math.sin(heading))
      .normalize();
  }
}
