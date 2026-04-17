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

let sharedShadowTexture: CanvasTexture | null = null;
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

  // Crescent caudal fin (tail)
  ctx.fillStyle = tailInk;
  ctx.beginPath();
  ctx.moveTo(65, 64); // Overlap with body
  ctx.bezierCurveTo(50, 55, 35, 35, 25, 25); // Top lobe tip
  ctx.bezierCurveTo(35, 45, 45, 55, 50, 64); // Inner fork top
  ctx.bezierCurveTo(45, 73, 35, 83, 25, 103); // Bottom lobe tip
  ctx.bezierCurveTo(35, 93, 50, 73, 65, 64); // Back to base
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
export function createFishVisual(): OceanFishVisual {
  shadowTextureRefCount += 1;
  glowTextureRefCount += 1;
  const tex = getSharedFishShadowTexture();
  const glowTex = getSharedGlowTexture();

  const group = new Group();

  const shadowGroup = new Group();

  // Top-view shadow (texture +X forward, ±Y lateral); ~50% of prior footprint
  const shadowGeo = new PlaneGeometry(0.12, 0.055);
  const shadowMat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: DoubleSide,
  });
  // Bioluminescent night glow — rendered BEFORE the shadow so the dark shadow sits on top.
  // Square plane + square texture → round, blurred halo (not an ellipse).
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
    const r = Math.max(-0.55, Math.min(0.55, rad));
    shadowMesh.rotation.z = r;
    glowMesh.rotation.z = r * 0.35;
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
    if (shadowTextureRefCount <= 0 && sharedShadowTexture) {
      sharedShadowTexture.dispose();
      sharedShadowTexture = null;
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
    setNightGlow,
    dispose,
  };
}
