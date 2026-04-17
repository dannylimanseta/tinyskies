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
const GLOW_COLOR_EVENING = new Color(0xff7722);

let sharedShadowTexture: CanvasTexture | null = null;
let shadowTextureRefCount = 0;

function getSharedFishShadowTexture(): CanvasTexture {
  if (sharedShadowTexture) return sharedShadowTexture;

  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);

  const cx = 56;
  const cy = 32;
  const rx = 38;
  const ry = 18;

  const grd = ctx.createRadialGradient(cx - 8, cy, 4, cx, cy, rx + 8);
  grd.addColorStop(0, "rgba(0, 0, 0, 1.0)");
  grd.addColorStop(0.55, "rgba(0, 2, 6, 0.85)");
  grd.addColorStop(1, "rgba(0, 2, 6, 0)");

  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.beginPath();
  ctx.moveTo(cx - rx + 4, cy);
  ctx.lineTo(cx - rx - 22, cy + 6);
  ctx.lineTo(cx - rx - 18, cy - 5);
  ctx.closePath();
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

  // Soft, multi-stop gradient — bright core fades gradually into transparency.
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  grd.addColorStop(0.0, "rgba(120, 240, 220, 1.00)");
  grd.addColorStop(0.15, "rgba(80, 220, 220, 0.75)");
  grd.addColorStop(0.35, "rgba(40, 180, 220, 0.45)");
  grd.addColorStop(0.60, "rgba(20, 120, 200, 0.22)");
  grd.addColorStop(0.85, "rgba(10, 70, 140, 0.07)");
  grd.addColorStop(1.0, "rgba(0, 40, 100, 0)");

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
  /**
   * Drives bioluminescent glow: intensity from night and/or evening, color blends
   * orange (evening) toward cyan (night).
   */
  setNightGlow(nightWeight: number, eveningWeight?: number): void;
  dispose(): void;
}

const BAR_H = 0.09;
const BAR_W = 0.014;
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

  // Main dark shadow
  const shadowGeo = new PlaneGeometry(0.18, 0.09);
  const shadowMat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: DoubleSide,
  });
  // Bioluminescent night glow — rendered BEFORE the shadow so the dark shadow sits on top.
  // Square plane + square texture → round, blurred halo (not an ellipse).
  const glowGeo = new PlaneGeometry(0.55, 0.55);
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

  // Dark shadow — rendered AFTER glow so it draws on top
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

  function setNightGlow(night: number, evening = 0) {
    const g = Math.max(0, Math.min(1, Math.max(night, evening) * opacityFade));
    const denom = night + evening + 1e-6;
    const tNight = night / denom;
    glowMat.color.copy(GLOW_COLOR_EVENING).lerp(GLOW_COLOR_NIGHT, tNight);
    glowMat.opacity = g * 0.85;
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

  return {
    group,
    shadowGroup,
    barGroup,
    setProgress,
    setShadowOpacity,
    setOpacityFade,
    setNightGlow,
    dispose,
  };
}
