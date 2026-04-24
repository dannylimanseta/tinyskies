import {
  AdditiveBlending,
  Camera,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshPhongMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  PointLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import {
  applyEternalFlameGlow,
  fitEternalFlameModel,
  getSharedEternalFlameModelRoot,
  loadEternalFlameModelOnce,
} from "./EternalFlameModel";

const SPIN_RAD = 1.1; // rad/s — one full revolution every ~5.7 s

const _radUp = new Vector3();
const _tangent = new Vector3();
const _lookTarget = new Vector3();
const _camPlane = new Vector3();

/** Tight + wide radial textures for layered additive halos (not flat discs). */
let glowCoreTex: CanvasTexture | null = null;
let glowHaloTex: CanvasTexture | null = null;
let poolTex: CanvasTexture | null = null;

function getGlowCoreTexture(): CanvasTexture {
  if (glowCoreTex) return glowCoreTex;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, "rgba(200, 245, 255, 0.95)");
  g.addColorStop(0.12, "rgba(120, 200, 255, 0.7)");
  g.addColorStop(0.35, "rgba(60, 140, 255, 0.35)");
  g.addColorStop(0.65, "rgba(20, 80, 200, 0.12)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowCoreTex = new CanvasTexture(c);
  glowCoreTex.colorSpace = SRGBColorSpace;
  return glowCoreTex;
}

function getGlowHaloTexture(): CanvasTexture {
  if (glowHaloTex) return glowHaloTex;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, "rgba(100, 180, 255, 0)");
  g.addColorStop(0.35, "rgba(70, 150, 255, 0.16)");
  g.addColorStop(0.65, "rgba(40, 100, 220, 0.22)");
  g.addColorStop(0.88, "rgba(20, 60, 180, 0.14)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowHaloTex = new CanvasTexture(c);
  glowHaloTex.colorSpace = SRGBColorSpace;
  return glowHaloTex;
}

/** Wider, softer radial biased toward the bottom — reads as a blue “pool” under the flame. */
function getPoolGlowTexture(): CanvasTexture {
  if (poolTex) return poolTex;
  const w = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = w;
  const ctx = c.getContext("2d")!;
  const h = w / 2;
  // Center of glow slightly below canvas middle so it sits under the main sprite
  const cx = h;
  const cy = w * 0.72;
  const rad = w * 0.48;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  g.addColorStop(0, "rgba(90, 190, 255, 0.45)");
  g.addColorStop(0.25, "rgba(50, 130, 255, 0.2)");
  g.addColorStop(0.5, "rgba(30, 80, 200, 0.1)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  poolTex = new CanvasTexture(c);
  poolTex.colorSpace = SRGBColorSpace;
  return poolTex;
}

/**
 * 3D eternal-flame for cosmic void: emissive mesh, blue point lights, layered additive glow,
 * slow spin. World position is set once by the caller (fixed beacon). The mesh stays “upright”
 * on the globe tangent (local +Y ≈ radial outward); glow {@link Sprite}s still face the camera.
 */
export class EternalFlameWorld {
  readonly group = new Group();
  private readonly flameModel = new Group();
  private spin = 0;
  private readonly spriteMats: SpriteMaterial[] = [];

  async init() {
    await loadEternalFlameModelOnce();
    const base = getSharedEternalFlameModelRoot().clone(true);
    applyEternalFlameGlow(base);

    // Void scene: strip emissive so the flame reads naturally under the void lighting
    // without blowing out. The UI dock/starburst clones keep their glow unchanged.
    const black = new Color(0x000000);
    base.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (
          mat instanceof MeshStandardMaterial ||
          mat instanceof MeshPhysicalMaterial ||
          mat instanceof MeshPhongMaterial ||
          mat instanceof MeshLambertMaterial
        ) {
          mat.emissive.copy(black);
          if ("emissiveIntensity" in mat) {
            (mat as MeshStandardMaterial).emissiveIntensity = 0;
          }
        }
      }
    });

    fitEternalFlameModel(base, 0.16);
    this.flameModel.add(base);
    this.group.add(this.flameModel);

    this.group.renderOrder = 120;

    const coreLight = new PointLight(0x88ccff, 1.0, 1.8, 1.5);
    coreLight.position.set(0, 0.04, 0.02);
    this.group.add(coreLight);
    const fill = new PointLight(0x5599ff, 0.45, 1.4, 1.2);
    fill.position.set(0.12, 0.08, -0.1);
    this.group.add(fill);
    const rim = new PointLight(0xaaddff, 0.26, 1.0, 1.0);
    rim.position.set(-0.1, 0, 0.08);
    this.group.add(rim);

    // Underglow: wide soft blue “pool” in view (local −Y) — add before main halos so it draws first
    const underSpecs = [
      { scale: [1.04, 0.34, 1] as const, y: -0.09, opacity: 0.22, order: 105 },
      { scale: [1.36, 0.44, 1] as const, y: -0.11, opacity: 0.14, order: 104 },
    ];
    for (const us of underSpecs) {
      const sm = new SpriteMaterial({
        map: getPoolGlowTexture(),
        color: 0xaaccff,
        transparent: true,
        opacity: us.opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      });
      this.spriteMats.push(sm);
      const sp = new Sprite(sm);
      sp.scale.set(us.scale[0], us.scale[1], us.scale[2]);
      sp.position.set(0, us.y, 0.01);
      sp.renderOrder = us.order;
      this.group.add(sp);
    }

    const layerSpecs: { tex: "core" | "halo"; scale: number; opacity: number; order: number }[] = [
      { tex: "halo", scale: 0.84, opacity: 0.25, order: 110 },
      { tex: "halo", scale: 0.62, opacity: 0.21, order: 111 },
      { tex: "core", scale: 0.42, opacity: 0.33, order: 112 },
      { tex: "core", scale: 0.28, opacity: 0.41, order: 113 },
    ];
    for (const spec of layerSpecs) {
      const map = spec.tex === "core" ? getGlowCoreTexture() : getGlowHaloTexture();
      const sm = new SpriteMaterial({
        map,
        color: 0xffffff,
        transparent: true,
        opacity: spec.opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      });
      this.spriteMats.push(sm);
      const sp = new Sprite(sm);
      sp.scale.setScalar(spec.scale);
      sp.position.set(0, 0.03, 0);
      sp.renderOrder = spec.order;
      this.group.add(sp);
    }
  }

  /** One-time world position (player-adjacent tangent point at void entry). */
  setWorldPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
  }

  /**
   * Match the upright tangent frame immediately (first frame before `update` runs).
   */
  alignToCamera(camera: Camera) {
    this.update(0, camera);
  }

  update(dt: number, camera: Camera) {
    const p = this.group.position;
    _radUp.copy(p).normalize();
    this.group.up.copy(_radUp);
    _tangent.set(0, 1, 0).cross(_radUp);
    if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0).cross(_radUp);
    _tangent.normalize();
    _camPlane.copy(camera.position).sub(p);
    if (_camPlane.lengthSq() > 1e-6) {
      _camPlane.addScaledVector(_radUp, -_camPlane.dot(_radUp));
      if (_camPlane.lengthSq() > 1e-6) {
        _camPlane.normalize();
        _tangent.lerp(_camPlane, 0.42);
        _tangent.normalize();
      }
    }
    _lookTarget.copy(p).add(_tangent);
    this.group.lookAt(_lookTarget);
    this.spin += dt * SPIN_RAD;
    this.flameModel.rotation.y = this.spin;
  }

  dispose() {
    this.flameModel.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else (mat as { dispose?: () => void })?.dispose?.();
      }
    });
    for (const m of this.spriteMats) m.dispose();
    this.spriteMats.length = 0;
    this.flameModel.clear();
    this.group.clear();
  }
}
