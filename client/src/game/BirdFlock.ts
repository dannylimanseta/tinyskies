import {
  Group,
  Mesh,
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
/** Arc speed along the globe (same units as `Plane` speed). */
const FLOCK_SPEED = 0.58;
const FORMATION_HOLD_SEC = 2;
export const FLOCK_FORMATION_XP = 45;
/** How many independent V formations exist in the world (plane mode). */
export const BIRD_FLOCK_COUNT = 4;
/** Seconds the flock keeps flying after a reward before it can be earned again. */
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

/** Formation “sweet spot” behind the leader; generous radius so you needn’t sit dead center. */
const SLOT_BACK = 0.34;
const SLOT_LAT = 0;
/** Near the rear-center slot, or anywhere this close to any duck counts as “in formation”. */
const SLOT_DIST_MAX = 0.62;
const NEAR_ANY_DUCK_DIST = 0.48;
const ALT_MATCH = 0.24;
/** ~cos(52°) — same rough direction as the flock, not perfectly parallel. */
const HEADING_DOT_MIN = 0.62;

const WING_FLAP_SPEED = 8;
const WING_FLAP_AMP = 0.55;

/** Build a low-poly duck: ellipsoid body, cone beak, two flat-triangle wings returned as children. */
function createDuck(): { root: Group; leftWing: Mesh; rightWing: Mesh } {
  const white = new MeshPhongMaterial({
    color: 0xf0f0f0,
    emissive: 0x222222,
    flatShading: true,
  });
  const orange = new MeshPhongMaterial({
    color: 0xee8822,
    emissive: 0x331100,
    flatShading: true,
  });

  const root = new Group();
  const pivot = new Group();
  pivot.rotation.y = -Math.PI / 2;
  root.add(pivot);

  const bodyGeo = new SphereGeometry(0.018, 6, 5);
  bodyGeo.scale(1.4, 0.8, 0.9);
  const body = new Mesh(bodyGeo, white);
  pivot.add(body);

  const headGeo = new SphereGeometry(0.01, 5, 4);
  const head = new Mesh(headGeo, white);
  head.position.set(0.022, 0.008, 0);
  pivot.add(head);

  const beakGeo = new ConeGeometry(0.004, 0.012, 4);
  beakGeo.rotateZ(-Math.PI / 2);
  const beak = new Mesh(beakGeo, orange);
  beak.position.set(0.034, 0.008, 0);
  pivot.add(beak);

  const wingVerts = new Float32Array([
    0, 0, 0,
    -0.02, 0, -0.04,
    0.01, 0, -0.035,
  ]);
  const wingGeo = new BufferGeometry();
  wingGeo.setAttribute("position", new Float32BufferAttribute(wingVerts, 3));
  wingGeo.computeVertexNormals();

  const leftWing = new Mesh(wingGeo, white.clone());
  leftWing.material.side = DoubleSide;
  leftWing.position.set(0, 0.002, -0.005);
  pivot.add(leftWing);

  const rightWingGeo = wingGeo.clone();
  const posAttr = rightWingGeo.getAttribute("position");
  for (let i = 0; i < posAttr.count; i++) {
    (posAttr as Float32BufferAttribute).setZ(i, -(posAttr as Float32BufferAttribute).getZ(i));
  }
  rightWingGeo.computeVertexNormals();

  const rightWing = new Mesh(rightWingGeo, white.clone());
  rightWing.material.side = DoubleSide;
  rightWing.position.set(0, 0.002, 0.005);
  pivot.add(rightWing);

  return { root, leftWing, rightWing };
}

interface DuckInstance {
  root: Group;
  leftWing: Mesh;
  rightWing: Mesh;
  flapPhase: number;
}

export class BirdFlock {
  readonly group = new Group();

  private globeRadius: number;
  private seed: number;
  /** Separates spawn paths so multiple flocks don’t overlap the same route. */
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
  private ducks: DuckInstance[] = [];
  private time = 0;

  private leaderPos = new Vector3();
  private slotPos = new Vector3();
  private dir = new Vector3();
  private right = new Vector3();
  private scratch = new Vector3();
  private birdOffset = new Vector3();

  constructor(scene: Scene, globeRadius: number, worldSeed: number, flockIndex: number) {
    this.globeRadius = globeRadius;
    this.seed = worldSeed;
    this.flockIndex = flockIndex;
    for (let i = 0; i < V_OFFSETS.length; i++) {
      const { root, leftWing, rightWing } = createDuck();
      root.castShadow = true;
      this.ducks.push({ root, leftWing, rightWing, flapPhase: i * 0.7 });
      this.group.add(root);
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
    this.setFlockOpacity(0);
  }

  private setFlockOpacity(opacity: number) {
    for (const duck of this.ducks) {
      duck.root.traverse((child) => {
        if ((child as Mesh).isMesh) {
          const mat = (child as Mesh).material as MeshPhongMaterial;
          mat.transparent = true;
          mat.opacity = opacity;
        }
      });
    }
  }

  update(
    dt: number,
    playerQ: Quaternion,
    playerAlt: number,
    playerHeading: number,
  ): { progress: number; justCompleted: boolean; flockActive: boolean } {
    this.time += dt;

    let opacity = 1;
    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt);
      opacity = 1 - this.fadeIn / BirdFlock.FADE_IN_SEC;
    }
    if (this.fadeDelay > 0) {
      this.fadeDelay = Math.max(0, this.fadeDelay - dt);
      if (this.fadeDelay <= 0) {
        this.fadeOut = BirdFlock.FADE_OUT_SEC;
      }
    }
    if (this.fadeOut > 0) {
      this.fadeOut = Math.max(0, this.fadeOut - dt);
      opacity *= this.fadeOut / BirdFlock.FADE_OUT_SEC;
      if (this.fadeOut <= 0) {
        this.group.visible = false;
      }
    }
    this.setFlockOpacity(opacity);

    const arc = (FLOCK_SPEED * dt) / this.globeRadius;
    this.leaderQ.copy(moveOnSphere(this.leaderQ, this.heading, arc));

    const frame = tangentFrame(this.leaderQ);
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    this.dir
      .copy(frame.north)
      .multiplyScalar(cos)
      .addScaledVector(frame.east, sin)
      .normalize();
    this.right
      .copy(frame.north)
      .multiplyScalar(-sin)
      .addScaledVector(frame.east, cos)
      .normalize();

    this.leaderPos.copy(
      cartesianFromSpherical(this.leaderQ, FLOCK_ALTITUDE, this.globeRadius),
    );

    const up = this.scratch.copy(this.leaderPos).normalize();

    const playerPos = cartesianFromSpherical(playerQ, playerAlt, this.globeRadius);
    let minDistToAnyDuck = Infinity;

    for (let i = 0; i < V_OFFSETS.length; i++) {
      const [back, lat] = V_OFFSETS[i]!;
      this.birdOffset
        .copy(this.dir)
        .multiplyScalar(back)
        .addScaledVector(this.right, lat);
      const duck = this.ducks[i]!;
      duck.root.position.copy(this.leaderPos).add(this.birdOffset);
      minDistToAnyDuck = Math.min(minDistToAnyDuck, playerPos.distanceTo(duck.root.position));

      duck.root.lookAt(duck.root.position.clone().add(this.dir));
      duck.root.up.copy(up);

      const flap = Math.sin(this.time * WING_FLAP_SPEED + duck.flapPhase) * WING_FLAP_AMP;
      duck.leftWing.rotation.x = flap;
      duck.rightWing.rotation.x = -flap;
    }

    this.slotPos
      .copy(this.leaderPos)
      .addScaledVector(this.dir, -SLOT_BACK)
      .addScaledVector(this.right, SLOT_LAT);

    if (this.rewardCooldown > 0) {
      this.rewardCooldown -= dt;
      if (this.rewardCooldown <= 0) {
        this.respawn((this.spawnSalt + 1) * 1103515245);
      }
      return { progress: 0, justCompleted: false, flockActive: true };
    }

    const distToSlot = playerPos.distanceTo(this.slotPos);
    const posOk =
      distToSlot < SLOT_DIST_MAX || minDistToAnyDuck < NEAR_ANY_DUCK_DIST;
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
    for (const duck of this.ducks) {
      duck.root.traverse((child) => {
        if ((child as Mesh).isMesh) {
          const m = child as Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mt) => mt.dispose());
          } else {
            m.material.dispose();
          }
        }
      });
    }
    this.ducks.length = 0;
    this.group.removeFromParent();
  }
}
