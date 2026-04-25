import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  BoxGeometry,
  DoubleSide,
  Group,
  NearestFilter,
  NormalBlending,
  LatheGeometry,
  Mesh,
  MeshPhongMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { BRAZIER_BURN_MS, BRAZIER_COUNT } from "@globefly/shared";
import { PROP_TERRAIN_SINK, surfaceDisplacementAt } from "./TerrainSurface";
import { isLand } from "./SimplexNoise";
import { addRimLight } from "./RimLight";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export { BRAZIER_COUNT };

export interface SavedBrazierState {
  revealed: boolean;
  burnEndsAtMs: (number | null)[];
  /** True = that slot burns forever (eternal flame). */
  burnEternal?: boolean[];
}

const BURN_DURATION_SEC = BRAZIER_BURN_MS / 1000;
const FADE_IN_DUR       = 0.50; // seconds for pop-in
const FADE_OUT_DUR      = 3.50; // seconds for slow extinguish
const LIGHT_RADIUS      = 1.2;

/* Brazier dimensions — 60 % shorter than original design */
const POLE_H     = 0.152;
const BOWL_H     = 0.055;
const BOWL_RIM_R = 0.065;
const RIM_RING_R = 0.070;
const FLAME_W    = 0.14;
const FLAME_H    = 0.22;
/** Raised so the flame quad clears the bowl rim — reduces the straight “crop” line. */
const FLAME_Y = POLE_H + BOWL_H + FLAME_H * 0.58;
const FLAME_GLOW_Y = FLAME_Y - FLAME_H * 0.18;
const FLAME_LIGHT_Y = FLAME_Y - FLAME_H * 0.28;

/** Sink brazier along surface normal so it sits slightly embedded in terrain */
const BRAZIER_GROUND_SINK = 0.038;
/** Start fully buried below the surface, then rise into place during the reveal cutscene. */
const BRAZIER_REVEAL_DEPTH = 0.24;
/** Further slowed so the brazier montage still catches the rise in progress. */
const BRAZIER_REVEAL_SEC = 4.4;
/** Keep the ripple between sites proportionally slower too. */
const BRAZIER_REVEAL_STAGGER_SEC = 0.42;

/* Inland placement: ring-sample radius (in unit-normal space) and max water ratio */
const INLAND_CHECK_DIST  = 0.10;   // ≈ 0.5 world units on a radius-5 globe
const INLAND_CHECKS      = 12;
const MAX_WATER_RATIO    = 0.0;    // all ring samples must be land (strict pass)
const MAX_WATER_FALLBACK = 0.167;  // relax if strict pass can't place all braziers

/**
 * Minimum angular separation between any two braziers, in dot-product terms.
 * cos(55°) ≈ 0.574 → braziers at least ~4.8 world units apart on a radius-5 globe.
 * Falls back to cos(38°) ≈ 0.788 if the terrain is too constrained.
 */
const MIN_SEP_DOT          = Math.cos(55 * (Math.PI / 180)); // ~0.574
const MIN_SEP_DOT_FALLBACK = Math.cos(38 * (Math.PI / 180)); // ~0.788

const REF_UP = new Vector3(0, 1, 0);

/** Orange ember particles per brazier — rise through the flame column */
const EMBER_COUNT = 36;
/** Aligned to flame base (just above bottom of flame quad) — moves up with FLAME_Y. */
const EMBER_ORIGIN_Y = FLAME_Y - FLAME_H * 0.5 + 0.012;
/** Local Y travel: past the flame tip so embers keep rising well above the fire */
const EMBER_RISE_MAX = (FLAME_Y + FLAME_H * 0.5) - EMBER_ORIGIN_Y + FLAME_H * 1.05;

/** Bright orange (RGB) — opacity handles fade, not these */
const EMBER_ORANGE = { r: 1.0, g: 0.72, b: 0.22 } as const;

/* ── Billboard shaders — vertical axis locked to globe surface normal ── */

/*
 * Cylindrical billboard: horizontal tracks camera; vertical stays locked to the
 * globe surface normal (model-matrix Y column). uBurnScale drives the pop-in.
 * uTime adds sway / flutter so the flame feels alive.
 */
const billboardVert = /* glsl */ `
varying vec2 vUv;
uniform float uBurnScale;
uniform float uTime;
uniform float uEternal;
void main() {
  vUv = uv;
  float eternalBoost = 1.0 + uEternal * 0.38;
  float scale = uBurnScale * eternalBoost;
  vec3 upAxis     = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vec3 worldCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCamera   = normalize(cameraPosition - worldCenter);
  vec3 forward    = normalize(toCamera - dot(toCamera, upAxis) * upAxis);
  vec3 right      = normalize(cross(upAxis, forward));
  float h = position.y + 0.52;
  float sway   = sin(uTime * 7.8  + h * 16.0) * 0.018 * h * h;
  float sway2  = sin(uTime * 15.2 - h * 22.0) * 0.008 * h * h;
  float flutter = sin(uTime * 21.0 + position.x * 38.0) * 0.005 * h;
  vec3 vertPos = worldCenter
    + right  * (position.x * scale + sway + sway2 + flutter)
    + upAxis * (position.y * scale);
  gl_Position = projectionMatrix * viewMatrix * vec4(vertPos, 1.0);
}
`;

