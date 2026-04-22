import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";

/** Bioluminescent night tint (cool cyan). */
const GLOW_COLOR_NIGHT = new Color(0x66eeff);
/** Dusk / evening tint for the same glow (warm orange). */
const GLOW_COLOR_EVENING = new Color(0xff4400);

export type FishVariant = "normal" | "large" | "octopus";

let sharedShadowTexture: CanvasTexture | null = null;
let sharedLargeShadowTexture: CanvasTexture | null = null;
let shadowTextureRefCount = 0;

function getSharedFishShadowTexture(): CanvasTexture {
  if (sharedShadowTexture) return sharedShadowTexture;

  /**
   * Top-down silhouette: canvas +X = fish forward (head), +Y = lateral.
   */
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);

  const ink = "rgba(8, 14, 22, 0.78)";
  const fin = "rgba(6, 12, 20, 0.68)";
  const tailInk = "rgba(5, 10, 18, 0.94)";

  // Sleek, organic teardrop body using bezier curves
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(210, 64); // Snout
  ctx.bezierCurveTo(210, 30, 130, 35, 60, 60); // Top edge
  ctx.lineTo(60, 68); // Tail peduncle
  ctx.bezierCurveTo(130, 93, 210, 98, 210, 64); // Bottom edge
  ctx.fill();

  // Single rounded paddle tail (smaller)
  ctx.fillStyle = tailInk;
  ctx.beginPath();
  ctx.moveTo(65, 64); // Overlap with body
  ctx.bezierCurveTo(50, 48, 30, 45, 20, 54); // Top curve
  ctx.bezierCurveTo(15, 60, 15, 68, 20, 74); // Back edge (rounded)
  ctx.bezierCurveTo(30, 83, 50, 80, 65, 64); // Bottom curve
  ctx.fill();

  // Swept-back pectoral fins
  ctx.fillStyle = fin;
  // Left (Top on canvas)
  ctx.beginPath();
  ctx.moveTo(140, 42); // Root front
  ctx.bezierCurveTo(135, 20, 110, 10, 90, 15); // Tip
  ctx.bezierCurveTo(110, 25, 120, 35, 125, 45); // Root back
  ctx.fill();
  // Right (Bottom on canvas)
  ctx.beginPath();
  ctx.moveTo(140, 86);
  ctx.bezierCurveTo(135, 108, 110, 118, 90, 113);
  ctx.bezierCurveTo(110, 103, 120, 93, 125, 83);
  ctx.fill();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  sharedShadowTexture = tex;
  return tex;
}

function getSharedLargeFishShadowTexture(): CanvasTexture {
  if (sharedLargeShadowTexture) return sharedLargeShadowTexture;

  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);

  const ink = "rgba(8, 14, 22, 0.85)";
  const fin = "rgba(6, 12, 20, 0.75)";
  const tailInk = "rgba(5, 10, 18, 0.96)";

  // Chunky body
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(220, 64); // Blunt snout
  ctx.bezierCurveTo(220, 20, 120, 20, 50, 55); // Top edge, wide
  ctx.lineTo(50, 73); // Thicker peduncle
  ctx.bezierCurveTo(120, 108, 220, 108, 220, 64); // Bottom edge
  ctx.fill();

  // Broad, single paddle tail (smaller)
  ctx.fillStyle = tailInk;
  ctx.beginPath();
  ctx.moveTo(55, 64);
  ctx.bezierCurveTo(40, 40, 20, 35, 15, 50);
  ctx.bezierCurveTo(10, 58, 10, 70, 15, 78);
  ctx.bezierCurveTo(20, 93, 40, 88, 55, 64);
  ctx.fill();

  // Pectorals (larger, sticking out more)
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(150, 35);
  ctx.bezierCurveTo(145, 5, 110, 0, 80, 5);
  ctx.bezierCurveTo(110, 20, 130, 30, 135, 38);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(150, 93);
  ctx.bezierCurveTo(145, 123, 110, 128, 80, 123);
  ctx.bezierCurveTo(110, 108, 130, 98, 135, 90);
  ctx.fill();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  sharedLargeShadowTexture = tex;
  return tex;
}

// ── Octopus textures (mantle + shared tentacle strip) ────────────────────
let octopusTexRefCount = 0;
let sharedMantleTex: CanvasTexture | null = null;
let sharedTentacleTex: CanvasTexture | null = null;

