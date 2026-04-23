import {
  AmbientLight,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ProgressionManager } from "../game/ProgressionManager";

const GLB_URL = "/3D/eternal_flame.glb";
const STARBURST_URL = "/2D/starburst.png";
const STYLE_ID = "eternal-flame-ui-styles";
const HOLD_MS = 2800;
const FLY_MS = 820;
const DOCK_PX = 72;
/** Per-flame width when multiple eternal flames are in the dock (horizontal strip). */
const DOCK_SLOT_W = 58;
const DOCK_GAP_PX = 5;
const PREVIEW_PX = 280;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes eternal-flame-starburst-spin {
      from { transform: translate(-50%, -50%) rotate(0deg); }
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }
    .eternal-flame-overlay {
      position: fixed;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      min-height: 100dvh;
      min-height: -webkit-fill-available;
      z-index: 195;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: max(12px, env(safe-area-inset-top, 0px))
        max(12px, env(safe-area-inset-right, 0px))
        max(12px, env(safe-area-inset-bottom, 0px))
        max(12px, env(safe-area-inset-left, 0px));
      background: rgba(0, 0, 0, 0.52);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.35s ease;
    }
    .eternal-flame-overlay--in { opacity: 1; }
    .eternal-flame-overlay-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
    .eternal-flame-loot-message {
      margin: 0;
      max-width: min(90vw, 440px);
      padding: 0 20px;
      font-size: 0.98rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1.45;
      text-align: center;
      color: rgba(240, 248, 255, 0.96);
      text-shadow:
        0 0 18px rgba(80, 160, 255, 0.55),
        0 0 32px rgba(40, 100, 220, 0.35),
        0 2px 10px rgba(0, 0, 0, 0.55);
      transition: opacity 0.25s ease;
    }
    .eternal-flame-loot-message--out {
      opacity: 0;
    }
    .eternal-flame-stack {
      position: relative;
      display: block;
      flex-shrink: 0;
      width: ${PREVIEW_PX}px;
      max-width: min(${PREVIEW_PX}px, calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
      height: ${PREVIEW_PX}px;
      max-height: min(${PREVIEW_PX}px, 72vh);
      margin: 0 auto;
    }
    .eternal-flame-starburst {
      position: absolute;
      left: 50%;
      top: 50%;
      width: min(120vw, 880px);
      height: auto;
      z-index: 0;
      opacity: 0.9;
      pointer-events: none;
      animation: eternal-flame-starburst-spin 18s linear infinite;
    }
    .eternal-flame-canvas-wrap {
      position: relative;
      z-index: 1;
      width: 100%;
      height: 100%;
    }
    .eternal-flame-dock {
      position: fixed;
      left: max(8px, env(safe-area-inset-left, 0px));
      bottom: max(8px, env(safe-area-inset-bottom, 0px));
      height: ${DOCK_PX}px;
      z-index: 25;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.35s ease;
    }
    .eternal-flame-dock canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .eternal-flame-dock.visible { opacity: 1; }
  `;
  document.head.appendChild(style);
}

function fitModel(root: Object3D, target = 0.42) {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const max = Math.max(size.x, size.y, size.z, 1e-4);
  const s = target / max;
  root.scale.setScalar(s);
  const c = box.getCenter(new Vector3());
  root.position.copy(c.multiplyScalar(-s));
}

/** Cool blue-cyan eternal flame (reads richer than pale orange wash). */
const EMISSIVE_CORE = new Color(0x3399ff);
const EMISSIVE_RIM = new Color(0x88ddff);
const BASE_TINT = new Color(0x4a88cc);

/** Strong emissive + local fill light so the flame reads as self-lit in preview and dock. */
function applyEternalFlameGlow(root: Object3D) {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next: typeof mats = [];
    for (let mi = 0; mi < mats.length; mi++) {
      const mat = mats[mi]!;
      if (mat instanceof MeshBasicMaterial) {
        const c = mat.color.clone().lerp(BASE_TINT, 0.35);
        const rep = new MeshStandardMaterial({
          color: c,
          map: mat.map,
          transparent: mat.transparent,
          opacity: mat.opacity,
          depthWrite: mat.depthWrite,
          side: mat.side,
          emissive: EMISSIVE_CORE.clone(),
          emissiveIntensity: 2.85,
          emissiveMap: mat.map ?? null,
        });
        mat.dispose();
        next.push(rep);
        continue;
      }
      if (
        mat instanceof MeshStandardMaterial ||
        mat instanceof MeshPhysicalMaterial
      ) {
        mat.color.lerp(BASE_TINT, 0.22);
        mat.emissive.copy(EMISSIVE_CORE);
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 2.65);
        if (!mat.emissiveMap && mat.map) mat.emissiveMap = mat.map;
        next.push(mat);
        continue;
      }
      if (mat instanceof MeshPhongMaterial || mat instanceof MeshLambertMaterial) {
        mat.emissive.copy(EMISSIVE_RIM);
        mat.emissive.multiplyScalar(2.0);
        mat.color.lerp(BASE_TINT, 0.28);
        next.push(mat);
        continue;
      }
      if ("emissive" in mat && (mat as { emissive?: Color }).emissive) {
        const m = mat as MeshPhongMaterial;
        m.emissive.copy(EMISSIVE_CORE);
        const ei = (m as { emissiveIntensity?: number }).emissiveIntensity;
        if (typeof ei === "number") {
          (m as { emissiveIntensity: number }).emissiveIntensity = Math.max(ei, 1.8);
        }
        next.push(mat);
        continue;
      }
      next.push(mat);
    }
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}

function dockWidthForCount(n: number): number {
  if (n <= 0) return DOCK_PX;
  return n * DOCK_SLOT_W + Math.max(0, n - 1) * DOCK_GAP_PX;
}

/** Dispose materials only — GLTF geometry is shared with `flameTemplate` and must stay valid. */
function disposeCloneMaterials(obj: Object3D) {
  obj.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as MeshPhongMaterial | undefined)?.dispose?.();
    }
  });
}

function disposeObject3DFull(obj: Object3D) {
  obj.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as MeshPhongMaterial | undefined)?.dispose?.();
    }
  });
}

/**
 * Gremlin King loot: full-screen 3D eternal flame + starburst, then flies to a HUD dock.
 * Dock shows while the player has unused eternal flames in inventory.
 */
export class EternalFlameUI {
  private readonly container: HTMLElement;
  private readonly dock: HTMLDivElement;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private renderer: WebGLRenderer | null = null;
  private modelRoot: Group | null = null;
  /** Loaded once; clones fill the dock when count &gt; 1. */
  private flameTemplate: Object3D | null = null;
  private dockFlameCount = 0;
  private readonly clock = new Clock();
  private raf = 0;
  private loopRunning = false;
  private modelLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private busy = false;

  constructor(container: HTMLElement, _hudRoot: HTMLElement) {
    ensureStyles();
    this.container = container;
    this.dock = document.createElement("div");
    this.dock.className = "eternal-flame-dock";
    this.dock.setAttribute("aria-hidden", "true");
    this.dock.title = "Eternal flame — bring it to a brazier to keep it burning forever.";
    container.appendChild(this.dock);
  }

  syncFromSave() {
    const n = ProgressionManager.loadPlayerWorldState().eternalFlameCount ?? 0;
    this.setDockVisible(n > 0);
    void this.ensureSceneReady().then(() => {
      if (this.busy) return;
      this.rebuildDockFlames(n);
      const w = dockWidthForCount(n);
      if (n > 0 && this.renderer && this.dock) {
        this.dock.style.width = `${w}px`;
        if (!this.dock.contains(this.renderer.domElement)) {
          this.dock.appendChild(this.renderer.domElement);
        }
        this.resizeRenderer(w, DOCK_PX);
      } else if (this.dock) {
        this.dock.style.width = "";
      }
    });
  }

  private rebuildDockFlames(count: number) {
    if (!this.modelRoot || !this.flameTemplate) return;
    while (this.modelRoot.children.length > 0) {
      const c = this.modelRoot.children[0]!;
      disposeCloneMaterials(c);
      this.modelRoot.remove(c);
    }
    this.dockFlameCount = count;
    if (count <= 0) return;
    const fitT = count > 2 ? 0.32 : count > 1 ? 0.36 : 0.42;
    const spacing = 0.5;
    for (let i = 0; i < count; i++) {
      const node = this.flameTemplate.clone(true);
      applyEternalFlameGlow(node);
      fitModel(node, fitT);
      node.position.x = (i - (count - 1) * 0.5) * spacing;
      this.modelRoot.add(node);
    }
  }

  private setDockVisible(visible: boolean) {
    this.dock.classList.toggle("visible", visible);
  }

  /** Award sequence after Gremlin King defeat (caller already saved +1 flame). */
  playKingLootSequence() {
    if (this.busy) return;
    this.busy = true;
    void this.runLootSequence();
  }

  private async runLootSequence() {
    await this.ensureSceneReady();
    if (!this.renderer || !this.scene || !this.camera || !this.modelRoot || !this.flameTemplate) {
      this.busy = false;
      this.syncFromSave();
      return;
    }

    const total =
      ProgressionManager.loadPlayerWorldState().eternalFlameCount ?? 0;
    this.rebuildDockFlames(1);

    this.setDockVisible(false);

    const overlay = document.createElement("div");
    overlay.className = "eternal-flame-overlay";
    overlay.setAttribute("role", "presentation");

    const inner = document.createElement("div");
    inner.className = "eternal-flame-overlay-inner";

    const stack = document.createElement("div");
    stack.className = "eternal-flame-stack";

    const msg = document.createElement("p");
    msg.className = "eternal-flame-loot-message";
    msg.textContent =
      "You have found an Eternal Flame. It might be useful later.";

    const star = document.createElement("img");
    star.className = "eternal-flame-starburst";
    star.src = STARBURST_URL;
    star.alt = "";
    star.decoding = "async";
    star.draggable = false;

    const wrap = document.createElement("div");
    wrap.className = "eternal-flame-canvas-wrap";
    wrap.appendChild(this.renderer.domElement);

    stack.appendChild(star);
    stack.appendChild(wrap);
    inner.appendChild(stack);
    inner.appendChild(msg);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    this.resizeRenderer(PREVIEW_PX, PREVIEW_PX);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add("eternal-flame-overlay--in"));
    });

    await new Promise<void>((r) => setTimeout(r, HOLD_MS));

    msg.classList.add("eternal-flame-loot-message--out");

    this.dock.style.width = `${dockWidthForCount(total)}px`;
    this.dock.style.height = `${DOCK_PX}px`;

    const from = stack.getBoundingClientRect();
    const to = this.dock.getBoundingClientRect();
    const dx = to.left - from.left + (to.width - from.width) * 0.5;
    const dy = to.top - from.top + (to.height - from.height) * 0.5;
    const scale = to.width / from.width;

    stack.style.willChange = "transform";
    stack.style.transformOrigin = "center center";
    stack.style.transition = `transform ${FLY_MS}ms cubic-bezier(0.33, 1, 0.35, 1)`;
    requestAnimationFrame(() => {
      stack.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    });

    await new Promise<void>((r) => setTimeout(r, FLY_MS + 60));

    this.renderer!.domElement.remove();
    overlay.remove();
    this.rebuildDockFlames(total);
    this.dock.style.width = `${dockWidthForCount(total)}px`;
    this.dock.appendChild(this.renderer.domElement);
    this.resizeRenderer(dockWidthForCount(total), DOCK_PX);
    this.setDockVisible(true);
    this.busy = false;
  }

  private resizeRenderer(w: number, h: number) {
    if (!this.renderer || !this.camera) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const n = this.dockFlameCount;
    this.camera.position.z = 1.12 + Math.max(0, n - 1) * 0.095;
    this.camera.updateProjectionMatrix();
  }

  private async ensureSceneReady(): Promise<void> {
    if (this.modelLoaded && this.scene) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      this.scene = new Scene();
      this.scene.background = null;

      this.camera = new PerspectiveCamera(42, 1, 0.05, 20);
      this.camera.position.set(0, 0.06, 1.15);

      const amb = new AmbientLight(0xd8e8ff, 0.48);
      this.scene.add(amb);
      const dir = new DirectionalLight(0xeef6ff, 0.72);
      dir.position.set(0.6, 1.2, 0.8);
      this.scene.add(dir);
      const core = new PointLight(0x55aaff, 3.2, 4.5, 1.85);
      core.position.set(0, 0.05, 0.35);
      this.scene.add(core);
      const rim = new PointLight(0xaaddff, 1.45, 3.2, 1.5);
      rim.position.set(-0.35, 0.2, 0.5);
      this.scene.add(rim);

      this.modelRoot = new Group();
      this.scene.add(this.modelRoot);

      this.renderer = new WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.outputColorSpace = SRGBColorSpace;

      await new Promise<void>((resolve) => {
        const loader = new GLTFLoader();
        loader.load(
          GLB_URL,
          (gltf) => {
            this.flameTemplate = gltf.scene;
            this.modelLoaded = true;
            resolve();
          },
          undefined,
          () => {
            const g = new Group();
            const geo = new IcosahedronGeometry(0.22, 1);
            const mat = new MeshPhongMaterial({
              color: 0x4488cc,
              emissive: 0x2288ff,
              emissiveIntensity: 1.85,
              flatShading: true,
            });
            g.add(new Mesh(geo, mat));
            this.flameTemplate = g;
            this.modelLoaded = true;
            resolve();
          },
        );
      });

      this.startLoop();
    })();

    return this.loadPromise;
  }

  private startLoop() {
    if (this.loopRunning) return;
    this.loopRunning = true;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.scene || !this.camera || !this.renderer || !this.modelRoot) return;
      const dt = this.clock.getDelta();
      // Spin each docked flame on its own pivot — rotating the whole group locked them together.
      for (let i = 0; i < this.modelRoot.children.length; i++) {
        const child = this.modelRoot.children[i]!;
        const rate = 1.02 + ((i * 0.23) % 0.38);
        child.rotation.y += dt * rate;
      }
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.loopRunning = false;
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    if (this.modelRoot) {
      while (this.modelRoot.children.length > 0) {
        const c = this.modelRoot.children[0]!;
        disposeCloneMaterials(c);
        this.modelRoot.remove(c);
      }
    }
    if (this.flameTemplate) {
      disposeObject3DFull(this.flameTemplate);
      this.flameTemplate = null;
    }
    this.dock.remove();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.modelRoot = null;
  }
}