const flameFrag = /* glsl */ `
uniform float uTime;
uniform float uBurn;
uniform float uEternal;
varying vec2 vUv;

void main() {
  float cy = vUv.y;
  // Turbulent wobble — stronger toward the flame tip
  float tip = cy * cy;
  float turbX = sin(uTime * 10.5 + cy * 20.0) * 0.045 * tip
              + sin(uTime * 17.0 - cy * 28.0) * 0.028 * tip;
  float turbY = sin(uTime * 8.2 + vUv.x * 12.0) * 0.012 * tip;
  float cx = vUv.x - 0.5 + turbX;
  cy = clamp(cy + turbY, 0.0, 1.0);

  float taper = mix(0.45, 0.06, cy * cy);
  float d = abs(cx) / max(taper, 0.001);

  float core = 1.0 - smoothstep(0.0, 0.65, d);
  float halo = 1.0 - smoothstep(0.0, 1.5, d);

  float heightFade = 1.0 - smoothstep(0.28, 1.0, cy);
  /* Soft, wavy bottom — the flame quad is a rectangle; without this, alpha hits the bowl along one
   * straight UV row and reads as a hard “crop”. Wobble + wide smoothstep breaks that line. */
  float baseWobble = 0.052 * sin(vUv.x * 18.0 + uTime * 4.5) + 0.034 * sin(vUv.x * 31.0 - uTime * 3.0);
  float baseFade   = smoothstep(0.0, 0.32, cy + baseWobble);

  float f1 = sin(uTime * 7.1  + vUv.x * 9.0 + vUv.y * 4.5) * 0.5 + 0.5;
  float f2 = sin(uTime * 13.7 - vUv.x * 6.0 + vUv.y * 8.2) * 0.5 + 0.5;
  float f3 = sin(uTime * 19.3 + vUv.x * 3.5 - vUv.y * 11.0) * 0.5 + 0.5;
  float f4 = sin(uTime * 24.0 + cy * 30.0) * 0.5 + 0.5;
  float flicker = f1 * 0.42 + f2 * 0.26 + f3 * 0.18 + f4 * 0.14;

  vec3 red    = vec3(0.88, 0.12, 0.0);
  vec3 orange = vec3(1.00, 0.42, 0.02);
  vec3 yellow = vec3(1.00, 0.90, 0.18);

  vec3 colWarm = mix(orange, red,    smoothstep(0.4, 1.0, cy));
  colWarm      = mix(colWarm, yellow, core * (1.0 - cy * 0.8));
  colWarm     += vec3(0.38, 0.14, 0.02) * flicker * core;
  colWarm     += vec3(0.12, 0.05, 0.0) * sin(uTime * 31.0 + cy * 40.0) * core;

  /* Strong blue eternal flame (deeper body, icy highlight). */
  vec3 blueDeep = vec3(0.02, 0.22, 0.94);
  vec3 blueMid  = vec3(0.1, 0.48, 1.0);
  vec3 blueTip  = vec3(0.62, 0.86, 1.0);
  vec3 colEternal = mix(blueMid, blueDeep, smoothstep(0.3, 1.0, cy));
  colEternal      = mix(colEternal, blueTip, core * (1.0 - cy * 0.75));
  colEternal     += vec3(0.06, 0.32, 0.88) * flicker * core;
  colEternal     += vec3(0.04, 0.22, 0.72) * sin(uTime * 31.0 + cy * 40.0) * core;

  vec3 col = mix(colWarm, colEternal, uEternal);

  float alpha = (core * 0.92 + halo * 0.18) * heightFade * baseFade;
  alpha *= 0.78 + flicker * 0.22;
  alpha *= mix(1.0, 1.14, uEternal);
  alpha *= uBurn;

  gl_FragColor = vec4(col * mix(2.85, 3.15, uEternal), alpha);
}
`;

const glowFrag = /* glsl */ `
uniform float uTime;
uniform float uBurn;
uniform float uEternal;
varying vec2 vUv;

void main() {
  vec2 gc = vUv - vec2(0.5, 0.30);
  gc.x += sin(uTime * 5.5 + vUv.y * 8.0) * 0.04 * vUv.y;
  float d = length(gc) * 2.2;
  float glow = 1.0 - smoothstep(0.0, 1.0, d);
  float pulse = 0.72 + 0.28 * sin(uTime * 3.1) + 0.08 * sin(uTime * 11.0);
  vec3 colWarm = vec3(1.0, 0.14, 0.12);
  vec3 colEternal = vec3(0.12, 0.58, 1.0);
  vec3 col = mix(colWarm, colEternal, uEternal);
  float glowBase = smoothstep(0.0, 0.34, vUv.y + 0.045 * sin(vUv.x * 15.0 + uTime * 4.2));
  float alpha = glow * glow * pulse * uBurn * 0.52 * glowBase;
  alpha *= mix(1.0, 1.22, uEternal);
  gl_FragColor = vec4(col * mix(2.0, 2.35, uEternal), alpha);
}
`;