/** Draws just the mantle sac + head oval — no tentacles (those are separate meshes). */
function getOctopusMantleTexture(): CanvasTexture {
  if (sharedMantleTex) return sharedMantleTex;
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 192, 128);

  const ink = "rgba(6, 10, 22, 0.97)";
  ctx.fillStyle = ink;

  // Head/body oval (left side — where tentacles root)
  ctx.beginPath();
  ctx.ellipse(58, 64, 26, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mantle sac: organic teardrop pointing +X (right)
  ctx.beginPath();
  ctx.moveTo(178, 64);                             // pointed tip
  ctx.bezierCurveTo(176, 30, 122, 24, 76, 32);    // top edge
  ctx.lineTo(76, 96);                              // base left
  ctx.bezierCurveTo(122, 104, 176, 98, 178, 64);  // bottom edge
  ctx.fill();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  sharedMantleTex = tex;
  return tex;
}

/**
 * Shared tapered arm texture reused for all 8 tentacle meshes.
 * Runs along X: wide at base (left, uv.x=0), tapers to transparent at tip (right, uv.x=1).
 */
function getOctopusTentacleTexture(): CanvasTexture {
  if (sharedTentacleTex) return sharedTentacleTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 32);

  const cy = 16;
  // Fade alpha from opaque at base to transparent at tip
  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0.0, "rgba(6,10,22,0.92)");
  grad.addColorStop(0.65, "rgba(6,10,22,0.72)");
  grad.addColorStop(1.0, "rgba(6,10,22,0.0)");
  ctx.fillStyle = grad;

  // Filled tapered shape: full height at x=0, tapers to a point at x=127
  ctx.beginPath();
  ctx.moveTo(0, cy - 13);
  ctx.bezierCurveTo(32, cy - 13, 72, cy - 5, 126, cy);
  ctx.bezierCurveTo(72, cy + 5, 32, cy + 13, 0, cy + 13);
  ctx.closePath();
  ctx.fill();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  sharedTentacleTex = tex;
  return tex;
}

// ── Octopus visual factory ────────────────────────────────────────────────
/**
 * Creates an octopus shadow composed of 8 independent tentacle strip meshes
 * (each with its own animation phase) plus a mantle mesh — so every tentacle
 * can ripple autonomously in the water plane.
 */
