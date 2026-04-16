import {
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

  private readonly bodyGeo = new SphereGeometry(0.06, 8, 8);
  private readonly headGeo = new SphereGeometry(0.045, 8, 8);
  private readonly snoutGeo = new ConeGeometry(0.015, 0.04, 5);
  private readonly earGeo = new ConeGeometry(0.015, 0.08, 4);
  private readonly limbGeo = new CylinderGeometry(0.008, 0.006, 0.05, 5);
  private readonly eyeGeo = new SphereGeometry(0.008, 4, 4);
  private readonly gunGeo = new CylinderGeometry(0.012, 0.015, 0.06, 6);

  private readonly leftWingGeo: BufferGeometry;
  private readonly rightWingGeo: BufferGeometry;

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
    private readonly onShotDown: (worldPosition: Vector3) => void,
  ) {
    this.group.visible = false;
    this.scene.add(this.group);

    const lWingVerts = new Float32Array([
      0, 0, 0,               // 0: Root
      -0.12, 0, 0.06,        // 1: Wrist
      -0.28, 0, 0.08,        // 2: Tip 1
      -0.24, 0, -0.06,       // 3: Tip 2
      -0.14, 0, -0.14,       // 4: Tip 3
      -0.04, 0, -0.12,       // 5: Tip 4
      -0.20, 0, 0.0,         // 6: Web 1-2
      -0.15, 0, -0.05,       // 7: Web 2-3
      -0.07, 0, -0.08,       // 8: Web 3-4
    ]);
    const lWingIndices = [
      1, 2, 6,
      1, 6, 3,
      1, 3, 7,
      1, 7, 4,
      1, 4, 8,
      1, 8, 5,
      1, 5, 0
    ];
    this.leftWingGeo = new BufferGeometry();
    this.leftWingGeo.setAttribute("position", new BufferAttribute(lWingVerts, 3));
    this.leftWingGeo.setIndex(lWingIndices);
    this.leftWingGeo.computeVertexNormals();

    const rWingVerts = new Float32Array(lWingVerts.length);
    for (let i = 0; i < lWingVerts.length; i += 3) {
      rWingVerts[i] = -lWingVerts[i];
      rWingVerts[i + 1] = lWingVerts[i + 1];
      rWingVerts[i + 2] = lWingVerts[i + 2];
    }
    const rWingIndices = [];
    for (let i = 0; i < lWingIndices.length; i += 3) {
      rWingIndices.push(lWingIndices[i], lWingIndices[i + 2], lWingIndices[i + 1]);
    }
    this.rightWingGeo = new BufferGeometry();
    this.rightWingGeo.setAttribute("position", new BufferAttribute(rWingVerts, 3));
    this.rightWingGeo.setIndex(rWingIndices);
    this.rightWingGeo.computeVertexNormals();

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
    this.leftWingGeo.dispose();
    this.rightWingGeo.dispose();
    this.bodyMaterial.dispose();
    this.bellyMaterial.dispose();
    this.wingMaterial.dispose();
    this.eyeMaterial.dispose();
    this.gearMaterial.dispose();
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

    const snout = new Mesh(this.snoutGeo, this.bodyMaterial);
    snout.position.set(0, 0.05, 0.1);
    snout.rotation.x = Math.PI / 2;
    snout.castShadow = true;
    rig.add(snout);

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

    const leftWing = new Mesh(this.leftWingGeo, this.wingMaterial);
    leftWing.castShadow = true;
    leftWingPivot.add(leftWing);

    const rightWingPivot = new Group();
    rightWingPivot.position.set(0.03, 0.04, -0.04);
    rig.add(rightWingPivot);

    const rightWing = new Mesh(this.rightWingGeo, this.wingMaterial);
    rightWing.castShadow = true;
    rightWingPivot.add(rightWing);

    const random = seededRandom(this.seed + index * 104729 + 17);
    return {
      index,
      id: `${GREMLIN_SHOOTER_PREFIX}${index}`,
      root,
      rig,
      leftWingPivot,
      rightWingPivot,
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
    gremlin.mode = "alive";
    gremlin.downTimer = 0;
    gremlin.root.visible = true;
    gremlin.rig.position.set(0, 0, 0);
    gremlin.rig.rotation.set(0, 0, 0);
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

      const targetHeading =
        Math.atan2(
          this.directionScratch.dot(frame.east),
          this.directionScratch.dot(frame.north),
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
    }

    const targetAltitude =
      gremlin.baseAltitude + Math.sin(this.time * GREMLIN_BOB_SPEED + gremlin.bobPhase) * GREMLIN_BOB_AMP;
    gremlin.altitude += (targetAltitude - gremlin.altitude) * Math.min(1, 2.8 * dt);

    gremlin.qPosition.copy(
      moveOnSphere(
        gremlin.qPosition,
        gremlin.heading,
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

    this.updateGremlinTransform(gremlin, 0);

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
    }
  }

  private updateFallingGremlin(gremlin: GremlinState, dt: number) {
    gremlin.downTimer = Math.max(0, gremlin.downTimer - dt);
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

    if (gremlin.mode === "alive") {
      const flap = Math.sin(this.time * GREMLIN_FLAP_SPEED + gremlin.flapPhase) * GREMLIN_FLAP_AMP;
      gremlin.leftWingPivot.rotation.z = flap;
      gremlin.rightWingPivot.rotation.z = -flap;
      gremlin.rig.position.y =
        Math.sin(this.time * GREMLIN_BOB_SPEED + gremlin.bobPhase) * 0.022;
      const lean = Math.sin(this.time * 1.4 + gremlin.turnPhase) * 0.08;
      gremlin.rig.rotation.set(0.06 + bankScale * 0.18, 0, lean);
      return;
    }

    gremlin.rig.position.y = 0;
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
      this.paintballSystem.playImpactAtGroup(gremlin.root, info.color, false);
      gremlin.mode = "falling";
      gremlin.downTimer = GREMLIN_FALL_SEC;
      this.onShotDown(gremlin.worldPosition.clone());
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
