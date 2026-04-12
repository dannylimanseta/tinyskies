import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshPhongMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { PROP_TERRAIN_SINK, surfaceDisplacementAt } from "./TerrainSurface";
import { isLand } from "./SimplexNoise";
import { addRimLight } from "./RimLight";

export const BRAZIER_COUNT = 5;
const BURN_DURATION_SEC = 45;
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
const FLAME_Y    = POLE_H + BOWL_H + FLAME_H * 0.42;

/* Tree ring — same scales / geometry style as Globe.ts forest */
const TREES_PER_BRAZIER = 7;
const TREE_RING_R       = 0.30;
const TREE_SCALE_MIN    = 0.028;
const TREE_SCALE_MAX    = 0.052;

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

/* ── Billboard shaders — vertical axis locked to globe surface normal ── */

/*
 * Cylindrical billboard: horizontal tracks camera; vertical stays locked to the
 * globe surface normal (model-matrix Y column). uBurnScale drives the pop-in.
 */
const billboardVert = /* glsl */ `
varying vec2 vUv;
uniform float uBurnScale;
void main() {
  vUv = uv;
  vec3 upAxis     = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vec3 worldCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCamera   = normalize(cameraPosition - worldCenter);
  vec3 forward    = normalize(toCamera - dot(toCamera, upAxis) * upAxis);
  vec3 right      = normalize(cross(upAxis, forward));
  vec3 vertPos = worldCenter
    + right  * (position.x * uBurnScale)
    + upAxis * (position.y * uBurnScale);
  gl_Position = projectionMatrix * viewMatrix * vec4(vertPos, 1.0);
}
`;

const flameFrag = /* glsl */ `
uniform float uTime;
uniform float uBurn;
varying vec2 vUv;

void main() {
  float cx = vUv.x - 0.5;
  float cy = vUv.y;

  float taper = mix(0.45, 0.06, cy * cy);
  float d = abs(cx) / max(taper, 0.001);

  float core = 1.0 - smoothstep(0.0, 0.65, d);
  float halo = 1.0 - smoothstep(0.0, 1.5, d);

  float heightFade = 1.0 - smoothstep(0.28, 1.0, cy);
  float baseFade   = smoothstep(0.0, 0.07, cy);

  float f1 = sin(uTime * 7.1  + vUv.x * 9.0 + vUv.y * 4.5) * 0.5 + 0.5;
  float f2 = sin(uTime * 13.7 - vUv.x * 6.0 + vUv.y * 8.2) * 0.5 + 0.5;
  float f3 = sin(uTime * 19.3 + vUv.x * 3.5 - vUv.y * 11.0) * 0.5 + 0.5;
  float flicker = f1 * 0.5 + f2 * 0.3 + f3 * 0.2;

  vec3 red    = vec3(0.88, 0.12, 0.0);
  vec3 orange = vec3(1.00, 0.42, 0.02);
  vec3 yellow = vec3(1.00, 0.90, 0.18);

  vec3 col = mix(orange, red,    smoothstep(0.4, 1.0, cy));
  col      = mix(col,    yellow, core * (1.0 - cy * 0.8));
  col     += vec3(0.35, 0.12, 0.0) * flicker * core;

  float alpha = (core * 0.92 + halo * 0.18) * heightFade * baseFade;
  alpha *= 0.82 + flicker * 0.18;
  alpha *= uBurn;

  gl_FragColor = vec4(col * 2.8, alpha);
}
`;