/* PointsMaterial only multiplies RGB — sparks never faded to transparent. Per-particle alpha here. */
const emberVert = /* glsl */ `
attribute vec3 color;
attribute float opacity;
varying vec3 vColor;
varying float vOpacity;
uniform float size;
uniform float scale;
void main() {
  vColor = color;
  vOpacity = opacity;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (scale / max(-mvPosition.z, 1e-3));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const emberFrag = /* glsl */ `
uniform sampler2D map;
varying vec3 vColor;
varying float vOpacity;
void main() {
  vec4 tex = texture2D(map, gl_PointCoord);
  if (tex.a < 0.01) discard;
  float a = tex.a * vOpacity;
  if (a < 0.0005) discard;
  vec3 rgb = min(vColor * tex.rgb * 1.12, vec3(1.0));
  gl_FragColor = vec4(rgb, a);
}
`;

/* ── Per-brazier state ───────────────────────────────────────────── */

interface BrazierState {
  group: Group;
  normal: Vector3;
  /** Final above-ground placement once the reveal is complete. */
  restPosition: Vector3;
  /** Delay before this brazier starts rising once reveal begins. */
  revealDelay: number;
  flameMesh: Mesh;
  glowMesh: Mesh;
  flameMat: ShaderMaterial;
  glowMat: ShaderMaterial;
  light: PointLight;
  emberPoints: Points;
  emberGeo: BufferGeometry;
  emberPos: Float32Array;
  emberBaseX: Float32Array;
  emberBaseZ: Float32Array;
  emberSpd: Float32Array;
  emberPhase: Float32Array;
  emberCol: Float32Array;
  emberOpacity: Float32Array;
  /** Bowl-top world position — proximity trigger centre. */
  worldPos: Vector3;
  lit: boolean;
  /** Wall-clock ms when burn ends; null when unlit or eternal. */
  burnEndsAtMs: number | null;
  /** Gremlin King eternal flame — never expires. */
  eternal: boolean;
  time: number;
  /** 0 → 1 over FADE_IN_DUR on ignition; drives pop-in. */
  fadeInT: number;
  /** 0 → 1 over FADE_OUT_DUR after burnTimer expires. */
  fadeOutT: number;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Ease-out-back: overshoots ~1.15 at t≈0.55 then settles to 1.0. */
function popScale(fadeInT: number): number {
  if (fadeInT <= 0) return 0;
  if (fadeInT < 0.55) return (fadeInT / 0.55) * 1.15;
  return 1.15 - ((fadeInT - 0.55) / 0.45) * 0.15;
}

/** Similar overshoot for the structural "rises out of the ground" reveal. */
function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/* ── Class ───────────────────────────────────────────────────────── */

export class Braziers {
  private states: BrazierState[] = [];
  private scene: Scene;
  private revealStarted = false;
  private revealComplete = false;
  private revealTimer = 0;

  /* shared geometry */
  private ironGeo!: BufferGeometry;
  private bowlGeo!: BufferGeometry;
  private stoneGeo!: BufferGeometry;
  private flameGeo!: PlaneGeometry;
  private glowGeo!: PlaneGeometry;

  /* shared materials */
  private ironMat!: MeshPhongMaterial;
  private bowlMat!: MeshPhongMaterial;
  private stoneMat!: MeshPhongMaterial;

  private emberTexture!: CanvasTexture;
  private emberMat!: ShaderMaterial;

  constructor(scene: Scene, globeRadius: number, worldSeed: number, terrainType: string) {
    this.scene = scene;

    this.buildSharedGeometry();
    this.buildSharedMaterials();
    this.emberTexture = this.buildEmberTexture();
    const emberScale = typeof window !== "undefined" ? window.innerHeight * 0.5 : 400;
    this.emberMat = new ShaderMaterial({
      uniforms: {
        map: { value: this.emberTexture },
        size: { value: 0.044 },
        scale: { value: emberScale },
      },
      vertexShader: emberVert,
      fragmentShader: emberFrag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: NormalBlending,
    });

    const normals = this.generateInlandPositions(
      BRAZIER_COUNT, worldSeed, terrainType,
    );

    for (let i = 0; i < normals.length; i++) {
      const normal   = normals[i]!;
      const disp     = surfaceDisplacementAt(worldSeed, terrainType, normal.x, normal.y, normal.z);
      const surfaceR = globeRadius + disp - PROP_TERRAIN_SINK;

      const brazierQ = new Quaternion().setFromUnitVectors(REF_UP, normal);

      const group = this.buildBrazierGroup();
      const restPosition = normal.clone().multiplyScalar(surfaceR - BRAZIER_GROUND_SINK);
      group.position.copy(restPosition);
      group.quaternion.copy(brazierQ);
      group.rotateY(((worldSeed * 2654435761 + i * 1234567891) >>> 0) / 0xffffffff * Math.PI * 2);
      scene.add(group);

      const flameMat = new ShaderMaterial({
        vertexShader:   billboardVert,
        fragmentShader: flameFrag,
        uniforms: {
          uTime: { value: 0 },
          uBurn: { value: 0 },
          uBurnScale: { value: 0 },
          uEternal: { value: 0 },
        },
        transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
      });

      const glowMat = new ShaderMaterial({
        vertexShader:   billboardVert,
        fragmentShader: glowFrag,
        uniforms: {
          uTime: { value: 0 },
          uBurn: { value: 0 },
          uBurnScale: { value: 0 },
          uEternal: { value: 0 },
        },
        transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
      });

      const flameMesh = new Mesh(this.flameGeo, flameMat);
      flameMesh.position.y = FLAME_Y;
      flameMesh.frustumCulled = false;
      group.add(flameMesh);

      const glowMesh = new Mesh(this.glowGeo, glowMat);
      glowMesh.position.y = FLAME_GLOW_Y;
      glowMesh.frustumCulled = false;
      group.add(glowMesh);

      const light = new PointLight(0xff3a32, 0, 3.5);
      light.position.y = FLAME_LIGHT_Y;
      group.add(light);

      const ember = this.createEmberPoints(worldSeed, i);
      group.add(ember.points);

      const state: BrazierState = {
        group,
        normal: normal.clone(),
        restPosition,
        revealDelay: i * BRAZIER_REVEAL_STAGGER_SEC,
        flameMesh,
        glowMesh,
        flameMat,
        glowMat,
        light,
        emberPoints: ember.points,
        emberGeo: ember.geo,
        emberPos: ember.pos,
        emberBaseX: ember.baseX,
        emberBaseZ: ember.baseZ,
        emberSpd: ember.spd,
        emberPhase: ember.phase,
        emberCol: ember.col,
        emberOpacity: ember.opacity,
        worldPos: new Vector3(),
        lit: false,
        burnEndsAtMs: null,
        eternal: false,
        time: 0,
        fadeInT: 0,
        fadeOutT: 1,
      };
      this.applyRevealPose(state, 0);
      state.group.visible = false;
      this.states.push(state);
    }
  }

  /* ── Shared geometry ─────────────────────────────────────────── */

  private buildSharedGeometry() {
    const ironParts: BufferGeometry[] = [];
    const stoneParts: BufferGeometry[] = [];

    // 1. Stone Base (Tiered)
    const baseH1 = 0.015;
    const baseW1 = 0.12;
    const base1 = new BoxGeometry(baseW1, baseH1, baseW1);
    base1.translate(0, baseH1 * 0.5, 0);
    stoneParts.push(base1);

    const baseH2 = 0.012;
    const baseW2 = 0.09;
    const base2 = new BoxGeometry(baseW2, baseH2, baseW2);
    base2.translate(0, baseH1 + baseH2 * 0.5, 0);
    stoneParts.push(base2);

    const baseH3 = 0.01;
    const baseW3 = 0.06;
    const base3 = new BoxGeometry(baseW3, baseH3, baseW3);
    base3.translate(0, baseH1 + baseH2 + baseH3 * 0.5, 0);
    stoneParts.push(base3);

    const stoneTop = baseH1 + baseH2 + baseH3;

    // 2. Iron Pillar
    const pillarH = POLE_H - stoneTop;
    const pillar = new CylinderGeometry(0.012, 0.016, pillarH, 8);
    pillar.translate(0, stoneTop + pillarH * 0.5, 0);
    ironParts.push(pillar);

    // Decorative ring on pillar
    const ring = new CylinderGeometry(0.018, 0.018, 0.008, 12);
    ring.translate(0, stoneTop + pillarH * 0.5, 0);
    ironParts.push(ring);

    // 3. Support Arms (4 angled struts)
    const armW = 0.006;
    const armD = 0.006;
    const armL = 0.06;
    for (let i = 0; i < 4; i++) {
      const arm = new BoxGeometry(armW, armL, armD);
      arm.translate(0, armL * 0.5, 0);
      arm.rotateX(0.5); // Angle outwards
      arm.translate(0, stoneTop + pillarH * 0.7, 0.01); // Position relative to center
      arm.rotateY((i * Math.PI) / 2); // Rotate around pillar
      ironParts.push(arm);
    }

    // 4. Concave bowl — exponential flare from narrow base to wide rim
    const profile: Vector2[] = [];
    for (let j = 0; j <= 10; j++) {
      const t = j / 10;
      profile.push(new Vector2(0.014 + (BOWL_RIM_R - 0.014) * Math.pow(t, 1.7), t * BOWL_H));
    }
    this.bowlGeo = new LatheGeometry(profile, 12);
    // Bowl interior is drawn separately so it can be DoubleSide

    // Bowl Cap (bottom)
    const bowlCap = new CylinderGeometry(0.014, 0.014, 0.005, 10);
    bowlCap.translate(0, POLE_H + 0.0025, 0);
    ironParts.push(bowlCap);

    // 5. Thicker Rim with decorative teeth
    const rimH = 0.012;
    const rim = new CylinderGeometry(RIM_RING_R + 0.006, RIM_RING_R, rimH, 16);
    rim.translate(0, POLE_H + BOWL_H, 0);
    ironParts.push(rim);

    // Teeth on the rim
    const toothH = 0.015;
    const toothW = 0.006;
    const toothD = 0.006;
    for (let i = 0; i < 8; i++) {
      const tooth = new BoxGeometry(toothW, toothH, toothD);
      tooth.translate(0, toothH * 0.5, RIM_RING_R + 0.002);
      tooth.rotateY((i * Math.PI) / 4);
      tooth.translate(0, POLE_H + BOWL_H + rimH * 0.5, 0);
      ironParts.push(tooth);
    }

    this.ironGeo = mergeGeometries(ironParts, false)!;
    this.stoneGeo = mergeGeometries(stoneParts, false)!;

    this.flameGeo = new PlaneGeometry(FLAME_W, FLAME_H);
    this.glowGeo  = new PlaneGeometry(FLAME_W * 2.8, FLAME_H * 1.6);
  }

  /* ── Shared materials ────────────────────────────────────────── */

  private buildSharedMaterials() {
    const iron = 0x2a241e; // Darker, richer iron
    this.ironMat = new MeshPhongMaterial({ color: iron, flatShading: true, shininess: 35 });
    addRimLight(this.ironMat, 0xffaa77, 0.6, 2.2);

    this.bowlMat = new MeshPhongMaterial({
      color: iron, flatShading: true, shininess: 30, side: DoubleSide,
    });
    addRimLight(this.bowlMat, 0xffaa77, 0.6, 2.2);

    const stone = 0x8e8984; // Grey stone
    this.stoneMat = new MeshPhongMaterial({ color: stone, flatShading: true });
    addRimLight(this.stoneMat, 0xe8e0d8, 0.36, 2.75);
  }

  /* ── Brazier structural Group ────────────────────────────────── */

  private buildBrazierGroup(): Group {
    const g = new Group();

    const stoneBase = new Mesh(this.stoneGeo, this.stoneMat);
    stoneBase.castShadow = true;
    stoneBase.receiveShadow = true;
    g.add(stoneBase);

    const ironParts = new Mesh(this.ironGeo, this.ironMat);
    ironParts.castShadow = true;
    ironParts.receiveShadow = true;
    g.add(ironParts);

    /* Concave bowl (DoubleSide so interior cavity is visible from above) */
    const bowl = new Mesh(this.bowlGeo, this.bowlMat);
    bowl.position.y = POLE_H;
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    g.add(bowl);

    return g;
  }

  /* ── Inland position generation ──────────────────────────────── */

  /**
   * Returns `count` surface normals that are on land, well away from any
   * coastline, AND mutually separated by at least MIN_SEP_DOT angular distance.
   * Uses the Fibonacci lattice with a seed-derived rotation so positions differ
   * per world. Falls back with relaxed thresholds if terrain is too constrained.
   */
  private generateInlandPositions(count: number, seed: number, terrainType: string): Vector3[] {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const seedAngle   = ((seed * 1664525 + 1013904223) >>> 0) / 0xffffffff * Math.PI * 2;
    const seedAxis    = new Vector3(
      Math.sin(seedAngle), Math.cos(seedAngle * 0.618), Math.cos(seedAngle),
    ).normalize();
    const seedQ = new Quaternion().setFromAxisAngle(seedAxis, seedAngle);

    const out: Vector3[] = [];

    /** One sweep through 4 000 Fibonacci candidates with given thresholds. */
    const trySweep = (maxWaterRatio: number, minSepDot: number) => {
      const maxWater = Math.floor(INLAND_CHECKS * maxWaterRatio);
      for (let n = 0; n < 4000 && out.length < count; n++) {
        const y     = 1 - (2 * n) / 3999;
        const r     = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * n;
        const v = new Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r)
          .normalize()
          .applyQuaternion(seedQ)
          .normalize();

        // Must be inland
        if (!this.isInland(v, seed, terrainType, maxWater)) continue;

        // Must be far enough from every already-placed brazier.
        // dot > minSepDot means the angle is SMALLER than the minimum → too close.
        if (out.some(existing => existing.dot(v) > minSepDot)) continue;

        out.push(v);
      }
    };

    // Pass 1: strict inland + 35° minimum separation
    trySweep(MAX_WATER_RATIO, MIN_SEP_DOT);
    // Pass 2: relax both thresholds if we're short
    if (out.length < count) trySweep(MAX_WATER_FALLBACK, MIN_SEP_DOT_FALLBACK);

    return out;
  }

  /** True when the normal is on land and the surrounding ring has at most `maxWater` ocean samples. */
  private isInland(
    normal: Vector3,
    seed: number,
    terrainType: string,
    maxWater: number,
  ): boolean {
    if (!isLand(seed, terrainType, normal.x, normal.y, normal.z)) return false;

    // Build a tangent frame for ring sampling
    const ref = Math.abs(normal.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const tang = normal.clone().cross(ref).normalize();
    const bita = normal.clone().cross(tang).normalize();

    let waterCount = 0;
    for (let c = 0; c < INLAND_CHECKS; c++) {
      const a = (c / INLAND_CHECKS) * Math.PI * 2;
      const sample = normal.clone()
        .addScaledVector(tang, Math.cos(a) * INLAND_CHECK_DIST)
        .addScaledVector(bita, Math.sin(a) * INLAND_CHECK_DIST)
        .normalize();
      if (!isLand(seed, terrainType, sample.x, sample.y, sample.z)) {
        waterCount++;
        if (waterCount > maxWater) return false; // early-out
      }
    }
    return true;
  }

  private hashInt(n: number): number {
    n = ((n >> 16) ^ n) * 0x45d9f3b;
    n = ((n >> 16) ^ n) * 0x45d9f3b;
    return ((n >> 16) ^ n) & 0xffffff;
  }

  /** Bowl-top world positions for all braziers — used by Game.ts for proximity whispers. */
  get worldPositions(): readonly Vector3[] {
    return this.states.map(s => s.worldPos);
  }

  /** True once all braziers have fully risen into place and can be interacted with. */
  isRevealed(): boolean {
    return this.revealComplete;
  }

  /** Snapshot enough local-only state to restore braziers in future runs/worlds. */
  capturePersistentState(now = Date.now()): SavedBrazierState {
    const burnEndsAtMs = this.states.map((s) => {
      if (s.eternal) return null;
      const end = s.burnEndsAtMs;
      return typeof end === "number" && Number.isFinite(end) && end > now ? end : null;
    });
    const burnEternal = this.states.map((s) => s.eternal);
    return {
      revealed:
        this.revealStarted ||
        this.revealComplete ||
        burnEndsAtMs.some((end) => end != null) ||
        burnEternal.some((e) => e),
      burnEndsAtMs,
      burnEternal,
    };
  }

  /** Restore a previously saved local-only brazier reveal/burn state instantly. */
  restorePersistentState(saved: SavedBrazierState, now = Date.now()) {
    const burnEternal = saved.burnEternal ?? this.states.map(() => false);
    const burnEndsAtMs = this.states.map((_s, i) => {
      if (burnEternal[i]) return null;
      const end = saved.burnEndsAtMs[i];
      return typeof end === "number" && Number.isFinite(end) && end > now ? end : null;
    });
    const revealed =
      !!saved.revealed ||
      burnEndsAtMs.some((end) => end != null) ||
      burnEternal.some((e) => e);
    this.revealStarted = revealed;
    this.revealComplete = revealed;
    this.revealTimer = revealed
      ? BRAZIER_REVEAL_SEC + BRAZIER_REVEAL_STAGGER_SEC * Math.max(0, this.states.length - 1)
      : 0;
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]!;
      const eternal = burnEternal[i] === true;
      this.applyRevealPose(s, revealed ? 1 : 0);
      s.group.visible = revealed;
      if (eternal) {
        s.eternal = true;
        s.lit = true;
        s.burnEndsAtMs = null;
        s.fadeInT = 1;
        s.fadeOutT = 0;
      } else {
        s.eternal = false;
        const burnEnd = burnEndsAtMs[i];
        s.lit = burnEnd != null;
        s.burnEndsAtMs = burnEnd;
        s.fadeInT = burnEnd != null ? 1 : 0;
        s.fadeOutT = burnEnd != null ? 0 : 1;
      }
    }
  }

  /** Read the current brazier progress bars without mutating the burn state. */
  getBurnProgressSnapshot(now = Date.now()): number[] {
    return this.states.map((s) => {
      if (!this.revealComplete) return 0;
      if (s.eternal && s.lit) return 1;
      if (!s.lit || s.burnEndsAtMs == null || s.burnEndsAtMs <= now) return 0;
      const remainSec = (s.burnEndsAtMs - now) / 1000;
      return (remainSec / BURN_DURATION_SEC) * easeOutQuad(s.fadeInT);
    });
  }

  /** Starts the cinematic "rise from the earth" reveal. Safe to call repeatedly. */
  startReveal() {
    if (this.revealStarted) return;
    this.revealStarted = true;
    this.revealComplete = false;
    this.revealTimer = 0;
    for (const s of this.states) {
      s.group.visible = true;
    }
  }

  /**
   * Reorders the reveal stagger to follow a caller-provided shot sequence.
   * Any omitted/invalid indices fall back to the end in their natural order.
   */
  setRevealSequence(order: readonly number[]) {
    const seen = new Set<number>();
    let seq = 0;
    for (const idx of order) {
      const s = this.states[idx];
      if (!s || seen.has(idx)) continue;
      s.revealDelay = seq * BRAZIER_REVEAL_STAGGER_SEC;
      seen.add(idx);
      seq++;
    }
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]!;
      if (seen.has(i)) continue;
      s.revealDelay = seq * BRAZIER_REVEAL_STAGGER_SEC;
      seq++;
    }
  }

  /** Current brazier bowl-top world position, including reveal animation offset. */
  readWorldPosition(index: number, target: Vector3): boolean {
    const s = this.states[index];
    if (!s) return false;
    target.copy(s.worldPos);
    return true;
  }

  private applyRevealPose(s: BrazierState, emerge: number) {
    const offset = (emerge - 1) * BRAZIER_REVEAL_DEPTH;
    s.group.position.copy(s.restPosition).addScaledVector(s.normal, offset);
    s.worldPos.copy(s.group.position).addScaledVector(s.normal, POLE_H + BOWL_H);
  }

  /** Hard-edged spark (no soft glow) — color comes from vertexColors (orange). */
  private buildEmberTexture(): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 16, 16);
    const cx = 8;
    const cy = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    const tex = new CanvasTexture(canvas);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private createEmberPoints(seed: number, brazierIndex: number) {
    const pos = new Float32Array(EMBER_COUNT * 3);
    const col = new Float32Array(EMBER_COUNT * 3);
    const opacity = new Float32Array(EMBER_COUNT);
    const baseX = new Float32Array(EMBER_COUNT);
    const baseZ = new Float32Array(EMBER_COUNT);
    const spd = new Float32Array(EMBER_COUNT);
    const phase = new Float32Array(EMBER_COUNT);

    for (let i = 0; i < EMBER_COUNT; i++) {
      const h = this.hashInt(seed * 9999 + brazierIndex * 127 + i * 31);
      const r1 = (h & 0xffff) / 0xffff;
      const r2 = ((h >> 16) & 0xffff) / 0xffff;
      baseX[i] = (r1 - 0.5) * FLAME_W * 0.42;
      baseZ[i] = (r2 - 0.5) * FLAME_W * 0.34;
      spd[i] = 0.11 + ((this.hashInt(seed + i * 17 + brazierIndex) & 0xff) / 255) * 0.14;
      phase[i] = ((this.hashInt(seed * 2 + i + brazierIndex * 13) & 0xffff) / 0xffff) * Math.PI * 2;
      const i3 = i * 3;
      pos[i3 + 0] = baseX[i]!;
      pos[i3 + 1] = ((r1 + r2) * 0.5) * EMBER_RISE_MAX * 0.55;
      pos[i3 + 2] = baseZ[i]!;
      col[i3 + 0] = EMBER_ORANGE.r;
      col[i3 + 1] = EMBER_ORANGE.g;
      col[i3 + 2] = EMBER_ORANGE.b;
      opacity[i] = 1;
    }

    const geo = new BufferGeometry();
    // Must use BufferAttribute — Float32BufferAttribute *copies* the array, so mutating
    // `pos` / `col` in updateEmberParticles would never reach the GPU (frozen particles).
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("color", new BufferAttribute(col, 3));
    geo.setAttribute("opacity", new BufferAttribute(opacity, 1));

    const points = new Points(geo, this.emberMat);
    points.frustumCulled = false;
    points.visible = false;
    points.renderOrder = 10;
    points.position.y = EMBER_ORIGIN_Y;

    return { points, geo, pos, baseX, baseZ, spd, phase, col, opacity };
  }

  private updateEmberParticles(s: BrazierState, burn: number, dt: number) {
    void burn;
    void dt;
    // Keep the ember particle layer disabled while preserving the main flame/glow visuals.
    s.emberPoints.visible = false;
  }

  /* ── Per-frame update ────────────────────────────────────────── */

  /**
   * Dev/test: force every slot lit with an eternal flame (reveal braziers first if still rising).
   * @returns true when the world has a full brazier set; otherwise no-op and false.
   */
  debugLightAllEternalFlames(): boolean {
    if (this.states.length < BRAZIER_COUNT) return false;
    this.revealStarted = true;
    this.revealTimer =
      BRAZIER_REVEAL_SEC + BRAZIER_REVEAL_STAGGER_SEC * (this.states.length - 1) + 0.05;
    this.revealComplete = true;
    for (const s of this.states) {
      this.applyRevealPose(s, 1);
      s.group.visible = true;
      s.eternal = true;
      s.lit = true;
      s.burnEndsAtMs = null;
      s.fadeInT = 1;
      s.fadeOutT = 0;
    }
    return true;
  }

  /** Extinguish every brazier immediately (e.g. all-five shield). */
  extinguishAll() {
    for (const s of this.states) {
      if (s.eternal) continue;
      s.lit = false;
      s.burnEndsAtMs = null;
      s.fadeInT = 0;
      s.fadeOutT = 1;
    }
  }

  /** True when every slot is lit with a Gremlin-King eternal flame (not temporary burn). */
  allFiveEternalAndLit(): boolean {
    if (!this.revealComplete || this.states.length < BRAZIER_COUNT) return false;
    return this.states.every((s) => s.lit && s.eternal);
  }

  update(
    dt: number,
    playerWorldPos: Vector3,
    allowPlayerIgnite: boolean = true,
    igniteOptions?: {
      eternalFlameAvailable: boolean;
      onConsumeEternal?: (index: number) => void;
    },
  ): {
    newlyLitIndices: number[];
    /** True when the ignition consumed an eternal flame (distinct HUD message). */
    newlyLitUsedEternalFlame: boolean;
    burnProgress: number[];
  } {
    const newlyLitIndices: number[] = [];
    let newlyLitUsedEternalFlame = false;
    if (this.revealStarted && !this.revealComplete) {
      this.revealTimer += dt;
    }
    let allRevealed = this.revealStarted;

    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]!;
      s.time += dt;
      let revealAlpha = 0;
      if (this.revealStarted) {
        const localT = clamp01((this.revealTimer - s.revealDelay) / BRAZIER_REVEAL_SEC);
        revealAlpha = localT;
        this.applyRevealPose(s, easeOutBack(localT));
        s.group.visible = localT > 0.001 || this.revealComplete;
        if (localT < 1) allRevealed = false;
      } else {
        this.applyRevealPose(s, 0);
        s.group.visible = false;
      }

      if (s.lit && s.burnEndsAtMs != null && !s.eternal) {
        s.fadeInT = Math.min(1, s.fadeInT + dt / FADE_IN_DUR);
        const remainSec = (s.burnEndsAtMs - Date.now()) / 1000;
        if (remainSec <= 0) {
          s.lit = false;
          s.burnEndsAtMs = null;
          s.fadeOutT = 0;
        }
      } else if (s.lit && s.eternal) {
        s.fadeInT = Math.min(1, s.fadeInT + dt / FADE_IN_DUR);
      } else if (!s.lit && s.fadeOutT < 1) {
        s.fadeOutT = Math.min(1, s.fadeOutT + dt / FADE_OUT_DUR);
      } else if (allowPlayerIgnite && this.revealComplete && newlyLitIndices.length === 0) {
        if (playerWorldPos.distanceTo(s.worldPos) < LIGHT_RADIUS) {
          const useEternal =
            igniteOptions?.eternalFlameAvailable === true &&
            igniteOptions?.onConsumeEternal != null;
          if (useEternal) {
            igniteOptions!.onConsumeEternal!(i);
            s.eternal = true;
            s.lit = true;
            s.burnEndsAtMs = null;
            newlyLitUsedEternalFlame = true;
          } else {
            s.lit = true;
            s.burnEndsAtMs = Date.now() + BRAZIER_BURN_MS;
          }
          s.fadeInT = 0;
          s.fadeOutT = 0;
          newlyLitIndices.push(i);
        }
      }

      const fadeIn  = s.lit  ? easeOutQuad(s.fadeInT)  : 1;
      const fadeOut = !s.lit ? (1 - s.fadeOutT)        : 1;
      const burn    = fadeIn * fadeOut * revealAlpha;
      const scale   = (s.lit ? popScale(s.fadeInT) : (s.fadeOutT < 1 ? 1.0 : 0)) * revealAlpha;

      const eternalOn = s.eternal && s.lit ? 1 : 0;
      s.flameMat.uniforms.uTime.value      = s.time;
      s.flameMat.uniforms.uBurn.value      = burn;
      s.flameMat.uniforms.uBurnScale.value = scale;
      s.flameMat.uniforms.uEternal.value  = eternalOn;
      s.glowMat.uniforms.uTime.value       = s.time;
      s.glowMat.uniforms.uBurn.value       = burn;
      s.glowMat.uniforms.uBurnScale.value  = scale;
      s.glowMat.uniforms.uEternal.value   = eternalOn;

      if (eternalOn > 0.5) {
        s.light.color.setHex(0x4488ff);
      } else {
        s.light.color.setHex(0xff3a32);
      }
      s.light.intensity = burn > 0.01
        ? (s.eternal && s.lit ? 2.75 : 2.2) * burn * (0.85 + 0.15 * Math.sin(s.time * 6.3))
        : 0;

      this.updateEmberParticles(s, burn, dt);
    }

    if (this.revealStarted && allRevealed) {
      this.revealComplete = true;
    }

    return {
      newlyLitIndices,
      newlyLitUsedEternalFlame,
      // 1.0 = just lit / full burn, linearly decreasing to 0.0 = extinguished.
      // Includes smooth ramp-in during FADE_IN_DUR so the progress bar
      // doesn't jump straight to the full-width value.
      burnProgress: this.states.map((s) => {
        if (!this.revealComplete) return 0;
        if (s.eternal && s.lit) return 1;
        if (!s.lit || s.burnEndsAtMs == null) return 0;
        const remainSec = Math.max(0, (s.burnEndsAtMs - Date.now()) / 1000);
        return (remainSec / BURN_DURATION_SEC) * easeOutQuad(s.fadeInT);
      }),
    };
  }

  /* ── Dispose ─────────────────────────────────────────────────── */

  setVisible(visible: boolean) {
    for (const slot of this.states) {
      if (visible) {
        slot.group.visible = this.revealComplete;
      } else {
        slot.group.visible = false;
      }
    }
  }

  dispose() {
    this.ironGeo.dispose();
    this.bowlGeo.dispose();
    this.stoneGeo.dispose();
    this.flameGeo.dispose();
    this.glowGeo.dispose();
    this.ironMat.dispose();
    this.bowlMat.dispose();
    this.stoneMat.dispose();

    this.emberMat.dispose();
    this.emberTexture.dispose();

    for (const s of this.states) {
      s.flameMat.dispose();
      s.glowMat.dispose();
      s.light.dispose();
      s.emberGeo.dispose();
      s.group.removeFromParent();
    }
    this.states = [];
  }
}