function createOctopusVisual(): OceanFishVisual {
  octopusTexRefCount += 1;
  glowTextureRefCount += 1;

  const group = new Group();
  const shadowGroup = new Group();
  shadowGroup.scale.setScalar(2.25 * 0.65);

  // ── Glow halo ──────────────────────────────────────────────────────────
  const glowGeo = new PlaneGeometry(0.42, 0.42);
  const glowMat = new MeshBasicMaterial({
    map: getSharedGlowTexture(),
    color: GLOW_COLOR_NIGHT.clone(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const glowMesh = new Mesh(glowGeo, glowMat);
  glowMesh.rotation.x = -Math.PI / 2;
  glowMesh.renderOrder = 7;
  shadowGroup.add(glowMesh);

  // ── Tentacles ──────────────────────────────────────────────────────────
  // 8 fan angles (degrees from the backward direction; positive = toward +Z).
  // Inner tentacles are longer and thicker.
  const ANGLES_DEG = [-65, -40, -18, -5, 5, 18, 40, 65] as const;
  const LENGTHS    = [0.095, 0.120, 0.140, 0.150, 0.150, 0.140, 0.120, 0.095] as const;
  const WIDTHS     = [0.022, 0.028, 0.032, 0.034, 0.034, 0.032, 0.028, 0.022] as const;

  const tentacleMats: MeshBasicMaterial[] = [];
  const tentacleTimeUs: { value: number }[] = [];
  const tentTex = getOctopusTentacleTexture();

  for (let i = 0; i < 8; i++) {
    const fanAngle = ANGLES_DEG[i]! * (Math.PI / 180);
    const len = LENGTHS[i]!;
    const width = WIDTHS[i]!;
    // Irregular per-tentacle phase so they never move in sync
    const phase = (i / 8) * Math.PI * 2 + Math.sin(i * 2.3) * 0.6;

    // Wrapper rotates the strip to its fan direction (pointing backward + spread)
    const wrapper = new Group();
    wrapper.rotation.y = Math.PI + fanAngle;

    const tentGeo = new PlaneGeometry(len, width, 18, 1);
    const timeU = { value: 0.0 };
    tentacleTimeUs.push(timeU);

    const mat = new MeshBasicMaterial({
      map: tentTex,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: DoubleSide,
    });
    tentacleMats.push(mat);

    // Capture loop-variable values for the shader closure
    const capturedTimeU = timeU;
    const capturedPhase = phase;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tentTime = capturedTimeU;
      shader.uniforms.tentPhase = { value: capturedPhase };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
        uniform float tentTime;
        uniform float tentPhase;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // uv.x: 0 = base (head), 1 = tip
        float tipFactor = uv.x;
        // Traveling wave ripples from base toward tip — primary frequency
        float wave1 = sin(tentTime * 3.2 + tentPhase + tipFactor * 3.14159) * tipFactor * tipFactor * 0.048;
        // Secondary harmonic adds texture/complexity
        float wave2 = sin(tentTime * 5.8 + tentPhase * 1.6 + tipFactor * 6.28) * tipFactor * 0.022;
        // transformed.y is lateral in the water plane (after rotation.x = -PI/2 on the mesh)
        transformed.y += wave1 + wave2;
        `,
      );
    };

    const tentMesh = new Mesh(tentGeo, mat);
    tentMesh.rotation.x = -Math.PI / 2;
    // Shift along +X so the base of the strip sits at the wrapper origin (= head)
    tentMesh.position.x = len / 2;
    tentMesh.renderOrder = 8;

    wrapper.add(tentMesh);
    shadowGroup.add(wrapper);
  }

  // ── Mantle (drawn on top so it covers tentacle bases cleanly) ──────────
  const mantleGeo = new PlaneGeometry(0.19, 0.115, 2, 1);
  const mantleMat = new MeshBasicMaterial({
    map: getOctopusMantleTexture(),
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: DoubleSide,
  });
  const mantleMesh = new Mesh(mantleGeo, mantleMat);
  mantleMesh.rotation.x = -Math.PI / 2;
  mantleMesh.position.x = 0.038; // shift forward so head center aligns with tentacle roots
  mantleMesh.renderOrder = 9;
  shadowGroup.add(mantleMesh);

  group.add(shadowGroup);

  // ── Progress bar (identical to normal fish) ────────────────────────────
  const barGroup = new Group();
  const barBgGeo = new PlaneGeometry(BAR_W, BAR_H);
  const barBgMat = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
  });
  const barBgMesh = new Mesh(barBgGeo, barBgMat);
  barBgMesh.position.y = FILL_HALF;
  barBgMesh.renderOrder = 20;
  const barFillGeo = new PlaneGeometry(BAR_W, BAR_H);
  const barFillMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const barFillMesh = new Mesh(barFillGeo, barFillMat);
  barFillMesh.renderOrder = 21;
  barGroup.add(barBgMesh);
  barGroup.add(barFillMesh);
  group.add(barGroup);

  let opacityFade = 1;

  function setProgress(v: number) {
    const p = Math.max(0, Math.min(1, v));
    barFillMesh.visible = p > 0.001;
    barGroup.visible = p > 0.001;
    barFillMesh.scale.y = p;
    barFillMesh.position.y = FILL_HALF * p;
  }

  function setShadowOpacity(a: number) {
    const t = Math.max(0, Math.min(1, a * opacityFade));
    for (const m of tentacleMats) {
      m.opacity = t;
      m.visible = t > 0.01;
    }
    mantleMat.opacity = t;
    mantleMesh.visible = t > 0.01;
  }

  function setOpacityFade(a: number) {
    opacityFade = Math.max(0, Math.min(1, a));
  }

  // Tentacles animate independently via setTime; no whole-body tilt needed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function setShadowWiggle(_rad: number) { /* intentional no-op for octopus */ }

  function setTime(t: number) {
    for (const u of tentacleTimeUs) {
      u.value = t;
    }
  }

  function setNightGlow(night: number, evening = 0) {
    const g = Math.max(0, Math.min(1, Math.max(night, evening) * opacityFade));
    const denom = night + evening + 1e-6;
    const tNight = night / denom;
    glowMat.color.copy(GLOW_COLOR_EVENING).lerp(GLOW_COLOR_NIGHT, tNight);
    const alphaScale = 0.35 * (1 - tNight) + 0.15 * tNight;
    glowMat.opacity = g * alphaScale;
    glowMesh.visible = g > 0.02;
  }

  function dispose() {
    glowGeo.dispose();
    glowMat.dispose();
    for (const m of tentacleMats) m.dispose();
    mantleGeo.dispose();
    mantleMat.dispose();
    barBgGeo.dispose();
    barBgMat.dispose();
    barFillGeo.dispose();
    barFillMat.dispose();

    octopusTexRefCount -= 1;
    if (octopusTexRefCount <= 0) {
      sharedMantleTex?.dispose(); sharedMantleTex = null;
      sharedTentacleTex?.dispose(); sharedTentacleTex = null;
    }
    glowTextureRefCount -= 1;
    if (glowTextureRefCount <= 0 && sharedGlowTexture) {
      sharedGlowTexture.dispose();
      sharedGlowTexture = null;
    }
  }

  setProgress(0);
  setNightGlow(0);
  setShadowWiggle(0);

  return {
    group,
    shadowGroup,
    barGroup,
    setProgress,
    setShadowOpacity,
    setOpacityFade,
    setShadowWiggle,
    setTime,
    setNightGlow,
    dispose,
  };
}

let sharedGlowTexture: CanvasTexture | null = null;
let glowTextureRefCount = 0;

function getSharedGlowTexture(): CanvasTexture {
  if (sharedGlowTexture) return sharedGlowTexture;

  // Large, soft radial gradient so the glow reads as a blurred halo, not a disc.
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);

  const cx = 128;
  const cy = 128;
  const outer = 124;

  // Neutral luminance — tint comes from {@link MeshBasicMaterial#color} (cyan night, orange evening).
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  grd.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
  grd.addColorStop(0.15, "rgba(255, 255, 255, 0.78)");
  grd.addColorStop(0.35, "rgba(220, 220, 220, 0.48)");
  grd.addColorStop(0.6, "rgba(140, 140, 140, 0.22)");
  grd.addColorStop(0.85, "rgba(60, 60, 60, 0.07)");
  grd.addColorStop(1.0, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  sharedGlowTexture = tex;
  return tex;
}

export interface OceanFishVisual {
  readonly group: Group;
  readonly shadowGroup: Group;
  readonly barGroup: Group;
  setProgress(v: number): void;
  setShadowOpacity(a: number): void;
  setOpacityFade(a: number): void;
  /** Roll in the water plane (radians) for swimming wiggle — applied to shadow silhouette. */
  setShadowWiggle(rad: number): void;
  /** Pass the current game time (in seconds) to animate independent parts like octopus tentacles. */
  setTime(t: number): void;
  /**
   * Drives bioluminescent glow: intensity from night and/or evening, color blends
   * orange (evening) toward cyan (night).
   */
  setNightGlow(nightWeight: number, eveningWeight?: number): void;
  dispose(): void;
}

const BAR_H = 0.045;
const BAR_W = 0.007;
const FILL_HALF = BAR_H * 0.5;

/**
 * Fish shadow + vertical progress bar. Parent positions `group` at world position;
 * `shadowGroup` / `barGroup` rotations are set by {@link OceanFish}.
 */
export function createFishVisual(variant: FishVariant = "normal"): OceanFishVisual {
  if (variant === "octopus") return createOctopusVisual();

  const isLarge = variant === "large";
  shadowTextureRefCount += 1;
  glowTextureRefCount += 1;

  const tex = isLarge
    ? getSharedLargeFishShadowTexture()
    : getSharedFishShadowTexture();
  const glowTex = getSharedGlowTexture();

  const group = new Group();

  const shadowGroup = new Group();
  shadowGroup.scale.setScalar(isLarge ? 1.5 * 0.65 : 0.65);

  // Top-view shadow (texture +X forward, ±Y lateral); 8 segments along X for smooth tail bend
  const shadowGeo = new PlaneGeometry(0.12, 0.055, 8, 1);
  const shadowMat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: DoubleSide,
  });

  const bendUniform = { value: 0.0 };
  shadowMat.onBeforeCompile = (shader) => {
    shader.uniforms.bend = bendUniform;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      uniform float bend;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      // uv.x: 0 = tail, 1 = head
      float tail = 1.0 - uv.x;
      transformed.y += bend * tail * tail * 0.12;
      transformed.x -= abs(bend) * tail * tail * 0.03;
      `,
    );
  };

  // Bioluminescent night glow — rendered BEFORE the shadow so the dark shadow sits on top.
  const glowGeo = new PlaneGeometry(0.275, 0.275);
  const glowMat = new MeshBasicMaterial({
    map: glowTex,
    color: GLOW_COLOR_NIGHT.clone(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const glowMesh = new Mesh(glowGeo, glowMat);
  glowMesh.rotation.x = -Math.PI / 2;
  glowMesh.renderOrder = 7;
  shadowGroup.add(glowMesh);

  // Dark shadow — rendered AFTER glow so it draws on top.
  const shadowMesh = new Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.renderOrder = 8;
  shadowGroup.add(shadowMesh);

  group.add(shadowGroup);

  // Progress bar
  const barGroup = new Group();

  const barBgGeo = new PlaneGeometry(BAR_W, BAR_H);
  const barBgMat = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
  });
  const barBgMesh = new Mesh(barBgGeo, barBgMat);
  barBgMesh.position.y = FILL_HALF;
  barBgMesh.renderOrder = 20;

  const barFillGeo = new PlaneGeometry(BAR_W, BAR_H);
  const barFillMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const barFillMesh = new Mesh(barFillGeo, barFillMat);
  barFillMesh.renderOrder = 21;

  barGroup.add(barBgMesh);
  barGroup.add(barFillMesh);

  group.add(barGroup);

  let opacityFade = 1;

  function setProgress(v: number) {
    const p = Math.max(0, Math.min(1, v));
    barFillMesh.visible = p > 0.001;
    barGroup.visible = p > 0.001;
    barFillMesh.scale.y = p;
    barFillMesh.position.y = FILL_HALF * p;
  }

  function setShadowOpacity(a: number) {
    const t = Math.max(0, Math.min(1, a * opacityFade));
    shadowMat.opacity = t;
    shadowMesh.visible = t > 0.01;
  }

  function setOpacityFade(a: number) {
    opacityFade = Math.max(0, Math.min(1, a));
  }

  function setShadowWiggle(rad: number) {
    const r = Math.max(-0.8, Math.min(0.8, rad));
    bendUniform.value = r;
    // Add a small amount of rigid rotation so the head sways slightly too
    shadowMesh.rotation.z = r * 0.35;
    glowMesh.rotation.z = r * 0.4;
  }

  function setNightGlow(night: number, evening = 0) {
    const g = Math.max(0, Math.min(1, Math.max(night, evening) * opacityFade));
    const denom = night + evening + 1e-6;
    const tNight = night / denom;
    // Neutral glow map → material color reads clearly: orange (evening) vs cyan (night).
    glowMat.color.copy(GLOW_COLOR_EVENING).lerp(GLOW_COLOR_NIGHT, tNight);

    const alphaScale = 0.35 * (1 - tNight) + 0.15 * tNight;
    glowMat.opacity = g * alphaScale;
    glowMesh.visible = g > 0.02;
  }

  function dispose() {
    shadowGeo.dispose();
    shadowMat.dispose();
    glowGeo.dispose();
    glowMat.dispose();
    barBgGeo.dispose();
    barBgMat.dispose();
    barFillGeo.dispose();
    barFillMat.dispose();

    shadowTextureRefCount -= 1;
    if (shadowTextureRefCount <= 0) {
      sharedShadowTexture?.dispose(); sharedShadowTexture = null;
      sharedLargeShadowTexture?.dispose(); sharedLargeShadowTexture = null;
    }
    glowTextureRefCount -= 1;
    if (glowTextureRefCount <= 0 && sharedGlowTexture) {
      sharedGlowTexture.dispose();
      sharedGlowTexture = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function setTime(_t: number) { /* no-op for regular fish */ }

  setProgress(0);
  setNightGlow(0);
  setShadowWiggle(0);

  return {
    group,
    shadowGroup,
    barGroup,
    setProgress,
    setShadowOpacity,
    setOpacityFade,
    setShadowWiggle,
    setNightGlow,
    setTime,
    dispose,
  };
}