const glowFrag = /* glsl */ `
uniform float uTime;
uniform float uBurn;
varying vec2 vUv;

void main() {
  float d = distance(vUv, vec2(0.5, 0.30)) * 2.2;
  float glow = 1.0 - smoothstep(0.0, 1.0, d);
  float pulse = 0.75 + 0.25 * sin(uTime * 3.1);
  vec3 col = vec3(1.0, 0.38, 0.04);
  float alpha = glow * glow * pulse * uBurn * 0.52;
  gl_FragColor = vec4(col * 2.0, alpha);
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
  /** Bowl-top world position — proximity trigger centre. */
  worldPos: Vector3;
  lit: boolean;
  burnTimer: number;
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
  private treeGeo!: LatheGeometry;

  /* shared materials */
  private ironMat!: MeshPhongMaterial;
  private bowlMat!: MeshPhongMaterial;
  private treeMat!: MeshPhongMaterial;

  /* tree instanced mesh */
  private treeMesh!: InstancedMesh;

  constructor(scene: Scene, globeRadius: number, worldSeed: number, terrainType: string) {
    this.scene = scene;

    this.buildSharedGeometry();
    this.buildSharedMaterials();

    const totalTrees = BRAZIER_COUNT * TREES_PER_BRAZIER;
    this.treeMesh = new InstancedMesh(this.treeGeo, this.treeMat, totalTrees);
    this.treeMesh.frustumCulled = false;
    scene.add(this.treeMesh);

    const normals = this.generateInlandPositions(
      BRAZIER_COUNT, worldSeed, terrainType,
    );

    const dummy = new Object3D();

    for (let i = 0; i < normals.length; i++) {
      const normal   = normals[i]!;
      const disp     = surfaceDisplacementAt(worldSeed, terrainType, normal.x, normal.y, normal.z);
      const surfaceR = globeRadius + disp - PROP_TERRAIN_SINK;

      const brazierQ = new Quaternion().setFromUnitVectors(REF_UP, normal);

      const group = this.buildBrazierGroup();
      group.position.copy(normal.clone().multiplyScalar(surfaceR));
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
      glowMesh.position.y = POLE_H + BOWL_H + FLAME_H * 0.20;
      glowMesh.frustumCulled = false;
      group.add(glowMesh);

      const light = new PointLight(0xff6600, 0, 3.5);
      light.position.y = POLE_H + BOWL_H + 0.04;
      group.add(light);

      const worldPos = group.position.clone().addScaledVector(normal, POLE_H + BOWL_H);

      this.states.push({
        group, flameMesh, glowMesh, flameMat, glowMat, light, worldPos,
        lit: false, burnTimer: 0, time: 0, fadeInT: 0, fadeOutT: 1,
      });

      /* ── Tree ring (same geometry + scale as Globe.ts forest) ── */
      for (let t = 0; t < TREES_PER_BRAZIER; t++) {
        const idx = i * TREES_PER_BRAZIER + t;
        const h = this.hashInt(worldSeed * 31337 + i * 7919 + t * 1021);

        const angleJitter = (h & 0xff) / 255 * 0.55;
        const angle = (t / TREES_PER_BRAZIER) * Math.PI * 2 + angleJitter;
        const ringVar = 0.88 + ((h >> 8 & 0xff) / 255) * 0.28;

        // Same scale formula as Globe.ts: treeH = treeScale*2.5, treeR = treeScale*0.7
        const treeScale = TREE_SCALE_MIN + ((h >> 16 & 0xff) / 255) * (TREE_SCALE_MAX - TREE_SCALE_MIN);
        const treeH = treeScale * 2.5;
        const treeR = treeScale * 0.7;

        // Tangent-plane offset from the brazier's surface centre
        const localOffset = new Vector3(
          TREE_RING_R * ringVar * Math.cos(angle),
          0,
          TREE_RING_R * ringVar * Math.sin(angle),
        ).applyQuaternion(brazierQ);

        const treePos = group.position.clone().add(localOffset);
        // Sink slightly into terrain — same as Globe.ts (-treeH * 0.05 along normal)
        treePos.addScaledVector(normal, -treeH * 0.05);

        // Random Y rotation around surface normal for facet variety
        const yRot = new Quaternion().setFromAxisAngle(normal, angle);
        const treeQ = yRot.multiply(brazierQ.clone());

        dummy.position.copy(treePos);
        dummy.quaternion.copy(treeQ);
        dummy.scale.set(treeR, treeH, treeR);
        dummy.updateMatrix();
        this.treeMesh.setMatrixAt(idx, dummy.matrix);
      }
    }

    this.treeMesh.instanceMatrix.needsUpdate = true;
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

    /* Teardrop tree — identical algorithm to Globe.ts createTeardropGeo(1,1) */
    const tearPoints: Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      tearPoints.push(new Vector2(
        Math.pow(Math.sin(t * Math.PI), 0.35) * Math.pow(1 - t, 0.5),
        t,
      ));
    }
    this.treeGeo = new LatheGeometry(tearPoints, 6);
  }

  /* ── Shared materials ────────────────────────────────────────── */

  private buildSharedMaterials() {
    this.ironMat = new MeshPhongMaterial({ color: 0x2a2218, flatShading: true, shininess: 22 });
    addRimLight(this.ironMat, 0xff6600, 0.55, 2.8);

    this.bowlMat = new MeshPhongMaterial({
      color: 0x2a2218, flatShading: true, shininess: 22, side: DoubleSide,
    });
    addRimLight(this.bowlMat, 0xff6600, 0.55, 2.8);

    /* Same green shade as Globe.ts forest (first of the five shades) */
    this.treeMat = new MeshPhongMaterial({ color: 0x4a9a3a, flatShading: true });
    addRimLight(this.treeMat, 0xff8833, 0.22, 2.5);
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

  /* ── Per-frame update ────────────────────────────────────────── */

  update(dt: number, playerWorldPos: Vector3): { justLit: boolean; burnProgress: number[] } {
    let justLit = false;

    for (const s of this.states) {
      s.time += dt;

      if (s.lit) {
        s.burnTimer -= dt;
        s.fadeInT    = Math.min(1, s.fadeInT + dt / FADE_IN_DUR);

        if (s.burnTimer <= 0) {
          s.lit       = false;
          s.burnTimer = 0;
          s.fadeOutT  = 0;
        }
      } else if (s.fadeOutT < 1) {
        s.fadeOutT = Math.min(1, s.fadeOutT + dt / FADE_OUT_DUR);
      } else {
        if (playerWorldPos.distanceTo(s.worldPos) < LIGHT_RADIUS) {
          s.lit       = true;
          s.burnTimer = BURN_DURATION_SEC;
          s.fadeInT   = 0;
          s.fadeOutT  = 0;
          justLit     = true;
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
    }

    return {
      justLit,
      // 1.0 = just lit / full burn, linearly decreasing to 0.0 = extinguished.
      // Includes smooth ramp-in during FADE_IN_DUR so the progress bar
      // doesn't jump straight to the full-width value.
      burnProgress: this.states.map(s =>
        s.lit
          ? (s.burnTimer / BURN_DURATION_SEC) * easeOutQuad(s.fadeInT)
          : 0,
      ),
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
    this.treeGeo.dispose();
    this.ironMat.dispose();
    this.bowlMat.dispose();
    this.treeMat.dispose();

    this.treeMesh.dispose();
    this.treeMesh.removeFromParent();

    for (const s of this.states) {
      s.flameMat.dispose();
      s.glowMat.dispose();
      s.light.dispose();
      s.group.removeFromParent();
    }
    this.states = [];
  }
}
