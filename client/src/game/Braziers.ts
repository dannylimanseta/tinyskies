import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
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

export { BRAZIER_COUNT };
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
void main() {
  vUv = uv;
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
    + right  * (position.x * uBurnScale + sway + sway2 + flutter)
    + upAxis * (position.y * uBurnScale);
  gl_Position = projectionMatrix * viewMatrix * vec4(vertPos, 1.0);
}
`;

const flameFrag = /* glsl */ `
uniform float uTime;
uniform float uBurn;
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

  vec3 col = mix(orange, red,    smoothstep(0.4, 1.0, cy));
  col      = mix(col,    yellow, core * (1.0 - cy * 0.8));
  col     += vec3(0.38, 0.14, 0.02) * flicker * core;
  col     += vec3(0.12, 0.05, 0.0) * sin(uTime * 31.0 + cy * 40.0) * core;

  float alpha = (core * 0.92 + halo * 0.18) * heightFade * baseFade;
  alpha *= 0.78 + flicker * 0.22;
  alpha *= uBurn;

  gl_FragColor = vec4(col * 2.85, alpha);
}
`;

const glowFrag = /* glsl */ `
uniform float uTime;
uniform float uBurn;
varying vec2 vUv;

void main() {
  vec2 gc = vUv - vec2(0.5, 0.30);
  gc.x += sin(uTime * 5.5 + vUv.y * 8.0) * 0.04 * vUv.y;
  float d = length(gc) * 2.2;
  float glow = 1.0 - smoothstep(0.0, 1.0, d);
  float pulse = 0.72 + 0.28 * sin(uTime * 3.1) + 0.08 * sin(uTime * 11.0);
  vec3 col = vec3(1.0, 0.14, 0.12);
  float glowBase = smoothstep(0.0, 0.34, vUv.y + 0.045 * sin(vUv.x * 15.0 + uTime * 4.2));
  float alpha = glow * glow * pulse * uBurn * 0.52 * glowBase;
  gl_FragColor = vec4(col * 2.0, alpha);
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
  /** Wall-clock ms when burn ends; null when unlit — matches server + multiplayer sync. */
  burnEndsAtMs: number | null;
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

/** Ease-out-back: overshoots ~1.15 at t≈0.55 then settles to 1.0. */
function popScale(fadeInT: number): number {
  if (fadeInT <= 0) return 0;
  if (fadeInT < 0.55) return (fadeInT / 0.55) * 1.15;
  return 1.15 - ((fadeInT - 0.55) / 0.45) * 0.15;
}

/* ── Class ───────────────────────────────────────────────────────── */

export class Braziers {
  private states: BrazierState[] = [];
  private scene: Scene;

  /* shared geometry */
  private poleGeo!: CylinderGeometry;
  private bowlGeo!: LatheGeometry;
  private bowlCapGeo!: CylinderGeometry;
  private rimGeo!: CylinderGeometry;
  private flameGeo!: PlaneGeometry;
  private glowGeo!: PlaneGeometry;

  /* shared materials */
  private ironMat!: MeshPhongMaterial;
  private bowlMat!: MeshPhongMaterial;

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
      group.position.copy(normal.clone().multiplyScalar(surfaceR - BRAZIER_GROUND_SINK));
      group.quaternion.copy(brazierQ);
      group.rotateY(((worldSeed * 2654435761 + i * 1234567891) >>> 0) / 0xffffffff * Math.PI * 2);
      scene.add(group);

      const flameMat = new ShaderMaterial({
        vertexShader:   billboardVert,
        fragmentShader: flameFrag,
        uniforms: { uTime: { value: 0 }, uBurn: { value: 0 }, uBurnScale: { value: 0 } },
        transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
      });

      const glowMat = new ShaderMaterial({
        vertexShader:   billboardVert,
        fragmentShader: glowFrag,
        uniforms: { uTime: { value: 0 }, uBurn: { value: 0 }, uBurnScale: { value: 0 } },
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

      const worldPos = group.position.clone().addScaledVector(normal, POLE_H + BOWL_H);

      this.states.push({
        group, flameMesh, glowMesh, flameMat, glowMat, light,
        emberPoints: ember.points,
        emberGeo: ember.geo,
        emberPos: ember.pos,
        emberBaseX: ember.baseX,
        emberBaseZ: ember.baseZ,
        emberSpd: ember.spd,
        emberPhase: ember.phase,
        emberCol: ember.col,
        emberOpacity: ember.opacity,
        worldPos,
        lit: false, burnEndsAtMs: null, time: 0, fadeInT: 0, fadeOutT: 1,
      });
    }
  }

  /* ── Shared geometry ─────────────────────────────────────────── */

  private buildSharedGeometry() {
    this.poleGeo = new CylinderGeometry(0.012, 0.016, POLE_H, 8);

    /* Concave bowl — exponential flare from narrow base to wide rim */
    const profile: Vector2[] = [];
    for (let j = 0; j <= 10; j++) {
      const t = j / 10;
      profile.push(new Vector2(0.014 + (BOWL_RIM_R - 0.014) * Math.pow(t, 1.7), t * BOWL_H));
    }
    this.bowlGeo    = new LatheGeometry(profile, 12);
    this.bowlCapGeo = new CylinderGeometry(0.014, 0.014, 0.005, 10);
    this.rimGeo     = new CylinderGeometry(RIM_RING_R + 0.004, RIM_RING_R, 0.010, 12);

    this.flameGeo = new PlaneGeometry(FLAME_W, FLAME_H);
    this.glowGeo  = new PlaneGeometry(FLAME_W * 2.8, FLAME_H * 1.6);
  }

  /* ── Shared materials ────────────────────────────────────────── */

  private buildSharedMaterials() {
    const iron = 0x4a4036;
    this.ironMat = new MeshPhongMaterial({ color: iron, flatShading: true, shininess: 26 });
    addRimLight(this.ironMat, 0xffaa77, 0.52, 2.45);

    this.bowlMat = new MeshPhongMaterial({
      color: iron, flatShading: true, shininess: 26, side: DoubleSide,
    });
    addRimLight(this.bowlMat, 0xffaa77, 0.52, 2.45);
  }

  /* ── Brazier structural Group ────────────────────────────────── */

  private buildBrazierGroup(): Group {
    const g = new Group();

    const pole = new Mesh(this.poleGeo, this.ironMat);
    pole.position.y = POLE_H * 0.5;
    g.add(pole);

    /* Concave bowl (DoubleSide so interior cavity is visible from above) */
    const bowl = new Mesh(this.bowlGeo, this.bowlMat);
    bowl.position.y = POLE_H;
    g.add(bowl);

    const cap = new Mesh(this.bowlCapGeo, this.ironMat);
    cap.position.y = POLE_H + 0.0025;
    g.add(cap);

    const rim = new Mesh(this.rimGeo, this.ironMat);
    rim.position.y = POLE_H + BOWL_H;
    g.add(rim);

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
    s.emberPoints.visible = burn > 0.02;
    if (!s.emberPoints.visible) return;

    const t = s.time;
    const pos = s.emberPos;
    const baseX = s.emberBaseX;
    const baseZ = s.emberBaseZ;
    const spd = s.emberSpd;
    const phase = s.emberPhase;
    const opacity = s.emberOpacity;

    for (let i = 0; i < EMBER_COUNT; i++) {
      const i3 = i * 3;
      let y = pos[i3 + 1]!;
      y += spd[i]! * dt * burn * 0.82;

      if (y > EMBER_RISE_MAX) {
        y = -0.02 + Math.random() * 0.07;
        baseX[i] = (Math.random() - 0.5) * FLAME_W * 0.44;
        baseZ[i] = (Math.random() - 0.5) * FLAME_W * 0.34;
      }

      const drift = Math.min(1, Math.max(0, y / EMBER_RISE_MAX));
      pos[i3 + 0] = baseX[i]! + Math.sin(t * 3.2 + phase[i]!) * 0.014 * drift;
      pos[i3 + 1] = y;
      pos[i3 + 2] = baseZ[i]! + Math.cos(t * 2.7 + phase[i]! * 1.2) * 0.014 * drift;

      const ht = Math.max(0, Math.min(1, y / EMBER_RISE_MAX));
      // True alpha fade (fragment shader) — full opacity at base, ~0 at top
      const heightFade = Math.pow(1.0 - ht, 2.1);
      opacity[i] = heightFade * burn;
    }

    s.emberGeo.attributes.position!.needsUpdate = true;
    s.emberGeo.attributes.opacity!.needsUpdate = true;
  }

  /* ── Per-frame update ────────────────────────────────────────── */

  /**
   * Apply authoritative burn end from the server (local + remote ignitions).
   */
  applyServerBurnState(index: number, burnEndsAt: number) {
    const s = this.states[index];
    if (!s) return;
    const remainMs = burnEndsAt - Date.now();
    if (remainMs <= 0) {
      s.lit = false;
      s.burnEndsAtMs = null;
      s.fadeInT = 0;
      s.fadeOutT = 1;
    } else {
      s.lit = true;
      s.burnEndsAtMs = burnEndsAt;
      s.fadeInT = 0;
      s.fadeOutT = 0;
    }
  }

  /** Extinguish every brazier immediately (e.g. all-five shield). */
  extinguishAll() {
    for (const s of this.states) {
      s.lit = false;
      s.burnEndsAtMs = null;
      s.fadeInT = 0;
      s.fadeOutT = 1;
    }
  }

  /** Debug: force every brazier lit with a full burn (visual + progress). */
  debugLightAll() {
    const end = Date.now() + BRAZIER_BURN_MS;
    for (const s of this.states) {
      s.lit = true;
      s.burnEndsAtMs = end;
      s.fadeInT = 0;
      s.fadeOutT = 0;
    }
  }

  /** Full snapshot when joining a world (server expiries are ms epoch). */
  syncBrazierExpiries(expiries: (number | null)[]) {
    const now = Date.now();
    for (let i = 0; i < this.states.length; i++) {
      const t = expiries[i];
      const s = this.states[i]!;
      if (t == null || t <= now) {
        s.lit = false;
        s.burnEndsAtMs = null;
        s.fadeInT = 0;
        s.fadeOutT = 1;
      } else {
        s.lit = true;
        s.burnEndsAtMs = t;
        s.fadeInT = 0;
        s.fadeOutT = 0;
      }
    }
  }

  update(dt: number, playerWorldPos: Vector3): { newlyLitIndices: number[]; burnProgress: number[] } {
    const newlyLitIndices: number[] = [];

    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]!;
      s.time += dt;

      if (s.lit && s.burnEndsAtMs != null) {
        s.fadeInT = Math.min(1, s.fadeInT + dt / FADE_IN_DUR);
        const remainSec = (s.burnEndsAtMs - Date.now()) / 1000;
        if (remainSec <= 0) {
          s.lit = false;
          s.burnEndsAtMs = null;
          s.fadeOutT = 0;
        }
      } else if (!s.lit && s.fadeOutT < 1) {
        s.fadeOutT = Math.min(1, s.fadeOutT + dt / FADE_OUT_DUR);
      } else {
        if (playerWorldPos.distanceTo(s.worldPos) < LIGHT_RADIUS) {
          s.lit = true;
          s.burnEndsAtMs = Date.now() + BRAZIER_BURN_MS;
          s.fadeInT = 0;
          s.fadeOutT = 0;
          newlyLitIndices.push(i);
        }
      }

      const fadeIn  = s.lit  ? easeOutQuad(s.fadeInT)  : 1;
      const fadeOut = !s.lit ? (1 - s.fadeOutT)        : 1;
      const burn    = fadeIn * fadeOut;
      const scale   = s.lit ? popScale(s.fadeInT) : (s.fadeOutT < 1 ? 1.0 : 0);

      s.flameMat.uniforms.uTime.value      = s.time;
      s.flameMat.uniforms.uBurn.value      = burn;
      s.flameMat.uniforms.uBurnScale.value = scale;
      s.glowMat.uniforms.uTime.value       = s.time;
      s.glowMat.uniforms.uBurn.value       = burn;
      s.glowMat.uniforms.uBurnScale.value  = scale;

      s.light.intensity = burn > 0.01
        ? 2.2 * burn * (0.85 + 0.15 * Math.sin(s.time * 6.3))
        : 0;

      this.updateEmberParticles(s, burn, dt);
    }

    return {
      newlyLitIndices,
      // 1.0 = just lit / full burn, linearly decreasing to 0.0 = extinguished.
      // Includes smooth ramp-in during FADE_IN_DUR so the progress bar
      // doesn't jump straight to the full-width value.
      burnProgress: this.states.map((s) => {
        if (!s.lit || s.burnEndsAtMs == null) return 0;
        const remainSec = Math.max(0, (s.burnEndsAtMs - Date.now()) / 1000);
        return (remainSec / BURN_DURATION_SEC) * easeOutQuad(s.fadeInT);
      }),
    };
  }

  /* ── Dispose ─────────────────────────────────────────────────── */

  dispose() {
    this.poleGeo.dispose();
    this.bowlGeo.dispose();
    this.bowlCapGeo.dispose();
    this.rimGeo.dispose();
    this.flameGeo.dispose();
    this.glowGeo.dispose();
    this.ironMat.dispose();
    this.bowlMat.dispose();

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
