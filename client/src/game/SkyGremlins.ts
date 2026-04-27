import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Points,
  PointsMaterial,
  CanvasTexture,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
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
import { Trail } from "./Trail";

const GREMLIN_BASE_COUNT = 3;
const GREMLIN_MAX_COUNT = 5;
export const SKY_GREMLIN_XP = 30;
/** XP when the Gremlin King is defeated (10 hits). */
export const SKY_GREMLIN_KING_XP = 120;

const GREMLIN_SHOOTER_PREFIX = "gremlin:";
const GREMLIN_KING_SHOOTER_ID = "gremlin:king";
/** Sky gremlins shot down in a session before the Gremlin King appears (HUD quest tracker uses this). */
export const GREMLIN_TAKEDOWNS_FOR_KING = 7;
const GREMLIN_HP_MAX = 3;
const GREMLIN_KING_HP_MAX = 10;
const HP_BAR_W = 0.135;
/** Slightly thick strip; corner radius is just under H/2 for smooth stadium / pill ends. */
const HP_BAR_H = 0.0145;
/**
 * RoundedBoxGeometry clamps fillet radius to min(w,h,d)/2 — depth must be large enough
 * that d/2 allows the pill-radius above; otherwise corners look "sharp" / cut off.
 */
const HP_BAR_D = 0.014;
/** Higher = smoother fillets (less faceted / “sharp” rounded corners). */
const HP_BAR_SEGMENTS = 16;
const HP_BAR_CORNER_R = 0.0069;
const HP_BAR_INSET = 0.0025;
const HP_TWEEN_SPEED = 14;
/** World-space lift above root along planet radial, scaled with rig. */
const HP_BAR_RADIAL_LIFT = 0.12;
const HP_RIG_BASE = 0.7;
const GREMLIN_SURFACE_CLEARANCE = 0.2;
const GREMLIN_ALTITUDE_MIN = 0.52;
const GREMLIN_ALTITUDE_MAX = 0.65;
const GREMLIN_CRUISE_SPEED = 0.34;
const GREMLIN_CHASE_SPEED = 0.5;
const GREMLIN_BOB_SPEED = 2.8;
const GREMLIN_BOB_AMP = 0.08;
const GREMLIN_FLAP_SPEED = 11.5;
const GREMLIN_FLAP_AMP = 0.72;
const GREMLIN_DETECT_RANGE = 2.25;
const GREMLIN_STANDOFF_IDEAL = 1.15;
const GREMLIN_STANDOFF_MIN = 0.92;
const GREMLIN_STANDOFF_MAX = 1.45;
const GREMLIN_ORBIT_WEIGHT = 0.92;
const GREMLIN_RETREAT_WEIGHT = 1.25;
const GREMLIN_FIRE_RANGE = 1.6;
/** Gremlin King can engage the player from farther away. */
const GREMLIN_KING_FIRE_RANGE = 2.55;
/** Must be within ~35° of facing the player before firing. */
const GREMLIN_FIRE_DOT = 0.82;
/** Heading lerp rate (rad/s equivalent) when actively turning to face before a shot. */
const GREMLIN_AIM_TURN_RATE = 9.0;
/** Seconds between shots (randomized per burst). */
const GREMLIN_FIRE_COOLDOWN_MIN = 1.85;
const GREMLIN_FIRE_COOLDOWN_MAX = 2.95;
const GREMLIN_KING_FIRE_COOLDOWN_MIN = 2.5;
const GREMLIN_KING_FIRE_COOLDOWN_MAX = 3.85;
const GREMLIN_RESPAWN_MIN_SEC = 13.0;
const GREMLIN_RESPAWN_MAX_SEC = 19.0;
const GREMLIN_HIT_RADIUS = 0.16;
const PLAYER_HIT_RADIUS = 0.22;
const GREMLIN_FALL_SEC = 0.8;
const GREMLIN_FALL_SPEED = 0.95;
const GREMLIN_SHOT_SPEED = 2.85;
const GREMLIN_MUZZLE_FORWARD = 0.12;
const GREMLIN_MUZZLE_UP = -0.01;
const GREMLIN_AIM_SIDE_SPREAD = 0.24;

function rollGremlinFireCooldown(
  random: () => number,
  isKing: boolean,
  initialRespawn: boolean,
): number {
  const min = isKing
    ? GREMLIN_KING_FIRE_COOLDOWN_MIN
    : GREMLIN_FIRE_COOLDOWN_MIN;
  const max = isKing
    ? GREMLIN_KING_FIRE_COOLDOWN_MAX
    : GREMLIN_FIRE_COOLDOWN_MAX;
  return (initialRespawn ? 0.5 : min) + random() * (max - min);
}

/** After the player lands a non-lethal hit, this gremlin tries to shoot from farther out. */
const RETALIATE_DURATION_SEC = 5.5;
const RETALIATE_FIRE_RANGE_MULT = 1.48;
const RETALIATE_FIRE_DOT = 0.12;
const RETALIATE_COOLDOWN_CAP = 0.32;
/** Orbit band shifted outward so they keep range instead of diving in. */
const RETALIATE_STANDOFF_MIN = 1.02;
const RETALIATE_STANDOFF_IDEAL_NORMAL = 1.4;
const RETALIATE_STANDOFF_MAX_NORMAL = 1.86;
const RETALIATE_STANDOFF_MIN_KING = 1.08;
const RETALIATE_STANDOFF_IDEAL_KING = 1.58;
const RETALIATE_STANDOFF_MAX_KING = 2.12;

/** Embers at the Gremlin King trident prongs (local space, parented to trident). */
const KING_TRIDENT_EMBER_N = 44;

let kingTridentEmberSprite: CanvasTexture | null = null;

function getKingTridentEmberSprite(): CanvasTexture {
  if (kingTridentEmberSprite) return kingTridentEmberSprite;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) {
    const tex = new CanvasTexture(c);
    kingTridentEmberSprite = tex;
    return tex;
  }
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31.5);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  kingTridentEmberSprite = tex;
  return tex;
}

type KingTridentEmberVfx = {
  points: Points;
  mat: PointsMaterial;
  geometry: BufferGeometry;
  pos: Float32Array;
  life: Float32Array;
  seed: Float32Array;
  alpha: Float32Array;
};

type GremlinMode = "alive" | "falling" | "respawning" | "dormant";

type GremlinState = {
  readonly index: number;
  readonly id: string;
  /** World rig scale (0.7 normal, 1.4 king = 2× size). */
  baseRigScale: number;
  readonly isKing?: boolean;
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
  /** >0: prefer long-range shots and wide standoff after player paintball damage. */
  longRangeRetaliateSec: number;
  respawnSalt: number;
  respawnTimer: number;
  downTimer: number;
  worldPosition: Vector3;
  mode: GremlinMode;
  trail: Trail;
  maxHealth: number;
  /** Smoothed 0–1 HP (tweened toward health / maxHealth). */
  hpDisplay: number;
  hpBarRoot: Group;
  hpFillMesh: Mesh;
  hpBarInnerW: number;
  tridentEmberVfx: KingTridentEmberVfx | null;
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
  private readonly kingBodyMaterial = new MeshPhongMaterial({
    color: 0xe85a1a,
    emissive: 0x5a1808,
    flatShading: true,
  });
  private readonly kingBellyMaterial = new MeshPhongMaterial({
    color: 0xff9540,
    emissive: 0x7a2a08,
    flatShading: true,
  });
  private readonly kingWingMaterial = new MeshPhongMaterial({
    color: 0xd44810,
    emissive: 0x4a1204,
    flatShading: true,
    side: DoubleSide,
  });
  private readonly crownMaterial = new MeshPhongMaterial({
    color: 0xffcc33,
    emissive: 0x664400,
    flatShading: true,
  });
  private readonly crownGemMaterial = new MeshPhongMaterial({
    color: 0xff1122,
    emissive: 0x660000,
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
  private readonly crownGemGeo = new SphereGeometry(0.006, 4, 4);

  private readonly innerLeftWingGeo: BufferGeometry;
  private readonly outerLeftWingGeo: BufferGeometry;
  private readonly innerRightWingGeo: BufferGeometry;
  private readonly outerRightWingGeo: BufferGeometry;

  private readonly gremlins: GremlinState[] = [];
  private gremlinKing: GremlinState | null = null;
  private sessionGremlinKills = 0;
  private kingSpawned = false;
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
  private readonly hpBarPosScratch = new Vector3();
  private readonly hpBarUpScratch = new Vector3();
  private readonly hpBarCamQuat = new Quaternion();
  private currentPlayer: Plane | null = null;
  private readonly hpBarTrackGeo: RoundedBoxGeometry;
  private readonly hpBarFillGeo: RoundedBoxGeometry;
  private readonly hpBarTrackMat: MeshBasicMaterial;
  private readonly hpBarFillMat: MeshBasicMaterial;
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
    private readonly onGremlinKingSpawn?: () => void,
    private readonly onKingDefeated?: (worldPosition: Vector3) => void,
    /** Called on every local paintball hit that damages a gremlin; `isKill` is true on the killing shot. */
    private readonly onGremlinPaintballHit?: (isKing: boolean, isKill: boolean) => void,
    /** When a gremlin paintball hits the local player (after slow / splatter). */
    private readonly onLocalPlayerGremlinHit?: (isKing: boolean) => void,
  ) {
    this.group.visible = false;
    this.scene.add(this.group);

    addRimLight(this.bodyMaterial, 0xa2ef7b, 0.45, 2.8);
    addRimLight(this.bellyMaterial, 0xa2ef7b, 0.5, 2.8);
    addRimLight(this.wingMaterial, 0xe2a0ff, 0.35, 3.2);
    addRimLight(this.gearMaterial, 0x888888, 0.4, 3.0);
    addRimLight(this.toothMaterial, 0xffffff, 0.5, 2.5);
    addRimLight(this.kingBodyMaterial, 0xffaa66, 0.5, 2.8);
    addRimLight(this.kingBellyMaterial, 0xffcc88, 0.48, 2.8);
    addRimLight(this.kingWingMaterial, 0xff8844, 0.42, 3.0);
    addRimLight(this.crownMaterial, 0xffee88, 0.55, 2.6);
    addRimLight(this.crownGemMaterial, 0xff8888, 0.5, 2.5);

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

    this.hpBarTrackGeo = new RoundedBoxGeometry(
      HP_BAR_W,
      HP_BAR_H,
      HP_BAR_D,
      HP_BAR_SEGMENTS,
      HP_BAR_CORNER_R,
    );
    {
      const fillH = HP_BAR_H * 0.6;
      const fillD = HP_BAR_D * 0.45;
      const fillR = Math.min(HP_BAR_CORNER_R * 0.55, fillH * 0.48, fillD * 0.45);
      this.hpBarFillGeo = new RoundedBoxGeometry(1, fillH, fillD, HP_BAR_SEGMENTS, fillR);
    }
    this.hpBarTrackMat = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this.hpBarFillMat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    for (let i = 0; i < GREMLIN_MAX_COUNT; i++) {
      const gremlin = this.createGremlin(i);
      this.gremlins.push(gremlin);
      this.group.add(gremlin.root);
      this.scene.add(gremlin.trail.mesh);
      if (i < GREMLIN_BASE_COUNT) {
        this.respawnGremlin(gremlin, true);
      } else {
        gremlin.mode = "dormant";
        gremlin.root.visible = false;
      }
    }

    this.removeProjectileStepListener = this.paintballSystem.addProjectileStepListener((info) => {
      this.handleProjectileStep(info);
    });
  }

  /** Gremlins shot down this session (excluding the king). */
  getSessionGremlinKills(): number {
    return this.sessionGremlinKills;
  }

  setSuspended(suspended: boolean) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    this.group.visible = !suspended;
    if (suspended) {
      this.paintballSystem.clearProjectilesByShooterPrefix(GREMLIN_SHOOTER_PREFIX);
    }
  }

  update(dt: number, player: Plane, moonPhase: number, camera: Camera) {
    this.currentPlayer = player;
    this.currentPlayerWorldPos.copy(
      cartesianFromSpherical(player.qPosition, player.altitude, this.globeRadius),
    );
    if (this.suspended) return;

    const activeCount = moonPhase >= 0.75 ? GREMLIN_MAX_COUNT : GREMLIN_BASE_COUNT;
    const cameraPos = camera.position;

    this.time += dt;
    for (let i = 0; i < this.gremlins.length; i++) {
      const gremlin = this.gremlins[i]!;
      if (i >= activeCount) {
        if (gremlin.mode !== "dormant") {
          gremlin.mode = "dormant";
          gremlin.root.visible = false;
          gremlin.trail.mesh.visible = false;
        }
        continue;
      } else if (gremlin.mode === "dormant") {
        gremlin.mode = "respawning";
        gremlin.respawnTimer = gremlin.random() * 2.0;
      }

      if (gremlin.mode === "respawning") {
        gremlin.respawnTimer = Math.max(0, gremlin.respawnTimer - dt);
        if (gremlin.respawnTimer <= 0) {
          this.respawnGremlin(gremlin, false);
        }
        continue;
      }
      
      gremlin.trail.update(gremlin.worldPosition, cameraPos);

      if (gremlin.mode === "falling") {
        this.updateFallingGremlin(gremlin, dt);
        continue;
      }
      this.updateAliveGremlin(gremlin, dt, player, camera);
    }

    if (this.gremlinKing && this.gremlinKing.mode !== "dormant") {
      const g = this.gremlinKing;
      if (g.mode === "respawning") {
        g.respawnTimer = Math.max(0, g.respawnTimer - dt);
        if (g.respawnTimer <= 0) {
          this.respawnGremlin(g, false);
        }
      } else {
        g.trail.update(g.worldPosition, cameraPos);
        if (g.mode === "falling") {
          this.updateFallingGremlin(g, dt);
        } else if (g.mode === "alive") {
          this.updateAliveGremlin(g, dt, player, camera);
        }
      }
    }
  }

  dispose() {
    this.removeProjectileStepListener();
    this.paintballSystem.clearProjectilesByShooterPrefix(GREMLIN_SHOOTER_PREFIX);
    this.scene.remove(this.group);
    for (const gremlin of this.gremlins) {
      this.scene.remove(gremlin.trail.mesh);
      gremlin.trail.dispose();
    }
    if (this.gremlinKing) {
      this.scene.remove(this.gremlinKing.trail.mesh);
      this.gremlinKing.trail.dispose();
      if (this.gremlinKing.tridentEmberVfx) {
        SkyGremlins.disposeKingTridentEmberVfx(this.gremlinKing.tridentEmberVfx);
      }
      this.gremlinKing = null;
    }
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
    this.kingBodyMaterial.dispose();
    this.kingBellyMaterial.dispose();
    this.kingWingMaterial.dispose();
    this.crownMaterial.dispose();
    this.crownGemMaterial.dispose();
    this.hpBarTrackGeo.dispose();
    this.hpBarFillGeo.dispose();
    this.hpBarTrackMat.dispose();
    this.hpBarFillMat.dispose();
    this.crownGemGeo.dispose();
  }

  private createKingTridentEmberVfx(rnd: () => number): KingTridentEmberVfx {
    const n = KING_TRIDENT_EMBER_N;
    const pos = new Float32Array(n * 3);
    const life = new Float32Array(n);
    const seed = new Float32Array(n);
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i] = rnd();
      life[i] = rnd() * 0.22;
      this.resetKingTridentEmberParticle(pos, i, rnd);
      alpha[i] = 1;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(pos, 3));
    geometry.setAttribute("emberAlpha", new BufferAttribute(alpha, 1));
    const mat = new PointsMaterial({
      color: 0xffaa55,
      map: getKingTridentEmberSprite(),
      size: 0.038,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
        attribute float emberAlpha;
        varying float vEmberAlpha;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vEmberAlpha = emberAlpha;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
        varying float vEmberAlpha;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.a *= vEmberAlpha;`,
      );
    };
    const points = new Points(geometry, mat);
    points.frustumCulled = false;
    points.renderOrder = 8;
    return { points, mat, geometry, pos, life, seed, alpha };
  }

  private resetKingTridentEmberParticle(
    pos: Float32Array,
    i: number,
    rnd: () => number,
  ) {
    const prong = i % 3;
    const bx = prong === 0 ? 0 : prong === 1 ? -0.011 : 0.011;
    pos[i * 3] = bx + (rnd() - 0.5) * 0.014;
    pos[i * 3 + 1] = 0.088 + rnd() * 0.042;
    pos[i * 3 + 2] = (rnd() - 0.5) * 0.007;
  }

  private updateKingTridentEmberVfx(
    vfx: KingTridentEmberVfx,
    dt: number,
    rnd: () => number,
  ) {
    vfx.points.visible = true;
    const { pos, life, seed, alpha } = vfx;
    const t = this.time;
    const n = KING_TRIDENT_EMBER_N;
    const posAttr = vfx.geometry.attributes.position as BufferAttribute;
    const alphaAttr = vfx.geometry.attributes.emberAlpha as BufferAttribute;
    for (let i = 0; i < n; i++) {
      const maxLife = 0.3 + seed[i] * 0.2;
      life[i] += dt;
      if (life[i] >= maxLife) {
        life[i] = 0;
        this.resetKingTridentEmberParticle(pos, i, rnd);
        alpha[i] = 1;
      } else {
        const s = seed[i] * 50;
        const u = life[i] / maxLife;
        // Fade: strong at start, goes to 0 at end (smooth)
        alpha[i] = 1.0 - u * u * (3.0 - 2.0 * u);

        pos[i * 3 + 1] += 0.52 * dt;
        // Drift
        pos[i * 3] += Math.sin(t * 7 + s) * 0.02 * dt;
        pos[i * 3 + 2] += Math.cos(t * 5 + s * 0.7) * 0.016 * dt;
        // Jitter: small erratic nudges
        const j = 0.11 * dt;
        pos[i * 3] += (rnd() - 0.5) * j;
        pos[i * 3 + 1] += (rnd() - 0.5) * j * 0.35;
        pos[i * 3 + 2] += (rnd() - 0.5) * j;
        // High-frequency wobble
        const ph = t * 35 + s * 2.1;
        pos[i * 3] += Math.sin(ph) * 0.0009;
        pos[i * 3 + 2] += Math.cos(ph * 0.86 + 1.2) * 0.00075;
        pos[i * 3 + 1] += Math.sin(ph * 1.1) * 0.0004;
      }
    }
    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  private static disposeKingTridentEmberVfx(vfx: KingTridentEmberVfx) {
    vfx.mat.dispose();
    vfx.geometry.dispose();
    vfx.points.removeFromParent();
  }

  private createGremlin(index: number, king = false): GremlinState {
    const bodyMat = king ? this.kingBodyMaterial : this.bodyMaterial;
    const bellyMat = king ? this.kingBellyMaterial : this.bellyMaterial;
    const wingMat = king ? this.kingWingMaterial : this.wingMaterial;
    const baseRigScale = king ? 1.4 : 0.7;
    let tridentEmberVfx: KingTridentEmberVfx | null = null;

    const root = new Group();
    root.matrixAutoUpdate = false;

    const rig = new Group();
    rig.scale.setScalar(baseRigScale);
    root.add(rig);

    const body = new Mesh(this.bodyGeo, bodyMat);
    body.scale.set(1.0, 1.2, 0.9);
    body.rotation.x = 0.3;
    body.castShadow = true;
    rig.add(body);

    const head = new Mesh(this.headGeo, bodyMat);
    head.position.set(0, 0.06, 0.05);
    head.scale.set(1.2, 0.9, 1.1);
    head.rotation.x = -0.2;
    head.castShadow = true;
    rig.add(head);

    const brow = new Mesh(this.browGeo, bodyMat);
    brow.position.set(0, 0.08, 0.085);
    brow.rotation.z = Math.PI / 2;
    brow.rotation.x = 0.2;
    brow.castShadow = true;
    rig.add(brow);

    const snout = new Mesh(this.snoutGeo, bodyMat);
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

    const leftEar = new Mesh(this.earGeo, bellyMat);
    leftEar.position.set(-0.045, 0.07, 0.03);
    leftEar.rotation.set(-0.2, -0.4, 1.2);
    leftEar.castShadow = true;
    rig.add(leftEar);

    const rightEar = new Mesh(this.earGeo, bellyMat);
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

    const leftArm = new Mesh(this.limbGeo, bodyMat);
    leftArm.position.set(-0.04, 0.01, 0.04);
    leftArm.rotation.set(-1.0, 0.3, 0.4);
    leftArm.castShadow = true;
    rig.add(leftArm);

    const rightArm = new Mesh(this.limbGeo, bodyMat);
    rightArm.position.set(0.04, 0.01, 0.04);
    rightArm.rotation.set(-1.0, -0.3, -0.4);
    rightArm.castShadow = true;
    rig.add(rightArm);

    if (!king) {
      const gun = new Mesh(this.gunGeo, this.gearMaterial);
      gun.position.set(0, -0.01, 0.08);
      gun.rotation.x = Math.PI / 2;
      gun.castShadow = true;
      rig.add(gun);
    }

    const leftLeg = new Mesh(this.limbGeo, bodyMat);
    leftLeg.position.set(-0.03, -0.06, -0.02);
    leftLeg.rotation.set(0.2, 0, 0.2);
    leftLeg.castShadow = true;
    rig.add(leftLeg);

    const rightLeg = new Mesh(this.limbGeo, bodyMat);
    rightLeg.position.set(0.03, -0.06, -0.02);
    rightLeg.rotation.set(0.2, 0, -0.2);
    rightLeg.castShadow = true;
    rig.add(rightLeg);

    const leftWingPivot = new Group();
    leftWingPivot.position.set(-0.03, 0.04, -0.04);
    rig.add(leftWingPivot);

    const innerLeftWing = new Mesh(this.innerLeftWingGeo, wingMat);
    innerLeftWing.castShadow = true;
    leftWingPivot.add(innerLeftWing);

    const leftWingMidPivot = new Group();
    leftWingMidPivot.position.set(-0.08, 0, 0.04);
    leftWingPivot.add(leftWingMidPivot);

    const outerLeftWing = new Mesh(this.outerLeftWingGeo, wingMat);
    outerLeftWing.castShadow = true;
    leftWingMidPivot.add(outerLeftWing);

    const rightWingPivot = new Group();
    rightWingPivot.position.set(0.03, 0.04, -0.04);
    rig.add(rightWingPivot);

    const innerRightWing = new Mesh(this.innerRightWingGeo, wingMat);
    innerRightWing.castShadow = true;
    rightWingPivot.add(innerRightWing);

    const rightWingMidPivot = new Group();
    rightWingMidPivot.position.set(0.08, 0, 0.04);
    rightWingPivot.add(rightWingMidPivot);

    const outerRightWing = new Mesh(this.outerRightWingGeo, wingMat);
    outerRightWing.castShadow = true;
    rightWingMidPivot.add(outerRightWing);

    if (king) {
      const crown = new Group();
      crown.position.set(0, 0.095, 0.05);
      crown.rotation.x = -0.1;

      const band = new Mesh(new CylinderGeometry(0.045, 0.045, 0.02, 8), this.crownMaterial);
      band.castShadow = true;
      crown.add(band);

      const numSpikes = 6;
      for (let s = 0; s < numSpikes; s++) {
        const spikeGroup = new Group();
        const a = (s / numSpikes) * Math.PI * 2;
        spikeGroup.position.set(Math.sin(a) * 0.042, 0.02, Math.cos(a) * 0.042);
        spikeGroup.rotation.set(0.2, a, 0, "YXZ");

        const spike = new Mesh(new ConeGeometry(0.015, 0.04, 4), this.crownMaterial);
        spike.castShadow = true;
        spikeGroup.add(spike);

        const gem = new Mesh(this.crownGemGeo, this.crownGemMaterial);
        gem.position.set(0, 0.02, 0);
        gem.castShadow = true;
        spikeGroup.add(gem);

        crown.add(spikeGroup);
      }
      rig.add(crown);

      const trident = new Group();
      trident.position.set(0.05, 0.02, 0.06);
      trident.rotation.set(0.6, 0, -0.4);

      const handle = new Mesh(new CylinderGeometry(0.004, 0.004, 0.2, 5), this.crownMaterial);
      handle.castShadow = true;
      trident.add(handle);

      const headBase = new Mesh(new BoxGeometry(0.03, 0.01, 0.01), this.crownMaterial);
      headBase.position.set(0, 0.1, 0);
      headBase.castShadow = true;
      trident.add(headBase);

      const centerProng = new Mesh(new ConeGeometry(0.006, 0.04, 4), this.crownMaterial);
      centerProng.position.set(0, 0.12, 0);
      centerProng.castShadow = true;
      trident.add(centerProng);

      const leftProng = new Mesh(new ConeGeometry(0.004, 0.03, 4), this.crownMaterial);
      leftProng.position.set(-0.012, 0.115, 0);
      leftProng.castShadow = true;
      trident.add(leftProng);

      const rightProng = new Mesh(new ConeGeometry(0.004, 0.03, 4), this.crownMaterial);
      rightProng.position.set(0.012, 0.115, 0);
      rightProng.castShadow = true;
      trident.add(rightProng);

      const flameMat = new MeshPhongMaterial({
        color: 0xffaa00,
        emissive: 0xff4400,
        emissiveIntensity: 2.0,
        transparent: true,
        opacity: 0.9,
      });
      const flame = new Mesh(new ConeGeometry(0.015, 0.05, 5), flameMat);
      flame.position.set(0, 0.13, 0);
      trident.add(flame);

      tridentEmberVfx = this.createKingTridentEmberVfx(
        seededRandom(this.seed + index * 104729 + 55117),
      );
      trident.add(tridentEmberVfx.points);

      rig.add(trident);
    }

    const maxHealth = king ? GREMLIN_KING_HP_MAX : GREMLIN_HP_MAX;
    const innerW = HP_BAR_W - 2 * HP_BAR_INSET;

    const hpBarRoot = new Group();
    const hpTrack = new Mesh(this.hpBarTrackGeo, this.hpBarTrackMat);
    hpTrack.position.z = 0.0001;
    hpTrack.renderOrder = 6;
    const hpFillMesh = new Mesh(this.hpBarFillGeo, this.hpBarFillMat);
    hpFillMesh.position.z = 0.0002;
    hpFillMesh.renderOrder = 7;
    hpBarRoot.add(hpTrack);
    hpBarRoot.add(hpFillMesh);
    hpBarRoot.visible = false;
    this.group.add(hpBarRoot);

    const random = seededRandom(this.seed + index * 104729 + 17);
    return {
      index,
      id: king ? GREMLIN_KING_SHOOTER_ID : `${GREMLIN_SHOOTER_PREFIX}${index}`,
      baseRigScale,
      isKing: king ? true : undefined,
      root,
      rig,
      leftWingPivot,
      rightWingPivot,
      leftWingMidPivot,
      rightWingMidPivot,
      random,
      orbitSign: random() < 0.5 ? -1 : 1,
      paintColor: king
        ? 0xff6600
        : PAINTBALL_COLOR_PALETTE[
            Math.floor(random() * PAINTBALL_COLOR_PALETTE.length)
          ]!,
      qPosition: new Quaternion(),
      heading: 0,
      altitude: GREMLIN_ALTITUDE_MIN,
      baseAltitude: GREMLIN_ALTITUDE_MIN,
      flapPhase: random() * Math.PI * 2,
      bobPhase: random() * Math.PI * 2,
      turnPhase: random() * Math.PI * 2,
      fireCooldown: rollGremlinFireCooldown(random, king === true, true),
      aimTimer: 0,
      health: maxHealth,
      maxHealth,
      hpDisplay: 1,
      hpBarRoot,
      hpFillMesh,
      hpBarInnerW: innerW,
      hitWobbleAmp: 0,
      hitWobblePhase: 0,
      longRangeRetaliateSec: 0,
      respawnSalt: 0,
      respawnTimer: 0,
      downTimer: 0,
      worldPosition: new Vector3(),
      mode: "respawning",
      trail: king
        ? new Trail(32, 0.038, 0xff6600)
        : new Trail(16, 0.015, 0x88aa88),
      tridentEmberVfx,
    };
  }

  private spawnGremlinKing() {
    if (this.gremlinKing) return;
    this.gremlinKing = this.createGremlin(100, true);
    this.group.add(this.gremlinKing.root);
    this.scene.add(this.gremlinKing.trail.mesh);
    this.respawnGremlin(this.gremlinKing, true);
    this.onGremlinKingSpawn?.();
  }

  private respawnGremlin(gremlin: GremlinState, initial: boolean) {
    let spawned = false;
    let attempts = 0;
    
    while (!spawned && attempts < 10) {
      const spawn = randomSpawnQuaternionAndHeading(
        this.seed + gremlin.index * 982451653 + gremlin.respawnSalt * 7919,
      );
      gremlin.respawnSalt += 1;
      
      if (this.currentPlayer) {
        const spawnPos = cartesianFromSpherical(spawn.qPosition, GREMLIN_ALTITUDE_MIN, this.globeRadius);
        const distSq = spawnPos.distanceToSquared(this.currentPlayerWorldPos);
        // Require at least ~2.5 units away (6.25 squared) to avoid popping in front of player
        if (distSq > 6.25) {
          gremlin.qPosition.copy(spawn.qPosition);
          gremlin.heading = spawn.heading;
          spawned = true;
        }
      } else {
        gremlin.qPosition.copy(spawn.qPosition);
        gremlin.heading = spawn.heading;
        spawned = true;
      }
      attempts++;
    }

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
    gremlin.fireCooldown = rollGremlinFireCooldown(
      gremlin.random,
      gremlin.isKing === true,
      initial,
    );
    gremlin.aimTimer = 0;
    gremlin.health = gremlin.maxHealth;
    gremlin.hpDisplay = 1;
    gremlin.hitWobbleAmp = 0;
    gremlin.hitWobblePhase = 0;
    gremlin.longRangeRetaliateSec = 0;
    gremlin.mode = "alive";
    gremlin.downTimer = 0;
    gremlin.root.visible = true;
    gremlin.trail.mesh.visible = true;
    if (gremlin.isKing && gremlin.tridentEmberVfx) {
      gremlin.tridentEmberVfx.points.visible = true;
    }
    gremlin.rig.position.set(0, 0, 0);
    gremlin.rig.rotation.set(0, 0, 0);
    gremlin.rig.scale.setScalar(gremlin.baseRigScale);
    this.updateGremlinTransform(gremlin, 0);
  }

  private updateAliveGremlin(gremlin: GremlinState, dt: number, player: Plane, camera: Camera) {
    gremlin.fireCooldown = Math.max(0, gremlin.fireCooldown - dt);
    if (gremlin.longRangeRetaliateSec > 0) {
      gremlin.longRangeRetaliateSec = Math.max(0, gremlin.longRangeRetaliateSec - dt);
    }
    const retaliate = gremlin.longRangeRetaliateSec > 0;
    const standMin = retaliate
      ? gremlin.isKing
        ? RETALIATE_STANDOFF_MIN_KING
        : RETALIATE_STANDOFF_MIN
      : GREMLIN_STANDOFF_MIN;
    const standMax = retaliate
      ? gremlin.isKing
        ? RETALIATE_STANDOFF_MAX_KING
        : RETALIATE_STANDOFF_MAX_NORMAL
      : GREMLIN_STANDOFF_MAX;
    const standIdeal = retaliate
      ? gremlin.isKing
        ? RETALIATE_STANDOFF_IDEAL_KING
        : RETALIATE_STANDOFF_IDEAL_NORMAL
      : GREMLIN_STANDOFF_IDEAL;

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
      if (distanceToPlayer < standMin) {
        approachWeight = -GREMLIN_RETREAT_WEIGHT;
        orbitWeight = 0.38;
        moveSpeed = GREMLIN_CHASE_SPEED * 1.08;
      } else if (distanceToPlayer > standMax) {
        approachWeight = retaliate ? 0.65 : 0.9;
        orbitWeight = 0.56;
        moveSpeed = GREMLIN_CHASE_SPEED;
      } else {
        const halfBand = Math.max(0.08, (standMax - standMin) * 0.5);
        approachWeight =
          ((distanceToPlayer - standIdeal) / halfBand) * 0.28;
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
    this.updateGremlinHpBar(gremlin, dt, camera);

    this.directionScratch
      .copy(this.currentPlayerWorldPos)
      .sub(gremlin.worldPosition);
    const fireDistance = this.directionScratch.length();
    const baseFireRange = gremlin.isKing
      ? GREMLIN_KING_FIRE_RANGE
      : GREMLIN_FIRE_RANGE;
    const fireRange = retaliate ? baseFireRange * RETALIATE_FIRE_RANGE_MULT : baseFireRange;
    const fireDot = retaliate ? RETALIATE_FIRE_DOT : GREMLIN_FIRE_DOT;
    if (
      fireDistance <= fireRange &&
      fireDistance > 1e-4 &&
      gremlin.fireCooldown <= 0
    ) {
      this.directionScratch.divideScalar(fireDistance);

      // Turn to face the player before shooting: project player direction onto the
      // tangent plane and lerp the gremlin's heading toward that bearing quickly.
      this.orbitScratch.copy(this.directionScratch);
      this.orbitScratch.addScaledVector(movedFrame.up, -this.orbitScratch.dot(movedFrame.up));
      if (this.orbitScratch.lengthSq() > 1e-5) {
        this.orbitScratch.normalize();
        const aimHeading = Math.atan2(
          this.orbitScratch.dot(movedFrame.east),
          this.orbitScratch.dot(movedFrame.north),
        );
        gremlin.heading = lerpAngle(gremlin.heading, aimHeading, Math.min(1, GREMLIN_AIM_TURN_RATE * dt));
      }

      this.forwardFromHeading(gremlin.qPosition, gremlin.heading, this.forwardScratch);
      if (this.forwardScratch.dot(this.directionScratch) >= fireDot) {
        gremlin.aimTimer += dt;
        if (gremlin.aimTimer >= 0.45) {
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
            speed: GREMLIN_SHOT_SPEED * (gremlin.isKing ? 0.94 : 1),
            ballRadius: gremlin.isKing ? 0.076 : undefined,
            splatterScale: gremlin.isKing ? 2 : undefined,
          });
          gremlin.fireCooldown = rollGremlinFireCooldown(
            gremlin.random,
            gremlin.isKing === true,
            false,
          );
        }
      } else {
        gremlin.aimTimer = 0;
      }
    } else {
      gremlin.aimTimer = 0;
    }

    if (gremlin.isKing && gremlin.tridentEmberVfx) {
      this.updateKingTridentEmberVfx(
        gremlin.tridentEmberVfx,
        dt,
        gremlin.random,
      );
    }
  }

  private updateFallingGremlin(gremlin: GremlinState, dt: number) {
    if (gremlin.isKing && gremlin.tridentEmberVfx) {
      gremlin.tridentEmberVfx.points.visible = false;
    }
    gremlin.hpBarRoot.visible = false;
    gremlin.downTimer = Math.max(0, gremlin.downTimer - dt);
    
    if (gremlin.downTimer < 0.2) {
      gremlin.rig.scale.setScalar(
        gremlin.baseRigScale * (gremlin.downTimer / 0.2),
      );
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
      if (gremlin.isKing) {
        gremlin.mode = "dormant";
        gremlin.root.visible = false;
        gremlin.trail.mesh.visible = false;
        return;
      }
      gremlin.mode = "respawning";
      gremlin.respawnTimer =
        GREMLIN_RESPAWN_MIN_SEC +
        gremlin.random() * (GREMLIN_RESPAWN_MAX_SEC - GREMLIN_RESPAWN_MIN_SEC);
      gremlin.root.visible = false;
      gremlin.trail.mesh.visible = false;
    }
  }

  private updateGremlinHpBar(gremlin: GremlinState, dt: number, camera: Camera) {
    const maxH = gremlin.maxHealth;
    const target = gremlin.health <= 0 ? 0 : gremlin.health / maxH;
    gremlin.hpDisplay += (target - gremlin.hpDisplay) * Math.min(1, HP_TWEEN_SPEED * dt);

    const innerW = gremlin.hpBarInnerW;
    const r = Math.max(0, Math.min(1, gremlin.hpDisplay));

    const show =
      gremlin.mode === "alive" &&
      gremlin.health > 0 &&
      (gremlin.health < maxH || r < 0.998);
    gremlin.hpBarRoot.visible = show;
    if (!show) return;

    const rw = Math.max(0.001, innerW * r);
    gremlin.hpFillMesh.scale.set(rw, 1, 1);
    gremlin.hpFillMesh.position.x = -innerW * 0.5 + rw * 0.5;

    const lift = HP_BAR_RADIAL_LIFT * (gremlin.baseRigScale / HP_RIG_BASE);
    this.hpBarUpScratch.copy(gremlin.worldPosition).normalize();
    this.hpBarPosScratch
      .copy(gremlin.worldPosition)
      .addScaledVector(this.hpBarUpScratch, lift);
    gremlin.hpBarRoot.position.copy(this.hpBarPosScratch);
    camera.getWorldQuaternion(this.hpBarCamQuat);
    gremlin.hpBarRoot.quaternion.copy(this.hpBarCamQuat);
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
        Math.sin(this.time * GREMLIN_BOB_SPEED + gremlin.bobPhase) * 0.055;
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
      this.paintballSystem.triggerLocalPlayerHit(
        this.currentPlayer.group,
        info.color,
        undefined,
        {
          splatterScale: info.splatterScale ?? 1,
          fromGremlin: true,
          gremlinKing: info.shooterId === GREMLIN_KING_SHOOTER_ID,
        },
      );
      if (info.shooterId === GREMLIN_KING_SHOOTER_ID) {
        this.currentPlayer.applyGremlinKingSlow();
      } else {
        this.currentPlayer.applyGremlinSlow();
      }
      this.onLocalPlayerGremlinHit?.(info.shooterId === GREMLIN_KING_SHOOTER_ID);
      return;
    }

    const localId = this.getLocalShooterId();
    const isLocalShot =
      info.shooterId === (localId ?? "local") ||
      (!localId && info.shooterId === "local");
    if (!isLocalShot) return;

    const hitR = (g: GremlinState) =>
      GREMLIN_HIT_RADIUS * (g.isKing ? 2 : 1);

    const targets: GremlinState[] = [];
    for (const g of this.gremlins) {
      if (g.mode === "alive") targets.push(g);
    }
    if (this.gremlinKing?.mode === "alive") targets.push(this.gremlinKing);

    for (const gremlin of targets) {
      if (
        !this.segmentHitsSphere(
          info.previousPosition,
          info.currentPosition,
          gremlin.worldPosition,
          hitR(gremlin),
        )
      ) {
        continue;
      }
      info.consume();
      this.paintballSystem.playImpactAtGroup(gremlin.root, info.color, false);

      gremlin.health--;
      const isKill = gremlin.health <= 0;
      this.onGremlinPaintballHit?.(gremlin.isKing === true, isKill);
      if (isKill) {
        gremlin.mode = "falling";
        gremlin.downTimer = GREMLIN_FALL_SEC;
        if (gremlin.isKing) {
          this.onKingDefeated?.(gremlin.worldPosition.clone());
        } else {
          this.onShotDown(gremlin.worldPosition.clone());
          this.sessionGremlinKills++;
          if (
            this.sessionGremlinKills >= GREMLIN_TAKEDOWNS_FOR_KING &&
            !this.kingSpawned
          ) {
            this.kingSpawned = true;
            this.spawnGremlinKing();
          }
        }
      } else {
        gremlin.hitWobbleAmp = 0.85;
        gremlin.hitWobblePhase = 0;
        gremlin.longRangeRetaliateSec = RETALIATE_DURATION_SEC;
        gremlin.fireCooldown = Math.min(gremlin.fireCooldown, RETALIATE_COOLDOWN_CAP);
        this.onHit(gremlin.worldPosition.clone());
      }
      break;
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
